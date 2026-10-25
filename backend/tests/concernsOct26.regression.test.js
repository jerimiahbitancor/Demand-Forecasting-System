// tests/concernsOct26.regression.test.js
//
// REGRESSION GUARD for the owner's Oct 26 2026 concern list (backend side).
// Test names start with the concern code: PP = Product Performance,
// ID = Ingredient Demand, SPEED = load time. A failure means a change
// brought a concern back: ask the owner before changing a check.
const test = require('node:test');
const assert = require('node:assert/strict');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
dayjs.extend(utc); dayjs.extend(tz);
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

const fake = createFakeSupabase({});
installFake(fake);
const { supabaseAdmin } = require('../config/supabase');
const svc = require('../services/analyticsService');

const today = dayjs().tz('Asia/Manila');
const d = (n) => today.add(n, 'day').format('YYYY-MM-DD');
const rice = { id: 103, name: 'Rice', category: 'Grains & Starches', unit: 'Kilograms (kg)', price: 55, quantity: 2.52, material_type: 'dry' };

function seed({ salesDaysAgo = [-30, -29, -28] } = {}) {
  fake.reset({
    products: [
      { id: 1, name: 'Porksilog', price: 120, status: 'active' },
      { id: 2, name: 'Porkchop', price: 135, status: 'active' },
    ],
    product_ingredients: [
      { product_id: 1, unit: 'Grams (g)', quantity_per_serving: 200, ingredients: rice },
      { product_id: 2, unit: 'Grams (g)', quantity_per_serving: 200, ingredients: rice },
    ],
    forecasts: [0, 1, 2, 3, 4, 5, 6].flatMap((n) => [
      { product_id: 1, forecast_date: d(n), predicted_quantity: 20.4, model_version: 'm' },
      { product_id: 2, forecast_date: d(n), predicted_quantity: 9.6, model_version: 'm' },
    ]),
    daily_sales: salesDaysAgo.flatMap((n) => [
      { product_id: 1, sale_date: d(n), quantity_sold: 30 },
      { product_id: 2, sale_date: d(n), quantity_sold: 10 },
    ]),
    forecast_config: [{ safety_buffer_percentage: 15 }],
  });
}

test('PP3: each ratio row carries its breakdown (items sold, open days, avg/day) and the store average', async () => {
  seed();
  const pp = await svc.getProductPerformanceAnalytics({});
  const r = pp.performanceRatio;
  assert.equal(r.openDays, 3);
  assert.equal(r.storeAverageDaily, 20, '(30 + 10) / 2 products');
  assert.equal(r.activeProductCount, 2);
  const pork = r.rows.find((x) => x.product === 'Porksilog');
  assert.deepEqual([pork.quantitySold, pork.openDays, pork.avgDaily], [90, 3, 30]);
  assert.equal(pork.performanceRatio, 1.5, '30 ÷ 20');
});

test('PP4/PP5: report dates with NO sales fall back to the latest 7 days with sales, and say so', async () => {
  seed();
  const pp = await svc.getProductPerformanceAnalytics({ from: d(-6), to: d(0) });
  const r = pp.performanceRatio;
  assert.ok(r.ratioShift, 'the shift is reported');
  assert.deepEqual(r.ratioShift.requested, { from: d(-6), to: d(0) });
  assert.equal(r.range.to, d(-28), 'ends on the newest sale on or before the chosen end');
  assert.ok(r.rows.some((x) => x.performanceRatio !== null), 'ratios are filled, not empty');
});

test('ID4: weekly grocery need = the 7 daily Forecasted Need values added up', async () => {
  seed();
  const demand = await svc.getIngredientDemandAnalytics({ date: d(0), weekStart: d(0) });
  const weekly = demand.groceryListWeekly.all.find((x) => x.name === 'Rice');
  // Each day: (20 + 10) × 0.2 kg = 6.00 raw + 0.90 buffer = 6.90 kg.
  const daysWithForecast = demand.weekly.days.filter((day) => day >= d(0) && day <= d(6)).length;
  assert.equal(weekly.forecastedNeed, Number((6.9 * daysWithForecast).toFixed(2)));
  assert.equal(weekly.toBuy, Number((weekly.forecastedNeed - 2.52).toFixed(2)), 'To Buy = weekly need − stock');
  const daily = demand.daily.rows.find((x) => x.name === 'Rice');
  assert.equal(daily.forecastedNeed, 6.9, 'the same 6.90 kg the daily table shows');
});

test('SPEED: Product Performance reads in parallel (no more one-read-at-a-time)', async () => {
  seed();
  const orig = supabaseAdmin.from.bind(supabaseAdmin);
  let inFlight = 0;
  let peak = 0;
  supabaseAdmin.from = (table) => {
    const builder = orig(table);
    const wrap = (obj) => new Proxy(obj, {
      get(o, k) {
        if (k === 'then') {
          return (res, rej) => {
            inFlight += 1; peak = Math.max(peak, inFlight);
            return new Promise((r) => setTimeout(r, 5)).then(() => { inFlight -= 1; return o.then(res, rej); });
          };
        }
        const v = o[k];
        return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out && typeof out === 'object' && 'then' in out ? wrap(out) : out; } : v;
      },
    });
    return wrap(builder);
  };
  try {
    await svc.getProductPerformanceAnalytics({});
  } finally {
    supabaseAdmin.from = orig;
  }
  assert.ok(peak >= 4, `at least 4 reads at once (peak was ${peak})`);
});
