// tests/stockThresholdSettings.test.js — run: node --test tests/stockThresholdSettings.test.js
//
// Settings > Stock Level Thresholds, end to end against the in-memory fake:
//   GET returns the defaults until migration 021 has been run
//   POST validates (range and order) and saves
//   a saved change reaches the statuses (getStockThresholds -> stockStatus)
//   before migration 021 a save is refused with a clear 409, nothing breaks

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';
delete process.env.ENABLE_SCHEDULERS;

const fake = createFakeSupabase();
installFake(fake);

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return () => Object.assign(console, saved);
};
const restoreLoad = quiet();
const ForecastConfigController = require('../controllers/forecastConfigController');
const { getStockThresholds, invalidateStockThresholds } = require('../services/stockThresholdService');
const { currentStockStatus, predictedStockStatus } = require('../utils/stockStatus');
restoreLoad();

const MIGRATED_ROW = {
  id: 1,
  safety_buffer_percentage: 15,
  food_cost_warning_threshold: 35,
  current_low_wet_pct: 50,
  current_low_dry_pct: 20,
  predicted_critical_pct: 50,
  predicted_sufficient_pct: 100,
  predicted_above_pct: 200,
};

function call(handler, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    const restore = quiet();
    Promise.resolve(handler({ body: body || {}, query: {} }, res)).finally(restore);
  });
}

test('GET before migration 021: the defaults, flagged as not saved yet', async () => {
  fake.reset({ forecast_config: [{ id: 1, safety_buffer_percentage: 15, food_cost_warning_threshold: 35 }] });
  const { status, body } = await call(ForecastConfigController.get);
  assert.equal(status, 200);
  assert.equal(body.data.current_low_wet_pct, 50);
  assert.equal(body.data.current_low_dry_pct, 20);
  assert.equal(body.data.predicted_critical_pct, 50);
  assert.equal(body.data.predicted_sufficient_pct, 100);
  assert.equal(body.data.predicted_above_pct, 200);
  assert.equal(body.data.stock_thresholds_saved, false);
});

test('POST saves valid thresholds; the next status uses them', async () => {
  fake.reset({ forecast_config: [{ ...MIGRATED_ROW }] });
  invalidateStockThresholds();
  // Before: a wet item at 45% of its ideal level is Low Stock (< 50%).
  const before = await getStockThresholds();
  assert.equal(currentStockStatus({ quantity: 4.5, idealLevel: 10, materialType: 'wet' }, before).status, 'Low Stock');

  const { status, body } = await call(ForecastConfigController.save, { current_low_wet_pct: 40, predicted_above_pct: 150 });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.current_low_wet_pct, 40);
  assert.equal(body.data.predicted_above_pct, 150);
  assert.equal(body.data.current_low_dry_pct, 20, 'untouched values stay');
  assert.equal(fake.tables.forecast_config[0].current_low_wet_pct, 40, 'saved in the row');

  // After: the cache was cleared, so the change applies at once.
  const after = await getStockThresholds();
  assert.equal(currentStockStatus({ quantity: 4.5, idealLevel: 10, materialType: 'wet' }, after).status, 'Normal Stock');
  assert.equal(predictedStockStatus({ quantity: 16, need: 10 }, after).status, 'Above Forecast Limit');
});

test('POST refuses bad values and leaves the row unchanged', async () => {
  fake.reset({ forecast_config: [{ ...MIGRATED_ROW }] });
  const cases = [
    [{ current_low_dry_pct: 0 }, /Dry raw materials/],
    [{ current_low_wet_pct: 100 }, /Wet raw materials/],
    [{ predicted_critical_pct: 120 }, /Critical Shortage threshold must be lower/],
    [{ predicted_above_pct: 80 }, /Sufficient Supply threshold must be lower/],
  ];
  for (const [input, message] of cases) {
    const { status, body } = await call(ForecastConfigController.save, input);
    assert.equal(status, 400, JSON.stringify(input));
    assert.match(body.error, message);
  }
  assert.deepEqual(fake.tables.forecast_config[0], MIGRATED_ROW);
});

test('POST before migration 021: a clear 409, and the safety buffer can still be saved', async () => {
  fake.reset({ forecast_config: [{ id: 1, safety_buffer_percentage: 15, food_cost_warning_threshold: 35 }] });
  // Make the fake behave like Postgres without the new columns.
  const realFrom = fake.from.bind(fake);
  fake.from = (table) => {
    const builder = realFrom(table);
    if (table !== 'forecast_config') return builder;
    const realUpdate = builder.update.bind(builder);
    builder.update = (values) => {
      if (Object.keys(values).some((k) => k.endsWith('_pct'))) {
        const failing = {
          eq: () => failing, select: () => failing, single: () => failing,
          then: (resolve) => resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'current_low_wet_pct' column of 'forecast_config' in the schema cache" } }),
        };
        return failing;
      }
      return realUpdate(values);
    };
    return builder;
  };
  try {
    const refused = await call(ForecastConfigController.save, { current_low_wet_pct: 40 });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /migration 021/);

    const buffer = await call(ForecastConfigController.save, { safety_buffer_percentage: 20 });
    assert.equal(buffer.status, 200, JSON.stringify(buffer.body));
    assert.equal(fake.tables.forecast_config[0].safety_buffer_percentage, 20);
  } finally {
    fake.from = realFrom;
  }

  // And every status keeps working on the defaults.
  invalidateStockThresholds();
  const t = await getStockThresholds();
  assert.equal(t.current_low_wet_pct, 50);
});

test('a failed settings read never breaks a status: the defaults are used', async () => {
  invalidateStockThresholds();
  const broken = { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) }) };
  const restore = quiet();
  const t = await getStockThresholds({ client: broken, fresh: true });
  restore();
  assert.equal(t.current_low_dry_pct, 20);
  assert.equal(t.predicted_above_pct, 200);
});
