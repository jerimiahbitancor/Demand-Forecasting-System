// tests/analyticsHelpers.test.js — run: node --test tests/analyticsHelpers.test.js
//
// Pure helpers behind Analytics (K2 times, K4 series/totals, K5 ratio
// fallback). No network: the fake Supabase client is installed
// before analyticsService loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

const fake = createFakeSupabase({});
installFake(fake);
const svc = require('../services/analyticsService');

// ---------------------------------------------------------------- K2 time
test('K2: model_v20261013_205641 (UTC) -> Oct 14, 2026, 4:56 AM Manila', () => {
  const t = svc.trainingTimeOf({ model_version: 'model_v20261013_205641', evaluation_date: '2026-10-13' });
  assert.equal(t.text, 'Oct 14, 2026, 4:56 AM');
  assert.equal(t.at, '2026-10-13T20:56:41.000Z');
});

test('K2: malformed version falls back to evaluation_date (date only)', () => {
  assert.equal(svc.parseModelVersionTime('model_v20261313_205641'), null); // month 13
  assert.equal(svc.parseModelVersionTime('something_else'), null);
  const t = svc.trainingTimeOf({ model_version: 'legacy', evaluation_date: '2026-10-06' });
  assert.equal(t.text, 'Oct 6, 2026');
  assert.equal(t.at, null);
});

test('K2: no model -> null text, next training still says manual', () => {
  assert.equal(svc.trainingTimeOf(null).text, null);
  assert.equal(svc.describeNextTraining(null), 'Manual (click Start Training).');
});

test('K2: next training = Manila training date + RETRAIN_RECOMMENDED_DAYS', () => {
  assert.equal(svc.RETRAIN_RECOMMENDED_DAYS, 30);
  // Trained Oct 14 Manila (Oct 13 UTC) -> Nov 13 2026.
  assert.equal(
    svc.describeNextTraining({ model_version: 'model_v20261013_205641' }),
    'Manual (click Start Training). Recommended around Nov 13, 2026.'
  );
  assert.equal(
    svc.describeNextTraining({ model_version: 'x', evaluation_date: '2026-10-06' }),
    'Manual (click Start Training). Recommended around Nov 5, 2026.'
  );
});

test('K2: formatManilaDateTime for forecast run times', () => {
  assert.equal(svc.formatManilaDateTime('2026-10-14T01:00:00.000Z'), 'Oct 14, 2026, 9:00 AM');
  assert.equal(svc.formatManilaDateTime(null), null);
});

// -------------------------------------------------------------- K4 series
test('K4: union of sale dates and forecast dates; today on both lines', () => {
  const today = '2026-10-14';
  const series = svc.buildPredictionSeries({
    today,
    salesRows: [
      { product_id: 1, sale_date: '2026-10-12', quantity_sold: 5 },
      { product_id: 2, sale_date: '2026-10-12', quantity_sold: 3 },
      { product_id: 1, sale_date: '2026-10-13', quantity_sold: 4 },
      { product_id: 1, sale_date: '2026-10-15', quantity_sold: 99 }, // future: ignored
    ],
    forecastRows: [
      { product_id: 1, forecast_date: '2026-10-13', predicted_quantity: 6, model_version: 'm' },
      { product_id: 1, forecast_date: '2026-10-14', predicted_quantity: 7, model_version: 'm' },
      { product_id: 2, forecast_date: '2026-10-14', predicted_quantity: 2, model_version: 'm' },
      { product_id: 1, forecast_date: '2026-10-15', predicted_quantity: 8, model_version: 'm' },
    ],
  });
  assert.deepEqual(series.map((p) => p.date), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
  const [d12, d13, d14, d15] = series;
  assert.equal(d12.actual, 8);           // sales-only date is kept
  assert.equal(d12.forecast, null);
  assert.equal(d13.actual, 4);
  assert.equal(d13.forecast, 6);
  assert.equal(d13.future, null);
  assert.equal(d14.forecast, 9);         // today: solid side...
  assert.equal(d14.future, 9);           // ...and dashed side, so they connect
  assert.equal(d15.forecast, null);
  assert.equal(d15.future, 8);
  assert.equal(d15.actual, null);
});

test('K4: a closed day is a gap marked closed, never a 0 forecast', () => {
  const series = svc.buildPredictionSeries({
    today: '2026-10-14',
    forecastRows: [
      { product_id: 1, forecast_date: '2026-10-17', predicted_quantity: 5, model_version: 'model_v1' },
      { product_id: 1, forecast_date: '2026-10-18', predicted_quantity: 0, model_version: 'model_v1_closed' },
      { product_id: 2, forecast_date: '2026-10-18', predicted_quantity: 0, model_version: 'model_v1_closed' },
    ],
  });
  const sunday = series.find((p) => p.date === '2026-10-18');
  assert.equal(sunday.closed, true);
  assert.equal(sunday.future, null);
  assert.equal(sunday.forecast, null);
  assert.equal(series.find((p) => p.date === '2026-10-17').closed, false);
});

test('K4: revenue series skips unknown prices', () => {
  const [p] = svc.buildPredictionSeries({
    today: '2026-10-14',
    priceOf: (id) => (id === 1 ? 100 : null),
    salesRows: [{ product_id: 1, sale_date: '2026-10-14', quantity_sold: 2 }, { product_id: 2, sale_date: '2026-10-14', quantity_sold: 5 }],
    forecastRows: [{ product_id: 1, forecast_date: '2026-10-14', predicted_quantity: 3, model_version: 'm' }],
  });
  assert.equal(p.actual, 7);
  assert.equal(p.actualRevenue, 200);
  assert.equal(p.forecastRevenue, 300);
});

test('K4: totals add known values only and count missing price/recipe products (no gross profit)', () => {
  const totals = svc.summarizePredictionTotals([
    { productId: 1, hasPrice: true, hasRecipe: true, actualQty: 2, forecastQty: 3, actualRevenue: 100, forecastRevenue: 120, estCost: 40 },
    { productId: 2, hasPrice: false, hasRecipe: true, actualQty: 1, forecastQty: null, actualRevenue: null, forecastRevenue: null, estCost: 10 },
    { productId: 2, hasPrice: false, hasRecipe: true, actualQty: null, forecastQty: 4, actualRevenue: null, forecastRevenue: null, estCost: 10 },
    { productId: 3, hasPrice: true, hasRecipe: false, actualQty: null, forecastQty: 2, closed: true, actualRevenue: null, forecastRevenue: 50, estCost: null },
  ]);
  assert.equal(totals.actualQty, 3);
  assert.equal(totals.forecastQty, 7, 'closed-day quantities are not forecast totals');
  assert.equal(totals.forecastRevenue, 170);
  assert.equal(totals.actualRevenue, 100);
  assert.equal(totals.estCost, 60);
  assert.equal(totals.estGrossProfit, undefined, 'gross profit removed (Oct 25 2026)');
  assert.equal(totals.noPriceCount, 1); // distinct products, not rows
  assert.equal(totals.noRecipeCount, 1);
});

// ------------------------------------------------ Oct 25 2026 concern fixes
test('wholeItems: nearest whole plate, half up, never negative', () => {
  assert.equal(svc.wholeItems(12.25), 12);
  assert.equal(svc.wholeItems('2.5'), 3);
  assert.equal(svc.wholeItems(0.46), 0);
  assert.equal(svc.wholeItems(-1), 0);
  assert.equal(svc.wholeItems(null), 0);
});

test('Forecast table: a sales day WITHOUT a forecast still shows its Actual Qty; unmapped products are left out', () => {
  const productById = new Map([[1, { id: 1, name: 'Porksilog', price: 120 }], [2, { id: 2, name: 'Water', price: 20 }]]);
  const rows = svc.buildForecastTableRows({
    today: '2026-10-25',
    productById,
    cogsPerUnitByProduct: new Map([[1, 45.5]]), // product 2 has no recipe
    priceOf: (id) => Number(productById.get(id)?.price) || null,
    salesRows: [
      { product_id: 1, sale_date: '2026-09-30', quantity_sold: 10 },
      { product_id: 1, sale_date: '2026-09-30', quantity_sold: 2 }, // a second row the same day is ADDED
      { product_id: 2, sale_date: '2026-09-30', quantity_sold: 5 },
    ],
    forecastRows: [{ product_id: 1, forecast_date: '2026-10-26', predicted_quantity: 12.25, model_version: 'm' }],
  });
  assert.equal(rows.length, 2, JSON.stringify(rows));
  const past = rows.find((r) => r.date === '2026-09-30');
  assert.equal(past.actualQty, 12);
  assert.equal(past.forecastQty, null);
  assert.equal(past.actualRevenue, 1440);
  assert.equal(past.estCost, null);
  const future = rows.find((r) => r.date === '2026-10-26');
  assert.equal(future.forecastQty, 12, 'whole plates');
  assert.equal(future.forecastQtyRaw, 12.25);
  assert.equal(future.forecastRevenue, 1440, '12 × ₱120');
  assert.equal(future.estCost, 546, '12 × ₱45.50 COGS, the Product Management number');
  assert.equal('estGrossProfit' in future, false);
});

test('COGS per plate = Σ qty × price in exact decimals, rounded to centavos (Product Management rule)', () => {
  assert.equal(svc.cogsPerUnit([
    { qtyPerServing: '0.06', unitPrice: '350' },  // 60 g pork at ₱350/kg = 21.00
    { qtyPerServing: '1', unitPrice: '8.5' },     // 1 egg = 8.50
    { qtyPerServing: '0.2', unitPrice: '55.555' }, // rice = 11.111
  ]), 40.61);
});

test('Modifier share: NO EGG plates leave out egg; capped at 1; outside the window ignored', () => {
  const shares = svc.computeModifierShares({
    windowDates: ['2026-09-29', '2026-09-30'],
    rules: [{ keyword: 'no egg', ingredient_id: 10 }],
    sales: [
      { product_id: 1, sale_date: '2026-09-29', quantity_sold: 300 },
      { product_id: 1, sale_date: '2026-09-30', quantity_sold: 100 },
      { product_id: 1, sale_date: '2026-08-01', quantity_sold: 999 },
    ],
    modifiers: [
      { product_id: 1, sale_date: '2026-09-30', keyword: 'NO  EGG', quantity: 40 },
      { product_id: 1, sale_date: '2026-08-01', keyword: 'NO EGG', quantity: 500 },
    ],
  });
  assert.equal(shares.get('1:10').toString(), '0.1');
  const egg = { ingredientId: 10, unit: 'pcs', qtyPerServing: '1' };
  const [entry] = svc.sumIngredientNeeds([{ product_id: 1, predicted_quantity: 20.4 }], new Map([[1, [egg]]]), '1', shares).values();
  assert.equal(entry.rawNeed, 18, '20 plates × 1 egg × (1 − 10%)');
});

test('Recipe map: one unconvertible recipe line is skipped, not a crash for every page', async () => {
  fake.reset({
    product_ingredients: [
      { product_id: 1, unit: 'kg', quantity_per_serving: 0.1, ingredients: { id: 10, name: 'Soy', unit: 'mL', price: 1, quantity: 1000 } },
      { product_id: 1, unit: 'pcs', quantity_per_serving: 1, ingredients: { id: 11, name: 'Egg', unit: 'pcs', price: 8, quantity: 30 } },
    ],
  });
  const restore = console.warn; console.warn = () => {};
  try {
    const map = await svc.getRecipeMap();
    assert.deepEqual(map.get(1).map((i) => i.name), ['Egg']);
  } finally { console.warn = restore; }
});

// ---------------------------------------------------------------- K5 ratio
test('K5: default range = 7 days ending on the latest sale date', () => {
  assert.deepEqual(svc.defaultRatioRange('2026-10-10', '2026-10-14'), { from: '2026-10-04', to: '2026-10-10' });
  assert.deepEqual(svc.defaultRatioRange(null, '2026-10-14'), { from: '2026-10-08', to: '2026-10-14' });
});

test('K5: ratio = own rolling_7 ÷ store average rolling_7 of ACTIVE products', () => {
  const { ratioByProduct, storeAverageRolling7 } = svc.computePerformanceRatios([
    { product_id: 1, forecast_date: '2026-10-14', rolling_7: 30 },
    { product_id: 2, forecast_date: '2026-10-14', rolling_7: 10 },
    { product_id: 9, forecast_date: '2026-10-14', rolling_7: 1000 }, // not active: ignored
  ], new Set([1, 2]));
  assert.equal(storeAverageRolling7, 20);
  assert.equal(ratioByProduct.get(1), 1.5);
  assert.equal(ratioByProduct.get(2), 0.5);
  assert.equal(ratioByProduct.has(9), false);
});

// ------------------------------------------------- sales-based ratio (Oct 18)
test('sales ratio: avg items per open day ÷ store average of active products', () => {
  // 2 open days. A: 30 sold -> 15/day; B: 10 sold -> 5/day; store avg 10.
  const { ratioByProduct, storeAverageDaily } = svc.computeSalesPerformanceRatios([
    { product_id: 1, sale_date: '2026-10-12', quantity_sold: 20 },
    { product_id: 1, sale_date: '2026-10-13', quantity_sold: 10 },
    { product_id: 2, sale_date: '2026-10-12', quantity_sold: 4 },
    { product_id: 2, sale_date: '2026-10-13', quantity_sold: 6 },
    { product_id: 9, sale_date: '2026-10-13', quantity_sold: 500 }, // not active: ignored
  ], new Set([1, 2]), 2);
  assert.equal(storeAverageDaily, 10);
  assert.equal(ratioByProduct.get(1), 1.5);
  assert.equal(ratioByProduct.get(2), 0.5);
  assert.equal(ratioByProduct.has(9), false);
});

test('sales ratio: an ACTIVE product with zero sales is 0.00 and counts in the store average', () => {
  // 1 open day, 3 active products: 12, 4, 0 sold -> store avg 16 / 3.
  const { ratioByProduct, storeAverageDaily } = svc.computeSalesPerformanceRatios([
    { product_id: 1, sale_date: '2026-10-12', quantity_sold: 12 },
    { product_id: 2, sale_date: '2026-10-12', quantity_sold: 4 },
    { product_id: 3, sale_date: '2026-10-12', quantity_sold: 0 }, // a 0 row (refunds)
    { product_id: 9, sale_date: '2026-10-12', quantity_sold: 50 }, // not active: no ratio, not averaged
  ], new Set([1, 2, 3]), 1);
  assert.equal(storeAverageDaily, 16 / 3);
  assert.equal(ratioByProduct.get(1), 12 / (16 / 3));
  assert.equal(ratioByProduct.get(2), 4 / (16 / 3));
  assert.equal(ratioByProduct.get(3), 0);
  assert.equal(ratioByProduct.has(9), false);
});

test('sales ratio: an active product with NO sales rows at all is also 0.00', () => {
  const { ratioByProduct, storeAverageDaily } = svc.computeSalesPerformanceRatios([
    { product_id: 1, sale_date: '2026-10-12', quantity_sold: 10 },
  ], new Set([1, 4]), 1);
  assert.equal(storeAverageDaily, 5);
  assert.equal(ratioByProduct.get(1), 2);
  assert.equal(ratioByProduct.get(4), 0);
});

test('sales ratio: empty range -> no ratios, no store average', () => {
  const none = svc.computeSalesPerformanceRatios([], new Set([1, 2]), 0);
  assert.equal(none.ratioByProduct.size, 0);
  assert.equal(none.storeAverageDaily, null);
  // Open days but nothing sold by an active product: also empty.
  const idle = svc.computeSalesPerformanceRatios([{ product_id: 9, sale_date: '2026-10-12', quantity_sold: 3 }], new Set([1]), 1);
  assert.equal(idle.ratioByProduct.size, 0);
  assert.equal(idle.storeAverageDaily, null);
});

test('sales ratio: a single product is exactly the average (1.00)', () => {
  const { ratioByProduct, storeAverageDaily } = svc.computeSalesPerformanceRatios([
    { product_id: 5, sale_date: '2026-10-12', quantity_sold: 7 },
    { product_id: 5, sale_date: '2026-10-14', quantity_sold: 3 },
  ], new Set([5]), 3);
  assert.equal(storeAverageDaily, 10 / 3);
  assert.equal(ratioByProduct.get(5), 1);
});

test('K5: range with no forecasts -> newest forecast date <= max(rangeTo, today) is used', async () => {
  fake.reset({
    forecasts: [
      { product_id: 1, forecast_date: '2026-10-13', rolling_7: 12 },
      { product_id: 2, forecast_date: '2026-10-13', rolling_7: 4 },
      { product_id: 1, forecast_date: '2026-10-14', rolling_7: 30 },
      { product_id: 2, forecast_date: '2026-10-14', rolling_7: 10 },
      { product_id: 1, forecast_date: '2026-10-15', rolling_7: 999 }, // after today: not used
      { product_id: 2, forecast_date: '2026-10-14', rolling_7: null, model_version: 'm_closed' },
    ],
  });
  const active = new Set([1, 2]);
  const loaded = await svc.loadRatioRollingRows(fake, {
    rangeFrom: '2026-10-04', rangeTo: '2026-10-10', today: '2026-10-14', activeProductIds: active,
  });
  assert.equal(loaded.source, 'latest_forecast');
  assert.equal(loaded.ratioAsOf, '2026-10-14');
  const { ratioByProduct } = svc.computePerformanceRatios(loaded.rows, active);
  assert.equal(ratioByProduct.get(1), 1.5); // 30 ÷ avg(30,10)
  assert.equal(ratioByProduct.get(2), 0.5);
});

test('K5: range WITH forecasts uses them and reports no ratioAsOf', async () => {
  fake.reset({
    forecasts: [
      { product_id: 1, forecast_date: '2026-10-08', rolling_7: 8 },
      { product_id: 2, forecast_date: '2026-10-08', rolling_7: 8 },
      { product_id: 1, forecast_date: '2026-10-14', rolling_7: 30 },
    ],
  });
  const loaded = await svc.loadRatioRollingRows(fake, {
    rangeFrom: '2026-10-04', rangeTo: '2026-10-10', today: '2026-10-14', activeProductIds: new Set([1, 2]),
  });
  assert.equal(loaded.source, 'range');
  assert.equal(loaded.ratioAsOf, null);
  assert.equal(loaded.rows.length, 2);
});

test('K5: no forecasts at all -> empty, source none', async () => {
  fake.reset({ forecasts: [] });
  const loaded = await svc.loadRatioRollingRows(fake, {
    rangeFrom: '2026-10-04', rangeTo: '2026-10-10', today: '2026-10-14', activeProductIds: new Set([1]),
  });
  assert.equal(loaded.source, 'none');
  assert.deepEqual(loaded.rows, []);
});

// -------------------------------------------------------- L6 weekly units
test('L6: weekly ingredient rows carry the ingredient record unit', async () => {
  const egg = { id: 10, name: 'Egg', category: 'Dairy', unit: 'pcs', price: 8, quantity: 36 };
  const rice = { id: 11, name: 'Rice', category: 'Grains', unit: 'kg', price: 50, quantity: 4.0999999999 };
  fake.reset({
    products: [{ id: 1, name: 'Porksilog', price: 120, status: 'active' }],
    product_ingredients: [
      // Recipe in grams; the stock unit (kg) is what the row must report.
      { product_id: 1, unit: 'g', quantity_per_serving: 200, ingredients: rice },
      { product_id: 1, unit: 'pcs', quantity_per_serving: 1, ingredients: egg },
    ],
    forecasts: [
      { product_id: 1, forecast_date: '2026-10-12', predicted_quantity: 10, model_version: 'm' },
    ],
    forecast_config: [{ safety_buffer_percentage: 0 }],
  });
  const result = await svc.getIngredientDemandAnalytics({ date: '2026-10-12', weekStart: '2026-10-12' });
  const byName = new Map(result.weekly.rows.map((r) => [r.ingredient, r]));
  assert.equal(byName.get('Egg').unit, 'pcs');
  assert.equal(byName.get('Rice').unit, 'kg');
  assert.equal(byName.get('Egg').values[0], 10);  // 10 plates × 1 pcs
  assert.ok(Math.abs(byName.get('Rice').values[0] - 2) < 1e-9); // 10 × 200 g = 2 kg
});

// ------------------------------------------------- Dashboard summary (A1/A2)
const dayjs = require('dayjs');
const todayPh = () => dayjs().tz('Asia/Manila').format('YYYY-MM-DD');

test('A2: stock alerts sum one ingredient across products (Low + Low -> Critical)', async () => {
  const rice = { id: 11, name: 'Rice', category: 'Grains', unit: 'kg', price: 50, quantity: 10 };
  fake.reset({
    products: [
      { id: 1, name: 'Porksilog', price: 120, status: 'active' },
      { id: 2, name: 'Tapsilog', price: 130, status: 'active' },
    ],
    product_ingredients: [
      { product_id: 1, unit: 'kg', quantity_per_serving: 1, ingredients: rice },
      { product_id: 2, unit: 'kg', quantity_per_serving: 1, ingredients: rice },
    ],
    // Each alone needs 12 kg against 10 in stock: 0.83 -> Low.
    // Together they need 24 kg: 0.42 -> Critical.
    forecasts: [
      { product_id: 1, forecast_date: todayPh(), predicted_quantity: 12 },
      { product_id: 2, forecast_date: todayPh(), predicted_quantity: 12 },
    ],
    forecast_config: [{ safety_buffer_percentage: 0 }],
  });
  assert.equal(svc.computeStockStatus(10, 12), 'Low', 'each product alone is Low');
  const summary = await svc.getForecastSummary();
  assert.deepEqual(summary.stockAlerts, { Critical: 1, Low: 0, Normal: 0, Excess: 0 });

  // Same rule as Ingredient Demand's daily table.
  const demand = await svc.getIngredientDemandAnalytics({ date: todayPh() });
  assert.equal(demand.daily.rows.length, 1);
  assert.equal(demand.daily.rows[0].status, 'Critical');
  assert.equal(demand.daily.rows[0].forecastedNeed, 24);
});

test('A1: two trainings on the same date -> getForecastSummary uses the higher id', async () => {
  fake.reset({
    products: [],
    // Older row first: without the id tie-break the first row would win.
    model_metrics: [
      { id: 1, model_version: 'model_v20261014_010000', evaluation_date: '2026-10-14', wmape: 35.00033, baseline_wmape: 30 },
      { id: 2, model_version: 'model_v20261014_090000', evaluation_date: '2026-10-14', wmape: 35.356, baseline_wmape: 30 },
    ],
  });
  const summary = await svc.getForecastSummary();
  assert.ok(Math.abs(summary.forecastAccuracy.value - 64.644) < 1e-9, `got ${summary.forecastAccuracy.value}`);
});

test('A3: predictedSalesYesterday = yesterday forecasts × price, null without rows', async () => {
  const yesterday = dayjs().tz('Asia/Manila').subtract(1, 'day').format('YYYY-MM-DD');
  fake.reset({
    products: [{ id: 1, name: 'Porksilog', price: 120, status: 'active' }],
    forecasts: [{ product_id: 1, forecast_date: yesterday, predicted_quantity: 5 }],
  });
  assert.equal((await svc.getForecastSummary()).predictedSalesYesterday, 600);
  fake.reset({ products: [{ id: 1, name: 'Porksilog', price: 120, status: 'active' }] });
  assert.equal((await svc.getForecastSummary()).predictedSalesYesterday, null);
});

test('B1: actualSalesYesterday = null with no rows, 0 for a real zero day, peso sum otherwise; yesterday returned', async () => {
  const yesterday = dayjs().tz('Asia/Manila').subtract(1, 'day').format('YYYY-MM-DD');
  const products = [
    { id: 1, name: 'Porksilog', price: 120, status: 'active' },
    { id: 2, name: 'Tapsilog', price: 130, status: 'active' },
  ];

  // Nothing uploaded for yesterday -> null (the card shows "—", not ₱0).
  fake.reset({ products });
  let summary = await svc.getForecastSummary();
  assert.equal(summary.actualSalesYesterday, null);
  assert.equal(summary.yesterday, yesterday);

  // Rows exist but nothing sold -> a real 0.
  fake.reset({
    products,
    daily_sales: [
      { product_id: 1, sale_date: yesterday, quantity_sold: 0 },
      { product_id: 2, sale_date: yesterday, quantity_sold: 0 },
    ],
  });
  assert.equal((await svc.getForecastSummary()).actualSalesYesterday, 0);

  // 3 x 120 + 2 x 130 = 620. A row from another day is ignored.
  fake.reset({
    products,
    daily_sales: [
      { product_id: 1, sale_date: yesterday, quantity_sold: 3 },
      { product_id: 2, sale_date: yesterday, quantity_sold: 2 },
      { product_id: 1, sale_date: '2020-01-01', quantity_sold: 99 },
    ],
  });
  summary = await svc.getForecastSummary();
  assert.equal(summary.actualSalesYesterday, 620);
});

test('C: getForecastBasis -> null without a run; newest run wins, labelled in Manila time', async () => {
  fake.reset({});
  assert.equal(await svc.getForecastBasis('2026-10-17'), null);

  fake.reset({
    forecast_runs: [
      { id: 1, run_at: '2026-10-16T01:00:30.000Z', run_type: 'daily' },
      { id: 2, run_at: '2026-10-17T07:31:00.000Z', run_type: 'weekly' }, // 3:31 PM Manila
    ],
    forecasts: [{ id: 5, product_id: 1, forecast_date: '2026-10-17', predicted_quantity: 4.37 }],
  });
  assert.deepEqual(await svc.getForecastBasis('2026-10-17'), {
    runAt: '2026-10-17T07:31:00.000Z',
    runAtLabel: 'October 17, 2026 • 03:31 PM',
    runType: 'weekly',
    forecastDate: '2026-10-17',
    forecastDateLabel: 'Oct 17, 2026',
    hasForecastForDate: true,
  });
});

test('C: getForecastBasis -> hasForecastForDate false when the date has no forecast rows (e.g. a closed day)', async () => {
  fake.reset({
    forecast_runs: [{ id: 2, run_at: '2026-10-17T07:31:00.000Z', run_type: 'daily' }],
    forecasts: [{ id: 5, product_id: 1, forecast_date: '2026-10-17', predicted_quantity: 4 }],
  });
  const basis = await svc.getForecastBasis('2026-10-18');
  assert.equal(basis.hasForecastForDate, false);
  assert.equal(basis.forecastDateLabel, 'Oct 18, 2026');
  assert.equal(basis.runAtLabel, 'October 17, 2026 • 03:31 PM');
});

// ------------------------------------------- closed day -> next open day (Oct 18)
// "today" is the real Manila date (the services read the clock), so the seeds
// are built around it.
const manilaDay = (offsetDays = 0) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
};
const TODAY = manilaDay(0);
const TOMORROW = manilaDay(1);
const NEXT_WEEK = manilaDay(7);
const closedRow = (pid, date) => ({ id: `${pid}-${date}`, product_id: pid, forecast_date: date, predicted_quantity: 0, model_version: 'model_v20261013_205641_closed' });
const openRow = (pid, date, qty) => ({ id: `${pid}-${date}`, product_id: pid, forecast_date: date, predicted_quantity: qty, model_version: 'model_v20261013_205641' });
const activeProducts = [1, 2, 3, 4, 5].map((id) => ({ id, name: `P${id}`, price: 100, status: 'active' }));

// Every product's own usual range: p40 = 3, p80 = 7 (as ml-service writes it).
const classifications = activeProducts.map((p) => ({ id: p.id, product_id: p.id, classification_date: TODAY, demand_tier: 'Low', basis: 'p40=3.0, p80=7.0' }));

function seedClosedToday({ todayOpen = false, todayEmpty = false } = {}) {
  fake.reset({
    products: activeProducts,
    product_classifications: classifications,
    forecasts: [
      ...(todayEmpty ? [] : activeProducts.map((p) => (todayOpen ? openRow(p.id, TODAY, p.id) : closedRow(p.id, TODAY)))),
      ...activeProducts.map((p) => openRow(p.id, TOMORROW, p.id * 2)),
      ...activeProducts.map((p) => openRow(p.id, NEXT_WEEK, p.id)),
    ],
  });
}

test('nextOpenForecastDate: today closed + tomorrow open -> tomorrow; today open -> today', async () => {
  seedClosedToday();
  assert.equal(await svc.nextOpenForecastDate(TODAY), TOMORROW);
  seedClosedToday({ todayOpen: true });
  assert.equal(await svc.nextOpenForecastDate(TODAY), TODAY);
});

test('nextOpenForecastDate: no forecasts (or only closed ones) -> null', async () => {
  fake.reset({ forecasts: [] });
  assert.equal(await svc.nextOpenForecastDate(TODAY), null);
  fake.reset({ forecasts: [closedRow(1, TODAY), closedRow(2, TOMORROW)] });
  assert.equal(await svc.nextOpenForecastDate(TODAY), null);
});

test('Product Performance default: closed today -> Demand Classification shows the next open day', async () => {
  seedClosedToday();
  const pp = await svc.getProductPerformanceAnalytics({});
  assert.equal(pp.demandRange.date, TOMORROW);
  assert.equal(pp.demandRange.shiftedFromClosedDay, true);
  assert.equal(pp.demandRange.shiftReason, 'closed');
  assert.equal(pp.demandClassification.length, 5);
  assert.ok(pp.demandClassification.every((r) => r.date === TOMORROW));
  // Busiest first; each product vs its OWN range (p40 3, p80 7).
  assert.deepEqual(pp.demandClassification.map((r) => r.forecastQty), [10, 8, 6, 4, 2]);
  assert.deepEqual(pp.demandClassification.map((r) => r.demandLevel), ['High Demand', 'High Demand', 'Medium Demand', 'Medium Demand', 'Low Demand']);
  assert.equal(pp.demandClassification[0].demandBasis, 'High for this product (normal range 3–7 items/day)');
});

test('Product Performance default: NO forecast for today yet -> next open day, reason no_forecast (not "closed")', async () => {
  seedClosedToday({ todayEmpty: true });
  const pp = await svc.getProductPerformanceAnalytics({});
  assert.equal(pp.demandRange.date, TOMORROW);
  assert.equal(pp.demandRange.shiftReason, 'no_forecast');
  assert.equal(pp.demandRange.shiftedFromClosedDay, false);
});

test('Product Performance default: open today -> no shift', async () => {
  seedClosedToday({ todayOpen: true });
  const pp = await svc.getProductPerformanceAnalytics({});
  assert.equal(pp.demandRange.date, TODAY);
  assert.equal(pp.demandRange.shiftedFromClosedDay, false);
  assert.equal(pp.demandRange.shiftReason, null);
  assert.equal(pp.demandClassification.length, 5);
});

test('Product Performance: explicit dates never shift (a closed day stays, listed in closedDates)', async () => {
  seedClosedToday();
  for (const params of [{ demandFrom: TODAY, demandTo: TODAY }, { from: TODAY, to: TODAY }]) {
    const pp = await svc.getProductPerformanceAnalytics(params);
    assert.equal(pp.demandRange.date, TODAY);
    assert.equal(pp.demandRange.shiftedFromClosedDay, false);
    assert.equal(pp.demandClassification.length, 0);
    assert.deepEqual(pp.demandRange.closedDates, [TODAY]);
  }
});

test('Ingredient Demand default: closed today -> next open day and its week; open today -> no shift', async () => {
  seedClosedToday();
  const closed = await svc.getIngredientDemandAnalytics({});
  assert.equal(closed.daily.date, TOMORROW);
  assert.equal(closed.daily.shiftedFromClosedDay, true);
  assert.equal(closed.daily.shiftReason, 'closed');
  assert.ok(closed.weekly.days.includes(TOMORROW), 'the heatmap is the next open day\'s week');

  seedClosedToday({ todayOpen: true });
  const open = await svc.getIngredientDemandAnalytics({});
  assert.equal(open.daily.date, TODAY);
  assert.equal(open.daily.shiftedFromClosedDay, false);
  assert.ok(open.weekly.days.includes(TODAY));
});

test('Ingredient Demand: explicit date or week never shifts', async () => {
  seedClosedToday();
  const byDate = await svc.getIngredientDemandAnalytics({ date: TODAY });
  assert.equal(byDate.daily.date, TODAY);
  assert.equal(byDate.daily.shiftedFromClosedDay, false);
  const byWeek = await svc.getIngredientDemandAnalytics({ weekStart: TODAY });
  assert.equal(byWeek.daily.date, TODAY);
  assert.equal(byWeek.daily.shiftedFromClosedDay, false);
});

test('Ingredient Demand default: NO forecast for today yet -> next open day, reason no_forecast', async () => {
  seedClosedToday({ todayEmpty: true });
  const d = await svc.getIngredientDemandAnalytics({});
  assert.equal(d.daily.date, TOMORROW);
  assert.equal(d.daily.shiftReason, 'no_forecast');
  assert.equal(d.daily.shiftedFromClosedDay, false);
});

test('forecastDayState: open / closed (all rows _closed) / none', async () => {
  seedClosedToday();
  assert.equal(await svc.forecastDayState(TODAY), 'closed');
  assert.equal(await svc.forecastDayState(TOMORROW), 'open');
  assert.equal(await svc.forecastDayState(manilaDay(30)), 'none');
  // One open row among closed ones -> open.
  fake.reset({ forecasts: [closedRow(1, TODAY), openRow(2, TODAY, 3)] });
  assert.equal(await svc.forecastDayState(TODAY), 'open');
});

// ------------------------------------------------ per-product demand tier
test('parseClassificationBasis reads what ml-service writes', () => {
  assert.deepEqual(svc.parseClassificationBasis('p40=4.2, p80=9.8'), { p40: 4.2, p80: 9.8 });
  assert.deepEqual(svc.parseClassificationBasis('p40=0.0, p80=0.0'), { p40: 0, p80: 0 });
  assert.equal(svc.parseClassificationBasis(null), null);
  assert.equal(svc.parseClassificationBasis('something else'), null);
});

test('productDemandTier: each DATE uses its own forecast vs the product\'s own p40/p80', () => {
  const cls = { demand_tier: 'Low', basis: 'p40=4.0, p80=8.0' }; // stored tier is for day 1 only
  assert.equal(svc.productDemandTier(9, cls).tier, 'High');   // > p80
  assert.equal(svc.productDemandTier(8, cls).tier, 'Medium'); // = p80 is not above it
  assert.equal(svc.productDemandTier(4, cls).tier, 'Medium'); // >= p40
  assert.equal(svc.productDemandTier(3.9, cls).tier, 'Low');
  assert.equal(svc.productDemandTier(9, cls).basisText, 'High for this product (normal range 4–8 items/day)');
});

test('productDemandTier: no thresholds -> stored tier; no classification -> not enough data', () => {
  assert.deepEqual(svc.productDemandTier(5, { demand_tier: 'Medium', basis: null }), { tier: 'Medium', basisText: 'Medium for this product' });
  assert.deepEqual(svc.productDemandTier(5, undefined), { tier: null, basisText: 'No usual sales range for this product yet' });
  // Thresholds rounded to whole items: 45.6 / 57.3 -> 46–57.
  assert.equal(svc.productDemandTier(30, { demand_tier: 'Low', basis: 'p40=45.6, p80=57.3' }).basisText, 'Low for this product (normal range 46–57 items/day)');
  assert.equal(svc.productDemandTier(2, { demand_tier: 'Low', basis: 'p40=0.6, p80=1.4' }).basisText, 'High for this product (normal range 1 item/day)');
});

test('Ingredient Demand uses exact decimal math and exposes raw demand separately from buffer', () => {
  const ingredient = { ingredientId: 7, unit: 'kg', qtyPerServing: '0.333' };
  const [entry] = svc.sumIngredientNeeds(
    [{ product_id: 1, predicted_quantity: '3' }],
    new Map([[1, [ingredient]]]),
    '1.15',
  ).values();
  assert.equal(entry.rawNeed, 1);
  assert.equal(entry.need, 1.15);
  assert.equal(svc.roundIngredientQuantity('1.005', 'kg'), 1.01);
  assert.equal(svc.roundIngredientQuantity('0.25', 'pcs'), 1);
});
