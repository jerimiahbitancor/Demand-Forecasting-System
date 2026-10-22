-- Audit: ingredients whose quantity carries more decimals than their
-- stock_scale allows.
--
-- This script ONLY reports. It changes nothing.
--
-- 1) Run the SELECT to see the rows that carry extra decimals.
-- 2) Decide whether to round them.
-- 3) Only then set the flag below to true and re-run the whole file.
--
-- The flag is false on purpose: rounding stock that a real (unrounded)
-- deduction created would quietly change the numbers the owner sees.

-- ---------------------------------------------------------------------------
-- 1. Rows that are not equal to their own rounded value
-- ---------------------------------------------------------------------------
SELECT id,
       name,
       unit,
       base_unit,
       unit_family,
       stock_scale,
       quantity,
       round(quantity, stock_scale) AS rounded_quantity,
       quantity - round(quantity, stock_scale) AS excess_decimals
FROM public.ingredients
WHERE quantity <> round(quantity, stock_scale)
ORDER BY name, id;

-- ---------------------------------------------------------------------------
-- 2. Summary: how many rows are affected
-- ---------------------------------------------------------------------------
SELECT count(*) AS rows_with_extra_decimals,
       count(*) FILTER (WHERE quantity < 0) AS negative_quantities
FROM public.ingredients
WHERE quantity <> round(quantity, stock_scale);

-- ---------------------------------------------------------------------------
-- 3. Sale transactions whose applied amount does not match their ingredient's
--    stock scale (the same drift, one level down)
-- ---------------------------------------------------------------------------
SELECT t.id,
       t.ingredient_id,
       i.name,
       i.stock_scale,
       t.unit,
       t.requested_quantity,
       t.applied_quantity,
       t.shortfall_quantity,
       t.quantity
FROM public.inventory_transactions t
JOIN public.ingredients i ON i.id = t.ingredient_id
WHERE t.transaction_type = 'sale'
  AND t.applied_quantity IS NOT NULL
  AND t.applied_quantity <> round(t.applied_quantity, i.stock_scale)
ORDER BY t.id;

-- ---------------------------------------------------------------------------
-- 4. The fix. Nothing runs unless the flag below is set to true.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_apply_rounding boolean := false;
  v_updated_rows integer;
BEGIN
  IF v_apply_rounding THEN
    UPDATE public.ingredients
    SET quantity = round(quantity, stock_scale)::numeric(18,6)
    WHERE quantity <> round(quantity, stock_scale);
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    RAISE NOTICE 'Rounded % ingredient quantity row(s) to their stock_scale', v_updated_rows;
  ELSE
    RAISE NOTICE 'No rows were changed. Review the report above, then set v_apply_rounding to true.';
  END IF;
END;
$$;
