-- 008_add_model_metrics_wmape.sql
--
-- Adds the two columns the new accuracy display needs.
--
-- WHY: accuracy used to be shown as 100 - MAPE with Lewis (1982) tier
-- bands. Both are dropped (owner decision, Oct 1 2026). MAPE divides each
-- row's error by that row's own actual, so on a menu where many dishes
-- sell 1-3 a day it is dominated by rounding on tiny numbers -- being off
-- by one plate on a dish that sold one scores a 100% error. WMAPE divides
-- total units missed by total units sold, so busy dishes count
-- proportionally more and a near-zero day cannot blow the number up.
--
-- And because there is no citable WMAPE band table, "good" is defined by
-- comparison instead: the forecast is acceptable when it beats the 7-day
-- average on the same test rows. That is why baseline_wmape is stored
-- alongside it -- without the baseline, a WMAPE figure alone cannot
-- answer the only question the owner actually cares about.
--
-- Both are nullable on purpose. Every model_metrics row written before
-- this migration has no WMAPE and never will, since it would mean
-- re-scoring a model whose feature set no longer exists. Readers skip
-- NULL rows rather than treating them as 0 (see
-- backend/services/analyticsService.js).
--
-- ORDER OF OPERATIONS -- this matters:
--   1. Run THIS migration first.
--   2. Then deploy the new ml-service.
-- The new supabase_writer.write_model_metrics() includes wmape and
-- baseline_wmape in its INSERT. If the service ships first, the very next
-- training run fails on "column wmape does not exist" (Postgres 42703)
-- after the model has already been trained and uploaded to Storage,
-- leaving a model file with no metrics row -- which the dashboard reads as
-- "no model trained yet" while Storage says otherwise.
--
-- Safe to re-run: IF NOT EXISTS on both columns.

ALTER TABLE model_metrics
  ADD COLUMN IF NOT EXISTS wmape numeric;

ALTER TABLE model_metrics
  ADD COLUMN IF NOT EXISTS baseline_wmape numeric;

COMMENT ON COLUMN model_metrics.wmape IS
  'Weighted MAPE: sum(|actual - predicted|) / sum(actual) * 100, on the held-out test rows. Headline accuracy metric = 100 - wmape. NULL for runs before migration 008.';

COMMENT ON COLUMN model_metrics.baseline_wmape IS
  'Same WMAPE formula for the 7-day-average (rolling_7) baseline on the SAME test rows. The model is acceptable when wmape < baseline_wmape. NULL for runs before migration 008.';
