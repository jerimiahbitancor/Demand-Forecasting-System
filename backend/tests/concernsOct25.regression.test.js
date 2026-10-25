// tests/concernsOct25.regression.test.js
//
// REGRESSION GUARD for the owner's Oct 25 2026 concern list. One test per
// concern (the test name starts with its code: IM = Ingredient Management,
// F = Forecast, PP = Product Performance, ID = Ingredient Demand,
// DM = Data Management, S = Settings). If one of these fails, a change has
// brought a concern back: read the test name before "fixing" the test.
//
// Every number below was worked out by hand (DFS Business Logic Doc v8, 3.4).
const test = require('node:test');
const assert = require('node:assert/strict');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
dayjs.extend(utc); dayjs.extend(tz);
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

const fake = createFakeSupabase({});
installFake(fake);
const svc = require('../services/analyticsService');
const { lastStockCountAt, shouldDeduct } = require('../utils/salesModifiers');
const { currentStockStatus, validateThresholds, DEFAULT_STOCK_THRESHOLDS, PREDICTED_LABELS, CURRENT_LABELS } = require('../utils/stockStatus');
const { buildInsufficientStockNotice } = require('../utils/insufficientStock');
const { EMAIL_REMINDER_KINDS } = require('../services/notificationService');

const today = dayjs().tz('Asia/Manila');
const d = (n) => today.add(n, 'day').format('YYYY-MM-DD');
const pork = { id: 101, name: 'Pork', category: 'Meat & Poultry', unit: 'Kilograms (kg)', price: 350, quantity: 1.2, material_type: 'wet' };
const egg = { id: 102, name: 'Egg', category: 'Dairy & Milk Products', unit: 'Pieces (pcs)', price: 8.5, quantity: 17, material_type: 'dry' };
const rice = { id: 103, name: 'Rice', category: 'Grains & Starches', unit: 'Kilograms (kg)', price: 55, quantity: 2.52, material_type: 'dry' };

function seed() {
  fake.reset({
    products: [
      { id: 1, name: 'Marinated Porksilog', price: 120, status: 'active' },
      { id: 2, name: 'Breaded Porkchop', price: 135, status: 'active' },
      { id: 3, name: 'Bottled Water', price: 20, status: 'active' }, // no recipe
    ],
    product_ingredients: [
      { product_id: 1, unit: 'Grams (g)', quantity_per_serving: 60, ingredients: pork },
      { product_id: 1, unit: 'Pieces (pcs)', quantity_per_serving: 1, ingredients: egg },
      { product_id: 1, unit: 'Grams (g)', quantity_per_serving: 200, ingredients: rice },
      { product_id: 2, unit: 'Grams (g)', quantity_per_serving: 100, ingredients: pork },
      { product_id: 2, unit: 'Grams (g)', quantity_per_serving: 200, ingredients: rice },
    ],
    // Forecasts today and after; sales only before today (the real gap).
    forecasts: [0, 1, 2].flatMap((n) => [
      { product_id: 1, forecast_date: d(n), predicted_quantity: 20.4, model_version: 'model_v20261025_101304' },
      { product_id: 2, forecast_date: d(n), predicted_quantity: 9.6, model_version: 'model_v20261025_101304' },
      { product_id: 3, forecast_date: d(n), predicted_quantity: 30, model_version: 'model_v20261025_101304' },
    ]),
    daily_sales: [-6, -5, -4, -3, -2, -1].flatMap((n) => [
      { product_id: 1, sale_date: d(n), quantity_sold: 18 + n },
      { product_id: 2, sale_date: d(n), quantity_sold: 8 },
      { product_id: 3, sale_date: d(n), quantity_sold: 25 },
    ]),
    business_days: [-6, -5, -4, -3, -2, -1].map((n) => ({ business_date: d(n), status: 'confirmed_open' })),
    modifier_rules: [{ keyword: 'NO EGG', ingredient_id: 102 }],
    daily_sales_modifiers: [{ product_id: 1, sale_date: d(-1), keyword: 'NO EGG', quantity: 10 }],
    product_classifications: [
      { id: 1, product_id: 2, classification_date: d(0), demand_tier: 'Low', basis: 'p40=10, p80=12' },
    ],
    forecast_config: [{ safety_buffer_percentage: 15 }],
  });
}

// ------------------------------------------------------------------ Forecast
test('F1: past days with uploaded sales show Actual Qty. even without a forecast', async () => {
  seed();
  const { prediction } = await svc.getForecastingAnalytics({});
  const past = prediction.rows.filter((r) => r.date < d(0));
  assert.ok(past.length > 0, 'past sales rows are listed');
  assert.ok(past.every((r) => r.actualQty !== null && r.forecastQty === null));
  assert.equal(past.find((r) => r.productId === 1 && r.date === d(-1)).actualQty, 17);
});

test('F3: only products with an ingredient recipe are listed (table and chart)', async () => {
  seed();
  const { prediction } = await svc.getForecastingAnalytics({});
  assert.deepEqual([...new Set(prediction.rows.map((r) => r.productId))].sort(), [1, 2]);
  const todayPoint = prediction.series.find((p) => p.date === d(0));
  assert.equal(todayPoint.future, 30, '20 + 10 predicted items; the drink (30) is left out');
});

test('F5: no gross profit anywhere in the API', async () => {
  seed();
  const { prediction } = await svc.getForecastingAnalytics({});
  assert.ok(prediction.rows.every((r) => !('estGrossProfit' in r)));
  assert.equal('estGrossProfit' in prediction.totals, false);
});

test('F6: Est. Total Cost = predicted items sold (rounded) × the Product Management COGS', async () => {
  seed();
  const { prediction } = await svc.getForecastingAnalytics({});
  const chop = prediction.rows.find((r) => r.productId === 2 && r.date === d(0));
  assert.equal(chop.forecastQty, 10, '9.6 -> 10');
  assert.equal(chop.cogsPerUnit, 46, '0.1 kg × 350 + 0.2 kg × 55');
  assert.equal(chop.estCost, 460);
  assert.equal(chop.forecastRevenue, 1350, '10 × ₱135');
});

// ------------------------------------------------------- Product Performance
test('PP1: predicted items sold are whole numbers and the demand level uses that number', async () => {
  seed();
  const pp = await svc.getProductPerformanceAnalytics({ demandFrom: d(0), demandTo: d(0) });
  assert.ok(pp.demandClassification.every((r) => Number.isInteger(r.forecastQty)));
  const chop = pp.demandClassification.find((r) => r.productId === 2);
  assert.equal(chop.forecastQty, 10);
  assert.equal(chop.demandLevel, 'Medium Demand', '10 is inside p40=10..p80=12; the raw 9.6 would have said Low');
});

// --------------------------------------------------------- Ingredient Demand
test('ID1/ID2/ID5: 2 decimals, whole pieces, Raw + Buffer = Need, weekly has no buffer', async () => {
  seed();
  const demand = await svc.getIngredientDemandAnalytics({ date: d(0), weekStart: d(0) });
  const byName = new Map(demand.daily.rows.map((r) => [r.name, r]));
  const porkRow = byName.get('Pork');
  assert.deepEqual([porkRow.rawForecastedNeed, porkRow.safetyBuffer, porkRow.forecastedNeed], [2.2, 0.33, 2.53]);
  const eggRow = byName.get('Egg');
  assert.deepEqual([eggRow.rawForecastedNeed, eggRow.safetyBuffer, eggRow.forecastedNeed], [18, 3, 21], 'pieces whole; NO EGG share applied');
  for (const r of demand.daily.rows) {
    assert.equal(Number((r.rawForecastedNeed + r.safetyBuffer).toFixed(2)), r.forecastedNeed, `${r.name}: Raw + Buffer = Need`);
  }
  const weekPork = demand.weekly.rows.find((r) => r.ingredient === 'Pork');
  assert.ok(weekPork.values.includes(2.2), 'weekly cell = raw 2.20 kg, no buffer');
  assert.equal(weekPork.unit, 'Kilograms (kg)', 'ID3: each weekly row carries its unit');
});

test('ID4: Est. Cost = To Buy × the Unit Cost from Ingredient Management', async () => {
  seed();
  const demand = await svc.getIngredientDemandAnalytics({ date: d(0) });
  const byName = new Map(demand.daily.rows.map((r) => [r.name, r]));
  assert.deepEqual([byName.get('Pork').toBuy, byName.get('Pork').marketPrice, byName.get('Pork').estCost], [1.33, '350', 465.5]);
  assert.deepEqual([byName.get('Rice').toBuy, byName.get('Rice').estCost], [4.38, 240.9]);
  assert.deepEqual([byName.get('Egg').toBuy, byName.get('Egg').estCost], [4, 34]);
  assert.equal(demand.groceryList.totals.estTotalCost, 740.4);
});

test('ID6: the daily table carries the Predicted Stock Level Status labels', async () => {
  seed();
  const demand = await svc.getIngredientDemandAnalytics({ date: d(0) });
  const allowed = new Set(Object.values(PREDICTED_LABELS));
  assert.ok(demand.daily.rows.every((r) => allowed.has(r.predictedStatus)));
  assert.equal(demand.daily.rows.find((r) => r.name === 'Pork').predictedStatus, 'Critical Shortage');
});

// ---------------------------------------------------- Ingredient Management
test('IM1: current status is worked out whether an ingredient is mapped or not, and a broken recipe line cannot stop it', async () => {
  const unmapped = currentStockStatus({ quantity: 3, idealLevel: 10, materialType: 'dry' });
  assert.equal(unmapped.status, 'Normal Stock', 'needs only stock, ideal level and wet/dry');
  fake.reset({
    product_ingredients: [
      { product_id: 1, unit: 'Kilograms (kg)', quantity_per_serving: 0.1, ingredients: { id: 9, name: 'Soy', unit: 'Milliliters (mL)', price: 1, quantity: 5 } },
    ],
  });
  const restore = console.warn; console.warn = () => {};
  try {
    await assert.doesNotReject(() => svc.getIngredientDailyNeeds(d(0)));
  } finally { console.warn = restore; }
});

// ---------------------------------------------------------- Data Management
test('DM1: a refused upload creates an emailed notification with the shortfall table', () => {
  const notice = buildInsufficientStockNotice({
    shortfalls: [{ ingredientId: 101, name: 'Pork', unit: 'Kilograms (kg)', required: '3', available: '1.2', shortfall: '1.8' }],
    filename: 'item-sales-summary.csv', uploadId: 7,
  });
  assert.equal(notice.metadata.kind, 'upload_blocked_stock');
  assert.equal(notice.metadata.shortfalls.length, 1);
  assert.ok(EMAIL_REMINDER_KINDS.includes('upload_blocked_stock'), 'this kind is emailed');
});

test('DM2: sales from a day that ended before the last restock OR stock edit are not deducted', () => {
  const cutoff = lastStockCountAt({ latestAdjustmentAt: '2026-10-05T00:00:00Z', latestRestockAt: '2026-10-11T01:00:00Z' });
  assert.equal(shouldDeduct('2026-10-10', cutoff), false, 'Oct 10 ended Oct 11 03:00 Manila, before the 09:00 restock');
  assert.equal(shouldDeduct('2026-10-11', cutoff), true, 'Oct 11 ended after the restock');
});

// ------------------------------------------------------------------ Settings
test('S1: all four Current and four Forecast statuses exist, and their % are configurable', () => {
  assert.deepEqual(Object.values(CURRENT_LABELS), ['Out of Stock', 'Low Stock', 'Normal Stock', 'Excess Stock']);
  assert.deepEqual(
    Object.values(PREDICTED_LABELS).filter((l) => l !== 'Unassigned'),
    ['Critical Shortage', 'Insufficient Supply', 'Sufficient Supply', 'Above Forecast Limit'],
  );
  const saved = validateThresholds({
    current_low_wet_pct: 40, current_low_dry_pct: 25, current_excess_pct: 150,
    predicted_critical_pct: 60, predicted_sufficient_pct: 110, predicted_above_pct: 250,
  }, DEFAULT_STOCK_THRESHOLDS);
  assert.equal(saved.ok, true);
  assert.equal(currentStockStatus({ quantity: 14, idealLevel: 10 }, saved.values).status, 'Normal Stock', '140% is Normal when Excess starts above 150%');
});
