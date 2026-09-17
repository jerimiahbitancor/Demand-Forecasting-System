-- Migration: persist rolling_7 on each forecast row
--
-- WHY: the Business Logic Documentation v6 (2.2 Product Performance
-- Ratio Analysis) defines Performance Ratio as:
--   product's own rolling_7 ÷ average of every active product's own
--   rolling_7 on that same day
-- rolling_7 was already computed per product/day inside
-- forecast_service.py (build_forecast_feature_row), fed to the model,
-- then thrown away right after prediction. Nothing in the schema
-- stored it, so Express had no way to read the same value ml-service
-- used and was instead summing raw actual_qty as a stand-in — the
-- wrong formula, and one that could never match ml-service's numbers
-- even if reimplemented, since Express doesn't have the "shift(1)"
-- warmup semantics without re-deriving them from scratch.
--
-- This column captures the exact rolling_7 value used for that
-- forecast row at the moment the forecast was generated, so Express
-- can read it straight out of `forecasts` instead of recomputing a
-- second copy of the same rolling-average logic in JS. Null on
-- business-rule-zero (non-operating) days, since there's no real
-- trend value for a day the store is known to be closed.

BEGIN;

ALTER TABLE public.forecasts
  ADD COLUMN rolling_7 numeric;

COMMIT;

-- ROLLBACK PLAN, if needed:
-- ALTER TABLE public.forecasts DROP COLUMN rolling_7;
