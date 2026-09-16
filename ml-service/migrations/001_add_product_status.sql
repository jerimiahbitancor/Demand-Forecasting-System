-- Migration: products.status enum + is_active generated column
--
-- WHY: this migration's changes are already live in the database (confirmed
-- via a direct schema dump — see database_schema.csv), but no tracked .sql
-- file documented how/when it was applied. Backfilling it here purely for
-- reproducibility and for the capstone paper's system documentation — do
-- NOT run this against the live database, it already has these objects.
--
-- Design: products.status is the single source of truth for a product's
-- activity state (active / inactive_new / inactive_discontinued /
-- archived). is_active is kept as a GENERATED column, derived from status,
-- so every existing `.eq('is_active', true)` query across the codebase
-- keeps working without being rewritten. Because it's GENERATED, no code
-- may ever write to is_active directly — Postgres rejects that with error
-- 428C9. All direct writes go through `status`, translated from the
-- app-level derived status ('active'|'new'|'inactive'|'archived') via
-- PRODUCT_DB_STATUS_BY_DERIVED in backend/services/productStatusConstants.js.
--
-- Eligibility for training (MIN_TRAINING_OBSERVATIONS) is deliberately
-- separate from this status — a product can be 'active' but too sparse to
-- train on, or 'inactive_discontinued' while retaining plenty of history.

BEGIN;

CREATE TYPE product_status AS ENUM (
  'active',
  'inactive_new',
  'inactive_discontinued',
  'archived'
);

ALTER TABLE public.products
  ADD COLUMN status product_status NOT NULL DEFAULT 'inactive_new';

ALTER TABLE public.products
  ADD COLUMN is_active boolean GENERATED ALWAYS AS (status = 'active') STORED;

CREATE INDEX idx_products_status ON public.products USING btree (status);

COMMIT;

-- ROLLBACK PLAN, if needed:
-- ALTER TABLE public.products DROP COLUMN is_active;
-- ALTER TABLE public.products DROP COLUMN status;
-- DROP TYPE product_status;
