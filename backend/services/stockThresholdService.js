// services/stockThresholdService.js
//
// The owner's stock level thresholds (Settings > Stock Level Thresholds),
// read from the single forecast_config row. Every caller that computes a
// stock status gets its numbers here, so a change in Settings reaches the
// Ingredient Management page, the dashboard, the grocery lists and the
// restock alerts at once.
//
// select('*') on purpose: before migration 021 the threshold columns do not
// exist, the row simply lacks them, and normalizeThresholds() fills in the
// defaults (wet 50 / dry 20 / 50 / 100 / 200). A read error does the same.
// A stock status must never fail because a settings lookup did.
//
// Cached for a few seconds: one Ingredient Management request computes a
// status per row and calls this from several services.

const { supabaseAdmin } = require('../config/supabase');
const { normalizeThresholds, DEFAULT_STOCK_THRESHOLDS } = require('../utils/stockStatus');

const CACHE_MS = 10 * 1000;
let cache = null; // { at, value }

async function getStockThresholds({ client = supabaseAdmin, now = Date.now(), fresh = false } = {}) {
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  let value;
  try {
    const { data, error } = await client
      .from('forecast_config')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    value = normalizeThresholds(data || {});
  } catch (error) {
    console.warn('Could not read stock thresholds, using the defaults:', error && error.message);
    value = { ...DEFAULT_STOCK_THRESHOLDS };
    // Do not cache a failure for long: retry on the next request.
    cache = null;
    return value;
  }
  cache = { at: now, value };
  return value;
}

// Called after Settings saves new thresholds.
function invalidateStockThresholds() {
  cache = null;
}

module.exports = { getStockThresholds, invalidateStockThresholds };
