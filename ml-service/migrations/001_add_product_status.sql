-- Migration: add a real product status indicator
--
-- WHY: is_active alone can't represent the states your system actually
-- needs — ACTIVE, INACTIVE (NEW — insufficient sales observations),
-- INACTIVE (DISCONTINUED), and ARCHIVED are four different situations
-- that a single boolean collapses into two. This migration adds an
-- explicit `status` enum as the single source of truth, and turns
-- `is_active` into a GENERATED column derived from it — so every
-- existing query in your Express codebase that already checks
-- `is_active = true` (there are ~23 of them) keeps working correctly
-- and automatically, without a rewrite, because `is_active` can no
-- longer drift out of sync with `status` by hand-editing one and not
-- the other. `status` is what you set going forward; `is_active` is a
-- read-only convenience view of it.
--
-- NOTE ON WHAT ISN'T HERE: "MAPPED" / "UNMAPPED" is deliberately NOT
-- a status value. It's fully derivable from whether a product has any
-- rows in product_ingredients — storing it as a separate column would
-- create a second source of truth that can drift from the actual
-- recipe data. Keep computing it live (EXISTS (SELECT 1 FROM
-- product_ingredients WHERE product_id = products.id)) wherever the
-- UI needs to show it.

BEGIN;

CREATE TYPE product_status AS ENUM (
  'active',
  'inactive_new',           -- exists, but < 28 valid daily sales observations yet
  'inactive_discontinued',  -- was active, then went quiet per the inactivity rule
  'archived'                -- owner manually archived it
);

ALTER TABLE public.products
  ADD COLUMN status product_status NOT NULL DEFAULT 'inactive_new';

-- Best-effort backfill from existing data. This is a STARTING POINT,
-- not the final word — it uses what's already on the row (is_active,
-- inactive_reason) since it can't retroactively count daily_sales
-- observations in a single UPDATE statement cheaply. Follow this with
-- Express's product status logic doing a real recompute per product
-- (counting actual daily_sales rows, per the eligibility clarification
-- below) to correct any product where this backfill guessed wrong.
UPDATE public.products
SET status = CASE
  WHEN is_active = false AND inactive_reason = 'user_archived' THEN 'archived'::product_status
  WHEN is_active = false THEN 'inactive_discontinued'::product_status
  WHEN first_sold_date IS NULL THEN 'inactive_new'::product_status
  ELSE 'active'::product_status
END;

-- Drop the old plain boolean column...
ALTER TABLE public.products DROP COLUMN is_active;

-- ...and replace it with a GENERATED column of the same name and type,
-- so every existing `.eq("is_active", true)` query in the backend
-- keeps working unmodified, but now reads a value that's always
-- consistent with `status` because it's computed, not stored twice.
ALTER TABLE public.products
  ADD COLUMN is_active boolean GENERATED ALWAYS AS (status = 'active') STORED;

CREATE INDEX idx_products_status ON public.products(status);

COMMIT;

-- ROLLBACK PLAN, if needed:
-- BEGIN;
-- ALTER TABLE public.products DROP COLUMN is_active;
-- ALTER TABLE public.products ADD COLUMN is_active boolean DEFAULT true;
-- UPDATE public.products SET is_active = (status = 'active');
-- ALTER TABLE public.products DROP COLUMN status;
-- DROP TYPE product_status;
-- COMMIT;
