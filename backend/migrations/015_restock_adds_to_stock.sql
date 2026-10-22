-- Migration 015: a restock always lands in the stock balance, and the
-- numbers written into the transaction notes carry no trailing-zero decimals.
--
-- Run this in the Supabase SQL editor. It is idempotent: every statement can
-- be re-run safely.
--
-- WHY
--
-- Migration 014 made a restock pay off outstanding sales shortfalls BEFORE the
-- remainder was added to the stock balance. In practice that made the "Add
-- Stock" button look broken: restocking 30 g of a powder that had a 100 g
-- sale shortfall logged
--
--   "Received 30.000000 Grams (g); 30.000000 settled previous sales
--    shortfalls; 0.000000 added to available stock."
--
-- and the Current Stock column did not move by a single gram. Stock that was
-- physically received has to be stock on hand, so from here on the whole
-- received amount is added to ingredients.quantity.
--
-- The shortfalls themselves are NOT lost. They stay recorded in
-- inventory_shortfall_balances and in the note of the sale transaction that
-- could not be fulfilled, so the unmet demand is still visible. A manual
-- stock count (an "adjustment" transaction) still clears them, because a
-- count already includes everything physically on hand.
--
-- The second half of this migration removes the trailing-zero noise from the
-- numbers Postgres writes into the notes ("150.000000" -> "150"), so the
-- stock history reads the way the rest of the app does.

-- ---------------------------------------------------------------------------
-- 1. One number -> text without trailing zeros
-- ---------------------------------------------------------------------------
-- 30.000000 -> '30', 0.500000 -> '0.5', 2.983500 -> '2.9835'.
-- The value itself is never rounded here: only its text form is cleaned up.
CREATE OR REPLACE FUNCTION public._stock_amount_text(p_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN p_value = trunc(p_value) THEN trunc(p_value)::bigint::text
    ELSE rtrim(rtrim(p_value::text, '0'), '.')
  END;
$$;

COMMENT ON FUNCTION public._stock_amount_text(numeric) IS
  'Formats a stock amount as text without trailing zeros (30.000000 -> 30).';

-- ---------------------------------------------------------------------------
-- 2. A restock adds the whole received amount to the stock balance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restock_ingredient_stock(
  p_ingredient_id integer,
  p_quantity text,
  p_updated_by integer DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  previous_quantity numeric,
  new_quantity numeric,
  received_quantity numeric,
  shortfall_settled_quantity numeric,
  added_quantity numeric,
  unit text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_received numeric(18,6);
  v_old_quantity numeric(18,6);
  v_new_quantity numeric(18,6);
  v_unit text;
BEGIN
  v_received := round(p_quantity::numeric, 6)::numeric(18,6);
  IF v_received <= 0 THEN
    RAISE EXCEPTION 'Restock quantity must be greater than zero';
  END IF;

  -- Serialize restocks and sales for this ingredient.
  SELECT i.quantity, i.unit
    INTO v_old_quantity, v_unit
  FROM public.ingredients i
  WHERE i.id = p_ingredient_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient % does not exist', p_ingredient_id;
  END IF;

  -- Everything that was received is stock on hand now.
  v_new_quantity := v_old_quantity + v_received;

  UPDATE public.ingredients
  SET quantity = v_new_quantity,
      updated_by = COALESCE(p_updated_by, updated_by)
  WHERE id = p_ingredient_id;

  INSERT INTO public.inventory_transactions (
    ingredient_id, transaction_type, quantity, previous_quantity, new_quantity,
    requested_quantity, applied_quantity, shortfall_quantity,
    received_quantity, shortfall_settled_quantity, unit,
    reason, notes, created_by
  ) VALUES (
    p_ingredient_id, 'restock', v_received, v_old_quantity, v_new_quantity,
    v_received, v_received, 0,
    v_received, 0, v_unit,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Restock'),
    concat_ws(' ',
      NULLIF(btrim(p_notes), ''),
      format('Received %s %s; stock is now %s %s.',
        public._stock_amount_text(v_received), v_unit,
        public._stock_amount_text(v_new_quantity), v_unit)),
    p_updated_by
  );

  RETURN QUERY SELECT
    v_old_quantity::numeric, v_new_quantity::numeric, v_received::numeric,
    0::numeric, v_received::numeric, v_unit;
END;
$$;

COMMENT ON FUNCTION public.restock_ingredient_stock(integer, text, integer, text, text) IS
  'Adds the received stock to the ingredient balance and logs the movement. The whole received amount lands in the stock balance; earlier sales shortfalls stay recorded instead of being paid off here.';

-- ---------------------------------------------------------------------------
-- 3. The deduction note loses its trailing-zero decimals
-- ---------------------------------------------------------------------------
-- Only the note text changes: the deduction itself (clamped at zero, atomic,
-- idempotent per upload) is exactly what migration 013 defined.
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
AS $$
DECLARE
  v_deduction numeric(18,6);
  v_requested_exact numeric(18,6);
  v_old_quantity numeric(18,6);
  v_new_quantity numeric(18,6);
  v_applied numeric(18,6);
  v_shortfall numeric(18,6);
  v_unit text;
  v_transaction_id uuid;
  v_existing public.inventory_transactions%ROWTYPE;
BEGIN
  -- p_deduction is TEXT on purpose: Postgres parses the decimal exactly.
  -- A JSON float would already have lost digits before it got here.
  v_deduction := round(p_deduction::numeric, 6);
  IF v_deduction <= 0 THEN
    RAISE EXCEPTION 'Stock deduction must be greater than zero';
  END IF;
  IF p_reference_type IS NULL OR p_reference_id IS NULL THEN
    RAISE EXCEPTION 'A deduction reference type and reference ID are required';
  END IF;
  v_requested_exact := COALESCE(p_requested_exact::numeric, v_deduction)::numeric(18,6);

  -- FOR UPDATE: concurrent callers serialize on this row instead of racing.
  SELECT i.quantity, i.unit
    INTO v_old_quantity, v_unit
  FROM public.ingredients i
  WHERE i.id = p_ingredient_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient % does not exist', p_ingredient_id;
  END IF;

  -- Clamp FIRST, then subtract: the applied amount can never exceed the
  -- stock, so the new quantity can never go below zero.
  v_applied := LEAST(v_deduction, GREATEST(0, v_old_quantity));
  v_new_quantity := GREATEST(0, v_old_quantity - v_applied);
  v_shortfall := GREATEST(0, v_deduction - GREATEST(0, v_old_quantity));

  -- The log row and the stock change share this transaction.
  INSERT INTO public.inventory_transactions (
    ingredient_id, transaction_type, quantity, previous_quantity, new_quantity,
    requested_quantity, requested_exact_quantity, applied_quantity, shortfall_quantity,
    unit, reference_type, reference_id, reason, notes, created_by
  ) VALUES (
    p_ingredient_id, 'sale', -v_applied, v_old_quantity, v_new_quantity,
    v_deduction, v_requested_exact, v_applied, v_shortfall,
    v_unit, p_reference_type, p_reference_id,
    'Automatic deduction from mapped product sales',
    concat_ws(' ', p_notes, format(
      'Exact requested: %s; rounded request: %s; applied: %s; shortfall: %s %s.',
      public._stock_amount_text(v_requested_exact),
      public._stock_amount_text(v_deduction),
      public._stock_amount_text(v_applied),
      public._stock_amount_text(v_shortfall), v_unit)),
    p_updated_by
  )
  ON CONFLICT (reference_type, reference_id, ingredient_id)
    WHERE transaction_type = 'sale'
    DO NOTHING
  RETURNING id INTO v_transaction_id;

  -- The upload was already applied: report the original result and change
  -- nothing. This is what makes a retried upload safe.
  IF v_transaction_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.inventory_transactions
    WHERE transaction_type = 'sale'
      AND reference_type = p_reference_type
      AND reference_id = p_reference_id
      AND ingredient_id = p_ingredient_id;
    RETURN QUERY SELECT
      v_existing.previous_quantity, v_existing.new_quantity,
      v_existing.requested_quantity, v_existing.requested_exact_quantity,
      v_existing.requested_quantity, v_existing.applied_quantity,
      v_existing.shortfall_quantity, true;
    RETURN;
  END IF;

  UPDATE public.ingredients
  SET quantity = GREATEST(0, quantity - v_applied),
      updated_by = COALESCE(p_updated_by, updated_by)
  WHERE id = p_ingredient_id;

  RETURN QUERY SELECT
    v_old_quantity::numeric, v_new_quantity::numeric, v_deduction::numeric,
    v_requested_exact::numeric, v_deduction::numeric, v_applied::numeric,
    v_shortfall::numeric, false;
END;
$$;

COMMENT ON FUNCTION public.deduct_ingredient_stock(integer, text, text, integer, integer, text, text) IS
  'Atomically deducts stock for one ingredient and writes the matching inventory_transactions row. Idempotent per (reference_type, reference_id, ingredient_id).';

-- ---------------------------------------------------------------------------
-- 4. The notes that are already stored
-- ---------------------------------------------------------------------------
-- 4a. A restock note of migration 014 claims the incoming stock settled old
--     sales shortfalls, and that is no longer what happens. The note is
--     rebuilt from the movement itself; a note the owner typed is kept.
UPDATE public.inventory_transactions t
SET notes = concat_ws(' · ',
    NULLIF(btrim(regexp_replace(split_part(t.notes, 'Received ', 1), '[[:space:]·]+$', '')), ''),
    CASE
      WHEN COALESCE(t.unit, i.unit) IS NULL THEN
        format('Received %s; stock is now %s.',
          public._stock_amount_text(t.received_quantity),
          public._stock_amount_text(t.new_quantity))
      ELSE
        format('Received %s %s; stock is now %s %s.',
          public._stock_amount_text(t.received_quantity), COALESCE(t.unit, i.unit),
          public._stock_amount_text(t.new_quantity), COALESCE(t.unit, i.unit))
    END)
FROM public.ingredients i
WHERE i.id = t.ingredient_id
  AND t.transaction_type = 'restock'
  AND t.received_quantity IS NOT NULL;

-- 4b. Every remaining note loses its trailing-zero decimals:
--     "150.000000" -> "150", "0.500000" -> "0.5".
UPDATE public.inventory_transactions
SET notes = regexp_replace(
              regexp_replace(notes, '([0-9]+)\.([0-9]*[1-9])0+', '\1.\2', 'g'),
              '([0-9]+)\.0+', '\1', 'g')
WHERE notes IS NOT NULL
  AND notes ~ '[0-9]\.[0-9]*0';

-- ---------------------------------------------------------------------------
-- 5. Stock that carries more decimals than its own scale
-- ---------------------------------------------------------------------------
-- The stock scale is the precision the ingredient is counted in (3 decimals
-- for a kilogram, so 0.5 g is not a thing). Two rows carried more than that
-- (a 4-decimal value that no count could ever produce).
UPDATE public.ingredients
SET quantity = round(quantity, stock_scale)::numeric(18,6)
WHERE stock_scale IS NOT NULL
  AND quantity <> round(quantity, stock_scale);
