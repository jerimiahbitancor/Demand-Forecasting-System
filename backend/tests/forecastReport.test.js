// tests/forecastReport.test.js — run: node --test tests/forecastReport.test.js
//
// The forecast report (scripts/forecast-report.js, Oct 26 2026) must show
// the SAME numbers as the app (it calls analyticsService), say which run
// wrote the window and how it was started, and score forecast vs actual
// exactly like forecast_accuracy_check.sql. In-memory database, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';
const fake = createFakeSupabase({});
installFake(fake);
const { supabaseAdmin } = require('../config/supabase');
const analytics = require('../services/analyticsService');
const report = require('../scripts/forecast-report');

const rice = { id: 103, name: 'Rice', category: 'Grains & Starches', unit: 'Kilograms (kg)', price: 55, quantity: 2.52, material_type: 'dry' };
const egg = { id: 104, name: 'Egg', category: 'Eggs', unit: 'Pieces (pcs)', price: 8.5, quantity: 17, material_type: 'wet' };
const V = 'model_v20261017_073006';

function seed() {
  const open = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30'];
  fake.reset({
    products: [
      { id: 1, name: 'Porksilog', price: 120, status: 'active' },
      { id: 2, name: 'Porkchop', price: 135, status: 'active' },
      { id: 3, name: 'Iced Tea', price: 30, status: 'active' }, // no recipe
    ],
    product_ingredients: [
      { product_id: 1, unit: 'Grams (g)', quantity_per_serving: 200, ingredients: rice },
      { product_id: 2, unit: 'Grams (g)', quantity_per_serving: 200, ingredients: rice },
      { product_id: 1, unit: 'Pieces (pcs)', quantity_per_serving: 1, ingredients: egg },
    ],
    forecasts: [
      { id: 1, product_id: 1, forecast_date: '2026-09-29', predicted_quantity: 20.4, model_version: V, created_at: '2026-10-26 07:00:05' },
      { id: 2, product_id: 2, forecast_date: '2026-09-29', predicted_quantity: 9.6, model_version: V, created_at: '2026-10-26 07:00:06' },
      { id: 3, product_id: 3, forecast_date: '2026-09-29', predicted_quantity: 4.5, model_version: V, created_at: '2026-10-26 07:00:06' },
      { id: 4, product_id: 1, forecast_date: '2026-09-30', predicted_quantity: 18.49, model_version: V, created_at: '2026-10-26 07:00:07' },
      { id: 5, product_id: 2, forecast_date: '2026-09-30', predicted_quantity: 11.5, model_version: V, created_at: '2026-10-26 07:00:07' },
      { id: 6, product_id: 3, forecast_date: '2026-09-30', predicted_quantity: 3.2, model_version: V, created_at: '2026-10-26 07:00:07' },
      // An older run for other dates: must not decide the newest window.
      { id: 7, product_id: 1, forecast_date: '2026-10-19', predicted_quantity: 30, model_version: V, created_at: '2026-10-19 01:00:00' },
    ],
    daily_sales: [
      ...open.filter((d) => d < '2026-09-29').flatMap((d) => [
        { product_id: 1, sale_date: d, quantity_sold: 20 },
        { product_id: 2, sale_date: d, quantity_sold: 10 },
        { product_id: 3, sale_date: d, quantity_sold: 4 },
      ]),
      { product_id: 1, sale_date: '2026-09-29', quantity_sold: 22 },
      { product_id: 2, sale_date: '2026-09-29', quantity_sold: 8 },
      { product_id: 3, sale_date: '2026-09-29', quantity_sold: 5 },
      { product_id: 1, sale_date: '2026-09-30', quantity_sold: 17 },
      { product_id: 2, sale_date: '2026-09-30', quantity_sold: 12 },
    ],
    business_days: open.map((d) => ({ business_date: d, status: 'confirmed_open' })),
    forecast_runs: [
      { id: 9, run_at: '2026-10-26T07:00:10Z', run_type: 'weekly', model_version: V, last_confirmed_date: '2026-09-28', stale_days: 27 },
      { id: 8, run_at: '2026-10-19T01:00:02Z', run_type: 'weekly', model_version: V, last_confirmed_date: '2026-09-28', stale_days: 20 },
    ],
    notifications: [
      { id: 50, title: 'Forecast report is ready', message: 'Forecast for Sep 29, 2026 to Oct 4, 2026 (starting after your latest sales data) has been generated and saved.', created_at: '2026-10-26T07:00:12Z' },
      { id: 40, title: 'Weekly (7-day) forecast completed', message: 'The scheduled weekly forecast run finished — 3 product(s) forecasted.', created_at: '2026-10-19T01:00:04Z' },
    ],
    audit_logs: [],
    model_metrics: [{ id: 1, model_version: V, evaluation_date: '2026-10-17', wmape: 28.13, baseline_wmape: 28.41, mae: 2.54, rmse: 3.97 }],
    forecast_config: [{ safety_buffer_percentage: 15 }],
  });
}

test('formatting follows the display rules (no trailing .00, small prices keep 4 decimals)', () => {
  assert.equal(report.num(9), '9');
  assert.equal(report.num(9.5), '9.50');
  assert.equal(report.peso(546), '₱546');
  assert.equal(report.peso(1234.5), '₱1,234.50');
  assert.equal(report.peso(0.0835), '₱0.0835');
  assert.equal(report.wholeOf(20.5), 21);
  assert.equal(report.wholeOf(18.49), 18);
});

test('the newest run decides the default window', async () => {
  seed();
  assert.deepEqual(await report.detectLatestWindow(supabaseAdmin), { from: '2026-09-29', to: '2026-09-30' });
});

test('how a run was started is read from what the app wrote around it', () => {
  assert.match(report.describeTrigger({ notifications: [{ title: 'Forecast report is ready', message: 'starting after your latest sales data' }] }), /test start date/);
  assert.match(report.describeTrigger({ triggerLogs: [{ performed_by: 'system:boot' }] }), /boot catch-up/);
  assert.match(report.describeTrigger({ notifications: [{ title: 'Daily (1-day) forecast completed', message: 'The first forecast after training finished' }] }), /after training/);
  assert.match(report.describeTrigger({ notifications: [{ title: 'Weekly (7-day) forecast completed', message: 'The scheduled weekly forecast run finished' }] }), /9:00 AM schedule/);
});

test('report numbers equal the app numbers, and accuracy matches the SQL definitions', async () => {
  seed();
  const data = await report.collect({ client: supabaseAdmin, analytics, from: '2026-09-29', to: '2026-09-30', ml: null });

  assert.equal(data.version, V);
  assert.equal(data.runRows.length, 1, 'only the run that wrote this window');
  assert.match(data.runRows[0].trigger, /Manual: Generate Forecast, test start date/);

  // Ingredient demand Sep 29: Rice (20 + 10) × 0.2 = 6.00 raw + 0.90 = 6.90 kg; Egg 20 × 1 = 20 + 3 = 23 pcs.
  const day1 = data.daily.find((d) => d.date === '2026-09-29');
  const riceRow = day1.rows.find((r) => r.name === 'Rice');
  assert.deepEqual([riceRow.rawForecastedNeed, riceRow.safetyBuffer, riceRow.forecastedNeed], [6, 0.9, 6.9]);
  const parts = day1.breakdown[103];
  assert.deepEqual(parts.map((p) => [p.product, p.items]), [['Porksilog', 20], ['Porkchop', 10]]);
  assert.equal(Number(parts.reduce((s, p) => s + p.part, 0).toFixed(2)), 6, 'breakdown adds up to Raw');

  // Accuracy (whole numbers): Sep 29 F 20/10/5(4.5→5) vs A 22/8/5; Sep 30 F 18/12/3 vs A 17/12/0.
  const a = data.accuracy.summary;
  assert.equal(a.actual, 64);
  assert.equal(a.forecast, 68);
  assert.equal(Number(a.wmape.toFixed(2)), Number(((2 + 2 + 0 + 1 + 0 + 3) / 64 * 100).toFixed(2)));
  assert.equal(Number(a.storeWmape.toFixed(2)), Number(((Math.abs(35 - 35) + Math.abs(29 - 33)) / 64 * 100).toFixed(2)));
  assert.equal(data.accuracy.last7.length, 7, '7 open days before the window');
  assert.ok(a.avg7Wmape > 0);

  const html = report.render(data);
  assert.match(html, /Forecast Report: Sep 29, 2026 to Sep 30, 2026/);
  assert.match(html, /6\.90/, 'the 6.90 kg the daily table shows');
  assert.match(html, /model part was not run/);
  assert.doesNotMatch(html, /\bplates?\b/i, 'never say plates');
  assert.doesNotMatch(html, /<script/i, 'static file, no scripts');
});

test('the report only reads: no insert, update, upsert, delete or rpc', async () => {
  seed();
  fake.writes.length = 0;
  await report.collect({ client: supabaseAdmin, analytics, from: '2026-09-29', to: '2026-09-30', ml: null });
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(fake.rpcCalls || [], []);
});

test('bad options are refused before anything is read', () => {
  assert.throws(() => report.parseArgs(['--from', '2026-09-29']), /both/);
  assert.throws(() => report.parseArgs(['--from', '29/09/2026', '--to', '2026-10-04']), /YYYY-MM-DD/);
  assert.throws(() => report.parseArgs(['--from', '2026-10-04', '--to', '2026-09-29']), /before/);
  assert.deepEqual(report.parseArgs(['--from', '2026-09-29', '--to', '2026-10-04', '--no-model']), { model: false, from: '2026-09-29', to: '2026-10-04' });
});
