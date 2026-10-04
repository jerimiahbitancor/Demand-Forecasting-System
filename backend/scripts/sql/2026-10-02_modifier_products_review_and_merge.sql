-- 2026-10-02_modifier_products_review_and_merge.sql
--
-- Products whose NAME is a dish plus a POS modifier ("Marinated Porksilog
-- NO EGG") were created as separate products before modifiers existed.
-- Owner decision: they are the base dish. This file
--   STEP 1 (read-only)  lists them, the base product each belongs to, and
--                       how much data hangs off them.
--   STEP 2 (ROLLBACK)   merges their daily_sales into the base product and
--                       records the modifier plates in daily_sales_modifiers.
--
-- NEEDS migration 010 AND its seed (modifier_rules) -- the keywords are
-- read from modifier_rules, nothing is hardcoded here.
--
-- WHICH OPTION?
--   (a) delete history + re-upload: the upload code now routes modifier
--       rows to the base product by itself. Cleanest, nothing to merge.
--       As of Oct 2 2026 daily_sales is EMPTY, so (a) is already the state
--       you are in -- just re-upload after deploying.
--   (b) this merge: only needed if you re-upload BEFORE deploying the new
--       code, or restore old daily_sales rows.
--
-- NEVER deletes a product. daily_sales -> products is ON DELETE RESTRICT,
-- forecasts -> products has no cascade, and the product rows are harmless.
-- Archive them in Product Management afterwards (optional STEP 3 below).
--
-- Only exact base-name matches are merged. Names with no exact base
-- product (on Oct 2: "Cheesy Spicy Hungarian", "OG Tapsilog" -- maybe
-- "Original Tapsilog"? -- and "Poppers NO FRIES") show base_product_id NULL
-- in STEP 1 and are skipped; those are owner decisions.
-- Names ending in TWO modifiers ("... NO RICE NO EGG") are matched on the
-- last one only and will not find a base; none existed on Oct 2.

-- Keyword -> regex: keywords are upper-case words and single spaces
-- (enforced by modifier_rules), so only spaces need translating.

-- =====================================================================
-- STEP 1 -- READ-ONLY review
-- =====================================================================
WITH rules AS (
  SELECT keyword, regexp_replace(keyword, ' ', '\s+', 'g') AS pattern
  FROM public.modifier_rules
),
matched AS (
  SELECT DISTINCT ON (p.id)
         p.id   AS modifier_product_id,
         p.name AS modifier_product_name,
         p.status::text AS modifier_status,
         r.keyword,
         btrim(regexp_replace(p.name, '[\s,;:/(\[-]+' || r.pattern || '[\s)\].]*$', '', 'i')) AS base_name
  FROM public.products p
  JOIN rules r ON p.name ~* ('[\s,;:/(\[-]' || r.pattern || '[\s)\].]*$')
  ORDER BY p.id, length(r.keyword) DESC
)
SELECT m.modifier_product_id,
       m.modifier_product_name,
       m.modifier_status,
       m.keyword,
       m.base_name,
       b.id            AS base_product_id,
       b.status::text  AS base_status,
       (SELECT count(*)          FROM public.daily_sales ds WHERE ds.product_id = m.modifier_product_id) AS daily_sales_rows,
       (SELECT coalesce(sum(quantity_sold), 0) FROM public.daily_sales ds WHERE ds.product_id = m.modifier_product_id) AS units,
       (SELECT min(sale_date)    FROM public.daily_sales ds WHERE ds.product_id = m.modifier_product_id) AS first_sale,
       (SELECT max(sale_date)    FROM public.daily_sales ds WHERE ds.product_id = m.modifier_product_id) AS last_sale,
       (SELECT count(*)          FROM public.forecasts f   WHERE f.product_id = m.modifier_product_id) AS forecast_rows,
       (SELECT count(*)          FROM public.product_classifications pc WHERE pc.product_id = m.modifier_product_id) AS classification_rows,
       (SELECT count(*)          FROM public.product_ingredients pi WHERE pi.product_id = m.modifier_product_id) AS recipe_rows
FROM matched m
LEFT JOIN public.products b
  ON lower(btrim(b.name)) = lower(m.base_name) AND b.id <> m.modifier_product_id
ORDER BY m.base_name, m.keyword;


-- =====================================================================
-- STEP 2 -- MERGE (ends in ROLLBACK; change to COMMIT only after the
--           before/after counts look right)
-- =====================================================================
BEGIN;

CREATE TEMP TABLE modifier_map ON COMMIT DROP AS
WITH rules AS (
  SELECT keyword, regexp_replace(keyword, ' ', '\s+', 'g') AS pattern
  FROM public.modifier_rules
),
matched AS (
  SELECT DISTINCT ON (p.id)
         p.id AS modifier_product_id,
         r.keyword,
         btrim(regexp_replace(p.name, '[\s,;:/(\[-]+' || r.pattern || '[\s)\].]*$', '', 'i')) AS base_name
  FROM public.products p
  JOIN rules r ON p.name ~* ('[\s,;:/(\[-]' || r.pattern || '[\s)\].]*$')
  ORDER BY p.id, length(r.keyword) DESC
)
SELECT m.modifier_product_id, m.keyword, b.id AS base_product_id
FROM matched m
JOIN public.products b
  ON lower(btrim(b.name)) = lower(m.base_name) AND b.id <> m.modifier_product_id;

-- BEFORE: units on base + modifier products together. Must equal the
-- AFTER figure (units only move, never appear or vanish).
SELECT 'before' AS stage,
       (SELECT count(*) FROM modifier_map)                                         AS modifier_products_mapped,
       (SELECT count(*) FROM public.daily_sales WHERE product_id IN (SELECT modifier_product_id FROM modifier_map)) AS rows_on_modifier_products,
       (SELECT coalesce(sum(quantity_sold), 0) FROM public.daily_sales
         WHERE product_id IN (SELECT modifier_product_id FROM modifier_map)
            OR product_id IN (SELECT base_product_id FROM modifier_map))            AS units_base_plus_modifier,
       (SELECT count(*) FROM public.daily_sales_modifiers)                         AS modifier_rows;

-- 1. Record the modifier plates (sum on conflict).
INSERT INTO public.daily_sales_modifiers (product_id, sale_date, keyword, quantity, upload_id)
SELECT mm.base_product_id, ds.sale_date, mm.keyword, sum(ds.quantity_sold), min(ds.upload_id)
FROM public.daily_sales ds
JOIN modifier_map mm ON mm.modifier_product_id = ds.product_id
GROUP BY mm.base_product_id, ds.sale_date, mm.keyword
HAVING sum(ds.quantity_sold) > 0
ON CONFLICT (product_id, sale_date, keyword)
DO UPDATE SET quantity = public.daily_sales_modifiers.quantity + EXCLUDED.quantity;

-- 2. Move the plates onto the base product (sum on conflict).
INSERT INTO public.daily_sales (product_id, sale_date, quantity_sold, upload_id)
SELECT mm.base_product_id, ds.sale_date, sum(ds.quantity_sold), min(ds.upload_id)
FROM public.daily_sales ds
JOIN modifier_map mm ON mm.modifier_product_id = ds.product_id
GROUP BY mm.base_product_id, ds.sale_date
ON CONFLICT (product_id, sale_date)
DO UPDATE SET quantity_sold = public.daily_sales.quantity_sold + EXCLUDED.quantity_sold;

-- 3. Remove the now-merged rows from the modifier products.
DELETE FROM public.daily_sales
WHERE product_id IN (SELECT modifier_product_id FROM modifier_map);

SELECT 'after' AS stage,
       (SELECT count(*) FROM modifier_map)                                         AS modifier_products_mapped,
       (SELECT count(*) FROM public.daily_sales WHERE product_id IN (SELECT modifier_product_id FROM modifier_map)) AS rows_on_modifier_products,
       (SELECT coalesce(sum(quantity_sold), 0) FROM public.daily_sales
         WHERE product_id IN (SELECT modifier_product_id FROM modifier_map)
            OR product_id IN (SELECT base_product_id FROM modifier_map))            AS units_base_plus_modifier,
       (SELECT count(*) FROM public.daily_sales_modifiers)                         AS modifier_rows;

-- STEP 3 (optional, owner decision) -- archive the merged modifier
-- products so they leave Product Management lists. Uses the archive
-- convention deriveProductStatus() checks (inactive_reason 'archived...').
-- UPDATE public.products
--    SET status = 'archived', inactive_reason = 'archived: POS modifier of base product'
--  WHERE id IN (SELECT modifier_product_id FROM modifier_map);

ROLLBACK;  -- change to COMMIT after the before/after units match
