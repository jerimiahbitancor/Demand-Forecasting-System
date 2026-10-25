// services/analyticsService.js
//
// Read-only query/computation layer for the four Analytics routes
// (backend/routes/analytics.js, backend/routes/forecastSummary.js).
// Every formula here mirrors what ml-service already computes for its
// own writes (business_logic.py's stock-status thresholds and
// ingredient-demand formula, model_service.py's accuracy) — this file
// does not invent new business rules, it re-derives the same ones for
// display, since ml-service never exposes an HTTP API of its own for
// Express to call read-only.
const { fetchAllRows } = require('../utils/fetchAllRows');
const { accuracyFromWmape, beatsBaseline } = require('../utils/accuracy');
const {
  loadStatusInputs, NEW_UNTIL_SALES_DAYS, DISCONTINUED_AFTER_OPEN_DAYS,
} = require('./productStatusService');
const { supabaseAdmin } = require('../config/supabase');
const Decimal = require('decimal.js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';
const { convertRecipeQuantity, parseRecipeQuantity, isMissingColumnError, isCountUnit } = require('../utils/recipeUnits');
const { legacyPredictedLabel, predictedStockStatus, DEFAULT_STOCK_THRESHOLDS } = require('../utils/stockStatus');
const { getStockThresholds } = require('./stockThresholdService');

// The PREDICTED STOCK LEVEL STATUS (stock vs forecasted demand), in the
// short wording the dashboard, grocery lists and Product Performance still
// use: Critical = Critical Shortage, Low = Insufficient Supply, Normal =
// Sufficient Supply, Excess = Above Forecast Limit, No Forecast = Unassigned.
// The rule and the numbers are utils/stockStatus.js (one place); callers
// pass the owner's thresholds from getStockThresholds(). Defaults: <50%,
// <100%, 100-200%, >200%.
function computeStockStatus(onStock, forecastedNeed, thresholds = DEFAULT_STOCK_THRESHOLDS) {
  return legacyPredictedLabel(onStock, forecastedNeed, thresholds);
}

function decimalValue(value) {
  const result = new Decimal(value == null || value === '' ? 0 : String(value));
  if (!result.isFinite()) throw new TypeError(`Invalid ingredient quantity or price: ${value}`);
  return result;
}

function roundIngredientQuantity(value, unit, countRounding = Decimal.ROUND_CEIL) {
  const amount = decimalValue(value);
  return amount.toDecimalPlaces(isCountUnit(unit) ? 0 : 2, isCountUnit(unit) ? countRounding : Decimal.ROUND_HALF_UP).toNumber();
}

function amountToBuy(need, stock, unit) {
  const shortfall = Decimal.max(0, decimalValue(need).minus(decimalValue(stock)));
  return roundIngredientQuantity(shortfall, unit, Decimal.ROUND_CEIL);
}

function costForQuantity(quantity, unitPrice) {
  if (unitPrice === null || unitPrice === undefined) return null;
  return decimalValue(quantity).mul(decimalValue(unitPrice)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function roundMoney(value) {
  return decimalValue(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function safetyBufferMultiplier(percentage) {
  return new Decimal(1).plus(decimalValue(percentage).div(100));
}

// PREDICTED ITEMS SOLD ARE WHOLE PLATES (owner decision, Oct 25 2026).
// The model's forecast is an expected value (12.25 plates). The owner cooks
// whole plates and must be able to redo every number on screen by hand
// ("12 plates × ₱45.50 = ₱546.00"), so the forecast is rounded to the
// nearest whole plate ONCE, here, and that whole number is what every
// downstream figure uses: revenue, estimated cost, demand level, ingredient
// demand, grocery list and stock status. Half rounds up (2.5 -> 3).
// Trade-off (documented in the Business Logic doc): a product forecast
// below 0.5 plate a day counts as 0 plates that day.
function wholeItems(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = decimalValue(value);
  return n.lte(0) ? 0 : n.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

// ---------------------------------------------------------------------
// POS modifier share (NO EGG, NO RICE ...) — the same rule as
// ml-service business_logic.compute_modifier_shares():
//   share(product, ingredient) = modifier plates mapped to that ingredient
//                                ÷ all plates of the product,
//   over the store's last 28 CONFIRMED-OPEN days; capped at 1.
// daily_sales.quantity_sold already includes the modifier plates.
// Until Oct 25 2026 the backend skipped this step, so every page here
// (Ingredient Demand, Ingredient Management, stock alerts) used full
// recipes while the Business Logic doc said "× (1 − modifier share)".
// ---------------------------------------------------------------------
const MODIFIER_SHARE_WINDOW_OPEN_DAYS = 28;

function normalizeModifierKeyword(keyword) {
  return String(keyword || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// -> Map "productId:ingredientId" -> Decimal share (pairs not listed = 0)
function computeModifierShares({ sales = [], modifiers = [], rules = [], windowDates = null } = {}) {
  const shares = new Map();
  if (!sales.length || !modifiers.length || !rules.length) return shares;
  const window = windowDates ? new Set(windowDates.map((d) => String(d).slice(0, 10))) : null;
  const inWindow = (row) => !window || window.has(String(row.sale_date).slice(0, 10));
  const ingredientByKeyword = new Map(rules.map((r) => [normalizeModifierKeyword(r.keyword), r.ingredient_id]));

  const plates = new Map();
  for (const r of sales) {
    if (!inWindow(r)) continue;
    plates.set(r.product_id, (plates.get(r.product_id) || new Decimal(0)).plus(Decimal.max(0, decimalValue(r.quantity_sold))));
  }
  const without = new Map();
  for (const r of modifiers) {
    if (!inWindow(r)) continue;
    const ingredientId = ingredientByKeyword.get(normalizeModifierKeyword(r.keyword));
    if (ingredientId === undefined || ingredientId === null) continue;
    const key = `${r.product_id}:${ingredientId}`;
    without.set(key, (without.get(key) || new Decimal(0)).plus(Decimal.max(0, decimalValue(r.quantity))));
  }
  for (const [key, count] of without) {
    const total = plates.get(Number(key.split(':')[0])) || plates.get(key.split(':')[0]);
    if (!total || total.lte(0) || count.lte(0)) continue;
    shares.set(key, Decimal.min(1, count.div(total)));
  }
  return shares;
}

function modifierShareOf(shares, productId, ingredientId) {
  if (!shares || shares.size === 0) return new Decimal(0);
  return shares.get(`${productId}:${ingredientId}`) || new Decimal(0);
}

function isMissingTableError(error) {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205'
    || /does not exist|could not find the table/i.test(String(error.message || ''))));
}

// Reads the inputs and returns computeModifierShares(). Never throws: no
// modifier tables (migration 010 not run) or any read error -> no shares,
// i.e. full recipes, exactly as before.
async function loadModifierShares(client = supabaseAdmin) {
  try {
    const { data: days, error: daysError } = await client
      .from('business_days')
      .select('business_date')
      .eq('status', 'confirmed_open')
      .order('business_date', { ascending: false })
      .limit(MODIFIER_SHARE_WINDOW_OPEN_DAYS);
    if (daysError) throw daysError;
    const windowDates = (days || []).map((d) => String(d.business_date).slice(0, 10)).sort();
    if (!windowDates.length) return new Map();
    const start = windowDates[0];
    const end = windowDates[windowDates.length - 1];
    const { data: rules, error: rulesError } = await client.from('modifier_rules').select('keyword, ingredient_id');
    if (rulesError) throw rulesError;
    if (!rules || !rules.length) return new Map();
    const { data: modifiers, error: modError } = await fetchAllRows(() => client
      .from('daily_sales_modifiers')
      .select('product_id, sale_date, keyword, quantity')
      .gte('sale_date', start)
      .lte('sale_date', end)
      .order('sale_date')
      .order('product_id'));
    if (modError) throw modError;
    if (!modifiers || !modifiers.length) return new Map();
    const { data: sales, error: salesError } = await fetchAllRows(() => client
      .from('daily_sales')
      .select('product_id, sale_date, quantity_sold')
      .gte('sale_date', start)
      .lte('sale_date', end)
      .order('sale_date')
      .order('product_id'));
    if (salesError) throw salesError;
    return computeModifierShares({ sales: sales || [], modifiers, rules, windowDates });
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn('[MODIFIERS] modifier share not applied (full recipes used):', error.message);
    }
    return new Map();
  }
}

// Worse-status-wins ranking, used to find a product's "bottleneck"
// ingredient (Product Performance > Demand Classification) and to rank
// items for the Grocery List preview.
const STOCK_SEVERITY = { Critical: 4, Low: 3, 'No Forecast': 2, Normal: 1, Excess: 0 };

function worseStockStatus(a, b) {
  return (STOCK_SEVERITY[a] ?? -1) >= (STOCK_SEVERITY[b] ?? -1) ? a : b;
}

// Weekly Grocery List consumes the seven daily needs supplied by its caller.
// The analytics endpoint supplies buffered values here while keeping the
// weekly heatmap unbuffered. priceOf is retained for helper callers; the
// endpoint uses ingredients.price directly.
//   weekly need = sum of the 7 values
//   status      = computeStockStatus(stock, weekly need); Critical + Low only
//   toBuy       = weekly need - stock (count units round up)
//   estCost     = toBuy × configured ingredient unit price, null without a price
function buildWeeklyGroceryList(rows = [], priceOf = () => null, thresholds = DEFAULT_STOCK_THRESHOLDS) {
  const all = rows
    .map((row) => {
      const weeklyNeed = roundIngredientQuantity(
        (row.values || []).reduce((sum, value) => sum.plus(decimalValue(value)), new Decimal(0)),
        row.unit,
      );
      const status = computeStockStatus(row.currentStock, weeklyNeed, thresholds);
      const toBuy = amountToBuy(weeklyNeed, row.currentStock, row.unit);
      const marketPrice = row.unitPrice ?? priceOf(row.ingredientId) ?? null;
      return {
        ingredientId: row.ingredientId,
        name: row.name,
        category: row.category,
        usedIn: row.usedIn || '',
        forecastedNeed: weeklyNeed,
        onStock: row.currentStock,
        unit: row.unit,
        status,
        predictedStatus: predictedStockStatus({ quantity: row.currentStock, need: weeklyNeed }, thresholds).status,
        toBuy,
        marketPrice,
        estCost: toBuy > 0 ? costForQuantity(toBuy, marketPrice) : null,
      };
    })
    .filter((item) => item.status === 'Critical' || item.status === 'Low')
    .sort((a, b) => (STOCK_SEVERITY[b.status] ?? -1) - (STOCK_SEVERITY[a.status] ?? -1));
  return {
    all,
    totals: {
      estTotalCost: roundMoney(all.reduce((sum, item) => sum.plus(item.estCost || 0), new Decimal(0))),
      totalItemsToBuy: all.length,
    },
  };
}

// Accuracy = 100 - WMAPE, and "is it good enough?" = does it beat the
// 7-day average (owner decision, Oct 1 2026). This replaced 100 - MAPE and
// the Lewis (1982) tier bands. The rule itself lives in utils/accuracy.js
// because the dashboard needs the identical answer — see the note there.
//
// There is no citable WMAPE band table, so there are deliberately only two
// states and no invented numeric threshold.
function accuracyStanding(wmape, baselineWmape) {
  if (wmape === null || wmape === undefined) return null;
  const beats = beatsBaseline(wmape, baselineWmape);
  if (beats === null) {
    return { beatsBaseline: null, label: 'No baseline recorded', color: 'amber' };
  }
  return {
    beatsBaseline: beats,
    label: beats ? 'Better than a simple average' : 'Not yet better than a simple average',
    color: beats ? 'green' : 'amber',
  };
}

// Human labels for the 11 FEATURE_COLUMNS (ml-service/services/
// feature_engineering.py) — used only for display; the DB key stays
// the raw column name so this never has to be kept in sync with a
// separate id scheme.
//
// Updated Oct 1 2026: `lag_7` is gone (it meant "7 rows back", which is
// not the same weekday once there are closed days), replaced by
// `same_dow_last_open`, and `days_since_last_open` was added. An unknown
// key still falls back to the raw column name, so an older model's
// feature_importance keys render readably rather than crashing.
//
// Updated Oct 17 2026: `is_holiday` was removed from the model. Its label
// stays below only so model_metrics rows from models trained before that
// date still show "Holiday" instead of the raw key.
const FEATURE_LABELS = {
  product_id: 'Product',
  dow: 'Day of Week',
  month: 'Month',
  day: 'Day of Month',
  is_weekend: 'Weekend',
  is_holiday: 'Holiday',
  is_payday: 'Payday',
  lag_1: 'Sales on the Last Open Day',
  same_dow_last_open: 'Sales on the Same Weekday, Last Time Open',
  days_since_last_open: 'Days Since the Store Was Last Open',
  rolling_7: 'Rolling Average (7 days)',
  rolling_14: 'Rolling Average (14 days)',
};

// The business operates on PH local time (see otpService.js/uploadService.js),
// but this file used to derive "today" via `new Date().toISOString().slice(0,10)`
// — the UTC calendar date. Render's server clock runs in UTC, so anywhere
// from midnight to ~7:59 AM PH time, the UTC date is still the *previous*
// day: "today's forecast" / "yesterday's sales" would silently read one
// business day stale during that window. Anchoring on dayjs().tz(PH_TZ)
// instead makes every date-only value in this file agree with the
// business's actual calendar day.
function toDateOnly(d) {
  return dayjs(d).tz(PH_TZ).format('YYYY-MM-DD');
}

function defaultDateRange(daysBack = 30, daysForward = 7) {
  const today = dayjs().tz(PH_TZ);
  const from = today.subtract(daysBack, 'day');
  const to = today.add(daysForward, 'day');
  return { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD'), today: today.format('YYYY-MM-DD') };
}

// Next 9:00 AM Asia/Manila forecast run of either kind — matches the two
// cron jobs in jobs/forecastScheduler.js: daily '0 9 * * 0,2-6' (every day
// except Monday) and weekly '0 9 * * 1' (Monday runs the weekly forecast
// only). Together they still fire every day at 9:00, so "next 9:00 AM" is
// right without a weekday rule here. If either cron ever stops covering a
// day, this needs that rule. 9:00 AM is the confirmed, locked schedule (see CLAUDE.md);
// an earlier 8:00 AM figure in some older comments/docs was a mistake.
//
// This used to compute "9:00 AM" against the server's own local clock via
// plain Date.setHours() — fine in PH-local dev, but wrong once deployed to
// Render, which runs in UTC: setHours(9) there means 9:00 AM UTC (5:00 PM
// PH), not 9:00 AM PH, so the displayed "next forecast" time didn't match
// when the cron job actually fires. Anchored on dayjs().tz(PH_TZ) instead,
// same pattern as toDateOnly()/defaultDateRange() above.
function nextDailyForecastRun(now = dayjs().tz(PH_TZ)) {
  const nowPh = dayjs(now).tz(PH_TZ);
  let next = nowPh.hour(9).minute(0).second(0).millisecond(0);
  if (!next.isAfter(nowPh)) next = next.add(1, 'day');
  return next.toISOString();
}

// ---------------------------------------------------------------------
// Pure helpers (unit-tested in tests/analyticsHelpers.test.js)
// ---------------------------------------------------------------------

// Retraining is manual. This is only the date we SUGGEST, shown next to
// "Manual (click Start Training)". One constant so the owner can change it.
const RETRAIN_RECOMMENDED_DAYS = 30;
const MANILA_DATETIME_FORMAT = 'MMM D, YYYY, h:mm A';
const MANILA_DATE_FORMAT = 'MMM D, YYYY';

// "model_vYYYYMMDD_HHMMSS" -> dayjs (UTC), or null. ml-service stamps the
// version with the container clock, which is UTC. Strict: a malformed date
// (month 13) returns null instead of rolling over.
function parseModelVersionTime(modelVersion) {
  const m = /^model_v(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(String(modelVersion || ''));
  if (!m) return null;
  const t = dayjs.utc(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  if (!t.isValid() || t.format('YYYYMMDDHHmmss') !== m.slice(1).join('')) return null;
  return t;
}

// Any instant (ISO string, Date, dayjs) -> "Oct 14, 2026, 4:56 AM" in Manila.
function formatManilaDateTime(value) {
  if (!value) return null;
  const t = dayjs(value);
  return t.isValid() ? t.tz(PH_TZ).format(MANILA_DATETIME_FORMAT) : null;
}

// A date-only string ("2026-10-06") -> "Oct 6, 2026". No time zone shift.
function formatDateOnly(dateStr) {
  if (!dateStr) return null;
  const t = dayjs(String(dateStr).slice(0, 10));
  return t.isValid() ? t.format(MANILA_DATE_FORMAT) : null;
}

// When was this model trained, as an instant? From model_version first
// (has a time); evaluation_date only as a date-only fallback.
function trainingTimeOf(metricsRow) {
  if (!metricsRow) return { at: null, text: null, sortKey: '' };
  const t = parseModelVersionTime(metricsRow.model_version);
  if (t) {
    return { at: t.toISOString(), text: t.tz(PH_TZ).format(MANILA_DATETIME_FORMAT), sortKey: t.toISOString() };
  }
  const date = metricsRow.evaluation_date ? String(metricsRow.evaluation_date).slice(0, 10) : null;
  return { at: null, text: formatDateOnly(date), sortKey: date || '' };
}

// "Next training" never blank: training is manual, so say so, plus the
// suggested date (last training + RETRAIN_RECOMMENDED_DAYS).
function describeNextTraining(metricsRow) {
  const manual = 'Manual (click Start Training).';
  if (!metricsRow) return manual;
  const t = parseModelVersionTime(metricsRow.model_version);
  const base = t
    ? t.tz(PH_TZ)
    : (metricsRow.evaluation_date ? dayjs(String(metricsRow.evaluation_date).slice(0, 10)) : null);
  if (!base || !base.isValid()) return manual;
  return `${manual} Recommended around ${base.add(RETRAIN_RECOMMENDED_DAYS, 'day').format(MANILA_DATE_FORMAT)}.`;
}

// A forecast row written for a non-operating day (forecast_service.py
// writes predicted 0 with model_version "<version>_closed"). Not demand.
function isClosedForecastRow(row) {
  return /_closed$/.test(String(row?.model_version || ''));
}

// First forecast_date >= fromDate that has at least one row that is NOT a
// closed-day row ("YYYY-MM-DD"), or null when there is none. Pages that
// default to "today" use it so a closed day does not show an empty table.
async function nextOpenForecastDate(fromDate) {
  const { data, error } = await fetchAllRows(() => supabaseAdmin
    .from('forecasts')
    .select('forecast_date, model_version')
    .gte('forecast_date', fromDate)
    .order('forecast_date')
    .order('product_id'));
  if (error) throw error;
  const open = (data || []).find((f) => !isClosedForecastRow(f));
  return open ? String(open.forecast_date).slice(0, 10) : null;
}

// 'open' = the date has at least one forecast row that is not a closed-day
// row; 'closed' = it has rows and ALL are closed-day rows; 'none' = no rows.
async function forecastDayState(date) {
  const { data, error } = await fetchAllRows(() => supabaseAdmin
    .from('forecasts')
    .select('forecast_date, model_version')
    .eq('forecast_date', date)
    .order('product_id'));
  if (error) throw error;
  if (!data || data.length === 0) return 'none';
  return data.every((f) => isClosedForecastRow(f)) ? 'closed' : 'open';
}

// Default "today" for pages that list forecast rows. Today not open ->
// the next open forecast date (when there is one), with the reason:
// shiftReason 'closed' (today's rows are all closed-day rows) or
// 'no_forecast' (today has no rows yet). Explicit dates never come here.
async function defaultForecastDay(today) {
  const state = await forecastDayState(today);
  if (state === 'open') return { date: today, shiftReason: null };
  const nextOpen = await nextOpenForecastDate(today);
  if (!nextOpen || nextOpen === today) return { date: today, shiftReason: null };
  return { date: nextOpen, shiftReason: state === 'closed' ? 'closed' : 'no_forecast' };
}

// product_classifications.basis as written by ml-service
// (supabase_writer.write_classification): "p40=4.2, p80=9.8" — the
// product's OWN P40/P80 of its past daily sales. -> { p40, p80 } or null.
function parseClassificationBasis(basis) {
  const m = /p40\s*=\s*(-?\d+(?:\.\d+)?)\s*,\s*p80\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(String(basis || ''));
  return m ? { p40: Number(m[1]), p80: Number(m[2]) } : null;
}

// Demand tier PER PRODUCT (owner decision, Oct 18 2026): this row's
// forecast vs the product's own thresholds — the same rule as ml-service
// classify_demand (> p80 High, >= p40 Medium, else Low). The stored
// demand_tier is for the first forecast day only, so each date's forecast
// is re-checked against the stored thresholds; without parseable
// thresholds the stored tier is used.
// -> { tier: 'High' | 'Medium' | 'Low' | null, basisText }
function productDemandTier(forecastQty, classification) {
  const t = parseClassificationBasis(classification?.basis);
  const qty = Number(forecastQty);
  let tier = classification?.demand_tier || null;
  if (t && Number.isFinite(qty)) tier = qty > t.p80 ? 'High' : qty >= t.p40 ? 'Medium' : 'Low';
  if (!tier) return { tier: null, basisText: 'No usual sales range for this product yet' };
  if (!t) return { tier, basisText: `${tier} for this product` };
  // The product's normal band, p40..p80, in whole items.
  const lo = Math.round(t.p40);
  const hi = Math.round(t.p80);
  const band = lo === hi ? `${lo} ${lo === 1 ? 'item' : 'items'}/day` : `${lo}–${hi} items/day`;
  return { tier, basisText: `${tier} for this product (normal range ${band})` };
}

// Chart series = every date that has sales (up to today) OR a forecast.
//   actual   = summed quantity_sold (callers pass only the rows to count)
//   forecast = summed predicted_quantity for dates <= today (solid side)
//   future   = the same for dates >= today, so TODAY is on both lines and
//              the dashed line joins the solid one
//   closed   = the date only has "_closed" forecast rows: forecast stays
//              null (a gap), never a drop to 0
// priceOf(productId) -> price or null; revenue sums skip unknown prices.
function buildPredictionSeries({ salesRows = [], forecastRows = [], today, priceOf = () => null }) {
  const byDate = new Map();
  const bucket = (date) => {
    let b = byDate.get(date);
    if (!b) {
      b = { date, actual: 0, actualRevenue: 0, hasActual: false, forecast: 0, forecastRevenue: 0, hasForecast: false, closed: false };
      byDate.set(date, b);
    }
    return b;
  };
  for (const s of salesRows) {
    const date = String(s.sale_date).slice(0, 10);
    if (today && date > today) continue;
    const b = bucket(date);
    const qty = Number(s.quantity_sold) || 0;
    const price = priceOf(s.product_id);
    b.actual += qty;
    if (price > 0) b.actualRevenue += qty * price;
    b.hasActual = true;
  }
  for (const f of forecastRows) {
    const b = bucket(String(f.forecast_date).slice(0, 10));
    if (isClosedForecastRow(f)) {
      b.closed = true;
      continue;
    }
    const qty = Number(f.predicted_quantity) || 0;
    const price = priceOf(f.product_id);
    b.forecast += qty;
    if (price > 0) b.forecastRevenue += qty * price;
    b.hasForecast = true;
  }
  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => {
      const qty = b.hasForecast ? b.forecast : null;
      const rev = b.hasForecast ? b.forecastRevenue : null;
      const past = !today || b.date <= today;
      const ahead = !today || b.date >= today;
      return {
        date: b.date,
        actual: b.hasActual ? b.actual : null,
        actualRevenue: b.hasActual ? b.actualRevenue : null,
        forecast: past ? qty : null,
        forecastRevenue: past ? rev : null,
        future: ahead ? qty : null,
        futureRevenue: ahead ? rev : null,
        closed: b.closed && !b.hasForecast,
      };
    });
}

// Sales and Demand Prediction table (Oct 25 2026 rules):
//   - one row per (product, date) that has a forecast OR actual sales up to
//     today. Before, rows came from forecasts only, so a day with sales but
//     no forecast row (every past day once the model was retrained and the
//     product ids changed) never showed its Actual Qty.
//   - only products WITH an ingredient recipe (mapped products).
//   - actualQty = all of that product's daily_sales rows for the date, summed.
//   - forecastQty = whole plates (wholeItems); revenue and cost use it:
//       forecastRevenue = forecastQty × price
//       estCost         = forecastQty × COGS per plate (Product Management's COGS)
//   - Gross profit was removed (owner decision, Oct 25 2026).
function buildForecastTableRows({
  forecastRows = [], salesRows = [], productById = new Map(), cogsPerUnitByProduct = new Map(),
  priceOf = () => null, today = null,
}) {
  const byKey = new Map();
  const keyOf = (pid, date) => `${pid}|${String(date).slice(0, 10)}`;
  const entry = (pid, date) => {
    const k = keyOf(pid, date);
    let e = byKey.get(k);
    if (!e) {
      e = { productId: pid, date: String(date).slice(0, 10), forecast: null, closed: false, actual: null };
      byKey.set(k, e);
    }
    return e;
  };
  for (const f of forecastRows) {
    if (!cogsPerUnitByProduct.has(f.product_id)) continue;
    const e = entry(f.product_id, f.forecast_date);
    if (isClosedForecastRow(f)) {
      e.closed = true;
      continue;
    }
    e.forecast = (e.forecast || 0) + Number(f.predicted_quantity || 0);
  }
  for (const s of salesRows) {
    if (!cogsPerUnitByProduct.has(s.product_id)) continue;
    const date = String(s.sale_date).slice(0, 10);
    if (today && date > today) continue;
    const e = entry(s.product_id, date);
    e.actual = (e.actual || 0) + (Number(s.quantity_sold) || 0);
  }
  return Array.from(byKey.values())
    .map((e) => {
      const product = productById.get(e.productId);
      const price = priceOf(e.productId);
      const hasPrice = price !== null;
      const cogs = cogsPerUnitByProduct.get(e.productId);
      const hasForecast = e.forecast !== null;
      const closed = e.closed && !hasForecast;
      const forecastQty = hasForecast ? wholeItems(e.forecast) : (closed ? 0 : null);
      const counted = hasForecast ? forecastQty : null;
      return {
        date: e.date,
        productId: e.productId,
        product: product?.name || `Product ${e.productId}`,
        closed,
        hasPrice,
        hasRecipe: true,
        hasForecast,
        actualQty: e.actual,
        forecastQty,
        forecastQtyRaw: hasForecast ? Number(e.forecast.toFixed(2)) : null,
        price: hasPrice ? price : null,
        cogsPerUnit: cogs,
        actualRevenue: e.actual !== null && hasPrice ? roundMoney(decimalValue(e.actual).mul(decimalValue(price))) : null,
        forecastRevenue: counted !== null && hasPrice ? roundMoney(decimalValue(counted).mul(decimalValue(price))) : null,
        estCost: counted !== null ? roundMoney(decimalValue(counted).mul(decimalValue(cogs))) : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));
}

// Table totals add only known values. Products with no price add nothing to
// revenue; no recipe adds nothing to cost. Exact decimals, then centavos.
function summarizePredictionTotals(rows = []) {
  const sums = { actualRevenue: new Decimal(0), forecastRevenue: new Decimal(0), estCost: new Decimal(0) };
  const noPrice = new Set();
  const noRecipe = new Set();
  for (const r of rows) {
    if (!r.hasPrice) noPrice.add(r.productId);
    if (!r.hasRecipe) noRecipe.add(r.productId);
    for (const key of Object.keys(sums)) {
      if (r[key] != null) sums[key] = sums[key].plus(decimalValue(r[key]));
    }
  }
  return {
    actualRevenue: roundMoney(sums.actualRevenue),
    forecastRevenue: roundMoney(sums.forecastRevenue),
    estCost: roundMoney(sums.estCost),
    noPriceCount: noPrice.size,
    noRecipeCount: noRecipe.size,
  };
}

// Performance Ratio from ACTUAL SALES in the chosen range (owner decisions,
// Oct 18 2026; replaces the rolling_7 ratio below on the page):
//   avgDaily(product) = items sold in range ÷ open days in range
//   storeAvg          = mean of avgDaily over ALL active products
//   ratio             = avgDaily ÷ storeAvg
// An ACTIVE product with no sales in range has avgDaily 0: ratio 0.00, and
// it counts in the store average. Non-active products get no ratio and are
// left out. No open days, or no active product sold anything -> no ratios
// (null, shown "—"), since there is no average to compare with.
function computeSalesPerformanceRatios(salesRows = [], activeProductIds = new Set(), openDayCount = 0) {
  const ratioByProduct = new Map();
  if (!(openDayCount > 0) || activeProductIds.size === 0) return { ratioByProduct, storeAverageDaily: null };
  const soldByProduct = new Map([...activeProductIds].map((id) => [id, 0]));
  for (const row of salesRows) {
    if (!activeProductIds.has(row.product_id)) continue;
    soldByProduct.set(row.product_id, soldByProduct.get(row.product_id) + (Number(row.quantity_sold) || 0));
  }
  const avgDaily = [...soldByProduct.values()].map((sold) => sold / openDayCount);
  const storeAverageDaily = avgDaily.reduce((a, b) => a + b, 0) / avgDaily.length;
  if (!(storeAverageDaily > 0)) return { ratioByProduct, storeAverageDaily: null };
  for (const [productId, sold] of soldByProduct) {
    ratioByProduct.set(productId, sold / openDayCount / storeAverageDaily);
  }
  return { ratioByProduct, storeAverageDaily };
}

// NOT USED by the page since Oct 18 2026 (the ratio now comes from actual
// sales: computeSalesPerformanceRatios above). Kept, with
// loadRatioRollingRows, until the owner decides to remove them.
// Performance Ratio (Business Logic Doc v6, 2.2): for each forecast date,
// a product's own rolling_7 ÷ the average rolling_7 of ACTIVE products that
// day; a product's ratio = the mean of its daily ratios. Rows with a null
// rolling_7 (before migration 007) are skipped, not read as 0.
function computePerformanceRatios(rollingRows = [], activeProductIds = new Set()) {
  const rollingByDate = new Map();
  for (const row of rollingRows) {
    if (!activeProductIds.has(row.product_id)) continue;
    if (row.rolling_7 === null || row.rolling_7 === undefined) continue;
    const bucket = rollingByDate.get(row.forecast_date) || [];
    bucket.push({ productId: row.product_id, rolling7: Number(row.rolling_7) });
    rollingByDate.set(row.forecast_date, bucket);
  }
  const dailyRatiosByProduct = new Map();
  const dailyStoreAverages = [];
  for (const entries of rollingByDate.values()) {
    const storeAvg = entries.reduce((sum, e) => sum + e.rolling7, 0) / entries.length;
    if (storeAvg <= 0) continue;
    dailyStoreAverages.push(storeAvg);
    for (const { productId, rolling7 } of entries) {
      const list = dailyRatiosByProduct.get(productId) || [];
      list.push(rolling7 / storeAvg);
      dailyRatiosByProduct.set(productId, list);
    }
  }
  const ratioByProduct = new Map();
  for (const [productId, ratios] of dailyRatiosByProduct) {
    ratioByProduct.set(productId, ratios.reduce((s, r) => s + r, 0) / ratios.length);
  }
  const storeAverageRolling7 = dailyStoreAverages.length
    ? dailyStoreAverages.reduce((s, v) => s + v, 0) / dailyStoreAverages.length
    : null;
  return { ratioByProduct, storeAverageRolling7 };
}

// Performance Ratio default range: the 7 days ending on the newest sale
// date. Today's sales are uploaded tomorrow, so a "today" default is empty.
function defaultRatioRange(latestSaleDate, today) {
  const end = latestSaleDate ? String(latestSaleDate).slice(0, 10) : today;
  return { from: dayjs(end).subtract(6, 'day').format('YYYY-MM-DD'), to: end };
}

// NOT USED since Oct 18 2026 (see computeSalesPerformanceRatios).
// rolling_7 rows for the ratio. Uses forecast dates inside the range; if the
// range has none (for active products), falls back to the newest forecast
// date <= max(rangeTo, today) that has rolling_7, and reports that date.
async function loadRatioRollingRows(client, { rangeFrom, rangeTo, today, activeProductIds }) {
  const select = 'product_id, forecast_date, rolling_7';
  const { data: inRange, error } = await fetchAllRows(() => client
    .from('forecasts')
    .select(select)
    .gte('forecast_date', rangeFrom)
    .lte('forecast_date', rangeTo)
    .not('rolling_7', 'is', null)
    .order('forecast_date')
    .order('product_id'));
  if (error) throw error;
  const activeInRange = (inRange || []).filter((r) => activeProductIds.has(r.product_id));
  if (activeInRange.length) return { rows: activeInRange, ratioAsOf: null, source: 'range' };

  const cap = rangeTo > today ? rangeTo : today;
  const { data: latest, error: latestError } = await client
    .from('forecasts')
    .select('forecast_date')
    .lte('forecast_date', cap)
    .not('rolling_7', 'is', null)
    .order('forecast_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest) return { rows: [], ratioAsOf: null, source: 'none' };

  const { data: dayRows, error: dayError } = await fetchAllRows(() => client
    .from('forecasts')
    .select(select)
    .eq('forecast_date', latest.forecast_date)
    .not('rolling_7', 'is', null)
    .order('product_id'));
  if (dayError) throw dayError;
  return {
    rows: (dayRows || []).filter((r) => activeProductIds.has(r.product_id)),
    ratioAsOf: latest.forecast_date,
    source: 'latest_forecast',
  };
}

async function getSafetyBufferPercentage() {
  const { data } = await supabaseAdmin
    .from('forecast_config')
    .select('safety_buffer_percentage')
    .limit(1)
    .maybeSingle();
  return data?.safety_buffer_percentage != null ? Number(data.safety_buffer_percentage) : 15;
}

// product_id -> [{ ingredientId, name, category, unit, unitCost, currentStock, qtyPerServing }]
// Mirrors ml-service/services/data_loader.py's get_recipe_and_stock().
async function getRecipeMap() {
  const ingredientCols = 'id, name, category, unit, price, quantity, material_type';
  const recipeSelect = (withUnit) =>
    `product_id, ${withUnit ? 'unit, ' : ''}quantity_per_serving, ingredients!inner(${ingredientCols})`;

  let attempt = await supabaseAdmin
    .from('product_ingredients')
    .select(recipeSelect(true));
  if (attempt.error && isMissingColumnError(attempt.error)) {
    attempt = await supabaseAdmin
      .from('product_ingredients')
      .select(`product_id, unit, quantity_per_serving, ingredients!inner(id, name, category, unit, price, quantity)`);
  }
  if (attempt.error && isMissingColumnError(attempt.error)) {
    attempt = await supabaseAdmin.from('product_ingredients')
      .select(`product_id, quantity_per_serving, ingredients!inner(id, name, category, unit, price, quantity)`);
  }
  if (attempt.error) throw attempt.error;
  const data = attempt.data;

  const map = new Map();
  for (const row of data || []) {
    const ingredient = row.ingredients;
    // The recipe's stored unit (row.unit) may differ from the ingredient's
    // stock unit (ingredient.unit). Normalise to the ingredient's unit so
    // every downstream quantity (demand, stock deduction, COGS) is in the
    // same unit the price and stock are quoted in.
    //
    // One recipe line whose unit cannot be converted (kg recipe, mL stock)
    // used to throw here and take down EVERY page that reads the recipe map
    // (Ingredient Management included). It is now skipped and logged; the
    // sales upload still refuses such a file on its own (UnconvertibleRecipeError).
    let normalizedPerServing;
    try {
      normalizedPerServing = 'unit' in row
        ? convertRecipeQuantity(
            row.quantity_per_serving,
            row.unit || ingredient.unit,
            ingredient.unit,
            { materialType: ingredient.material_type || 'dry' }
          )
        : parseRecipeQuantity(row.quantity_per_serving) || 0;
    } catch (conversionError) {
      console.warn(`[RECIPES] skipped recipe line (product ${row.product_id}, ${ingredient?.name}): ${conversionError.message}`);
      continue;
    }
    const entry = {
      ingredientId: ingredient.id,
      name: ingredient.name,
      // Free-text column, not yet FK'd to ingredient_categories (see
      // CLAUDE.md) — whatever the owner typed when adding the
      // ingredient. The Grocery List's palengke-category grouping only
      // matches items whose text exactly equals one of its 10 known
      // category strings; anything else (typos, different casing,
      // categories the owner phrased differently) silently won't group.
      // Worth reconciling once ingredients.category_id is the source of
      // truth instead of this text column.
      category: ingredient.category,
      unit: ingredient.unit,
      unitCost: Number(ingredient.price) || 0,
      unitPrice: ingredient.price == null ? null : String(ingredient.price),
      currentStock: ingredient.quantity == null ? '0' : String(ingredient.quantity),
      qtyPerServing: normalizedPerServing == null ? '0' : String(normalizedPerServing),
    };
if (!map.has(row.product_id)) map.set(row.product_id, []);
    map.get(row.product_id).push(entry);
  }
  return map;
}

// ONE rule for "how much of each ingredient do these forecasts need":
// for every ingredient, SUM forecastQty × qtyPerServing × bufferMultiplier
// across ALL products that use it. Used by Ingredient Demand (daily table),
// the inventory status (getIngredientDailyNeeds) and the Dashboard's stock
// alerts, so the three can never disagree.
// -> Map ingredientId -> { ingredientId, item, need, productIds:Set,
//                          byProduct: Map productId -> that product's part of need }
// byProduct lets a caller name the products that use the most of an
// ingredient (restock email "For ..."); it never changes `need`.
//
// Oct 25 2026: forecastQty is the WHOLE number of plates (wholeItems), and
// each product's part is × (1 − modifier share) when shares are passed:
//   need_i = (1 + buffer) × Σ_p wholePlates_p × qtyPerServing_p,i × (1 − share_p,i)
function sumIngredientNeeds(forecastRows, recipeMap, bufferMultiplier, modifierShares = null) {
  const byIngredient = new Map();
  const multiplier = decimalValue(bufferMultiplier);
  for (const f of forecastRows || []) {
    const plates = wholeItems(f.predicted_quantity);
    for (const item of recipeMap.get(f.product_id) || []) {
      let entry = byIngredient.get(item.ingredientId);
      if (!entry) {
        entry = {
          ingredientId: item.ingredientId,
          item,
          need: new Decimal(0),
          rawNeed: new Decimal(0),
          productIds: new Set(),
          byProduct: new Map(),
        };
        byIngredient.set(item.ingredientId, entry);
      }
      const rawPart = new Decimal(plates)
        .mul(decimalValue(item.qtyPerServing))
        .mul(new Decimal(1).minus(modifierShareOf(modifierShares, f.product_id, item.ingredientId)));
      const part = rawPart.mul(multiplier);
      entry.rawNeed = entry.rawNeed.plus(rawPart);
      entry.need = entry.need.plus(part);
      entry.productIds.add(f.product_id);
      entry.byProduct.set(f.product_id, (entry.byProduct.get(f.product_id) || new Decimal(0)).plus(part));
    }
  }
  for (const entry of byIngredient.values()) {
    const rawNeed = roundIngredientQuantity(entry.rawNeed, entry.item.unit);
    const need = isCountUnit(entry.item.unit)
      ? roundIngredientQuantity(entry.need, entry.item.unit)
      : roundIngredientQuantity(
        decimalValue(rawNeed).plus(
          roundIngredientQuantity(
            decimalValue(rawNeed).mul(multiplier.minus(1)),
            entry.item.unit,
          ),
        ),
        entry.item.unit,
      );
    entry.need = need;
    entry.rawNeed = rawNeed;
    entry.safetyBuffer = roundIngredientQuantity(decimalValue(need).minus(rawNeed), entry.item.unit);
    entry.byProduct = new Map([...entry.byProduct].map(([productId, quantity]) => [
      productId,
      roundIngredientQuantity(quantity, entry.item.unit),
    ]));
  }
  return byIngredient;
}

// COGS per plate = Σ (qty per serving, in the stock unit × ingredient price),
// rounded to centavos — the SAME number Product Management shows for the
// product (its calculateProductCogs), so Forecast "Est. Total Cost" is
// exactly  whole plates × that COGS  and the owner can check it by hand.
// Exact decimals (the old version multiplied floats and strings).
function cogsPerUnit(recipeItems) {
  const total = (recipeItems || []).reduce(
    (sum, item) => sum.plus(decimalValue(item.qtyPerServing).mul(decimalValue(item.unitPrice ?? item.unitCost ?? 0))),
    new Decimal(0),
  );
  return roundMoney(total);
}

// ---------------------------------------------------------------------
// 1. Forecasting
// ---------------------------------------------------------------------
async function getForecastingAnalytics({ productId, from, to } = {}) {
  const range = defaultDateRange();
  const rangeFrom = from || range.from;
  const rangeTo = to || range.to;

  // SPEED (Oct 26 2026): every read starts now and runs at the same time;
  // each is awaited where it is used.
  const salesTo = rangeTo < range.today ? rangeTo : range.today;
  // A Supabase query runs each time it is awaited: Promise.resolve() turns
  // each into ONE real promise, so awaiting it twice never reads twice.
  const metricsP = Promise.resolve(supabaseAdmin.from('model_metrics').select('*').order('evaluation_date', { ascending: true }));
  const productsP = Promise.resolve((() => {
    let q = supabaseAdmin.from('products').select('id, name, price, status');
    if (productId) q = q.eq('id', productId);
    return q;
  })());
  const forecastsP = fetchAllRows(() => {
    let q = supabaseAdmin
      .from('forecasts')
      .select('product_id, forecast_date, predicted_quantity, model_version')
      .gte('forecast_date', rangeFrom)
      .lte('forecast_date', rangeTo);
    if (productId) q = q.eq('product_id', productId);
    return q.order('forecast_date').order('product_id');
  });
  const salesP = fetchAllRows(() => {
    let q = supabaseAdmin
      .from('daily_sales')
      .select('product_id, sale_date, quantity_sold')
      .gte('sale_date', rangeFrom)
      .lte('sale_date', salesTo);
    if (productId) q = q.eq('product_id', productId);
    return q.order('sale_date').order('product_id');
  });
  const recipeMapP = getRecipeMap();
  const latestRunP = Promise.resolve(supabaseAdmin
    .from('forecast_runs')
    .select('run_at, run_type, model_version, last_confirmed_date, stale_days')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle());
  const activeCountP = Promise.resolve(supabaseAdmin.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active'));
  // Settle every one so a failure in one never leaves the others unhandled.
  await Promise.allSettled([metricsP, productsP, forecastsP, salesP, recipeMapP, latestRunP, activeCountP]);

  const { data: metricsRows, error: metricsError } = await metricsP;
  if (metricsError) throw metricsError;

  // Ordered by TRAINING time (from model_version), so two trainings on the
  // same evaluation_date still come out in the right order. Stable sort.
  const orderedMetrics = (metricsRows || [])
    .map((row) => ({ row, trained: trainingTimeOf(row) }))
    .sort((a, b) => a.trained.sortKey.localeCompare(b.trained.sortKey));
  const latestMetrics = orderedMetrics.length ? orderedMetrics[orderedMetrics.length - 1].row : null;
  const latestTrained = trainingTimeOf(latestMetrics);
  // Rows written before migration 008 have no wmape and never will —
  // re-scoring them would mean rebuilding a feature set that no longer
  // exists. They are SKIPPED, not treated as 0% accuracy, so the history
  // line and the chart simply start at the first WMAPE-scored run instead
  // of plunging to zero for every older row.
  const accuracyHistory = orderedMetrics
    .filter(({ row }) => row.wmape !== null && row.wmape !== undefined)
    .map(({ row, trained }) => ({
      date: row.evaluation_date,
      trainedAt: trained.at,
      trainedAtText: trained.text,
      modelVersion: row.model_version,
      accuracy: accuracyFromWmape(row.wmape),
      baselineAccuracy: accuracyFromWmape(row.baseline_wmape),
    }));
  const latestAccuracy = latestMetrics ? accuracyFromWmape(latestMetrics.wmape) : null;
  const latestBaselineAccuracy = latestMetrics ? accuracyFromWmape(latestMetrics.baseline_wmape) : null;
  const standing = latestMetrics
    ? accuracyStanding(latestMetrics.wmape, latestMetrics.baseline_wmape)
    : null;

  const featureImportance = latestMetrics?.feature_importance
    ? Object.entries(latestMetrics.feature_importance)
        .map(([key, value]) => ({
          key,
          label: FEATURE_LABELS[key] || key,
          value: Number(value) * 100,
        }))
        .sort((a, b) => b.value - a.value)
    : null;

  const { data: products, error: productsError } = await productsP;
  if (productsError) throw productsError;
  const productById = new Map((products || []).map((p) => [p.id, p]));

  const { data: forecastRows, error: forecastError } = await forecastsP;
  if (forecastError) throw forecastError;
  // Sales never go past today (today's file is uploaded tomorrow).
  const { data: salesRows, error: salesError } = await salesP;
  if (salesError) throw salesError;

  const recipeMap = await recipeMapP;
  const cogsPerUnitByProduct = new Map();
  for (const [pid, items] of recipeMap.entries()) {
    cogsPerUnitByProduct.set(pid, cogsPerUnit(items));
  }

  // Price 0 = "No price". Unknown money values stay null (shown as a
  // label), never as ₱0.
  const priceOf = (pid) => {
    const p = Number(productById.get(pid)?.price);
    return p > 0 ? p : null;
  };

  const rows = buildForecastTableRows({
    forecastRows: forecastRows || [],
    salesRows: salesRows || [],
    productById,
    cogsPerUnitByProduct,
    priceOf,
    today: range.today,
  });

  // Chart = the same products as the table (products WITH a recipe), and
  // the same whole plates, so the line and the table always add up alike.
  // The page rebuilds it from the rows when a product is searched.
  const series = buildPredictionSeries({
    salesRows: (salesRows || []).filter((s) => recipeMap.has(s.product_id)),
    forecastRows: (forecastRows || [])
      .filter((f) => recipeMap.has(f.product_id))
      .map((f) => ({ ...f, predicted_quantity: wholeItems(f.predicted_quantity) })),
    today: range.today,
    priceOf,
  });
  const totals = summarizePredictionTotals(rows);

  const { data: latestRun } = await latestRunP;
  const { count: activeProductsCount } = await activeCountP;

  return {
    accuracy: {
      value: latestAccuracy,
      // WMAPE itself: "forecasts were off by about N% of total sales".
      errorRate: latestMetrics?.wmape ?? null,
      baselineValue: latestBaselineAccuracy,
      baselineErrorRate: latestMetrics?.baseline_wmape ?? null,
      beatsBaseline: standing?.beatsBaseline ?? null,
      standing,
      history: accuracyHistory,
    },
    prediction: { rows, series, totals, range: { from: rangeFrom, to: rangeTo, today: range.today } },
    modelInsights: {
      // Raw shares kept for the API only; the UI shows no feature
      // importance in any form (owner decision, Oct 14 2026).
      featureImportance, // null until the NEXT training run after migration 005 — see route-level note
      trainingInfo: {
        modelStatus: latestMetrics ? 'Trained' : 'Not Trained',
        modelVersion: latestMetrics?.model_version || null,
        // Manila date + time from model_version; evaluation_date (date
        // only) when the version has no timestamp.
        lastTrained: latestTrained.text,
        lastTrainedAt: latestTrained.at,
        evaluationDate: latestMetrics?.evaluation_date || null,
        latestForecastRun: latestRun?.run_at || null,
        latestForecastRunText: formatManilaDateTime(latestRun?.run_at),
        latestForecastStaleDays: latestRun?.stale_days ?? null,
        activeProducts: activeProductsCount || 0,
        // MAE = average servings missed per product per day. Surfaced so
        // the accuracy sentence can quote a physical number ("about 2
        // plates per dish per day") next to the percentage, instead of
        // the frontend inventing one. Null on older rows.
        mae: latestMetrics?.mae ?? null,
        // Not persisted anywhere per training run (see model_service.py) —
        // returning null rather than a fabricated number.
        trainingRecords: null,
        // Training is manual; this states that plus a suggested date
        // (last training + RETRAIN_RECOMMENDED_DAYS). Never null.
        nextTraining: describeNextTraining(latestMetrics),
        nextForecastRun: nextDailyForecastRun(),
        nextForecastRunText: formatManilaDateTime(nextDailyForecastRun()),
      },
    },
  };
}

// ---------------------------------------------------------------------
// 2. Product Performance
// ---------------------------------------------------------------------
// from/to: both cards (the report uses this). demandFrom/demandTo: the
// Demand Classification card only (its own date control on the page).
// Recent enough to hold every forecast product's newest classification.
const CLASSIFICATION_LOOKBACK_DAYS = 60;

function readRatioSales(fromDate, toDate) {
  return fetchAllRows(() => supabaseAdmin
    .from('daily_sales')
    .select('product_id, sale_date, quantity_sold')
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)
    .order('sale_date')
    .order('product_id'));
}

async function getProductPerformanceAnalytics({ from, to, demandFrom, demandTo } = {}) {
  const range = defaultDateRange();
  // SPEED (Oct 26 2026): every read that does not depend on another runs at
  // the same time. Before, ~14 reads ran one after another (> 2 s on Render
  // + Supabase); now there are three rounds.
  const needDefaultDay = !from && !to && !demandFrom && !demandTo;
  const needLatestSale = !from || !to;
  const classificationSince = dayjs().tz(PH_TZ).subtract(CLASSIFICATION_LOOKBACK_DAYS, 'day').format('YYYY-MM-DD');
  const readClassifications = (since) => fetchAllRows(() => {
    let q = supabaseAdmin
      .from('product_classifications')
      .select('product_id, classification_date, demand_tier, basis');
    if (since) q = q.gte('classification_date', since);
    // Tie-break: two runs on the same date -> the newer row (higher id)
    // comes first, so the "first row per product wins" loop keeps it.
    return q.order('classification_date', { ascending: false }).order('id', { ascending: false }).order('product_id');
  });
  // Product status reads are the slowest part; start them now, await later.
  const statusInputsPromise = loadStatusInputs(supabaseAdmin);
  const [
    day, latestSaleRes, stockThresholds, safetyBufferPct, productsRes, [recipeMap, modifierShares], recentClassifications,
  ] = await Promise.all([
    needDefaultDay ? defaultForecastDay(range.today) : Promise.resolve(null),
    needLatestSale
      ? supabaseAdmin.from('daily_sales').select('sale_date').order('sale_date', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getStockThresholds(),
    getSafetyBufferPercentage(),
    supabaseAdmin.from('products').select('id, name, price, status, first_sold_date, created_at'),
    Promise.all([getRecipeMap(), loadModifierShares()]),
    readClassifications(classificationSince),
  ]);

  // Demand Classification defaults to today; on a closed day (no open
  // forecast rows) to the next open forecast date. Any explicit date: as given.
  let rangeFrom = demandFrom || from || range.today;
  let rangeTo = demandTo || demandFrom || to || from || range.today;
  let shiftReason = null;
  if (day) {
    rangeFrom = day.date;
    rangeTo = day.date;
    shiftReason = day.shiftReason;
  }
  const shiftedFromClosedDay = shiftReason === 'closed';
  // Performance Ratio defaults to the 7 days ending on the newest sale
  // date — today's sales are uploaded tomorrow, so "today" is always empty.
  if (latestSaleRes.error) throw latestSaleRes.error;
  let ratioFrom = from;
  let ratioTo = to;
  if (needLatestSale) {
    const fallback = defaultRatioRange(latestSaleRes.data?.sale_date, range.today);
    ratioFrom = from || fallback.from;
    ratioTo = to || fallback.to;
  }
  const bufferMultiplier = safetyBufferMultiplier(safetyBufferPct);
  if (productsRes.error) throw productsRes.error;
  const products = productsRes.data || [];
  const productById = new Map(products.map((p) => [p.id, p]));

  // Round 2: the forecasts for the demand dates and the sales for the ratio
  // dates, together.
  const [forecastRes, salesRes] = await Promise.all([
    fetchAllRows(() => supabaseAdmin
      .from('forecasts')
      .select('product_id, forecast_date, predicted_quantity, model_version')
      .gte('forecast_date', rangeFrom)
      .lte('forecast_date', rangeTo)
      .order('forecast_date')
      .order('product_id')),
    readRatioSales(ratioFrom, ratioTo),
  ]);
  if (forecastRes.error) throw forecastRes.error;
  const forecastRows = forecastRes.data;

  // Only the recent classifications are read (a product forecast every day
  // is re-classified every day). Nothing recent -> read them all, as before.
  let classificationRows = recentClassifications.data;
  if (recentClassifications.error) throw recentClassifications.error;
  if (!classificationRows || classificationRows.length === 0) {
    const all = await readClassifications(null);
    if (all.error) throw all.error;
    classificationRows = all.data;
  }
  const latestClassificationByProduct = new Map();
  for (const row of classificationRows || []) {
    if (!latestClassificationByProduct.has(row.product_id)) {
      latestClassificationByProduct.set(row.product_id, row);
    }
  }

  const openRows = (forecastRows || []).filter((f) => !isClosedForecastRow(f));
  const openDates = new Set(openRows.map((f) => f.forecast_date));
  const closedDates = [...new Set((forecastRows || []).map((f) => f.forecast_date))]
    .filter((d) => !openDates.has(d))
    .sort();

  const demandRows = openRows
    .map((f) => {
      const product = productById.get(f.product_id);
      if (!product) return null;
      // Whole plates: the number shown is the number classified and used
      // for the bottleneck, so "2 items sold — Low (normal range 2–4)"
      // can no longer happen (1.93 used to be classified as 1.93).
      const plates = wholeItems(f.predicted_quantity);
      const { tier, basisText } = productDemandTier(plates, latestClassificationByProduct.get(f.product_id));
      const recipeItems = recipeMap.get(f.product_id) || [];

      // Bottleneck ingredient: worst stock status among this product's
      // own recipe ingredients, forecasted-need computed with the same
      // formula ml-service uses (business_logic.py estimate_ingredient_demand).
      let bottleneckStatus = null;
      let bottleneckIngredient = null;
      for (const item of recipeItems) {
        const need = roundIngredientQuantity(
          new Decimal(plates)
            .mul(decimalValue(item.qtyPerServing))
            .mul(new Decimal(1).minus(modifierShareOf(modifierShares, f.product_id, item.ingredientId)))
            .mul(bufferMultiplier),
          item.unit,
        );
        const status = computeStockStatus(item.currentStock, need, stockThresholds);
        if (bottleneckStatus === null || worseStockStatus(status, bottleneckStatus) === status) {
          bottleneckStatus = status;
          bottleneckIngredient = item.name;
        }
      }

      return {
        date: f.forecast_date,
        productId: f.product_id,
        product: product.name,
        forecastQty: plates,
        forecastQtyRaw: Number(f.predicted_quantity),
        // 'High Demand' | 'Medium Demand' | 'Low Demand' | 'Not enough data'
        demandLevel: tier ? `${tier} Demand` : 'Not enough data',
        // "High for this product (normal range 46–57 items/day)"
        demandBasis: basisText,
        bottleneckIngredient,
        bottleneckStatus: recipeItems.length ? bottleneckStatus : 'Unmapped',
      };
    })
    .filter(Boolean)
    // Busiest first within each date.
    .sort((a, b) => a.date.localeCompare(b.date) || b.forecastQty - a.forecastQty || a.product.localeCompare(b.product));

  // --- Performance Ratio ---
  // Quantity Sold / Revenue columns are real actual sales summed over the
  // range. If the chosen dates have NO sales at all (e.g. a report for this
  // week while the last upload was weeks ago), the ratio uses the 7 days
  // ending on the newest sale on or before the chosen end date instead, and
  // says so (ratioShift), rather than showing an empty table.
  let salesRows = salesRes.data;
  if (salesRes.error) throw salesRes.error;
  let ratioShift = null;
  if ((!salesRows || salesRows.length === 0) && !needLatestSale) {
    const { data: latestBefore, error: latestBeforeError } = await supabaseAdmin
      .from('daily_sales')
      .select('sale_date')
      .lte('sale_date', ratioTo)
      .order('sale_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestBeforeError) throw latestBeforeError;
    if (latestBefore?.sale_date) {
      const fallback = defaultRatioRange(latestBefore.sale_date, range.today);
      const shifted = await readRatioSales(fallback.from, fallback.to);
      if (shifted.error) throw shifted.error;
      ratioShift = { requested: { from: ratioFrom, to: ratioTo }, reason: 'no_sales' };
      ratioFrom = fallback.from;
      ratioTo = fallback.to;
      salesRows = shifted.data;
    }
  }

  const qtyByProduct = new Map();
  for (const row of salesRows || []) {
    qtyByProduct.set(row.product_id, (qtyByProduct.get(row.product_id) || 0) + row.quantity_sold);
  }

  // Performance Ratio = the product's average items sold per OPEN day in
  // the range ÷ the average of that over active products
  // (computeSalesPerformanceRatios). Open days = dates in the range that
  // have any daily_sales row: a confirmed-open day always has an upload,
  // and closed days never get sales rows, so this matches
  // business_days.status = 'confirmed_open' without a second read.
  const activeProductIds = new Set(products.filter((p) => p.status === 'active').map((p) => p.id));
  const openDayCount = new Set((salesRows || []).map((r) => String(r.sale_date).slice(0, 10))).size;
  const { ratioByProduct, storeAverageDaily } = computeSalesPerformanceRatios(salesRows || [], activeProductIds, openDayCount);

  // Every Active product gets a row (0 sold if no sales in range), plus any
  // other product that did sell in the range.
  const performanceProductIds = new Set([...activeProductIds, ...qtyByProduct.keys()]);
  const performanceRows = Array.from(performanceProductIds)
    .map((productId) => {
      const product = productById.get(productId);
      if (!product) return null;
      const hasSales = qtyByProduct.has(productId);
      const qty = qtyByProduct.get(productId) || 0;
      const price = Number(product.price);
      const ratio = ratioByProduct.has(productId) ? ratioByProduct.get(productId) : null;
      // No ratio: say why (an active product that sold nothing in these
      // dates vs. a product that is not forecast).
      let actionSignal = activeProductIds.has(productId) && qty <= 0
        ? 'No sales in these dates'
        : 'Insufficient data';
      if (ratio !== null) {
        if (ratio > 1.2) actionSignal = 'Keep on Menu — top performer';
        else if (ratio >= 1.0) actionSignal = 'Above average — maintain';
        else if (ratio >= 0.8) actionSignal = 'Near average — monitor';
        else actionSignal = 'Below average — consider promo or review';
      }
      return {
        productId,
        product: product.name,
        quantitySold: qty,
        // Breakdown shown on the page (Oct 26 2026):
        //   avgDaily = quantitySold ÷ openDays;  ratio = avgDaily ÷ storeAverageDaily
        openDays: openDayCount,
        avgDaily: openDayCount > 0 ? qty / openDayCount : null,
        // Empty (not ₱0) when nothing sold in range or the price is 0.
        revenue: hasSales && price > 0 ? qty * price : null,
        hasPrice: price > 0,
        performanceRatio: ratio,
        actionSignal,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.performanceRatio ?? -1) - (a.performanceRatio ?? -1)
      || b.quantitySold - a.quantitySold
      || a.product.localeCompare(b.product))
    .map((row, index) => ({ rank: index + 1, ...row }));

  // --- Product Status sections ---
  // Same inputs as the status rule itself (productStatusService: sales days,
  // last real sale, confirmed-open days), a few paged reads for all products,
  // so the texts below match what decided each product's status.
  const statusInputs = await statusInputsPromise;
  const lastSaleByProduct = new Map(
    [...statusInputs.byProduct].map(([productId, s]) => [productId, s.lastSaleDate])
  );

  const unmappedProductIds = new Set(products.map((p) => p.id).filter((id) => !recipeMap.has(id)));

  const now = Date.now();
  const daysAgo = (dateStr) => (dateStr ? Math.floor((now - new Date(dateStr).getTime()) / 86400000) : null);
  const daysOnMenuText = (product) => {
    if (!product.first_sold_date) return 'No sales yet';
    const days = daysAgo(product.first_sold_date);
    if (days < 60) return `${days} days`;
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'}`;
  };

  const sections = { active: [], new: [], inactive: [], archived: [] };
  for (const product of products) {
    const lastSale = lastSaleByProduct.get(product.id) || null;
    const isMapped = !unmappedProductIds.has(product.id);
    const base = {
      productId: product.id,
      product: product.name,
      isMapped,
      lastSale,
    };
    if (product.status === 'active') {
      sections.active.push({ ...base, daysOnMenu: daysOnMenuText(product), forecastStatus: 'Forecast Running' });
    } else if (product.status === 'inactive_new') {
      // "Inactive (Not enough data)": fewer than 42 days with sales. Was
      // "Forecast in (28 - calendar days)", which said "Forecast Running"
      // for long-listed dishes that are not forecast at all.
      const salesDays = (statusInputs.byProduct.get(product.id) || {}).salesDays || 0;
      const needed = Math.max(0, NEW_UNTIL_SALES_DAYS - salesDays);
      sections.new.push({
        ...base,
        daysOnMenu: product.first_sold_date ? daysOnMenuText(product) : 'Not yet sold',
        salesDays,
        forecastStatus: needed > 0
          ? `${salesDays} of ${NEW_UNTIL_SALES_DAYS} days with sales (${needed} more needed)`
          : 'Forecast starts after the next status update',
      });
    } else if (product.status === 'inactive_discontinued') {
      const idleDays = lastSale ? daysAgo(lastSale) : null;
      sections.inactive.push({
        ...base,
        lastSale: lastSale ? `${idleDays} days ago` : 'Never sold',
        forecastStatus: `Excluded — no sale in the last ${DISCONTINUED_AFTER_OPEN_DAYS} open days`,
      });
    } else if (product.status === 'archived') {
      sections.archived.push({
        ...base,
        lastSale: lastSale ? `${daysAgo(lastSale)} days ago` : 'Never sold',
        forecastStatus: 'Archived',
      });
    }
  }

  return {
    demandClassification: demandRows,
    performanceRatio: {
      rows: performanceRows,
      // Kept for older readers; the ratio no longer uses rolling_7.
      storeAverageRolling7: null,
      // Store average items sold per open day (active products that sold).
      storeAverageDaily,
      openDays: openDayCount,
      // How many ACTIVE products the store average is taken over.
      activeProductCount: activeProductIds.size,
      range: { from: ratioFrom, to: ratioTo },
      // Set when the chosen dates had no sales and the newest 7 days with
      // sales were used instead: { requested: { from, to }, reason: 'no_sales' }.
      ratioShift,
      // The ratio always comes from actual sales in the range now.
      ratioAsOf: null,
      ratioSource: 'sales',
    },
    // No dates asked for and today not open -> the next open forecast date
    // is shown: shiftReason 'closed' (today is a closed day) or
    // 'no_forecast' (no forecast for today yet). demandClassification stays
    // an array (its readers expect one), so the date and flags live here.
    demandRange: { from: rangeFrom, to: rangeTo, date: rangeFrom, shiftedFromClosedDay, shiftReason, closedDates },
    productStatus: {
      active: sections.active,
      new: sections.new,
      inactive: sections.inactive,
      archived: sections.archived,
      counts: {
        active: sections.active.length,
        new: sections.new.length,
        inactive: sections.inactive.length,
        archived: sections.archived.length,
      },
    },
  };
}

// ---------------------------------------------------------------------
// 3. Ingredient Demand
// ---------------------------------------------------------------------
async function getLatestMarketPriceMap() {
  // Paged: reads the whole table to pick each ingredient's newest price.
  // market_price gains a row per ingredient per fetch (~103 ingredients),
  // so about ten fetches is already past 1,000 rows. Truncation here
  // silently drops ingredients from every COGS figure downstream.
  const { data, error } = await fetchAllRows(() => supabaseAdmin
    .from('market_price')
    .select('ingredient_id, price, source, scraped_at')
    .order('scraped_at', { ascending: false })
    .order('ingredient_id'));
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    if (!map.has(row.ingredient_id)) map.set(row.ingredient_id, row);
  }
  return map;
}

function startOfWeekMonday(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back up to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

// ---------------------------------------------------------------------
// 6. Ingredient stock status (forecast-based)
// ---------------------------------------------------------------------

// ingredientId -> forecasted units needed on the given date (safety buffer
// included). Only ingredients that appear in an active recipe get a need;
// unmapped ones stay out of the map and read as 'No Forecast'.
// This is the SAME basis the Ingredient Management table uses for its
// per-row status (see inventoryController.js), so the table, the legend,
// and Analytics > Ingredient Demand always agree.
async function getIngredientDailyNeeds(date) {
  const { entries } = await getIngredientDailyNeedDetails(date);
  const needs = new Map();
  for (const entry of entries.values()) {
    needs.set(entry.ingredientId, entry.need);
  }
  return needs;
}

// The same need, with what is behind it: the sumIngredientNeeds() entries
// (need, productIds, byProduct), the date used and the safety buffer %.
// Used by getIngredientDailyNeeds() (Ingredient Management) and by the
// stock alerts + restock email (services/stockAlertService.js), so all
// three read the same number.
async function getIngredientDailyNeedDetails(date) {
  const safetyBufferPct = await getSafetyBufferPercentage();
  const bufferMultiplier = safetyBufferMultiplier(safetyBufferPct);
  const targetDate = date || defaultDateRange().today;

  const { data: forecastRows, error } = await supabaseAdmin
    .from('forecasts')
    .select('product_id, predicted_quantity')
    .eq('forecast_date', targetDate);
  if (error) throw error;

  const [recipeMap, modifierShares] = await Promise.all([getRecipeMap(), loadModifierShares()]);
  return {
    date: targetDate,
    safetyBufferPct,
    entries: sumIngredientNeeds(forecastRows, recipeMap, bufferMultiplier, modifierShares),
  };
}

// ingredientId set for every ingredient that appears in at least one product
// recipe. Deliberately independent of forecasts: an ingredient can be mapped
// yet still read 'No Forecast' when none of its products have a forecast row
// for the target date, so getIngredientDailyNeeds() cannot stand in for this
// or an unmapped count derived from it would be wrong.
async function getMappedIngredientIds() {
  const recipeMap = await getRecipeMap();
  const ids = new Set();
  for (const items of recipeMap.values()) {
    for (const item of items) {
      ids.add(item.ingredientId);
    }
  }
  return ids;
}

async function getIngredientDemandAnalytics({ date, weekStart } = {}) {
  let targetDate = date || defaultDateRange().today;
  // SPEED (Oct 26 2026): independent reads run together (two rounds instead
  // of ~10 one after another).
  // No date or week asked for, and today has no open forecast (a closed
  // day): show the next open forecast date, and its week. Explicit params
  // are used as given. (Stock alerts use getIngredientDailyNeedDetails,
  // not this: a closed day needs no stock.)
  const [stockThresholds, safetyBufferPct, day, [recipeMap, modifierShares], productsRes] = await Promise.all([
    getStockThresholds(),
    getSafetyBufferPercentage(),
    !date && !weekStart ? defaultForecastDay(targetDate) : Promise.resolve(null),
    Promise.all([getRecipeMap(), loadModifierShares()]),
    supabaseAdmin.from('products').select('id, name'),
  ]);
  const bufferMultiplier = safetyBufferMultiplier(safetyBufferPct);
  let shiftReason = null;
  if (day) {
    targetDate = day.date;
    shiftReason = day.shiftReason;
  }
  const shiftedFromClosedDay = shiftReason === 'closed';

  const monday = startOfWeekMonday(weekStart || targetDate);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return toDateOnly(d);
  });

  const outsideWeek = !weekDates.includes(targetDate);
  const [weekRes, dayRes] = await Promise.all([
    supabaseAdmin
      .from('forecasts')
      .select('product_id, forecast_date, predicted_quantity, model_version')
      .gte('forecast_date', weekDates[0])
      .lte('forecast_date', weekDates[6]),
    outsideWeek
      ? supabaseAdmin.from('forecasts').select('product_id, forecast_date, predicted_quantity, model_version').eq('forecast_date', targetDate)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (weekRes.error) throw weekRes.error;
  if (dayRes.error) throw dayRes.error;
  const forecastRows = weekRes.data;
  // ingredient name -> { values: number[7], ingredientId }
  const heatmap = new Map();
  // ingredientId -> { category, currentStock, productIds } for the weekly grocery list
  const weekInfo = new Map();
  for (const f of forecastRows || []) {
    const dayIndex = weekDates.indexOf(f.forecast_date);
    if (dayIndex === -1) continue;
    const recipeItems = recipeMap.get(f.product_id) || [];
    for (const item of recipeItems) {
      if (!heatmap.has(item.ingredientId)) {
        // unit = the ingredient record's own stock unit (recipe amounts are
        // already converted to it), so the page can format count units.
        heatmap.set(item.ingredientId, {
          ingredient: item.name,
          ingredientId: item.ingredientId,
          unit: item.unit || null,
          unitPrice: item.unitPrice,
          values: Array.from({ length: 7 }, () => new Decimal(0)),
        });
        weekInfo.set(item.ingredientId, {
          category: item.category,
          currentStock: item.currentStock,
          unitPrice: item.unitPrice,
          productIds: new Set(),
        });
      }
      const entry = heatmap.get(item.ingredientId);
      // Weekly heatmap = RAW demand: whole plates × recipe × (1 − modifier
      // share), NO safety buffer (owner decision, Oct 25 2026).
      const rawNeed = new Decimal(wholeItems(f.predicted_quantity))
        .mul(decimalValue(item.qtyPerServing))
        .mul(new Decimal(1).minus(modifierShareOf(modifierShares, f.product_id, item.ingredientId)));
      entry.values[dayIndex] = entry.values[dayIndex].plus(rawNeed);
      const info = weekInfo.get(item.ingredientId);
      info.productIds.add(f.product_id);
    }
  }

  const weeklyDemand = Array.from(heatmap.values()).map((row) => {
    row.values = row.values.map((value) => roundIngredientQuantity(value, row.unit));
    const total = roundIngredientQuantity(
      row.values.reduce((sum, value) => sum.plus(decimalValue(value)), new Decimal(0)),
      row.unit,
    );
    const avg = roundIngredientQuantity(decimalValue(total).div(7), row.unit);
    const highDay = row.values.indexOf(Math.max(...row.values));
    // "Typical" baseline = this ingredient's own weekly average — a cell
    // well above its own average signals a spike (e.g. payday, holiday),
    // consistent with the spec's "relative to each ingredient's typical
    // amount" framing. Thresholds (1.15x / 1.5x) are a reasonable
    // starting point, not a value locked anywhere else in the system —
    // worth confirming with the project owner if it should change.
    const levels = row.values.map((v) => {
      if (avg <= 0) return 'normal';
      if (decimalValue(v).gt(decimalValue(avg).mul('1.5'))) return 'high';
      if (decimalValue(v).gt(decimalValue(avg).mul('1.15'))) return 'above_normal';
      return 'normal';
    });
    return { ...row, total, average: avg, highDay, levels };
  });

  // --- Daily ingredient demand for targetDate ---
  // The page picks the day and the week separately, so targetDate can be
  // outside the heatmap week: then its forecasts are read on their own.
  const dayForecasts = outsideWeek
    ? (dayRes.data || [])
    : (forecastRows || []).filter((f) => f.forecast_date === targetDate);
  // Same summing rule as the Dashboard's stock alerts (sumIngredientNeeds).
  const dailyByIngredient = new Map();
  for (const { ingredientId, item, need, rawNeed, safetyBuffer, productIds } of sumIngredientNeeds(dayForecasts, recipeMap, bufferMultiplier, modifierShares).values()) {
    dailyByIngredient.set(ingredientId, {
      ingredientId,
      name: item.name,
      category: item.category,
      unit: item.unit,
      unitPrice: item.unitPrice,
      forecastedNeed: need,
      rawForecastedNeed: rawNeed,
      safetyBuffer,
      usedIn: productIds,
      currentStock: item.currentStock,
    });
  }

  const productNamesById = new Map();
  for (const p of productsRes.data || []) productNamesById.set(p.id, p.name);

  const dailyIngredients = Array.from(dailyByIngredient.values())
    .map((entry) => {
      // Price/Unit = the ingredient's own price from Ingredient Management
      // (ingredients.price, per its stock unit). Est. Cost = To Buy (as
      // shown: 2 decimals, whole pieces) × that price, rounded to centavos,
      // so "2.31 kg × ₱50.00/kg = ₱115.50" can be checked by hand. Nothing
      // to buy -> ₱0.00 (not blank) when the price is known.
      const marketPrice = entry.unitPrice;
      const predicted = predictedStockStatus({ quantity: entry.currentStock, need: entry.forecastedNeed }, stockThresholds);
      const status = computeStockStatus(entry.currentStock, entry.forecastedNeed, stockThresholds);
      const toBuy = amountToBuy(entry.forecastedNeed, entry.currentStock, entry.unit);
      return {
        ingredientId: entry.ingredientId,
        name: entry.name,
        category: entry.category,
        usedIn: Array.from(entry.usedIn).map((pid) => productNamesById.get(pid)).filter(Boolean).join(', '),
        rawForecastedNeed: entry.rawForecastedNeed,
        safetyBuffer: entry.safetyBuffer,
        forecastedNeed: entry.forecastedNeed,
        onStock: entry.currentStock,
        unit: entry.unit,
        status,
        predictedStatus: predicted.status,
        predictedLevel: predicted.level,
        predictedAction: predicted.action,
        coveragePct: predicted.coveragePct,
        toBuy: status === 'Normal' || status === 'Excess' ? null : toBuy,
        marketPrice,
        estCost: marketPrice == null ? null : (toBuy > 0 && status !== 'Normal' && status !== 'Excess' ? costForQuantity(toBuy, marketPrice) : 0),
      };
    })
    .sort((a, b) => (STOCK_SEVERITY[b.status] ?? -1) - (STOCK_SEVERITY[a.status] ?? -1));

  // --- Grocery List preview: Critical + Low only, top 5 by est. cost ---
  const groceryEligible = dailyIngredients.filter((i) => i.status === 'Critical' || i.status === 'Low');
  const groceryPreview = [...groceryEligible]
    .sort((a, b) => (b.estCost || 0) - (a.estCost || 0))
    .slice(0, 5);
  const groceryTotals = {
    estTotalCost: roundMoney(groceryEligible.reduce((sum, item) => sum.plus(item.estCost || 0), new Decimal(0))),
    totalItemsToBuy: groceryEligible.length,
  };

  // --- Weekly Grocery List: the same week as the heatmap ---
  // Weekly Forecasted Need = the SUM of the 7 daily Forecasted Need values,
  // each worked out exactly as the Daily Ingredient Demand table shows it
  // (sumIngredientNeeds, rounded per day). Before Oct 26 2026 it summed
  // unrounded buffered values, so the weekly total never matched the daily
  // numbers the owner could add up by hand.
  const dailyNeedByIngredient = new Map(); // ingredientId -> [7 needs]
  weekDates.forEach((weekDate, dayIndex) => {
    const rows = (forecastRows || []).filter((f) => f.forecast_date === weekDate);
    for (const entry of sumIngredientNeeds(rows, recipeMap, bufferMultiplier, modifierShares).values()) {
      if (!dailyNeedByIngredient.has(entry.ingredientId)) dailyNeedByIngredient.set(entry.ingredientId, Array(7).fill(0));
      dailyNeedByIngredient.get(entry.ingredientId)[dayIndex] = entry.need;
    }
  });
  const groceryListWeekly = buildWeeklyGroceryList(
    weeklyDemand.map((row) => {
      const info = weekInfo.get(row.ingredientId);
      return {
        ingredientId: row.ingredientId,
        name: row.ingredient,
        category: info.category,
        unit: row.unit,
        unitPrice: info.unitPrice,
        currentStock: info.currentStock,
        usedIn: Array.from(info.productIds).map((pid) => productNamesById.get(pid)).filter(Boolean).join(', '),
        values: dailyNeedByIngredient.get(row.ingredientId) || Array(7).fill(0),
      };
    }),
    () => null,
    stockThresholds,
  );

  // Lets the page say WHY a table is empty: no forecast vs. no recipe.
  // Closed-day rows (predicted 0) do not count as a forecast.
  const openForecasts = (forecastRows || []).filter((f) => !isClosedForecastRow(f));
  const weekHasForecasts = openForecasts.length > 0;
  const dayHasForecasts = dayForecasts.some((f) => !isClosedForecastRow(f));

  return {
    weekly: { weekStart: weekDates[0], weekEnd: weekDates[6], days: weekDates, rows: weeklyDemand, hasForecasts: weekHasForecasts },
    daily: { date: targetDate, rows: dailyIngredients, hasForecasts: dayHasForecasts, shiftedFromClosedDay, shiftReason },
    // Daily list (unchanged; the Dashboard and the stock alerts agree with it).
    groceryList: { preview: groceryPreview, all: groceryEligible, totals: groceryTotals },
    groceryListWeekly: { weekStart: weekDates[0], weekEnd: weekDates[6], ...groceryListWeekly },
    safetyBufferPercentage: safetyBufferPct,
  };
}

// ---------------------------------------------------------------------
// 4. Dashboard KPI summary (GET /api/forecast/summary)
// ---------------------------------------------------------------------
async function getForecastSummary() {
  const today = defaultDateRange().today;
  const yesterday = dayjs().tz(PH_TZ).subtract(1, 'day').format('YYYY-MM-DD');
  const safetyBufferPct = await getSafetyBufferPercentage();
  const bufferMultiplier = safetyBufferMultiplier(safetyBufferPct);

  const { data: products, error: productsError } = await supabaseAdmin
    .from('products')
    .select('id, name, price, status');
  if (productsError) throw productsError;
  const productById = new Map(products.map((p) => [p.id, p]));

  const { data: todayForecasts, error: forecastError } = await supabaseAdmin
    .from('forecasts')
    .select('product_id, predicted_quantity')
    .eq('forecast_date', today);
  if (forecastError) throw forecastError;

  const predictedSalesToday = todayForecasts.reduce((sum, f) => {
    const product = productById.get(f.product_id);
    return sum + (product ? Number(f.predicted_quantity) * Number(product.price) : 0);
  }, 0);

  const { data: yesterdaySales, error: salesError } = await supabaseAdmin
    .from('daily_sales')
    .select('product_id, quantity_sold')
    .eq('sale_date', yesterday);
  if (salesError) throw salesError;

  // null = nothing uploaded for yesterday (the Dashboard shows "—"), so a
  // missing upload never reads as a ₱0 day. A real zero-sales day (rows
  // exist, quantities 0) still sums to 0.
  const actualSalesYesterday = (yesterdaySales || []).length
    ? yesterdaySales.reduce((sum, s) => {
        const product = productById.get(s.product_id);
        return sum + (product ? Number(s.quantity_sold) * Number(product.price) : 0);
      }, 0)
    : null;

  // Yesterday's forecast at the same prices, so the Dashboard can say
  // "N% of yesterday's forecast". null when yesterday had no forecast rows.
  const { data: yesterdayForecasts, error: yesterdayForecastError } = await supabaseAdmin
    .from('forecasts')
    .select('product_id, predicted_quantity')
    .eq('forecast_date', yesterday);
  if (yesterdayForecastError) throw yesterdayForecastError;
  const predictedSalesYesterday = (yesterdayForecasts || []).length
    ? yesterdayForecasts.reduce((sum, f) => {
        const product = productById.get(f.product_id);
        return sum + (product ? Number(f.predicted_quantity) * Number(product.price) : 0);
      }, 0)
    : null;

  const { data: latestMetrics } = await supabaseAdmin
    .from('model_metrics')
    .select('wmape, baseline_wmape, evaluation_date')
    .order('evaluation_date', { ascending: false })
    // Tie-break: two trainings on the same day -> the newer row wins.
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  const accuracy = latestMetrics ? accuracyFromWmape(latestMetrics.wmape) : null;
  const standing = latestMetrics
    ? accuracyStanding(latestMetrics.wmape, latestMetrics.baseline_wmape)
    : null;

  // Ingredient Demand rule: one status per ingredient, from its need SUMMED
  // across every product that uses it (sumIngredientNeeds). The old code
  // judged each product-ingredient pair on its own and kept the worst, so
  // two "Low" dishes sharing rice never added up to "Critical".
  const [recipeMap, stockThresholds, modifierShares] = await Promise.all([getRecipeMap(), getStockThresholds(), loadModifierShares()]);
  const stockCounts = { Critical: 0, Low: 0, Normal: 0, Excess: 0 };
  for (const { item, need } of sumIngredientNeeds(todayForecasts, recipeMap, bufferMultiplier, modifierShares).values()) {
    const status = computeStockStatus(item.currentStock, need, stockThresholds);
    if (stockCounts[status] !== undefined) stockCounts[status] += 1;
  }

  const { data: latestRun } = await supabaseAdmin
    .from('forecast_runs')
    .select('run_at, stale_days, last_confirmed_date')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    predictedSalesToday,
    predictedSalesYesterday,
    actualSalesYesterday,
    // YYYY-MM-DD (Manila), so the card can say "No sales uploaded for Oct 16".
    yesterday,
    forecastAccuracy: {
      value: accuracy,
      baselineValue: accuracyFromWmape(latestMetrics?.baseline_wmape),
      beatsBaseline: standing?.beatsBaseline ?? null,
      standing,
    },
    stockAlerts: stockCounts,
    freshness: latestRun
      ? { staleDays: latestRun.stale_days, lastConfirmedDate: latestRun.last_confirmed_date, runAt: latestRun.run_at }
      : null,
  };
}

// Which forecast the Ingredient Management statuses are measured against
// (the page shows "As of Latest Forecast (...)"). The statuses use TODAY's
// forecasts rows (getIngredientDailyNeeds); this names the newest
// forecast_runs row and says whether it has rows for that date (a closed
// day has none, so every ingredient reads No Forecast). Labels are made
// here in Manila time so the browser's time zone never matters.
// null when no forecast has ever run.
async function getForecastBasis(date) {
  const targetDate = date || defaultDateRange().today;
  const [runRes, forecastRes] = await Promise.all([
    supabaseAdmin
      .from('forecast_runs')
      .select('run_at, run_type')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('forecasts')
      .select('id')
      .eq('forecast_date', targetDate)
      .limit(1),
  ]);
  if (runRes.error) throw runRes.error;
  if (forecastRes.error) throw forecastRes.error;
  const run = runRes.data;
  if (!run) return null;
  return {
    runAt: run.run_at,
    runAtLabel: dayjs(run.run_at).tz(PH_TZ).format('MMMM D, YYYY • hh:mm A'),
    runType: run.run_type || null,
    forecastDate: targetDate,
    forecastDateLabel: formatDateOnly(targetDate),
    hasForecastForDate: Array.isArray(forecastRes.data) && forecastRes.data.length > 0,
  };
}

module.exports = {
  computeStockStatus,
  sumIngredientNeeds,
  roundIngredientQuantity,
  wholeItems,
  computeModifierShares,
  loadModifierShares,
  buildForecastTableRows,
  cogsPerUnit,
  getRecipeMap,
  getIngredientDailyNeeds,
  getIngredientDailyNeedDetails,
  getSafetyBufferPercentage,
  getLatestMarketPriceMap,
  accuracyFromWmape,
  accuracyStanding,
  getForecastingAnalytics,
  getProductPerformanceAnalytics,
  getIngredientDemandAnalytics,
  getForecastSummary,
  getForecastBasis,
  getMappedIngredientIds,
  // Pure helpers, exported for tests.
  RETRAIN_RECOMMENDED_DAYS,
  parseModelVersionTime,
  formatManilaDateTime,
  trainingTimeOf,
  describeNextTraining,
  isClosedForecastRow,
  nextOpenForecastDate,
  forecastDayState,
  parseClassificationBasis,
  productDemandTier,
  buildPredictionSeries,
  summarizePredictionTotals,
  computePerformanceRatios,
  computeSalesPerformanceRatios,
  buildWeeklyGroceryList,
  defaultRatioRange,
  loadRatioRollingRows,
};
