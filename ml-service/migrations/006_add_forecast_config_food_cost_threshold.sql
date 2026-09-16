-- Migration: configurable High Food Cost warning threshold
--
-- WHY: ProductManagement.jsx hardcodes `warningThreshold = 30` in four
-- separate places, but the settled spec (system module doc, High Food
-- Cost Items section) is:
--   Food Cost Percentage = (COGS / Selling Price) * 100
--   Flagged as "High Food Cost" when Food Cost Percentage > 35%
-- This column makes 35% the persisted default instead of a number
-- baked into frontend code, and makes it owner-configurable from
-- Settings > Forecast Configuration, consistent with how
-- safety_buffer_percentage already works on this same table.

BEGIN;

ALTER TABLE public.forecast_config
  ADD COLUMN food_cost_warning_threshold numeric DEFAULT 35.00;

COMMIT;

-- ROLLBACK PLAN, if needed:
-- ALTER TABLE public.forecast_config DROP COLUMN food_cost_warning_threshold;
