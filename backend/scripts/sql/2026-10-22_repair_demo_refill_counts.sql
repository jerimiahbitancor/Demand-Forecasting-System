-- One-time repair for the first version of the demo refill script.
--
-- That version logged its top-up as transaction_type = 'adjustment'. The
-- upload pipeline reads the newest 'adjustment' as the ingredient's last stock
-- count and skips every sale day that ended before it, so uploads after the
-- refill deducted nothing for older sale dates.
--
-- This relabels ONLY those demo rows as 'restock' (a delivery, not a count).
-- Stock quantities are not changed.
--
-- Uploads that were already skipped are NOT re-deducted by this. Delete those
-- test uploads (or their daily_sales rows) and upload the files again.

-- 1. Diagnose: which ingredients now have a "count" newer than the latest
--    sale dates you uploaded? (read-only)
SELECT i.name,
       max(t.created_at) FILTER (WHERE t.transaction_type = 'adjustment') AS last_count_at,
       max(t.created_at) FILTER (WHERE t.transaction_type = 'sale')       AS last_sale_deduction_at,
       count(*) FILTER (WHERE t.transaction_type = 'adjustment'
                          AND t.reason = 'Demo stock reset')             AS demo_count_rows
FROM public.ingredients i
LEFT JOIN public.inventory_transactions t ON t.ingredient_id = i.id
WHERE COALESCE(i.is_archived, false) = false
GROUP BY i.name
ORDER BY last_count_at DESC NULLS LAST;

-- 2. Repair
BEGIN;

UPDATE public.inventory_transactions
SET transaction_type = 'restock',
    notes = concat_ws(' ', notes, '(relabelled from adjustment: a demo top-up is not a stock count)')
WHERE transaction_type = 'adjustment'
  AND reason = 'Demo stock reset';

COMMIT;

-- 3. Check: this should return 0.
SELECT count(*) AS demo_rows_still_counted_as_counts
FROM public.inventory_transactions
WHERE transaction_type = 'adjustment'
  AND reason = 'Demo stock reset';
