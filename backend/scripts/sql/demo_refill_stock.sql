-- DEMO / TESTING ONLY. Never run this on a database with ChefDuo's real stock.
--
-- Tops up every active ingredient to a known "fully stocked" level so a demo
-- or a test upload has stock to deduct from.
--
-- WHY THIS IS LOGGED AS 'restock' AND NOT 'adjustment'
-- -----------------------------------------------------
-- The upload pipeline treats the newest 'adjustment' row of an ingredient as
-- its LAST STOCK COUNT (utils/salesModifiers.js -> shouldDeduct). Sales from a
-- business day that ended BEFORE that count are skipped, because a count is
-- assumed to already include them. An earlier version of this script logged
-- 'adjustment' rows timestamped "now", so every sales file uploaded afterwards
-- with older dates deducted nothing. A 'restock' is a delivery, not a count,
-- so it never blocks deductions.
--
-- Because a restock can only ADD stock, this script only tops up: an
-- ingredient already above its target is left alone.
--
-- Run step 0 first and read it. Then run the whole BEGIN ... COMMIT block.

-- ---------------------------------------------------------------------------
-- 0. Preview (read-only)
-- ---------------------------------------------------------------------------
SELECT name,
       unit,
       quantity AS current_qty,
       min_stock,
       GREATEST(
         quantity,
         COALESCE(min_stock, 0) * 10,
         CASE WHEN lower(btrim(unit)) IN
              ('g','gram','grams','mg','ml','milliliter','milliliters',
               'pc','pcs','piece','pieces','each')
              THEN 1000 ELSE 50 END
       )::numeric(18,6) AS will_become
FROM public.ingredients
WHERE COALESCE(is_archived, false) = false
ORDER BY unit, name;

-- ---------------------------------------------------------------------------
-- 1. Top up (atomic)
-- ---------------------------------------------------------------------------
BEGIN;

WITH targets AS (
  SELECT
    i.id,
    i.unit,
    i.quantity AS old_qty,
    GREATEST(
      COALESCE(i.min_stock, 0) * 10,
      CASE WHEN lower(btrim(i.unit)) IN
           ('g','gram','grams','mg','ml','milliliter','milliliters',
            'pc','pcs','piece','pieces','each')
           THEN 1000 ELSE 50 END
    )::numeric(18,6) AS target_qty
  FROM public.ingredients i
  WHERE COALESCE(i.is_archived, false) = false
  FOR UPDATE
),
changed AS (
  UPDATE public.ingredients i
  SET quantity   = t.target_qty,
      updated_at = timezone('utc', now())
  FROM targets t
  WHERE i.id = t.id
    AND i.quantity < t.target_qty          -- top up only
  RETURNING i.id
)
INSERT INTO public.inventory_transactions (
  ingredient_id, transaction_type, quantity,
  previous_quantity, new_quantity,
  requested_quantity, applied_quantity, shortfall_quantity,
  received_quantity, shortfall_settled_quantity,
  unit, reason, notes
)
SELECT
  t.id, 'restock', t.target_qty - t.old_qty,
  t.old_qty, t.target_qty,
  t.target_qty - t.old_qty, t.target_qty - t.old_qty, 0,
  t.target_qty - t.old_qty, 0,
  t.unit, 'Demo stock reset', 'Bulk top-up for demo/testing (not a stock count)'
FROM targets t
JOIN changed c ON c.id = t.id;

-- A restock does not clear old sales shortfalls (by design, see
-- inventoryController.restockInventoryItem). For a clean demo, clear them.
UPDATE public.inventory_shortfall_balances
SET remaining_quantity = 0,
    updated_at = timezone('utc', now())
WHERE remaining_quantity > 0;

-- Old low-stock alerts would otherwise stay on the dashboard.
UPDATE public.notifications
SET read = true, updated_at = now()
WHERE (metadata ->> 'key') LIKE 'stock_shortfall:%'
  AND read IS NOT TRUE;

COMMIT;

-- ---------------------------------------------------------------------------
-- 2. Verify
-- ---------------------------------------------------------------------------
SELECT name, unit, quantity, min_stock
FROM public.ingredients
WHERE COALESCE(is_archived, false) = false
ORDER BY name;
