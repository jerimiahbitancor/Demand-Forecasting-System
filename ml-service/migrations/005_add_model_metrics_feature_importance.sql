-- Migration: persist per-training-run feature importance
--
-- WHY: the Analytics > Forecasting > Model Insights panel needs a real
-- feature-importance breakdown (e.g. "is_payday 24%, dow 19%, ..."),
-- but nothing in this schema stores it — model_metrics only has
-- mape/mae/rmse/notes. The XGBoost model computes
-- model.feature_importances_ at training time (see model_service.py)
-- but it was being thrown away right after evaluation. This column
-- captures it so the Analytics API can read real numbers instead of
-- the illustrative placeholder percentages in the system module doc.
--
-- jsonb, not a new table: one row per training run already exists
-- (model_metrics), and this is a small fixed-size object
-- ({feature_name: importance_float}), not something that needs its
-- own relational shape or gets queried by individual feature.

BEGIN;

ALTER TABLE public.model_metrics
  ADD COLUMN feature_importance jsonb;

COMMIT;

-- ROLLBACK PLAN, if needed:
-- ALTER TABLE public.model_metrics DROP COLUMN feature_importance;
