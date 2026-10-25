-- Migration 025 (first numbered 022): owner-configurable Excess Stock threshold (Oct 25 2026).
--
-- Run in the Supabase SQL editor after 021. Idempotent. Nothing breaks before
-- it is run: the backend uses 100% until this column exists, and Settings
-- saves every other threshold meanwhile.
--
-- CURRENT STOCK LEVEL STATUS, stock % = current stock / ideal stock level x 100:
--   Out of Stock   stock <= 0
--   Low Stock      below the wet / dry low threshold (021)
--   Normal Stock   up to this excess threshold
--   Excess Stock   above this excess threshold      <- new, default 100

ALTER TABLE public.forecast_config
  ADD COLUMN IF NOT EXISTS current_excess_pct numeric NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forecast_config_current_excess_check'
  ) THEN
    ALTER TABLE public.forecast_config
      ADD CONSTRAINT forecast_config_current_excess_check CHECK (
        current_excess_pct BETWEEN 100 AND 1000
        AND current_excess_pct > current_low_wet_pct
        AND current_excess_pct > current_low_dry_pct
      );
  END IF;
END $$;

COMMENT ON COLUMN public.forecast_config.current_excess_pct IS
  'Current Stock Level Status: Excess Stock above this % of the ideal stock level; Normal Stock up to it (default 100).';

-- Check (expect 50 | 20 | 100 | 50 | 100 | 200 unless already changed):
-- SELECT current_low_wet_pct, current_low_dry_pct, current_excess_pct,
--        predicted_critical_pct, predicted_sufficient_pct, predicted_above_pct
-- FROM public.forecast_config;
