-- Apply the missed stock deduction for upload 6988
-- ("item-sales-summary-2026-09-29-2026-09-29.csv", uploaded Oct 23 2026 1:07 PM).
--
-- The upload saved its sales (Marinated Porksilog: 17 sold - 2 refunded = 15,
-- + 3 NO EGG + 2 NO RICE = 20 plates) but the server that processed it wrote
-- no 'sale' transaction and did not change stock.
--
-- The amounts below are what backend/services/uploadService.js computes for
-- this upload on the current data (run on Oct 23 with every write blocked):
--   Pork (155): 20 x 60 g          = 1.2 kg
--   Egg  (156): (20 - 3 NO EGG) x 1 = 17 pcs
--   Rice  (92): (20 - 2 NO RICE) x 1 cup (0.19999992 kg) = 3.59999856 -> 3.6 kg
--
-- It calls the SAME function the upload uses, deduct_ingredient_stock(), with
-- the same key (reference_type 'upload', reference_id 6988, ingredient_id).
-- Running it twice is safe: the second call returns already_applied = true
-- and changes nothing. A later re-run of the upload also cannot deduct again.
--
-- Run PART 1 first. If the numbers are right, run PART 2.

-- ============================================================
-- PART 1: DRY RUN (changes nothing, ends in ROLLBACK)
-- ============================================================
BEGIN;

SELECT id, name, quantity AS stock_before, unit
FROM public.ingredients
WHERE id IN (155, 156, 92)
ORDER BY id;

SELECT 'Pork' AS ingredient, * FROM public.deduct_ingredient_stock(155, '1.2', 'upload', 6988, 758, 'Applied by SQL: upload 6988 was not deducted by the server.', '1.2');
SELECT 'Egg'  AS ingredient, * FROM public.deduct_ingredient_stock(156, '17',  'upload', 6988, 758, 'Applied by SQL: upload 6988 was not deducted by the server.', '17');
SELECT 'Rice' AS ingredient, * FROM public.deduct_ingredient_stock(92,  '3.6', 'upload', 6988, 758, 'Applied by SQL: upload 6988 was not deducted by the server.', '3.59999856');

-- Expected: Pork 48.8 kg, Egg 983 pcs, Rice 96.4 kg
SELECT id, name, quantity AS stock_after, unit
FROM public.ingredients
WHERE id IN (155, 156, 92)
ORDER BY id;

ROLLBACK;

-- ============================================================
-- PART 2: APPLY (run only after PART 1 shows the right numbers)
-- ============================================================
BEGIN;
SELECT 'Pork' AS ingredient, * FROM public.deduct_ingredient_stock(155, '1.2', 'upload', 6988, 758, 'Applied by SQL: upload 6988 was not deducted by the server.', '1.2');
SELECT 'Egg'  AS ingredient, * FROM public.deduct_ingredient_stock(156, '17',  'upload', 6988, 758, 'Applied by SQL: upload 6988 was not deducted by the server.', '17');
SELECT 'Rice' AS ingredient, * FROM public.deduct_ingredient_stock(92,  '3.6', 'upload', 6988, 758, 'Applied by SQL: upload 6988 was not deducted by the server.', '3.59999856');
SELECT id, name, quantity AS stock_after, unit
FROM public.ingredients
WHERE id IN (155, 156, 92)
ORDER BY id;
COMMIT;
