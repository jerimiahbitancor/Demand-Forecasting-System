-- Migration 013: inventory stock deduction hardening.
--
-- Canonical units, decimal precision, and an atomic, idempotent deduction RPC.
--
-- Run this in the Supabase SQL editor. It is idempotent: every statement can
-- be re-run safely.
--
-- The repository uses INTEGER primary keys everywhere (ingredients.id,
-- uploads.id, "user".id), so the RPC keeps integer ids instead of the uuid
-- used in the original design note.
--
-- CANONICAL UNIT
-- --------------
-- base_unit is the unit ingredients.quantity is stored in. It is the
-- ingredient's OWN canonical unit ('g', 'kg', 'mL', 'L', 'pcs', 'slice', ...),
-- not a single global pivot: the pivot units ('g', 'mL', 'piece') are used
-- INSIDE the conversion, and a recipe amount is converted into base_unit
-- before anything is written. Keeping quantity in base_unit means the
-- deduction amount and the stored stock are always the same unit, so the RPC
-- needs no unit maths of its own.
--
-- pack_size is how many base units ONE purchase pack contains. A 150 g
-- sachet of an ingredient stocked in grams has pack_size = 150 and
-- base_unit = 'g'. A pack of 12 eggs has pack_size = 12 and base_unit =
-- 'pcs'. The recipe unit "pack" then resolves through pack_size.
--
-- pack_qty / pack_unit keep their ORIGINAL meaning ("150 g per sachet"): they
-- are what the owner typed and what deriveUnitPrice() uses for costing.

-- ---------------------------------------------------------------------------
-- 1. ingredients: canonical unit columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS base_unit text,
  ADD COLUMN IF NOT EXISTS unit_family text,
  ADD COLUMN IF NOT EXISTS stock_scale integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS allow_fractional boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pack_size numeric(18,6),
  ADD COLUMN IF NOT EXISTS density_g_per_ml numeric(18,6);

-- base_unit = the SHORT unit name the ingredient is stocked in: the name in
-- the brackets when the display name has one ('Kilograms (kg)' -> 'kg',
-- 'Pieces (pcs)' -> 'pcs'), else the name itself ('Slices' -> 'slices').
UPDATE public.ingredients i
SET base_unit = lower(
      CASE
        WHEN u.name ~ '\(([^)]+)\)\s*$'
          THEN regexp_replace(u.name, '^.*\(([^)]+)\)\s*$', '\1')
        ELSE u.name
      END)
FROM public.ingredient_units u
WHERE i.base_unit IS NULL
  AND i.unit_id = u.id;

-- base_unit = the raw unit string when there is no ingredient_units row.
UPDATE public.ingredients i
SET base_unit = lower(btrim(i.unit))
WHERE i.base_unit IS NULL
  AND i.unit IS NOT NULL
  AND btrim(i.unit) <> '';

-- unit_family = mass | volume | count, from the ingredient_units row.
UPDATE public.ingredients i
SET unit_family = u.family
FROM public.ingredient_units u
WHERE i.unit_family IS NULL
  AND i.unit_id = u.id
  AND u.family IN ('mass', 'volume', 'count');

-- A count-family ingredient that has no unit row is still a count.
UPDATE public.ingredients i
SET unit_family = 'count'
WHERE i.unit_family IS NULL
  AND lower(i.base_unit) IN ('pcs', 'pc', 'piece', 'pieces', 'slices', 'cloves', 'sticks');

-- A discrete unit (an egg, a slice) is never split: allow_fractional = false.
UPDATE public.ingredients
SET allow_fractional = false
WHERE unit_family = 'count'
  AND allow_fractional = true;

-- A mass or volume ingredient may carry fractions (0.5 kg of sugar).
UPDATE public.ingredients
SET allow_fractional = true
WHERE unit_family IN ('mass', 'volume')
  AND allow_fractional = false;

-- density_g_per_ml: the canonical grams-per-mL, derived from grams_per_cup.
-- A mass <-> volume conversion is only allowed when this is set, so the
-- ingredient's own density is what travels with it.
UPDATE public.ingredients
SET density_g_per_ml = round((grams_per_cup / 240), 6)
WHERE density_g_per_ml IS NULL
  AND grams_per_cup IS NOT NULL
  AND grams_per_cup > 0;

-- ---------------------------------------------------------------------------
-- 2. pack_size: how many base units one purchase pack contains
-- ---------------------------------------------------------------------------
-- Mass / volume: one 150 g sachet of an ingredient stocked in kg is 0.15 kg,
-- so pack_size = 0.15 and base_unit = 'kg'.
UPDATE public.ingredients i
SET pack_size = round(
  CASE
    WHEN pu.family = bu.family
      THEN (i.pack_qty * pu.base_factor) / bu.base_factor
    WHEN bu.family = 'mass' AND pu.family = 'volume'
      THEN (i.pack_qty * pu.base_factor * i.density_g_per_ml) / bu.base_factor
    WHEN bu.family = 'volume' AND pu.family = 'mass'
      THEN (i.pack_qty * pu.base_factor / i.density_g_per_ml) / bu.base_factor
  END,
  6
)
FROM public.ingredient_units bu,
     public.ingredient_units pu
WHERE i.pack_size IS NULL
  AND i.pack_qty IS NOT NULL
  AND i.pack_qty > 0
  AND i.pack_unit IS NOT NULL
  AND btrim(i.pack_unit) <> ''
  AND i.base_unit IS NOT NULL
  AND btrim(i.base_unit) <> ''
  AND bu.id = i.unit_id
  AND bu.family IN ('mass', 'volume')
  AND bu.base_factor > 0
  AND pu.base_factor > 0
  AND (
    pu.family = bu.family
    OR i.density_g_per_ml IS NOT NULL
  )
  AND pu.family IN ('mass', 'volume')
  AND (
    lower(pu.name) = lower(btrim(i.pack_unit))
    OR EXISTS (
      SELECT 1 FROM unnest(pu.aliases) AS alias(alias_name)
      WHERE lower(alias_name) = lower(btrim(i.pack_unit))
    )
  );

-- Count: one pack holds pack_qty pieces.
UPDATE public.ingredients i
SET pack_size = round(i.pack_qty, 6)
FROM public.ingredient_units bu,
     public.ingredient_units pu
WHERE i.pack_size IS NULL
  AND i.pack_qty IS NOT NULL
  AND i.pack_qty > 0
  AND i.pack_unit IS NOT NULL
  AND btrim(i.pack_unit) <> ''
  AND bu.id = i.unit_id
  AND bu.family = 'count'
  AND pu.family = 'count'
  AND (
    lower(pu.name) = lower(btrim(i.pack_unit))
    OR EXISTS (
      SELECT 1 FROM unnest(pu.aliases) AS alias(alias_name)
      WHERE lower(alias_name) = lower(btrim(i.pack_unit))
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Decimal columns
-- ---------------------------------------------------------------------------
-- product_ingredients.quantity_per_serving was historically free text, so
-- fractions such as "1/2" must still parse. Parse decimal, fraction and
-- mixed-number values exactly.
CREATE OR REPLACE FUNCTION public._parse_recipe_quantity_2(p_value text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_match text[];
  v_denominator numeric;
BEGIN
  v_match := regexp_match(btrim(p_value), '^(-?[0-9]+(?:\.[0-9]+)?)\s+([+-]?[0-9]+)\s*/\s*([0-9]+)$');
  IF v_match IS NOT NULL THEN
    v_denominator := v_match[3]::numeric;
    IF v_denominator = 0 THEN
      RAISE WARNING 'Invalid recipe fraction "%"; kept as text', p_value;
      RETURN NULL;
    END IF;
    RETURN v_match[1]::numeric + v_match[2]::numeric / v_denominator;
  END IF;

  v_match := regexp_match(btrim(p_value), '^(-?[0-9]+)\s*/\s*([0-9]+)$');
  IF v_match IS NOT NULL THEN
    v_denominator := v_match[2]::numeric;
    IF v_denominator = 0 THEN
      RAISE WARNING 'Invalid recipe fraction "%"; kept as text', p_value;
      RETURN NULL;
    END IF;
    RETURN v_match[1]::numeric / v_denominator;
  END IF;

  IF btrim(p_value) ~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$' THEN
    RETURN btrim(p_value)::numeric;
  END IF;
  RAISE WARNING 'Cannot convert recipe quantity "%" to numeric; kept as text', p_value;
  RETURN NULL;
END;
$$;

-- The original text is kept, so a value the parser could not read is never
-- lost by the type change below.
ALTER TABLE public.product_ingredients
  ADD COLUMN IF NOT EXISTS quantity_per_serving_text text;

UPDATE public.product_ingredients
SET quantity_per_serving_text = quantity_per_serving::text
WHERE quantity_per_serving_text IS NULL
  AND quantity_per_serving IS NOT NULL;

ALTER TABLE public.ingredients
  ALTER COLUMN quantity TYPE numeric(18,6) USING quantity::numeric(18,6);

ALTER TABLE public.product_ingredients
  ALTER COLUMN quantity_per_serving TYPE numeric(18,6)
  USING public._parse_recipe_quantity_2(quantity_per_serving::text)::numeric(18,6),
  ALTER COLUMN quantity_per_serving DROP NOT NULL;

DROP FUNCTION public._parse_recipe_quantity_2(text);

ALTER TABLE public.inventory_transactions
  ALTER COLUMN quantity TYPE numeric(18,6) USING quantity::numeric(18,6),
  ALTER COLUMN previous_quantity TYPE numeric(18,6) USING previous_quantity::numeric(18,6),
  ALTER COLUMN new_quantity TYPE numeric(18,6) USING new_quantity::numeric(18,6),
  ADD COLUMN IF NOT EXISTS requested_quantity numeric(18,6),
  ADD COLUMN IF NOT EXISTS requested_exact_quantity numeric(18,6),
  ADD COLUMN IF NOT EXISTS applied_quantity numeric(18,6),
  ADD COLUMN IF NOT EXISTS shortfall_quantity numeric(18,6),
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id integer;

-- ---------------------------------------------------------------------------
-- 4. Per-ingredient house measures (1 tbsp sugar = 12 g)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingredient_unit_conversions (
  ingredient_id integer NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  factor numeric(18,6) NOT NULL CHECK (factor > 0),
  PRIMARY KEY (ingredient_id, from_unit, to_unit)
);

COMMENT ON TABLE public.ingredient_unit_conversions IS
  'House measures per ingredient: how many to_units one from_unit is worth (1 tbsp sugar = 12 g). Overrides the generic density tables.';

-- ---------------------------------------------------------------------------
-- 5. One sale transaction per (reference, ingredient) - retry safety
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS inventory_transactions_sale_reference_ingredient_key
  ON public.inventory_transactions (reference_type, reference_id, ingredient_id)
  WHERE transaction_type = 'sale';

-- The application-level lookup avoids ordinary duplicates; this unique index
-- also closes the race between two simultaneous upload retries.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_stock_shortfall_key
  ON public.notifications (user_id, (metadata ->> 'key'))
  WHERE (metadata ->> 'key') LIKE 'stock_shortfall:%';

-- ---------------------------------------------------------------------------
-- 6. The deduction RPC
-- ---------------------------------------------------------------------------
-- Atomic: the stock UPDATE and the inventory_transactions INSERT happen in
-- the same transaction, so a stock change without its log (or the other way
-- round) is impossible.
-- Idempotent: a second call with the same (reference_type, reference_id)
-- does nothing and reports already_applied = true.
-- Exact: p_deduction arrives as TEXT and is parsed by Postgres, never by
-- JavaScript, so no binary float ever touches the stock number.
DROP FUNCTION IF EXISTS public.deduct_ingredient_stock(integer, numeric, integer);
DROP FUNCTION IF EXISTS public.deduct_ingredient_stock(integer, text, text, integer, integer, text, text);

CREATE FUNCTION public.deduct_ingredient_stock(
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
      v_requested_exact, v_deduction, v_applied, v_shortfall, v_unit)),
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
