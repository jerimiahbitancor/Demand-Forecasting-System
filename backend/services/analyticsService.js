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
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';
const { convertRecipeQuantity, parseRecipeQuantity, isMissingColumnError, toBuyQuantity } = require('../utils/recipeUnits');

// Critical <50%, Low <100%, Normal 100-200%, Excess >200% of forecasted
// demand — locked thresholds, matches ml-service/services/business_logic.py's
// _stock_status_row() exactly. Keep these two in sync if either changes.
function computeStockStatus(onStock, forecastedNeed) {
  if (!forecastedNeed || forecastedNeed <= 0) return 'No Forecast';
  const ratio = onStock / forecastedNeed;
  if (ratio < 0.5) return 'Critical';
  if (ratio < 1.0) return 'Low';
  if (ratio <= 2.0) return 'Normal';
  return 'Excess';
}

// Worse-status-wins ranking, used to find a product's "bottleneck"
// ingredient (Product Performance > Demand Classification) and to rank
// items for the Grocery List preview.
const STOCK_SEVERITY = { Critical: 4, Low: 3, 'No Forecast': 2, Normal: 1, Excess: 0 };

function worseStockStatus(a, b) {
  return (STOCK_SEVERITY[a] ?? -1) >= (STOCK_SEVERITY[b] ?? -1) ? a : b;
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

// Table totals add only known values. Products with no price add nothing to
// revenue; no recipe adds nothing to cost; gross profit needs both.
function summarizePredictionTotals(rows = []) {
  const totals = {
    actualRevenue: 0, forecastRevenue: 0, estCost: 0, estGrossProfit: 0,
    noPriceCount: 0, noRecipeCount: 0,
  };
  const noPrice = new Set();
  const noRecipe = new Set();
  for (const r of rows) {
    if (!r.hasPrice) noPrice.add(r.productId);
    if (!r.hasRecipe) noRecipe.add(r.productId);
    if (r.actualRevenue != null) totals.actualRevenue += r.actualRevenue;
    if (r.forecastRevenue != null) totals.forecastRevenue += r.forecastRevenue;
    if (r.estCost != null) totals.estCost += r.estCost;
    if (r.estGrossProfit != null) totals.estGrossProfit += r.estGrossProfit;
  }
  totals.noPriceCount = noPrice.size;
  totals.noRecipeCount = noRecipe.size;
  return totals;
}

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
  // Query with the recipe-unit and purchase-pack columns. The ladder below
  // degrades gracefully: migration 012 (pack) first, then migration 008
  // (recipe unit), then the oldest schema where every quantity is already in
  // the ingredient's own unit and no conversion is needed.
  const ingredientCols = (withPack) => withPack
    ? 'id, name, category, unit, price, quantity, grams_per_cup, pack_qty, pack_unit, pack_price'
    : 'id, name, category, unit, price, quantity, grams_per_cup';
  const recipeSelect = (withUnit, withPack) =>
    `product_id, ${withUnit ? 'unit, ' : ''}quantity_per_serving, ingredients!inner(${ingredientCols(withPack)})`;

  let attempt = await supabaseAdmin
    .from('product_ingredients')
    .select(recipeSelect(true, true));
  if (attempt.error && isMissingColumnError(attempt.error)) {
    attempt = await supabaseAdmin
      .from('product_ingredients')
      .select(recipeSelect(true, false));
  }
  if (attempt.error && isMissingColumnError(attempt.error)) {
    attempt = await supabaseAdmin
      .from('product_ingredients')
      .select(recipeSelect(false, false));
  }
  if (attempt.error) throw attempt.error;
  const data = attempt.data;

  const map = new Map();
  for (const row of data || []) {
    const ingredient = row.ingredients;
    // The recipe's stored unit (row.unit) may differ from the ingredient's
    // stock unit (ingredient.unit). Normalise to the ingredient's unit so
    // every downstream quantity (demand, stock deduction, COGS) is in the
    // same unit the price and stock are quoted in. grams_per_cup lets a
    // volume recipe unit (e.g. cup) convert into a mass stock unit (kg),
    // piece units (e.g. pcs of potato) convert into mass via a per-piece
    // weight, and count units (a sachet) weigh out via the purchase pack.
    const normalizedPerServing = 'unit' in row
      ? convertRecipeQuantity(
          row.quantity_per_serving,
          row.unit || ingredient.unit,
          ingredient.unit,
          {
            gramsPerCup: ingredient.grams_per_cup,
            ingredientName: ingredient.name,
            packQty: ingredient.pack_qty,
            packUnit: ingredient.pack_unit,
          }
        )
      : parseRecipeQuantity(row.quantity_per_serving) || 0;
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
      currentStock: Number(ingredient.quantity) || 0,
      qtyPerServing: Number(normalizedPerServing) || 0,
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
function sumIngredientNeeds(forecastRows, recipeMap, bufferMultiplier) {
  const byIngredient = new Map();
  for (const f of forecastRows || []) {
    for (const item of recipeMap.get(f.product_id) || []) {
      let entry = byIngredient.get(item.ingredientId);
      if (!entry) {
        entry = { ingredientId: item.ingredientId, item, need: 0, productIds: new Set(), byProduct: new Map() };
        byIngredient.set(item.ingredientId, entry);
      }
      const part = Number(f.predicted_quantity) * item.qtyPerServing * bufferMultiplier;
      entry.need += part;
      entry.productIds.add(f.product_id);
      entry.byProduct.set(f.product_id, (entry.byProduct.get(f.product_id) || 0) + part);
    }
  }
  return byIngredient;
}

function cogsPerUnit(recipeItems) {
  return (recipeItems || []).reduce((sum, item) => sum + item.qtyPerServing * item.unitCost, 0);
}

// ---------------------------------------------------------------------
// 1. Forecasting
// ---------------------------------------------------------------------
async function getForecastingAnalytics({ productId, from, to } = {}) {
  const range = defaultDateRange();
  const rangeFrom = from || range.from;
  const rangeTo = to || range.to;

  const { data: metricsRows, error: metricsError } = await supabaseAdmin
    .from('model_metrics')
    .select('*')
    .order('evaluation_date', { ascending: true });
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

  let productQuery = supabaseAdmin.from('products').select('id, name, price, status');
  if (productId) productQuery = productQuery.eq('id', productId);
  const { data: products, error: productsError } = await productQuery;
  if (productsError) throw productsError;
  const productById = new Map((products || []).map((p) => [p.id, p]));

  // Paged: the default range is 38 days (30 back + 7 forward) and a
  // forecast row accumulates per product per date, so ~40 products
  // already puts this over 1,000 rows.
  const buildForecastQuery = () => {
    let q = supabaseAdmin
      .from('forecasts')
      .select('product_id, forecast_date, predicted_quantity, model_version')
      .gte('forecast_date', rangeFrom)
      .lte('forecast_date', rangeTo);
    if (productId) q = q.eq('product_id', productId);
    return q.order('forecast_date').order('product_id');
  };
  const { data: forecastRows, error: forecastError } = await fetchAllRows(buildForecastQuery);
  if (forecastError) throw forecastError;

  // Paged: a date range across all products easily passes 1,000 rows.
  // Sales never go past today (today's file is uploaded tomorrow).
  const salesTo = rangeTo < range.today ? rangeTo : range.today;
  const buildSalesQuery = () => {
    let q = supabaseAdmin
      .from('daily_sales')
      .select('product_id, sale_date, quantity_sold')
      .gte('sale_date', rangeFrom)
      .lte('sale_date', salesTo);
    if (productId) q = q.eq('product_id', productId);
    return q.order('sale_date').order('product_id');
  };
  const { data: salesRows, error: salesError } = await fetchAllRows(buildSalesQuery);
  if (salesError) throw salesError;

  const recipeMap = await getRecipeMap();
  const cogsPerUnitByProduct = new Map();
  for (const [pid, items] of recipeMap.entries()) {
    cogsPerUnitByProduct.set(pid, cogsPerUnit(items));
  }

  const actualByKey = new Map();
  for (const row of salesRows || []) {
    actualByKey.set(`${row.product_id}_${row.sale_date}`, row.quantity_sold);
  }

  // Price 0 = "No price"; no recipe rows = "No recipe". Unknown money
  // values stay null (shown as a label), never as ₱0.
  const priceOf = (pid) => {
    const p = Number(productById.get(pid)?.price);
    return p > 0 ? p : null;
  };

  const rows = (forecastRows || [])
    .map((f) => {
      const product = productById.get(f.product_id);
      const price = priceOf(f.product_id);
      const hasPrice = price !== null;
      const hasRecipe = recipeMap.has(f.product_id);
      const closed = isClosedForecastRow(f);
      const actualQty = actualByKey.has(`${f.product_id}_${f.forecast_date}`)
        ? actualByKey.get(`${f.product_id}_${f.forecast_date}`)
        : null;
      const forecastQty = Number(f.predicted_quantity);
      const forecastRevenue = hasPrice ? forecastQty * price : null;
      const estCost = hasRecipe ? forecastQty * (cogsPerUnitByProduct.get(f.product_id) || 0) : null;
      return {
        date: f.forecast_date,
        productId: f.product_id,
        product: product?.name || `Product ${f.product_id}`,
        closed,
        hasPrice,
        hasRecipe,
        actualQty,
        forecastQty,
        actualRevenue: actualQty !== null && hasPrice ? actualQty * price : null,
        forecastRevenue,
        estCost,
        estGrossProfit: forecastRevenue !== null && estCost !== null ? forecastRevenue - estCost : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));

  // Chart actuals: active products only (or the one selected product), so
  // the line compares like with like against the forecast.
  const countedSales = productId
    ? (salesRows || [])
    : (salesRows || []).filter((s) => productById.get(s.product_id)?.status === 'active');
  const series = buildPredictionSeries({
    salesRows: countedSales,
    forecastRows: forecastRows || [],
    today: range.today,
    priceOf,
  });
  const totals = summarizePredictionTotals(rows);

  const { data: latestRun } = await supabaseAdmin
    .from('forecast_runs')
    .select('run_at, run_type, model_version, last_confirmed_date, stale_days')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: activeProductsCount } = await supabaseAdmin
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

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
async function getProductPerformanceAnalytics({ from, to } = {}) {
  const range = defaultDateRange();
  // Demand Classification keeps the "today" default (it lists forecast rows).
  const rangeFrom = from || range.today;
  const rangeTo = to || range.today;
  // Performance Ratio defaults to the 7 days ending on the newest sale
  // date — today's sales are uploaded tomorrow, so "today" is always empty.
  let ratioFrom = from;
  let ratioTo = to;
  if (!from || !to) {
    const { data: latestSale, error: latestSaleError } = await supabaseAdmin
      .from('daily_sales')
      .select('sale_date')
      .order('sale_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestSaleError) throw latestSaleError;
    const fallback = defaultRatioRange(latestSale?.sale_date, range.today);
    ratioFrom = from || fallback.from;
    ratioTo = to || fallback.to;
  }
  const safetyBufferPct = await getSafetyBufferPercentage();
  const bufferMultiplier = 1 + safetyBufferPct / 100;

  const { data: products, error: productsError } = await supabaseAdmin
    .from('products')
    .select('id, name, price, status, first_sold_date, created_at');
  if (productsError) throw productsError;
  const productById = new Map(products.map((p) => [p.id, p]));

  const recipeMap = await getRecipeMap();

  // --- Demand Classification (today's forecast + latest classification tier) ---
  // Paged: same reason as getForecastingAnalytics — products x dates.
  const { data: forecastRows, error: forecastError } = await fetchAllRows(() => supabaseAdmin
    .from('forecasts')
    .select('product_id, forecast_date, predicted_quantity')
    .gte('forecast_date', rangeFrom)
    .lte('forecast_date', rangeTo)
    .order('forecast_date')
    .order('product_id'));
  if (forecastError) throw forecastError;

  // Paged: this reads the WHOLE table to pick each product's newest row,
  // and the forecast run appends one row per product per day — ~40/day,
  // so it passes 1,000 rows in under a month of normal operation.
  const { data: classificationRows, error: classError } = await fetchAllRows(() => supabaseAdmin
    .from('product_classifications')
    .select('product_id, classification_date, demand_tier, basis')
    .order('classification_date', { ascending: false })
    // Tie-break: two runs on the same date -> the newer row (higher id)
    // comes first, so the "first row per product wins" loop keeps it.
    .order('id', { ascending: false })
    .order('product_id'));
  if (classError) throw classError;
  const latestClassificationByProduct = new Map();
  for (const row of classificationRows || []) {
    if (!latestClassificationByProduct.has(row.product_id)) {
      latestClassificationByProduct.set(row.product_id, row);
    }
  }

  const demandRows = forecastRows
    .map((f) => {
      const product = productById.get(f.product_id);
      if (!product) return null;
      const classification = latestClassificationByProduct.get(f.product_id);
      const recipeItems = recipeMap.get(f.product_id) || [];

      // Bottleneck ingredient: worst stock status among this product's
      // own recipe ingredients, forecasted-need computed with the same
      // formula ml-service uses (business_logic.py estimate_ingredient_demand).
      let bottleneckStatus = null;
      let bottleneckIngredient = null;
      for (const item of recipeItems) {
        const need = Number(f.predicted_quantity) * item.qtyPerServing * bufferMultiplier;
        const status = computeStockStatus(item.currentStock, need);
        if (bottleneckStatus === null || worseStockStatus(status, bottleneckStatus) === status) {
          bottleneckStatus = status;
          bottleneckIngredient = item.name;
        }
      }

      return {
        date: f.forecast_date,
        productId: f.product_id,
        product: product.name,
        forecastQty: Number(f.predicted_quantity),
        demandLevel: classification ? `${classification.demand_tier} Demand` : null,
        demandBasis: classification?.basis || null,
        bottleneckIngredient,
        bottleneckStatus: recipeItems.length ? bottleneckStatus : 'Unmapped',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));

  // --- Performance Ratio ---
  // Quantity Sold / Revenue columns are still real actual sales summed
  // over the range (unchanged).
  const { data: salesRows, error: salesError } = await fetchAllRows(() => supabaseAdmin
    .from('daily_sales')
    .select('product_id, quantity_sold')
    .gte('sale_date', ratioFrom)
    .lte('sale_date', ratioTo)
    .order('sale_date')
    .order('product_id'));
  if (salesError) throw salesError;

  const qtyByProduct = new Map();
  for (const row of salesRows || []) {
    qtyByProduct.set(row.product_id, (qtyByProduct.get(row.product_id) || 0) + row.quantity_sold);
  }

  // Performance Ratio itself (Business Logic Doc v6, 2.2) = the
  // product's own rolling_7 ÷ the average of every ACTIVE product's own
  // rolling_7 on that same day — never a pooled raw-quantity total, and
  // never each product's own historical average. rolling_7 is read
  // straight from forecasts.rolling_7 (written by ml-service's
  // /forecast run — see forecast_service.py + migration 007) instead of
  // recomputed here, so this can never drift from what the model itself
  // used. Rows written before that migration shipped have rolling_7 =
  // null and are excluded, not treated as 0. If the range has no
  // forecast rows, the newest forecast date is used (ratioAsOf).
  const activeProductIds = new Set(products.filter((p) => p.status === 'active').map((p) => p.id));
  const ratioRolling = await loadRatioRollingRows(supabaseAdmin, {
    rangeFrom: ratioFrom, rangeTo: ratioTo, today: range.today, activeProductIds,
  });
  const { ratioByProduct, storeAverageRolling7 } = computePerformanceRatios(ratioRolling.rows, activeProductIds);

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
      let actionSignal = 'Insufficient data';
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
  const statusInputs = await loadStatusInputs(supabaseAdmin);
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
      // Average, across days in range, of the active-product rolling_7
      // average — a display figure only; each row's own ratio is
      // computed per-day against that day's own store average, not
      // against this single summary number.
      storeAverageRolling7,
      range: { from: ratioFrom, to: ratioTo },
      // null when the ratio comes from forecast dates inside the range;
      // otherwise the newest forecast date it was taken from.
      ratioAsOf: ratioRolling.ratioAsOf,
      ratioSource: ratioRolling.source,
    },
    demandRange: { from: rangeFrom, to: rangeTo },
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
  const bufferMultiplier = 1 + safetyBufferPct / 100;
  const targetDate = date || defaultDateRange().today;

  const { data: forecastRows, error } = await supabaseAdmin
    .from('forecasts')
    .select('product_id, predicted_quantity')
    .eq('forecast_date', targetDate);
  if (error) throw error;

  const recipeMap = await getRecipeMap();
  return {
    date: targetDate,
    safetyBufferPct,
    entries: sumIngredientNeeds(forecastRows, recipeMap, bufferMultiplier),
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
  const safetyBufferPct = await getSafetyBufferPercentage();
  const bufferMultiplier = 1 + safetyBufferPct / 100;
  const targetDate = date || defaultDateRange().today;

  const monday = startOfWeekMonday(weekStart || targetDate);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return toDateOnly(d);
  });

  const { data: forecastRows, error: forecastError } = await supabaseAdmin
    .from('forecasts')
    .select('product_id, forecast_date, predicted_quantity, model_version')
    .gte('forecast_date', weekDates[0])
    .lte('forecast_date', weekDates[6]);
  if (forecastError) throw forecastError;

  const recipeMap = await getRecipeMap();
  const marketPriceMap = await getLatestMarketPriceMap();

  // ingredient name -> { values: number[7], ingredientId }
  const heatmap = new Map();
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
          values: [0, 0, 0, 0, 0, 0, 0],
        });
      }
      const entry = heatmap.get(item.ingredientId);
      entry.values[dayIndex] += Number(f.predicted_quantity) * item.qtyPerServing * bufferMultiplier;
    }
  }

  const weeklyDemand = Array.from(heatmap.values()).map((row) => {
    const total = row.values.reduce((s, v) => s + v, 0);
    const avg = total / 7;
    const highDay = row.values.indexOf(Math.max(...row.values));
    // "Typical" baseline = this ingredient's own weekly average — a cell
    // well above its own average signals a spike (e.g. payday, holiday),
    // consistent with the spec's "relative to each ingredient's typical
    // amount" framing. Thresholds (1.15x / 1.5x) are a reasonable
    // starting point, not a value locked anywhere else in the system —
    // worth confirming with the project owner if it should change.
    const levels = row.values.map((v) => {
      if (avg <= 0) return 'normal';
      if (v > avg * 1.5) return 'high';
      if (v > avg * 1.15) return 'above_normal';
      return 'normal';
    });
    return { ...row, total, average: avg, highDay, levels };
  });

  // --- Daily ingredient demand for targetDate ---
  const dayForecasts = (forecastRows || []).filter((f) => f.forecast_date === targetDate);
  // Same summing rule as the Dashboard's stock alerts (sumIngredientNeeds).
  const dailyByIngredient = new Map();
  for (const { ingredientId, item, need, productIds } of sumIngredientNeeds(dayForecasts, recipeMap, bufferMultiplier).values()) {
    dailyByIngredient.set(ingredientId, {
      ingredientId,
      name: item.name,
      category: item.category,
      unit: item.unit,
      forecastedNeed: need,
      usedIn: productIds,
      currentStock: item.currentStock,
    });
  }

  const productNamesById = new Map();
  {
    const { data: products } = await supabaseAdmin.from('products').select('id, name');
    for (const p of products || []) productNamesById.set(p.id, p.name);
  }

  const dailyIngredients = Array.from(dailyByIngredient.values())
    .map((entry) => {
      const marketPrice = marketPriceMap.get(entry.ingredientId)?.price ?? null;
      const status = computeStockStatus(entry.currentStock, entry.forecastedNeed);
      // Count units round UP (utils/recipeUnits.js toBuyQuantity); est.
      // cost is for what is actually bought.
      const toBuy = toBuyQuantity(entry.forecastedNeed, entry.currentStock, entry.unit);
      return {
        ingredientId: entry.ingredientId,
        name: entry.name,
        category: entry.category,
        usedIn: Array.from(entry.usedIn).map((pid) => productNamesById.get(pid)).filter(Boolean).join(', '),
        forecastedNeed: entry.forecastedNeed,
        onStock: entry.currentStock,
        unit: entry.unit,
        status,
        toBuy: status === 'Normal' || status === 'Excess' ? null : toBuy,
        marketPrice,
        estCost: toBuy > 0 && marketPrice !== null ? toBuy * marketPrice : null,
      };
    })
    .sort((a, b) => (STOCK_SEVERITY[b.status] ?? -1) - (STOCK_SEVERITY[a.status] ?? -1));

  // --- Grocery List preview: Critical + Low only, top 5 by est. cost ---
  const groceryEligible = dailyIngredients.filter((i) => i.status === 'Critical' || i.status === 'Low');
  const groceryPreview = [...groceryEligible]
    .sort((a, b) => (b.estCost || 0) - (a.estCost || 0))
    .slice(0, 5);
  const groceryTotals = {
    estTotalCost: groceryEligible.reduce((sum, i) => sum + (i.estCost || 0), 0),
    totalItemsToBuy: groceryEligible.length,
  };

  // Lets the page say WHY a table is empty: no forecast vs. no recipe.
  // Closed-day rows (predicted 0) do not count as a forecast.
  const openForecasts = (forecastRows || []).filter((f) => !isClosedForecastRow(f));
  const weekHasForecasts = openForecasts.length > 0;
  const dayHasForecasts = openForecasts.some((f) => f.forecast_date === targetDate);

  return {
    weekly: { weekStart: weekDates[0], weekEnd: weekDates[6], days: weekDates, rows: weeklyDemand, hasForecasts: weekHasForecasts },
    daily: { date: targetDate, rows: dailyIngredients, hasForecasts: dayHasForecasts },
    groceryList: { preview: groceryPreview, all: groceryEligible, totals: groceryTotals },
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
  const bufferMultiplier = 1 + safetyBufferPct / 100;

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
  const recipeMap = await getRecipeMap();
  const stockCounts = { Critical: 0, Low: 0, Normal: 0, Excess: 0 };
  for (const { item, need } of sumIngredientNeeds(todayForecasts, recipeMap, bufferMultiplier).values()) {
    const status = computeStockStatus(item.currentStock, need);
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
  buildPredictionSeries,
  summarizePredictionTotals,
  computePerformanceRatios,
  defaultRatioRange,
  loadRatioRollingRows,
};
