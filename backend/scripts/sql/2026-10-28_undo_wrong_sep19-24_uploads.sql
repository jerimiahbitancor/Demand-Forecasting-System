-- 2026-10-28_undo_wrong_sep19-24_uploads.sql
--
-- WHY: on Oct 28, 2026 (08:34 Manila) six files named
-- item-sales-summary-2026-09-19 ... 2026-09-24 were uploaded (uploads
-- 9697-9702) when the Oct 19-24 files were meant. Sep 19-24 are inside the
-- renovation closure and were marked closed by the owner. The upload:
--   * wrote 335 daily_sales rows for Sep 19-24,
--   * flipped business_days Sep 19-24 from confirmed_closed to confirmed_open,
--   * deducted stock (32 inventory_transactions, reference_type 'upload').
--
-- WHAT THIS DOES (one transaction):
--   1. gives back the stock those 32 deductions took,
--   2. deletes those 32 'sale' transactions (NOT replaced by an
--      'adjustment' row: an adjustment counts as a stock count and would stop
--      the Oct 19-24 sales from deducting),
--   3. deletes the daily_sales rows of those 6 uploads,
--   4. sets Sep 19-24 back to confirmed_closed,
--   5. marks the 6 uploads 'failed' with a note (kept for the audit trail).
--
-- HOW TO RUN: Supabase SQL editor. Run as-is first (DRY RUN, ends in
-- ROLLBACK) and check the counts. Then change the last line to COMMIT.

BEGIN;

-- Before: what will be touched
SELECT 'daily_sales rows' AS what, count(*) FROM public.daily_sales WHERE upload_id IN (9697, 9698, 9699, 9700, 9701, 9702)
UNION ALL
SELECT 'stock deductions', count(*) FROM public.inventory_transactions
  WHERE reference_type = 'upload' AND reference_id::text IN ('9697','9698','9699','9700','9701','9702') AND transaction_type = 'sale'
UNION ALL
SELECT 'open days Sep 19-24', count(*) FROM public.business_days
  WHERE business_date BETWEEN '2026-09-19' AND '2026-09-24' AND status = 'confirmed_open';
-- Expected: 335 / 32 / 6

-- 1. Give the stock back (summed per ingredient).
WITH back AS (
  SELECT ingredient_id, sum(-quantity) AS amount
  FROM public.inventory_transactions
  WHERE reference_type = 'upload'
    AND reference_id::text IN ('9697','9698','9699','9700','9701','9702')
    AND transaction_type = 'sale'
  GROUP BY ingredient_id
)
UPDATE public.ingredients i
SET quantity = i.quantity + back.amount
FROM back
WHERE i.id = back.ingredient_id
RETURNING i.id, i.name, i.quantity - back.amount AS stock_before, i.quantity AS stock_after;

-- 2. Remove the deduction log rows.
DELETE FROM public.inventory_transactions
WHERE reference_type = 'upload'
  AND reference_id::text IN ('9697','9698','9699','9700','9701','9702')
  AND transaction_type = 'sale';

-- 3. Remove the sales rows.
DELETE FROM public.daily_sales WHERE upload_id IN (9697, 9698, 9699, 9700, 9701, 9702);
DELETE FROM public.daily_sales_modifiers WHERE upload_id IN (9697, 9698, 9699, 9700, 9701, 9702);

-- 4. Closed again, exactly like the owner's other closure marks.
UPDATE public.business_days
SET status = 'confirmed_closed', is_open = false, source = 'manual_confirmation', confirmed_at = now()
WHERE business_date BETWEEN '2026-09-19' AND '2026-09-24';

-- 5. Retire the uploads (kept, not deleted).
UPDATE public.uploads
SET status = 'failed',
    error_message = '{"error":"Undone on 2026-10-28: September file uploaded by mistake (Oct 19-24 was meant). Sales, stock deductions and open-day marks were reversed by SQL."}'
WHERE id IN (9697, 9698, 9699, 9700, 9701, 9702);

-- After: all three should be 0
SELECT 'daily_sales rows' AS what, count(*) FROM public.daily_sales WHERE sale_date BETWEEN '2026-09-19' AND '2026-09-24'
UNION ALL
SELECT 'stock deductions', count(*) FROM public.inventory_transactions
  WHERE reference_type = 'upload' AND reference_id::text IN ('9697','9698','9699','9700','9701','9702')
UNION ALL
SELECT 'open days Sep 19-24', count(*) FROM public.business_days
  WHERE business_date BETWEEN '2026-09-19' AND '2026-09-24' AND status <> 'confirmed_closed';

ROLLBACK;  -- dry run. Change to COMMIT when the counts look right.
