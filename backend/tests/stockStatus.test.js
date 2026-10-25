// tests/stockStatus.test.js — run: node --test tests/stockStatus.test.js
//
// The two stock level statuses (utils/stockStatus.js) against the
// hand-worked examples in tests/fixtures/stock_status_cases.json, plus the
// Settings validation rules.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  currentStockStatus,
  predictedStockStatus,
  legacyPredictedLabel,
  normalizeThresholds,
  validateThresholds,
  DEFAULT_STOCK_THRESHOLDS,
} = require('../utils/stockStatus');
const RULES = require('../../shared/stockStatusRules.json');

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'stock_status_cases.json'), 'utf8'));
const withDefaults = (overrides) => ({ ...DEFAULT_STOCK_THRESHOLDS, ...(overrides || {}) });

test('defaults are the agreed table: wet 50%, dry 20%; predicted 50 / 100 / 200%', () => {
  assert.deepEqual(DEFAULT_STOCK_THRESHOLDS, {
    current_low_wet_pct: 50,
    current_low_dry_pct: 20,
    predicted_critical_pct: 50,
    predicted_sufficient_pct: 100,
    predicted_above_pct: 200,
  });
  assert.deepEqual(Object.values(RULES.current.labels), ['Out of Stock', 'Low Stock', 'Normal Stock', 'Excess Stock']);
  assert.deepEqual(
    Object.values(RULES.predicted.labels),
    ['Critical Shortage', 'Insufficient Supply', 'Sufficient Supply', 'Above Forecast Limit', 'Unassigned'],
  );
});

for (const c of CASES.current) {
  test(`current: ${c.label}`, () => {
    const got = currentStockStatus(
      { quantity: c.quantity, idealLevel: c.idealLevel, materialType: c.materialType },
      withDefaults(c.thresholds),
    );
    assert.equal(got.status, c.expected);
    assert.equal(got.stockPct, c.stockPct);
    if (c.idealLevelSet !== undefined) assert.equal(got.idealLevelSet, c.idealLevelSet);
  });
}

for (const c of CASES.predicted) {
  test(`predicted: ${c.label}`, () => {
    const got = predictedStockStatus({ quantity: c.quantity, need: c.need }, withDefaults(c.thresholds));
    assert.equal(got.status, c.expected);
    assert.equal(got.coveragePct, c.coveragePct);
    assert.equal(got.action, RULES.predicted.actions[got.level], 'every status carries its action text');
  });
}

test('exact arithmetic: the float result for 8.04 / 40.2 really is below 20, and the module still says Normal', () => {
  assert.ok(8.04 / 40.2 * 100 < 20, 'if this ever fails, pick another example; the point is the float error');
  assert.equal(currentStockStatus({ quantity: 8.04, idealLevel: 40.2, materialType: 'dry' }).status, 'Normal Stock');
});

test('the two statuses are independent: the same ingredient can be Normal Stock and Critical Shortage', () => {
  // Rice: 12 kg on hand, ideal 40 kg (30% -> Normal for a dry item), but a big
  // forecast needs 30 kg tomorrow (40% coverage -> Critical Shortage).
  assert.equal(currentStockStatus({ quantity: 12, idealLevel: 40, materialType: 'dry' }).status, 'Normal Stock');
  assert.equal(predictedStockStatus({ quantity: 12, need: 30 }).status, 'Critical Shortage');
});

test('legacy wording keeps the same level for screens not renamed yet', () => {
  assert.equal(legacyPredictedLabel(4.99, 10), 'Critical');
  assert.equal(legacyPredictedLabel(5, 10), 'Low');
  assert.equal(legacyPredictedLabel(10, 10), 'Normal');
  assert.equal(legacyPredictedLabel(20.01, 10), 'Excess');
  assert.equal(legacyPredictedLabel(10, 0), 'No Forecast');
  assert.equal(legacyPredictedLabel(16, 10, withDefaults({ predicted_above_pct: 150 })), 'Excess', 'uses the thresholds passed in');
});

test('normalizeThresholds: missing, junk or out-of-order values fall back to the defaults', () => {
  assert.deepEqual(normalizeThresholds(null), DEFAULT_STOCK_THRESHOLDS);
  assert.deepEqual(normalizeThresholds({}), DEFAULT_STOCK_THRESHOLDS);
  // Postgres numeric comes back as text.
  assert.equal(normalizeThresholds({ current_low_wet_pct: '40.00' }).current_low_wet_pct, 40);
  assert.equal(normalizeThresholds({ current_low_dry_pct: 'abc' }).current_low_dry_pct, 20);
  assert.equal(normalizeThresholds({ current_low_dry_pct: 150 }).current_low_dry_pct, 20, 'over the limit');
  const broken = normalizeThresholds({ predicted_critical_pct: 120, predicted_sufficient_pct: 100, predicted_above_pct: 200 });
  assert.deepEqual(
    [broken.predicted_critical_pct, broken.predicted_sufficient_pct, broken.predicted_above_pct],
    [50, 100, 200],
    'bands out of order: all three back to defaults, never mixed',
  );
});

test('validateThresholds: accepts a valid change and merges it with what is saved', () => {
  const r = validateThresholds({ current_low_wet_pct: 40 }, DEFAULT_STOCK_THRESHOLDS);
  assert.equal(r.ok, true);
  assert.equal(r.values.current_low_wet_pct, 40);
  assert.equal(r.values.current_low_dry_pct, 20, 'untouched keys keep their saved value');
});

test('validateThresholds: refuses out-of-range and badly ordered values with a clear message', () => {
  const bad = [
    [{ current_low_wet_pct: 0 }, /Wet raw materials/],
    [{ current_low_dry_pct: 100 }, /Dry raw materials/],
    [{ current_low_dry_pct: 'x' }, /Dry raw materials/],
    [{ current_low_dry_pct: '' }, /Dry raw materials/],
    [{ predicted_critical_pct: 100 }, /Critical Shortage threshold must be lower/],
    [{ predicted_sufficient_pct: 250 }, /Sufficient Supply threshold must be lower/],
    [{ predicted_above_pct: 90 }, /Sufficient Supply threshold must be lower/],
  ];
  for (const [input, message] of bad) {
    const r = validateThresholds(input, DEFAULT_STOCK_THRESHOLDS);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.match(r.error, message);
  }
});
