// backend/controllers/forecastConfigController.js
//
// Single-row config table, same shape as businessProfileController.js.
// Owner-configurable values:
//   - safety_buffer_percentage (0-50, default 15) — read by ml-service
//     (get_safety_buffer_percentage) and analyticsService.js.
//   - food_cost_warning_threshold (default 35) — migration 006.
//   - the six STOCK LEVEL THRESHOLDS (migrations 021 + 025, Oct 25 2026):
//       current_low_wet_pct (50), current_low_dry_pct (20),
//       current_excess_pct (100)                                Current Stock Level Status
//       predicted_critical_pct (50), predicted_sufficient_pct (100),
//       predicted_above_pct (200)                                Predicted Stock Level Status
//     Validated by utils/stockStatus.js validateThresholds(); every status
//     is computed by that same module (services/stockThresholdService.js
//     reads the saved values). ml-service no longer computes a status at
//     all, so there is no second copy of these numbers to keep in sync.
const { supabaseAdmin } = require('../config/supabase');
const { queueStockRefresh } = require('../services/notificationService');
const {
  normalizeThresholds,
  validateThresholds,
  DEFAULT_STOCK_THRESHOLDS,
  THRESHOLD_KEYS,
} = require('../utils/stockStatus');
const { invalidateStockThresholds } = require('../services/stockThresholdService');

// True when the error means a threshold column does not exist yet (migration
// 021 not run): Postgres 42703 or PostgREST PGRST204.
function isMissingThresholdColumn(error) {
  const message = String((error && error.message) || '');
  return Boolean(error && (
    error.code === '42703'
    || error.code === 'PGRST204'
    || (/does not exist|schema cache/i.test(message) && /_pct/.test(message))
  ));
}

function toApiShape(row) {
  const thresholds = normalizeThresholds(row || {});
  if (!row) {
    return { safety_buffer_percentage: 15, food_cost_warning_threshold: 35, ...thresholds };
  }
  return {
    safety_buffer_percentage: row.safety_buffer_percentage != null ? Number(row.safety_buffer_percentage) : 15,
    food_cost_warning_threshold: row.food_cost_warning_threshold != null ? Number(row.food_cost_warning_threshold) : 35,
    ...thresholds,
    // false until migration 021 has been run: the thresholds shown are the
    // defaults and cannot be saved yet. excess_threshold_saved: migration 025.
    stock_thresholds_saved: THRESHOLD_KEYS.filter((key) => key !== 'current_excess_pct').every((key) => row[key] !== undefined),
    excess_threshold_saved: row.current_excess_pct !== undefined,
    updated_at: row.updated_at,
  };
}

class ForecastConfigController {
  // GET /api/settings/forecast-config
  static async get(req, res) {
    try {
      const { data, error } = await supabaseAdmin
        .from('forecast_config')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      res.json({ success: true, data: toApiShape(data) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to load forecast configuration: ' + error.message,
      });
    }
  }

  // POST /api/settings/forecast-config (upsert, single row)
  static async save(req, res) {
    const { safety_buffer_percentage, food_cost_warning_threshold } = req.body;

    if (safety_buffer_percentage !== undefined) {
      const value = Number(safety_buffer_percentage);
      if (Number.isNaN(value) || value < 0 || value > 50) {
        return res.status(400).json({
          success: false,
          error: 'Safety buffer must be a number between 0 and 50',
        });
      }
    }

    if (food_cost_warning_threshold !== undefined) {
      const value = Number(food_cost_warning_threshold);
      if (Number.isNaN(value) || value <= 0 || value > 100) {
        return res.status(400).json({
          success: false,
          error: 'Food cost warning threshold must be a number between 0 and 100',
        });
      }
    }

    const thresholdInput = {};
    for (const key of THRESHOLD_KEYS) {
      if (req.body[key] !== undefined) thresholdInput[key] = req.body[key];
    }
    const changesThresholds = Object.keys(thresholdInput).length > 0;

    try {
      const { data: existingRow, error: existingError } = await supabaseAdmin
        .from('forecast_config')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      const row = { updated_at: new Date() };
      if (safety_buffer_percentage !== undefined) row.safety_buffer_percentage = Number(safety_buffer_percentage);
      if (food_cost_warning_threshold !== undefined) row.food_cost_warning_threshold = Number(food_cost_warning_threshold);

      if (changesThresholds) {
        // Checked against what is saved now, so "critical < sufficient <
        // above" holds for the row as it will be after this save.
        const checked = validateThresholds(thresholdInput, existingRow || {});
        if (!checked.ok) {
          return res.status(400).json({ success: false, error: checked.error });
        }
        for (const key of THRESHOLD_KEYS) row[key] = checked.values[key];
        // current_excess_pct arrives with migration 025. Until it is run the
        // column does not exist: keep saving the other thresholds, and refuse
        // only a CHANGED Excess value, naming the migration.
        if (existingRow && existingRow.current_excess_pct === undefined) {
          if (Number(row.current_excess_pct) !== DEFAULT_STOCK_THRESHOLDS.current_excess_pct) {
            return res.status(400).json({
              success: false,
              error: 'Run migration 025_current_excess_threshold.sql in Supabase before changing the Excess Stock threshold.',
            });
          }
          delete row.current_excess_pct;
        }
      }

      let result;
      if (existingRow?.id) {
        result = await supabaseAdmin
          .from('forecast_config')
          .update(row)
          .eq('id', existingRow.id)
          .select()
          .single();
      } else {
        result = await supabaseAdmin
          .from('forecast_config')
          .insert(row)
          .select()
          .single();
      }

      if (result.error) {
        if (changesThresholds && isMissingThresholdColumn(result.error)) {
          return res.status(409).json({
            success: false,
            error: 'Stock level thresholds cannot be saved yet: run migration 021_stock_level_thresholds.sql in Supabase first. The default thresholds are in use until then.',
          });
        }
        throw result.error;
      }

      if (changesThresholds) invalidateStockThresholds();

      // The safety buffer changes every ingredient need, and the thresholds
      // change every status, so the stock alerts are refreshed. Not awaited,
      // never throws (see queueStockRefresh).
      queueStockRefresh(changesThresholds ? 'stock_thresholds' : 'safety_buffer');

      res.json({
        success: true,
        message: 'Forecast configuration saved.',
        data: toApiShape(result.data),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to save forecast configuration: ' + error.message,
      });
    }
  }
}

module.exports = ForecastConfigController;
