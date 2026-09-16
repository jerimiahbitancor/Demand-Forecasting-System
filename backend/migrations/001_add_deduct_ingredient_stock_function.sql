-- Migration: atomic ingredient stock deduction
--
-- WHY: uploadService.processSalesData() deducted stock with two separate
-- round trips from Node — SELECT quantity, compute new = max(0, old -
-- deduction) in JS, then UPDATE. Two concurrent sales uploads touching the
-- same ingredient (e.g. two daily CSVs for products that share an
-- ingredient, uploaded in the same batch) can both read the same starting
-- quantity before either UPDATE lands, so the second UPDATE overwrites the
-- first — one of the two deductions is silently lost. This is the same
-- class of bug as the products SELECT-then-INSERT race in
-- uploadService.syncProductsFromSales, just on ingredients.quantity
-- instead of products.name.
--
-- This function does the read, clamp, and write as ONE statement inside
-- Postgres, so the whole operation is atomic under Postgres's normal
-- row-level locking — concurrent callers serialize on the same ingredient
-- row instead of racing. It returns both the pre- and post-deduction
-- quantity so the caller can log an accurate inventory_transactions row
-- without a separate SELECT before or after.

BEGIN;

CREATE OR REPLACE FUNCTION public.deduct_ingredient_stock(
  p_ingredient_id INTEGER,
  p_deduction NUMERIC,
  p_updated_by INTEGER DEFAULT NULL
)
RETURNS TABLE(previous_quantity NUMERIC, new_quantity NUMERIC)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    -- FOR UPDATE takes the row lock up front so this CTE's read and the
    -- UPDATE below see/affect the same row within this one statement,
    -- and any other transaction touching this ingredient waits its turn.
    SELECT quantity AS old_quantity
    FROM public.ingredients
    WHERE id = p_ingredient_id
    FOR UPDATE
  ),
  updated AS (
    UPDATE public.ingredients
    SET quantity = GREATEST(0, quantity - p_deduction),
        updated_by = COALESCE(p_updated_by, updated_by)
    WHERE id = p_ingredient_id
    RETURNING quantity AS updated_quantity
  )
  SELECT locked.old_quantity, updated.updated_quantity
  FROM locked, updated;
END;
$$;

-- Only the backend (service_role) calls this — not exposed to anon/authenticated.
REVOKE ALL ON FUNCTION public.deduct_ingredient_stock(INTEGER, NUMERIC, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_ingredient_stock(INTEGER, NUMERIC, INTEGER) TO service_role;

COMMIT;

-- ROLLBACK PLAN, if needed:
-- DROP FUNCTION IF EXISTS public.deduct_ingredient_stock(INTEGER, NUMERIC, INTEGER);
