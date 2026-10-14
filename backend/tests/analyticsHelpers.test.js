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

test('K4: totals add known values only and count missing price/recipe products', () => {
  const totals = svc.summarizePredictionTotals([
    { productId: 1, hasPrice: true, hasRecipe: true, actualRevenue: 100, forecastRevenue: 120, estCost: 40, estGrossProfit: 80 },
    { productId: 2, hasPrice: false, hasRecipe: true, actualRevenue: null, forecastRevenue: null, estCost: 10, estGrossProfit: null },
    { productId: 2, hasPrice: false, hasRecipe: true, actualRevenue: null, forecastRevenue: null, estCost: 10, estGrossProfit: null },
    { productId: 3, hasPrice: true, hasRecipe: false, actualRevenue: null, forecastRevenue: 50, estCost: null, estGrossProfit: null },
  ]);
  assert.equal(totals.forecastRevenue, 170);
  assert.equal(totals.actualRevenue, 100);
  assert.equal(totals.estCost, 60);
  assert.equal(totals.estGrossProfit, 80);
  assert.equal(totals.noPriceCount, 1); // distinct products, not rows
  assert.equal(totals.noRecipeCount, 1);
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
