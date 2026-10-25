-- Migration 021: owner-configurable stock level thresholds.
--
-- Run this in the Supabase SQL editor. It is idempotent: every statement can
-- be re-run safely. Nothing breaks before it is run: the backend falls back
-- to the same default numbers until these columns exist.
--
-- WHY
--
-- There are two separate stock statuses (owner's decision, Oct 2026):
--
--   CURRENT STOCK LEVEL STATUS (real time)
--     Stock % = current stock / ideal stock level (ingredients.min_stock) x 100
--     Out of Stock <= 0 | Low Stock < low threshold | Normal <= 100% | Excess > 100%
--     Low threshold: WET raw materials 50%, DRY raw materials 20%
--
--   PREDICTED STOCK LEVEL STATUS (after each forecast)
--     Coverage % = current stock / forecasted demand x 100
--     Critical Shortage < 50% | Insufficient Supply < 100%
--     Sufficient Supply 100%-200% | Above Forecast Limit > 200%
--
-- These five percentages are now saved here so the owner can change them in
-- Settings > Stock Level Thresholds. The rule itself lives in ONE place:
-- backend/utils/stockStatus.js (labels and defaults: shared/stockStatusRules.json).

ALTER TABLE public.forecast_config
  ADD COLUMN IF NOT EXISTS current_low_wet_pct      numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS current_low_dry_pct      numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS predicted_critical_pct   numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS predicted_sufficient_pct numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS predicted_above_pct      numeric NOT NULL DEFAULT 200;

-- The same limits the backend validates (shared/stockStatusRules.json), so a
-- bad value cannot get in even from the SQL editor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forecast_config_stock_thresholds_check'
  ) THEN
    ALTER TABLE public.forecast_config
      ADD CONSTRAINT forecast_config_stock_thresholds_check CHECK (
        current_low_wet_pct BETWEEN 1 AND 99
        AND current_low_dry_pct BETWEEN 1 AND 99
        AND predicted_critical_pct BETWEEN 1 AND 999
        AND predicted_sufficient_pct BETWEEN 1 AND 999
        AND predicted_above_pct BETWEEN 1 AND 1000
        AND predicted_critical_pct < predicted_sufficient_pct
        AND predicted_sufficient_pct < predicted_above_pct
      );
  END IF;
END $$;

COMMENT ON COLUMN public.forecast_config.current_low_wet_pct IS
  'Current Stock Level Status: a WET raw material is Low Stock below this % of its ideal stock level (default 50).';
COMMENT ON COLUMN public.forecast_config.current_low_dry_pct IS
  'Current Stock Level Status: a DRY raw material is Low Stock below this % of its ideal stock level (default 20).';
COMMENT ON COLUMN public.forecast_config.predicted_critical_pct IS
  'Predicted Stock Level Status: Critical Shortage below this % of forecasted demand (default 50).';
COMMENT ON COLUMN public.forecast_config.predicted_sufficient_pct IS
  'Predicted Stock Level Status: Sufficient Supply from this % of forecasted demand (default 100).';
COMMENT ON COLUMN public.forecast_config.predicted_above_pct IS
  'Predicted Stock Level Status: Above Forecast Limit above this % of forecasted demand (default 200).';

-- Check (expect one row with 50 | 20 | 50 | 100 | 200 unless already changed):
-- SELECT current_low_wet_pct, current_low_dry_pct, predicted_critical_pct,
--        predicted_sufficient_pct, predicted_above_pct FROM public.forecast_config;
