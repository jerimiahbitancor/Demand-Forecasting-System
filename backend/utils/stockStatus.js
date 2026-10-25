// utils/stockStatus.js
//
// THE two stock level statuses. Every screen, alert and email that shows a
// stock status gets it from here (Oct 25 2026). Before this the same idea
// was written four different ways (Ingredient Management, dashboard/grocery
// list, restock alerts, ml-service) with different numbers, so one
// ingredient could read "Sufficient Supply" on one page and "Low" on another.
//
// Rules, labels and default percentages: shared/stockStatusRules.json.
// The owner can change the percentages in Settings > Stock Level Thresholds;
// services/stockThresholdService.js reads them.
//
// 1. CURRENT STOCK LEVEL STATUS — real-time, no forecast involved.
//    Stock % = current stock / ideal stock level (ingredients.min_stock) x 100
//      Out of Stock   stock <= 0
//      Low Stock      0% < Stock % <  low threshold   (wet 50%, dry 20%)
//      Normal Stock   low threshold <= Stock % <= excess threshold (default 100%)
//      Excess Stock   Stock % > excess threshold
//    The excess threshold is configurable since Oct 25 2026 (migration 022).
//
// 2. PREDICTED STOCK LEVEL STATUS — after a forecast, stock vs forecasted demand.
//    Coverage % = current stock / forecasted demand x 100
//      Critical Shortage     Coverage % <  50%
//      Insufficient Supply   Coverage % < 100%
//      Sufficient Supply     100% <= Coverage % <= 200%
//      Above Forecast Limit  Coverage % > 200%
//      Unassigned            no forecasted demand
//
// EXACT ARITHMETIC. Percentages are compared with decimal.js, not floats:
// rice at 8.04 kg against an ideal level of 40.2 kg is exactly 20%, but in
// floating point 8.04 / 40.2 * 100 = 19.999999999999996, which would put it
// in Low Stock instead of Normal Stock. The
// comparison is done as  stock x 100  vs  threshold x reference  in exact
// decimals, so a value ON a boundary always lands where the table says.
//
// Pure: no I/O.

const Decimal = require('decimal.js');
const RULES = require('../../shared/stockStatusRules.json');

const CURRENT_LABELS = Object.freeze({ ...RULES.current.labels });
const PREDICTED_LABELS = Object.freeze({ ...RULES.predicted.labels });
const PREDICTED_ACTIONS = Object.freeze({ ...RULES.predicted.actions });
const DEFAULT_STOCK_THRESHOLDS = Object.freeze({ ...RULES.defaults });
const THRESHOLD_LIMITS = Object.freeze({ ...RULES.limits });
const THRESHOLD_KEYS = Object.freeze(Object.keys(RULES.defaults));

// The old short labels still used by the dashboard, the grocery lists and
// Product Performance (renamed in the UI pass). Same level, old wording.
const LEGACY_PREDICTED_LABELS = Object.freeze({
  critical: 'Critical',
  insufficient: 'Low',
  sufficient: 'Normal',
  above: 'Excess',
  unassigned: 'No Forecast',
});

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

// Any number-like value -> Decimal, or null. Accepts "30.000000" (Postgres
// numeric as text), numbers and Decimals; rejects NaN / Infinity / junk.
function toDecimal(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Decimal) return value.isFinite() ? value : null;
  try {
    const d = new Decimal(typeof value === 'number' ? String(value) : String(value).trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

// Percentage for display only (never used for the decision itself).
function percentOf(stock, reference) {
  const s = toDecimal(stock);
  const r = toDecimal(reference);
  if (!s || !r || r.lte(0)) return null;
  return Number(s.mul(HUNDRED).div(r).toDecimalPlaces(2));
}

// stock x 100  compared with  pct x reference, exactly. -1 | 0 | 1
function compareStockPct(stock, reference, pct) {
  return stock.mul(HUNDRED).comparedTo(new Decimal(String(pct)).mul(reference));
}

function normalizeMaterialType(materialType) {
  return String(materialType || '').trim().toLowerCase() === 'wet' ? 'wet' : 'dry';
}

/**
 * Fill in any missing / invalid threshold with its default. Use on values
 * read from the database, so a half-filled row can never break a status.
 * @param {object} row  forecast_config row (or any object with the keys)
 */
function normalizeThresholds(row = {}) {
  const out = {};
  for (const key of THRESHOLD_KEYS) {
    const value = row && row[key] !== undefined && row[key] !== null ? Number(row[key]) : NaN;
    const { min, max } = THRESHOLD_LIMITS[key];
    out[key] = Number.isFinite(value) && value >= min && value <= max ? value : DEFAULT_STOCK_THRESHOLDS[key];
  }
  // Excess must sit above both Low thresholds; otherwise use the default.
  if (!(out.current_excess_pct > out.current_low_wet_pct && out.current_excess_pct > out.current_low_dry_pct)) {
    out.current_excess_pct = DEFAULT_STOCK_THRESHOLDS.current_excess_pct;
  }
  // The predicted bands must stay in order; if a stored row breaks that,
  // fall back to the defaults for all three rather than mixing.
  if (!(out.predicted_critical_pct < out.predicted_sufficient_pct && out.predicted_sufficient_pct < out.predicted_above_pct)) {
    out.predicted_critical_pct = DEFAULT_STOCK_THRESHOLDS.predicted_critical_pct;
    out.predicted_sufficient_pct = DEFAULT_STOCK_THRESHOLDS.predicted_sufficient_pct;
    out.predicted_above_pct = DEFAULT_STOCK_THRESHOLDS.predicted_above_pct;
  }
  return out;
}

/**
 * Validate what the owner typed in Settings. Only the keys present are
 * checked individually; the band order is checked on the merged result.
 * @param {object} input     the request body (any subset of the keys)
 * @param {object} current   the thresholds saved now (to merge with)
 * @returns {{ ok: true, values } | { ok: false, error }}
 */
function validateThresholds(input = {}, current = DEFAULT_STOCK_THRESHOLDS) {
  const merged = { ...normalizeThresholds(current) };
  const labels = {
    current_low_wet_pct: 'Wet raw materials low stock threshold',
    current_low_dry_pct: 'Dry raw materials low stock threshold',
    current_excess_pct: 'Excess Stock threshold',
    predicted_critical_pct: 'Critical Shortage threshold',
    predicted_sufficient_pct: 'Sufficient Supply threshold',
    predicted_above_pct: 'Above Forecast Limit threshold',
  };
  for (const key of THRESHOLD_KEYS) {
    if (input[key] === undefined) continue;
    const value = Number(input[key]);
    const { min, max } = THRESHOLD_LIMITS[key];
    if (input[key] === null || input[key] === '' || !Number.isFinite(value) || value < min || value > max) {
      return { ok: false, error: `${labels[key]} must be a number from ${min} to ${max}` };
    }
    merged[key] = value;
  }
  if (!(merged.current_excess_pct > merged.current_low_wet_pct && merged.current_excess_pct > merged.current_low_dry_pct)) {
    return { ok: false, error: 'Excess Stock threshold must be higher than both Low Stock thresholds' };
  }
  if (!(merged.predicted_critical_pct < merged.predicted_sufficient_pct)) {
    return { ok: false, error: 'Critical Shortage threshold must be lower than the Sufficient Supply threshold' };
  }
  if (!(merged.predicted_sufficient_pct < merged.predicted_above_pct)) {
    return { ok: false, error: 'Sufficient Supply threshold must be lower than the Above Forecast Limit threshold' };
  }
  return { ok: true, values: merged };
}

/**
 * CURRENT STOCK LEVEL STATUS.
 * @param {object} p
 * @param {*} p.quantity      stock on hand (ingredient's own unit)
 * @param {*} p.idealLevel    ideal stock level, same unit (ingredients.min_stock)
 * @param {string} p.materialType  'wet' | 'dry' (anything else counts as dry)
 * @param {object} thresholds
 * @returns {{ level, status, stockPct, lowThresholdPct, materialType, idealLevelSet }}
 *   level: 'out' | 'low' | 'normal' | 'excess'
 */
function currentStockStatus({ quantity, idealLevel, materialType } = {}, thresholds = DEFAULT_STOCK_THRESHOLDS) {
  const t = normalizeThresholds(thresholds);
  const type = normalizeMaterialType(materialType);
  const lowThresholdPct = type === 'wet' ? t.current_low_wet_pct : t.current_low_dry_pct;
  const stock = toDecimal(quantity) || ZERO;
  const ideal = toDecimal(idealLevel);
  const idealLevelSet = Boolean(ideal && ideal.gt(0));
  const result = (level) => ({
    level,
    status: CURRENT_LABELS[level],
    stockPct: idealLevelSet ? percentOf(stock, ideal) : null,
    lowThresholdPct,
    excessThresholdPct: t.current_excess_pct,
    materialType: type,
    idealLevelSet,
  });

  if (stock.lte(0)) return result('out');
  // No ideal level set: there is nothing to take a percentage of. The stock
  // is not zero, so it is not Out of Stock and cannot be called Low; it reads
  // Normal Stock, and idealLevelSet:false lets the screen say "set an ideal
  // stock level" instead of pretending it was measured.
  if (!idealLevelSet) return result('normal');
  if (compareStockPct(stock, ideal, lowThresholdPct) < 0) return result('low');
  if (compareStockPct(stock, ideal, t.current_excess_pct) <= 0) return result('normal');
  return result('excess');
}

/**
 * PREDICTED STOCK LEVEL STATUS.
 * @param {object} p
 * @param {*} p.quantity  stock on hand (ingredient's own unit)
 * @param {*} p.need      forecasted demand, same unit (safety buffer included)
 * @param {object} thresholds
 * @returns {{ level, status, action, coveragePct }}
 *   level: 'critical' | 'insufficient' | 'sufficient' | 'above' | 'unassigned'
 */
function predictedStockStatus({ quantity, need } = {}, thresholds = DEFAULT_STOCK_THRESHOLDS) {
  const t = normalizeThresholds(thresholds);
  const stock = toDecimal(quantity) || ZERO;
  const demand = toDecimal(need);
  const result = (level) => ({
    level,
    status: PREDICTED_LABELS[level],
    action: PREDICTED_ACTIONS[level],
    coveragePct: level === 'unassigned' ? null : percentOf(stock.lt(0) ? ZERO : stock, demand),
  });

  if (!demand || demand.lte(0)) return result('unassigned');
  if (stock.lte(0)) return result('critical');
  if (compareStockPct(stock, demand, t.predicted_critical_pct) < 0) return result('critical');
  if (compareStockPct(stock, demand, t.predicted_sufficient_pct) < 0) return result('insufficient');
  if (compareStockPct(stock, demand, t.predicted_above_pct) <= 0) return result('sufficient');
  return result('above');
}

// The same predicted level, in the old short wording ('Critical' | 'Low' |
// 'Normal' | 'Excess' | 'No Forecast') for screens not yet renamed.
function legacyPredictedLabel(quantity, need, thresholds = DEFAULT_STOCK_THRESHOLDS) {
  return LEGACY_PREDICTED_LABELS[predictedStockStatus({ quantity, need }, thresholds).level];
}

module.exports = {
  currentStockStatus,
  predictedStockStatus,
  legacyPredictedLabel,
  normalizeThresholds,
  validateThresholds,
  normalizeMaterialType,
  percentOf,
  CURRENT_LABELS,
  PREDICTED_LABELS,
  PREDICTED_ACTIONS,
  LEGACY_PREDICTED_LABELS,
  DEFAULT_STOCK_THRESHOLDS,
  THRESHOLD_LIMITS,
  THRESHOLD_KEYS,
};
