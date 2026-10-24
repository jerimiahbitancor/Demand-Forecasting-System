-- Migration 020: a sales upload is saved only when there is enough stock.
--
-- Run this in the Supabase SQL editor. It is idempotent: every statement can
-- be re-run safely.
--
-- WHY
--
-- Until now a sales upload saved its daily_sales rows FIRST and deducted the
-- ingredients AFTER, one ingredient at a time. When an ingredient did not
-- have enough stock, deduct_ingredient_stock() clamped at zero and logged a
-- "shortfall": the sales were saved, but the stock no longer matched them.
--
-- The rule now (owner's decision, Oct 2026): a sales file that needs more of
-- any ingredient than is in stock is NOT saved at all. No daily_sales rows,
-- no deductions. The owner is told which ingredients are short, restocks or
-- corrects the count, and uploads the same file again. There is no
-- negative stock and no "shortfall" deduction anywhere any more:
-- deduct_ingredient_stock() itself now refuses (section 0), and the backend
-- has no fallback to the old path (it refuses the upload if this migration
-- has not been run).
--
-- Numbered 020: 016 (lock_down_browser_roles) and 017-019 (ingredient unit
-- clean-up) were already taken on the `fixes` branch.
--
-- WHY A DATABASE FUNCTION, NOT A CHECK IN NODE
--
-- The upload screen sends 3 files at once. Two files can need the same
-- ingredient: rice has 10 kg, each file needs 6 kg. A check in Node reads
-- "10 kg, enough" for BOTH files before either deducts, both save, and the
-- second deduction comes up 2 kg short: the exact state this rule forbids.
-- (This is a "check-then-act" race, also called TOCTOU: time of check vs.
-- time of use.)
--
-- apply_sales_upload() closes that gap: it locks every ingredient row the
-- file deducts (SELECT ... FOR UPDATE, lowest id first so two uploads cannot
-- deadlock), checks them all, and only then inserts the sales rows and
-- deducts, all inside ONE transaction. A second upload needing the same
-- ingredient waits for the lock, then sees the reduced stock and is refused.
-- If anything fails part-way (a duplicate sales day, a missing ingredient),
-- Postgres rolls the whole thing back: never sales without deductions, never
-- deductions without sales.

-- ---------------------------------------------------------------------------
-- 0. deduct_ingredient_stock refuses instead of clamping at zero
-- ---------------------------------------------------------------------------
-- Same signature, same return columns, same idempotency key as migration 015.
-- One change: a deduction bigger than the stock RAISES (nothing is written)
-- instead of applying what is there and logging a "shortfall". No caller can
-- produce a negative-stock / shortfall movement any more, even by mistake.
-- apply_sales_upload() below checks first, so it never hits this; it is the
-- last line of defence for any other caller.
CREATE OR REPLACE FUNCTION public.deduct_ingredient_stock(
  p_ingredient_id integer,
  p_deduction text,
  p_reference_type text,
  p_reference_id integer,
  p_updated_by integer DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_requested_exact text DEFAULT NULL
)
RETURNS TABLE (
  previous_quantity numeric,
  new_quantity numeric,
  requested_quantity numeric,
  requested_exact_quantity numeric,
  rounded_quantity numeric,
  applied_quantity numeric,
  shortfall_quantity numeric,
  already_applied boolean
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deduction numeric(18,6);
  v_requested_exact numeric(18,6);
  v_old_quantity numeric(18,6);
  v_new_quantity numeric(18,6);
  v_unit text;
  v_name text;
  v_existing public.inventory_transactions%ROWTYPE;
BEGIN
  v_deduction := round(p_deduction::numeric, 6);
  IF v_deduction <= 0 THEN
    RAISE EXCEPTION 'Stock deduction must be greater than zero';
  END IF;
  IF p_reference_type IS NULL OR p_reference_id IS NULL THEN
    RAISE EXCEPTION 'A deduction reference type and reference ID are required';
  END IF;
  v_requested_exact := COALESCE(p_requested_exact::numeric, v_deduction)::numeric(18,6);

  -- FOR UPDATE: concurrent callers serialize on this row instead of racing.
  SELECT i.quantity, i.unit, i.name
    INTO v_old_quantity, v_unit, v_name
  FROM public.ingredients i
  WHERE i.id = p_ingredient_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient % does not exist', p_ingredient_id;
  END IF;

  -- Already applied for this reference: report the original, change nothing.
  SELECT * INTO v_existing
  FROM public.inventory_transactions t
  WHERE t.transaction_type = 'sale'
    AND t.reference_type = p_reference_type
    AND t.reference_id = p_reference_id
    AND t.ingredient_id = p_ingredient_id;
  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.previous_quantity, v_existing.new_quantity,
      v_existing.requested_quantity, v_existing.requested_exact_quantity,
      v_existing.requested_quantity, v_existing.applied_quantity,
      v_existing.shortfall_quantity, true;
    RETURN;
  END IF;

  -- The hard stop.
  IF v_deduction > GREATEST(0, v_old_quantity) THEN
    RAISE EXCEPTION 'Not enough stock for % (ingredient %): needs %, has %',
      COALESCE(v_name, '?'), p_ingredient_id,
      public._stock_amount_text(v_deduction),
      public._stock_amount_text(GREATEST(0, v_old_quantity))
      USING ERRCODE = 'P0001', HINT = 'insufficient_stock';
  END IF;

  v_new_quantity := v_old_quantity - v_deduction;

  INSERT INTO public.inventory_transactions (
    ingredient_id, transaction_type, quantity, previous_quantity, new_quantity,
    requested_quantity, requested_exact_quantity, applied_quantity, shortfall_quantity,
    unit, reference_type, reference_id, reason, notes, created_by
  ) VALUES (
    p_ingredient_id, 'sale', -v_deduction, v_old_quantity, v_new_quantity,
    v_deduction, v_requested_exact, v_deduction, 0,
    v_unit, p_reference_type, p_reference_id,
    'Automatic deduction from mapped product sales',
    concat_ws(' ', p_notes, format(
      'Exact requested: %s; deducted: %s %s.',
      public._stock_amount_text(v_requested_exact),
      public._stock_amount_text(v_deduction), v_unit)),
    p_updated_by
  );

  UPDATE public.ingredients
  SET quantity = v_new_quantity,
      updated_by = COALESCE(p_updated_by, updated_by)
  WHERE id = p_ingredient_id;

  RETURN QUERY SELECT
    v_old_quantity::numeric, v_new_quantity::numeric, v_deduction::numeric,
    v_requested_exact::numeric, v_deduction::numeric, v_deduction::numeric,
    0::numeric, false;
END;
$$;

COMMENT ON FUNCTION public.deduct_ingredient_stock(integer, text, text, integer, integer, text, text) IS
  'Atomically deducts stock for one ingredient and logs it. Refuses (raises) when the stock is not enough: no shortfall is ever deducted. Idempotent per (reference_type, reference_id, ingredient_id).';

-- ---------------------------------------------------------------------------
-- 1. apply_sales_upload
-- ---------------------------------------------------------------------------
-- p_daily_sales: [{ "product_id": 12, "sale_date": "2026-10-20", "quantity_sold": 31 }, ...]
-- p_deductions:  [{ "ingredient_id": 4, "deduction": "1.250", "requested_exact": "1.2493",
--                   "notes": null }, ...]   amounts as TEXT, in the ingredient's base unit,
--                                            already rounded once by the backend.
--
-- Returns jsonb:
--   { "ok": false, "shortfalls": [{ ingredient_id, name, unit, required, available, shortfall }] }
--     -> nothing was written
--   { "ok": true, "sales_rows": n, "deductions": [{ ingredient_id, previous_quantity,
--       new_quantity, applied_quantity, shortfall_quantity, already_applied }] }
CREATE OR REPLACE FUNCTION public.apply_sales_upload(
  p_upload_id integer,
  p_updated_by integer,
  p_daily_sales jsonb,
  p_deductions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deductions jsonb := COALESCE(p_deductions, '[]'::jsonb);
  v_sales jsonb := COALESCE(p_daily_sales, '[]'::jsonb);
  v_item record;
  v_result record;
  v_shortfalls jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_sales_rows integer := 0;
BEGIN
  IF p_upload_id IS NULL THEN
    RAISE EXCEPTION 'apply_sales_upload: an upload id is required';
  END IF;
  IF jsonb_typeof(v_deductions) <> 'array' OR jsonb_typeof(v_sales) <> 'array' THEN
    RAISE EXCEPTION 'apply_sales_upload: p_daily_sales and p_deductions must be JSON arrays';
  END IF;

  -- 1. Lock every ingredient this file deducts, lowest id first.
  PERFORM 1
  FROM public.ingredients i
  WHERE i.id IN (
    SELECT (d->>'ingredient_id')::integer FROM jsonb_array_elements(v_deductions) d
  )
  ORDER BY i.id
  FOR UPDATE;

  -- 2. Check EVERY ingredient before writing anything.
  FOR v_item IN
    SELECT
      (d->>'ingredient_id')::integer AS ingredient_id,
      round((d->>'deduction')::numeric, 6) AS deduction,
      i.id AS found_id,
      i.name,
      i.unit,
      GREATEST(0, COALESCE(i.quantity, 0)) AS available
    FROM jsonb_array_elements(v_deductions) d
    LEFT JOIN public.ingredients i ON i.id = (d->>'ingredient_id')::integer
  LOOP
    IF v_item.found_id IS NULL THEN
      RAISE EXCEPTION 'apply_sales_upload: ingredient % does not exist', v_item.ingredient_id;
    END IF;
    IF v_item.deduction IS NULL OR v_item.deduction <= 0 THEN
      RAISE EXCEPTION 'apply_sales_upload: deduction for ingredient % must be greater than zero', v_item.ingredient_id;
    END IF;
    IF v_item.deduction > v_item.available THEN
      v_shortfalls := v_shortfalls || jsonb_build_object(
        'ingredient_id', v_item.ingredient_id,
        'name', v_item.name,
        'unit', v_item.unit,
        'required', public._stock_amount_text(v_item.deduction),
        'available', public._stock_amount_text(v_item.available),
        'shortfall', public._stock_amount_text(v_item.deduction - v_item.available)
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_shortfalls) > 0 THEN
    -- Nothing has been written; returning (not raising) lets the backend show
    -- the owner exactly which ingredients are short. The row locks are
    -- released when this transaction ends.
    RETURN jsonb_build_object('ok', false, 'shortfalls', v_shortfalls);
  END IF;

  -- 3. The sales rows. A day already uploaded for a product raises 23505 on
  --    daily_sales_product_id_sale_date_key and rolls everything back.
  INSERT INTO public.daily_sales (product_id, sale_date, quantity_sold, upload_id)
  SELECT x.product_id, x.sale_date, x.quantity_sold, p_upload_id
  FROM jsonb_to_recordset(v_sales) AS x(product_id integer, sale_date date, quantity_sold integer);
  GET DIAGNOSTICS v_sales_rows = ROW_COUNT;

  -- 4. The deductions, through the existing function: same log rows, same
  --    (reference_type, reference_id, ingredient_id) idempotency key. The
  --    check above guarantees each one is applied in full.
  FOR v_item IN
    SELECT
      (d->>'ingredient_id')::integer AS ingredient_id,
      d->>'deduction' AS deduction,
      NULLIF(d->>'requested_exact', '') AS requested_exact,
      NULLIF(d->>'notes', '') AS notes
    FROM jsonb_array_elements(v_deductions) d
    ORDER BY (d->>'ingredient_id')::integer
  LOOP
    SELECT * INTO v_result
    FROM public.deduct_ingredient_stock(
      v_item.ingredient_id, v_item.deduction, 'upload', p_upload_id,
      p_updated_by, v_item.notes, v_item.requested_exact
    );
    v_results := v_results || jsonb_build_object(
      'ingredient_id', v_item.ingredient_id,
      'previous_quantity', v_result.previous_quantity,
      'new_quantity', v_result.new_quantity,
      'applied_quantity', v_result.applied_quantity,
      'shortfall_quantity', v_result.shortfall_quantity,
      'already_applied', v_result.already_applied
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sales_rows', v_sales_rows, 'deductions', v_results);
END;
$$;

COMMENT ON FUNCTION public.apply_sales_upload(integer, integer, jsonb, jsonb) IS
  'Saves one sales upload (daily_sales rows + ingredient deductions) only if every ingredient has enough stock; otherwise writes nothing and returns the shortfalls. One transaction, ingredient rows locked.';

-- ---------------------------------------------------------------------------
-- 2. Only the backend may call these functions
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- Supabase exposes public functions at /rest/v1/rpc/<name>. The anon key is
-- in the browser bundle (it has to be, for login), so without these REVOKEs
-- anyone could call apply_sales_upload(), or deduct/restock stock directly,
-- and skip Express's authentication entirely. Migration 011 already did this
-- for merge_products(); migrations 013-015 did not for the stock functions.
REVOKE ALL ON FUNCTION public.apply_sales_upload(integer, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sales_upload(integer, integer, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.deduct_ingredient_stock(integer, text, text, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_ingredient_stock(integer, text, text, integer, integer, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.restock_ingredient_stock(integer, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restock_ingredient_stock(integer, text, integer, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Check (optional): both should return false for anon.
-- ---------------------------------------------------------------------------
-- SELECT has_function_privilege('anon', 'public.apply_sales_upload(integer, integer, jsonb, jsonb)', 'EXECUTE');
-- SELECT has_function_privilege('anon', 'public.deduct_ingredient_stock(integer, text, text, integer, integer, text, text)', 'EXECUTE');
