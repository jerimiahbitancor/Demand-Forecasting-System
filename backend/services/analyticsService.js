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
const { supabaseAdmin } = require('../config/supabase');

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

// Lewis 1982 MAPE-scale accuracy tiers, per the system module spec
// (Forecasting > 1.1 Forecast Accuracy). accuracy = 100 - MAPE, clamped
// to [0, 100] since MAPE has no natural upper bound.
function accuracyFromMape(mape) {
  if (mape === null || mape === undefined) return null;
  return Math.max(0, Math.min(100, 100 - Number(mape)));
}

function accuracyTier(accuracy) {
  if (accuracy === null || accuracy === undefined) return null;
  if (accuracy > 90) return { label: 'Excellent', color: 'green' };
  if (accuracy >= 80) return { label: 'Good', color: 'green' };
  if (accuracy >= 70) return { label: 'Fair', color: 'amber' };
  return { label: 'Low', color: 'red' };
}

// Human labels for the 11 locked FEATURE_COLUMNS (ml-service/services/
// feature_engineering.py) — used only for display; the DB key stays
// the raw column name so this never has to be kept in sync with a
// separate id scheme.
const FEATURE_LABELS = {
  product_id: 'Product',
  dow: 'Day of Week',
  month: 'Month',
  day: 'Day of Month',
  is_weekend: 'Weekend',
  is_holiday: 'Holiday',
  is_payday: 'Payday',
  lag_1: 'Sales Lag (1 day)',
  lag_7: 'Sales Lag (7 days)',
  rolling_7: 'Rolling Average (7 days)',
  rolling_14: 'Rolling Average (14 days)',
};

function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function defaultDateRange(daysBack = 30, daysForward = 7) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - daysBack);
  const to = new Date(today);
  to.setDate(to.getDate() + daysForward);
  return { from: toDateOnly(from), to: toDateOnly(to), today: toDateOnly(today) };
}

// Next daily 9:00 AM forecast-refresh run, per the system module doc's
// "Daily forecast refresh: Every day, 9:00 AM" schedule note.
// NOTE: CLAUDE.md's project instructions say 8:00 AM for this same job —
// the two documents disagree on the hour. Using 9:00 AM here (the more
// detailed, more recently-dated spec) but this needs a real answer from
// the project owner before a cron job actually gets scheduled on either.
function nextDailyForecastRun(now = new Date()) {
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
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
  const { data, error } = await supabaseAdmin
    .from('product_ingredients')
    .select('product_id, quantity_per_serving, ingredients!inner(id, name, category, unit, price, quantity)');
  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    const ingredient = row.ingredients;
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
      qtyPerServing: Number(row.quantity_per_serving) || 0,
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
  const accuracyHistory = (metricsRows || []).map((row) => ({
    date: row.evaluation_date,
    modelVersion: row.model_version,
    accuracy: accuracyFromMape(row.mape),
  }));
  const latestAccuracy = latestMetrics ? accuracyFromMape(latestMetrics.mape) : null;

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

  let forecastQuery = supabaseAdmin
    .from('forecasts')
    .select('product_id, forecast_date, predicted_quantity, model_version')
    .gte('forecast_date', rangeFrom)
    .lte('forecast_date', rangeTo);
  if (productId) forecastQuery = forecastQuery.eq('product_id', productId);
  const { data: forecastRows, error: forecastError } = await forecastQuery;
  if (forecastError) throw forecastError;

  let salesQuery = supabaseAdmin
    .from('daily_sales')
    .select('product_id, sale_date, quantity_sold')
    .gte('sale_date', rangeFrom)
    .lte('sale_date', rangeTo);
  if (productId) salesQuery = salesQuery.eq('product_id', productId);
  const { data: salesRows, error: salesError } = await salesQuery;
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
      tier: accuracyTier(latestAccuracy),
      errorRate: latestMetrics?.mape ?? null,
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
  const { data: forecastRows, error: forecastError } = await supabaseAdmin
    .from('forecasts')
    .select('product_id, forecast_date, predicted_quantity')
    .gte('forecast_date', rangeFrom)
    .lte('forecast_date', rangeTo);
  if (forecastError) throw forecastError;

  const { data: classificationRows, error: classError } = await supabaseAdmin
    .from('product_classifications')
    .select('product_id, classification_date, demand_tier, basis')
    .order('classification_date', { ascending: false });
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

  // --- Performance Ratio (actual_qty summed over range ÷ store average) ---
  const { data: salesRows, error: salesError } = await supabaseAdmin
    .from('daily_sales')
    .select('product_id, quantity_sold')
    .gte('sale_date', rangeFrom)
    .lte('sale_date', rangeTo);
  if (salesError) throw salesError;

  const qtyByProduct = new Map();
  for (const row of salesRows || []) {
    qtyByProduct.set(row.product_id, (qtyByProduct.get(row.product_id) || 0) + row.quantity_sold);
  }
  const qtyValues = Array.from(qtyByProduct.values());
  const rollingAvgQtyAllProducts = qtyValues.length
    ? qtyValues.reduce((sum, v) => sum + v, 0) / qtyValues.length
    : 0;

  const performanceRows = Array.from(qtyByProduct.entries())
    .map(([productId, qty]) => {
      const product = productById.get(productId);
      if (!product) return null;
      const ratio = rollingAvgQtyAllProducts > 0 ? qty / rollingAvgQtyAllProducts : null;
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
  const { data: lastSaleRows, error: lastSaleError } = await supabaseAdmin
    .from('daily_sales')
    .select('product_id, sale_date')
    .order('sale_date', { ascending: false });
  if (lastSaleError) throw lastSaleError;
  const lastSaleByProduct = new Map();
  for (const row of lastSaleRows || []) {
    if (!lastSaleByProduct.has(row.product_id)) lastSaleByProduct.set(row.product_id, row.sale_date);
  }

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
      storeAverageQty: rollingAvgQtyAllProducts,
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
  const { data, error } = await supabaseAdmin
    .from('market_price')
    .select('ingredient_id, price, source, scraped_at')
    .order('scraped_at', { ascending: false });
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
  const yesterday = toDateOnly(new Date(Date.now() - 86400000));
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
    .select('mape, evaluation_date')
    .order('evaluation_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const accuracy = latestMetrics ? accuracyFromMape(latestMetrics.mape) : null;

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
    forecastAccuracy: { value: accuracy, tier: accuracyTier(accuracy) },
    stockAlerts: stockCounts,
    freshness: latestRun
      ? { staleDays: latestRun.stale_days, lastConfirmedDate: latestRun.last_confirmed_date, runAt: latestRun.run_at }
      : null,
  };
}

module.exports = {
  computeStockStatus,
  accuracyFromMape,
  accuracyTier,
  getForecastingAnalytics,
  getProductPerformanceAnalytics,
  getIngredientDemandAnalytics,
  getForecastSummary,
};
