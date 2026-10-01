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
const { getProductSalesSummary } = require('../utils/productSalesSummary');
const { supabaseAdmin } = require('../config/supabase');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';
const { convertRecipeQuantity, parseRecipeQuantity, isMissingColumnError } = require('../utils/recipeUnits');

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

// Human labels for the 12 FEATURE_COLUMNS (ml-service/services/
// feature_engineering.py) — used only for display; the DB key stays
// the raw column name so this never has to be kept in sync with a
// separate id scheme.
//
// Updated Oct 1 2026: `lag_7` is gone (it meant "7 rows back", which is
// not the same weekday once there are closed days), replaced by
// `same_dow_last_open`, and `days_since_last_open` was added. An unknown
// key still falls back to the raw column name, so an older model's
// feature_importance keys render readably rather than crashing.
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

// Next daily 9:00 AM Asia/Manila forecast-refresh run — matches the real
// cron job registered in jobs/forecastScheduler.js ('0 9 * * *', timezone
// Asia/Manila). 9:00 AM is the confirmed, locked schedule (see CLAUDE.md);
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
  // Query with the recipe-unit column. If migration 008 hasn't been applied
  // yet (column product_ingredients.unit missing), fall back to the previous
  // schema: every quantity is already in the ingredient's own unit, so no
  // conversion is needed.
  const primary = await supabaseAdmin
    .from('product_ingredients')
    .select('product_id, unit, quantity_per_serving, ingredients!inner(id, name, category, unit, price, quantity, grams_per_cup)');
  let data = primary.data;
  if (primary.error && isMissingColumnError(primary.error)) {
    const fallback = await supabaseAdmin
      .from('product_ingredients')
      .select('product_id, quantity_per_serving, ingredients!inner(id, name, category, unit, price, quantity, grams_per_cup)');
    if (fallback.error) throw fallback.error;
    data = fallback.data;
  } else if (primary.error) {
    throw primary.error;
  }

  const map = new Map();
  for (const row of data || []) {
    const ingredient = row.ingredients;
    // The recipe's stored unit (row.unit) may differ from the ingredient's
    // stock unit (ingredient.unit). Normalise to the ingredient's unit so
    // every downstream quantity (demand, stock deduction, COGS) is in the
    // same unit the price and stock are quoted in. grams_per_cup lets a
    // volume recipe unit (e.g. cup) convert into a mass stock unit (kg), and
    // piece units (e.g. pcs of potato) convert into mass via a per-piece weight.
    const normalizedPerServing = 'unit' in row
      ? convertRecipeQuantity(
          row.quantity_per_serving,
          row.unit || ingredient.unit,
          ingredient.unit,
          { gramsPerCup: ingredient.grams_per_cup, ingredientName: ingredient.name }
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

  const latestMetrics = metricsRows && metricsRows.length ? metricsRows[metricsRows.length - 1] : null;
  // Rows written before migration 008 have no wmape and never will —
  // re-scoring them would mean rebuilding a feature set that no longer
  // exists. They are SKIPPED, not treated as 0% accuracy, so the history
  // line and the chart simply start at the first WMAPE-scored run instead
  // of plunging to zero for every older row.
  const accuracyHistory = (metricsRows || [])
    .filter((row) => row.wmape !== null && row.wmape !== undefined)
    .map((row) => ({
      date: row.evaluation_date,
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
  const buildSalesQuery = () => {
    let q = supabaseAdmin
      .from('daily_sales')
      .select('product_id, sale_date, quantity_sold')
      .gte('sale_date', rangeFrom)
      .lte('sale_date', rangeTo);
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

  const rows = (forecastRows || [])
    .map((f) => {
      const product = productById.get(f.product_id);
      const price = product ? Number(product.price) : 0;
      const actualQty = actualByKey.has(`${f.product_id}_${f.forecast_date}`)
        ? actualByKey.get(`${f.product_id}_${f.forecast_date}`)
        : null;
      const forecastQty = Number(f.predicted_quantity);
      const unitCogs = cogsPerUnitByProduct.get(f.product_id) || 0;
      const forecastRevenue = forecastQty * price;
      const estCost = forecastQty * unitCogs;
      return {
        date: f.forecast_date,
        productId: f.product_id,
        product: product?.name || `Product ${f.product_id}`,
        actualQty,
        forecastQty,
        actualRevenue: actualQty !== null ? actualQty * price : null,
        forecastRevenue,
        estCost,
        estGrossProfit: forecastRevenue - estCost,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));

  const byDate = new Map();
  for (const row of rows) {
    const bucket = byDate.get(row.date) || { date: row.date, actual: 0, forecast: 0, hasActual: false };
    bucket.forecast += row.forecastQty;
    if (row.actualQty !== null) {
      bucket.actual += row.actualQty;
      bucket.hasActual = true;
    }
    byDate.set(row.date, bucket);
  }
  const series = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => ({
      date: point.date,
      actual: point.hasActual ? point.actual : null,
      forecast: point.date <= range.today ? point.forecast : null,
      future: point.date > range.today ? point.forecast : null,
    }));

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
    prediction: { rows, series, range: { from: rangeFrom, to: rangeTo } },
    modelInsights: {
      featureImportance, // null until the NEXT training run after migration 005 — see route-level note
      trainingInfo: {
        modelStatus: latestMetrics ? 'Trained' : 'Not Trained',
        modelVersion: latestMetrics?.model_version || null,
        lastTrained: latestMetrics?.evaluation_date || null,
        latestForecastRun: latestRun?.run_at || null,
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
        // Retraining cadence explicitly not finalized per the system
        // module doc ("still researching") — not guessing at a date.
        nextTraining: null,
        nextForecastRun: nextDailyForecastRun(),
      },
    },
  };
}

// ---------------------------------------------------------------------
// 2. Product Performance
// ---------------------------------------------------------------------
async function getProductPerformanceAnalytics({ from, to } = {}) {
  const range = defaultDateRange();
  const rangeFrom = from || range.today;
  const rangeTo = to || range.today;
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
    .gte('sale_date', rangeFrom)
    .lte('sale_date', rangeTo)
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
  // null and are excluded below, not treated as 0.
  const activeProductIds = new Set(products.filter((p) => p.status === 'active').map((p) => p.id));

  // Paged: products x dates over the requested range.
  const { data: rollingRows, error: rollingError } = await fetchAllRows(() => supabaseAdmin
    .from('forecasts')
    .select('product_id, forecast_date, rolling_7')
    .gte('forecast_date', rangeFrom)
    .lte('forecast_date', rangeTo)
    .not('rolling_7', 'is', null)
    .order('forecast_date')
    .order('product_id'));
  if (rollingError) throw rollingError;

  // forecast_date -> [{ productId, rolling7 }] for active products only
  const rollingByDate = new Map();
  for (const row of rollingRows || []) {
    if (!activeProductIds.has(row.product_id)) continue;
    const bucket = rollingByDate.get(row.forecast_date) || [];
    bucket.push({ productId: row.product_id, rolling7: Number(row.rolling_7) });
    rollingByDate.set(row.forecast_date, bucket);
  }

  // productId -> list of that product's daily ratios (own rolling_7 ÷
  // that day's active-product average rolling_7), one entry per day in
  // range that had data for it.
  const dailyRatiosByProduct = new Map();
  const dailyStoreAverages = [];
  for (const entries of rollingByDate.values()) {
    const storeAvgRolling7 = entries.reduce((sum, e) => sum + e.rolling7, 0) / entries.length;
    if (storeAvgRolling7 <= 0) continue;
    dailyStoreAverages.push(storeAvgRolling7);
    for (const { productId, rolling7 } of entries) {
      const list = dailyRatiosByProduct.get(productId) || [];
      list.push(rolling7 / storeAvgRolling7);
      dailyRatiosByProduct.set(productId, list);
    }
  }
  const storeAverageRolling7 = dailyStoreAverages.length
    ? dailyStoreAverages.reduce((sum, v) => sum + v, 0) / dailyStoreAverages.length
    : null;

  function averagePerformanceRatio(productId) {
    const ratios = dailyRatiosByProduct.get(productId);
    if (!ratios || !ratios.length) return null;
    return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
  }

  const performanceRows = Array.from(qtyByProduct.entries())
    .map(([productId, qty]) => {
      const product = productById.get(productId);
      if (!product) return null;
      const ratio = averagePerformanceRatio(productId);
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
        revenue: qty * Number(product.price),
        performanceRatio: ratio,
        actionSignal,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.performanceRatio || 0) - (a.performanceRatio || 0))
    .map((row, index) => ({ rank: index + 1, ...row }));

  // --- Product Status sections ---
  // One query via the product_sales_summary view instead of reading the
  // whole daily_sales table on every page load.
  const { data: salesSummary, error: lastSaleError } = await getProductSalesSummary();
  if (lastSaleError) throw lastSaleError;
  const lastSaleByProduct = new Map(
    [...salesSummary].map(([productId, s]) => [productId, s.lastSaleDate])
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
      const daysTracked = product.first_sold_date ? daysAgo(product.first_sold_date) : 0;
      const daysUntilForecast = Math.max(0, 28 - (daysTracked || 0));
      sections.new.push({
        ...base,
        daysOnMenu: product.first_sold_date ? `${daysTracked} days` : 'Not yet sold',
        forecastStatus: daysUntilForecast > 0 ? `Forecast in ${daysUntilForecast} days` : 'Forecast Running',
      });
    } else if (product.status === 'inactive_discontinued') {
      const idleDays = lastSale ? daysAgo(lastSale) : null;
      sections.inactive.push({
        ...base,
        lastSale: lastSale ? `${idleDays} days ago` : 'Never sold',
        forecastStatus: 'Excluded — no sale in 28+ days',
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
      range: { from: rangeFrom, to: rangeTo },
    },
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
  const safetyBufferPct = await getSafetyBufferPercentage();
  const bufferMultiplier = 1 + safetyBufferPct / 100;
  const targetDate = date || defaultDateRange().today;

  const { data: forecastRows, error } = await supabaseAdmin
    .from('forecasts')
    .select('product_id, predicted_quantity')
    .eq('forecast_date', targetDate);
  if (error) throw error;

  const recipeMap = await getRecipeMap();

  const needs = new Map();
  for (const f of forecastRows || []) {
    const items = recipeMap.get(f.product_id) || [];
    for (const item of items) {
      const add = Number(f.predicted_quantity) * item.qtyPerServing * bufferMultiplier;
      needs.set(item.ingredientId, (needs.get(item.ingredientId) || 0) + add);
    }
  }
  return needs;
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
    .select('product_id, forecast_date, predicted_quantity')
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
        heatmap.set(item.ingredientId, { ingredient: item.name, ingredientId: item.ingredientId, values: [0, 0, 0, 0, 0, 0, 0] });
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
  const dailyByIngredient = new Map();
  for (const f of dayForecasts) {
    const recipeItems = recipeMap.get(f.product_id) || [];
    for (const item of recipeItems) {
      if (!dailyByIngredient.has(item.ingredientId)) {
        dailyByIngredient.set(item.ingredientId, {
          ingredientId: item.ingredientId,
          name: item.name,
          category: item.category,
          unit: item.unit,
          forecastedNeed: 0,
          usedIn: new Set(),
          currentStock: item.currentStock,
        });
      }
      const entry = dailyByIngredient.get(item.ingredientId);
      entry.forecastedNeed += Number(f.predicted_quantity) * item.qtyPerServing * bufferMultiplier;
      entry.usedIn.add(f.product_id);
    }
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
      const toBuy = Math.max(0, entry.forecastedNeed - entry.currentStock);
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

  return {
    weekly: { weekStart: weekDates[0], weekEnd: weekDates[6], days: weekDates, rows: weeklyDemand },
    daily: { date: targetDate, rows: dailyIngredients },
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

  const actualSalesYesterday = (yesterdaySales || []).reduce((sum, s) => {
    const product = productById.get(s.product_id);
    return sum + (product ? Number(s.quantity_sold) * Number(product.price) : 0);
  }, 0);

  const { data: latestMetrics } = await supabaseAdmin
    .from('model_metrics')
    .select('wmape, baseline_wmape, evaluation_date')
    .order('evaluation_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const accuracy = latestMetrics ? accuracyFromWmape(latestMetrics.wmape) : null;
  const standing = latestMetrics
    ? accuracyStanding(latestMetrics.wmape, latestMetrics.baseline_wmape)
    : null;

  const recipeMap = await getRecipeMap();
  const forecastByProduct = new Map(todayForecasts.map((f) => [f.product_id, Number(f.predicted_quantity)]));
  const stockCounts = { Critical: 0, Low: 0, Normal: 0, Excess: 0 };
  const ingredientStatusById = new Map();
  for (const [productId, recipeItems] of recipeMap.entries()) {
    const forecastQty = forecastByProduct.get(productId) || 0;
    for (const item of recipeItems) {
      const need = forecastQty * item.qtyPerServing * bufferMultiplier;
      const status = computeStockStatus(item.currentStock, need);
      const existing = ingredientStatusById.get(item.ingredientId);
      if (!existing || worseStockStatus(status, existing) === status) {
        ingredientStatusById.set(item.ingredientId, status);
      }
    }
  }
  for (const status of ingredientStatusById.values()) {
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
    actualSalesYesterday,
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

module.exports = {
  computeStockStatus,
  getIngredientDailyNeeds,
  accuracyFromWmape,
  accuracyStanding,
  getForecastingAnalytics,
  getProductPerformanceAnalytics,
  getIngredientDemandAnalytics,
  getForecastSummary,
};
