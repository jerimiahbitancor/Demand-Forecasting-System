// backend/controllers/forecastConfigController.js
//
// Single-row config table, same shape as businessProfileController.js.
// Currently owns two owner-configurable values:
//   - safety_buffer_percentage (0-50, default 15) — already read by
//     both ml-service (get_safety_buffer_percentage) and
//     analyticsService.js (getSafetyBufferPercentage), but the Settings
//     UI could never actually save it — handleSaveConfig() was a stub
//     that just showed a toast.
//   - food_cost_warning_threshold (default 35) — new column (migration
//     006), replaces the hardcoded `warningThreshold = 30` that used to
//     live directly in ProductManagement.jsx.
//
// Deliberately NOT including the Stock Level Thresholds (critical/low/
// excess) card here — those would need the same three numbers read on
// the ml-service (Python) side too (business_logic.py's
// _stock_status_row currently hardcodes 0.5/1.0/2.0), which is a larger
// change than this pass. That card's Save button stays a stub for now.
const { supabaseAdmin } = require('../config/supabase');

function toApiShape(row) {
  if (!row) {
    return { safety_buffer_percentage: 15, food_cost_warning_threshold: 35 };
  }
  return {
    safety_buffer_percentage: row.safety_buffer_percentage != null ? Number(row.safety_buffer_percentage) : 15,
    food_cost_warning_threshold: row.food_cost_warning_threshold != null ? Number(row.food_cost_warning_threshold) : 35,
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

    try {
      const { data: existingRow, error: existingError } = await supabaseAdmin
        .from('forecast_config')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      const row = { updated_at: new Date() };
      if (safety_buffer_percentage !== undefined) row.safety_buffer_percentage = Number(safety_buffer_percentage);
      if (food_cost_warning_threshold !== undefined) row.food_cost_warning_threshold = Number(food_cost_warning_threshold);

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

      if (result.error) throw result.error;

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
