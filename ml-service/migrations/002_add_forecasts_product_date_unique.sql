-- Migration: forecasts_product_date_unique constraint
--
-- WHY: this constraint is already live in the database (confirmed by
-- reading database_schema.csv directly — the unique_constraints section
-- lists it by name), but no tracked .sql file documented how/when it was
-- added. Backfilling it here purely for reproducibility and for the
-- capstone paper's system documentation — do NOT run this against the
-- live database, it already has this constraint.
--
-- Design: write_forecast() (ml-service/services/supabase_writer.py) upserts
-- one row per (product_id, forecast_date) on every forecast run. Without
-- this constraint, a same-day re-run of /forecast could insert duplicate
-- rows instead of overwriting the prior forecast for that date. With it,
-- the upsert's onConflict target is enforced at the database level, not
-- just assumed by application code.

BEGIN;

ALTER TABLE public.forecasts
  ADD CONSTRAINT forecasts_product_date_unique UNIQUE (product_id, forecast_date);

COMMIT;

-- ROLLBACK PLAN, if needed:
-- ALTER TABLE public.forecasts DROP CONSTRAINT forecasts_product_date_unique;
