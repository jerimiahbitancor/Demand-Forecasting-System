// tests/stockStatusBadge.test.mjs — run: node --test tests/stockStatusBadge.test.mjs
//
// Every status label the backend can send (shared/stockStatusRules.json) has
// a badge, so a new label can never show up as "Unknown" on the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stockStatusBadge, currentStockBadge } from '../src/utils/stockStatusBadge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(path.join(here, '..', '..', 'shared', 'stockStatusRules.json'), 'utf8'));

test('every current and predicted label from the shared rules has a badge', () => {
  const labels = [...Object.values(RULES.current.labels), ...Object.values(RULES.predicted.labels)];
  assert.equal(labels.length, 9);
  for (const label of labels) {
    const badge = stockStatusBadge(label);
    assert.equal(badge.label, label, label);
    assert.match(badge.color, /^#[0-9a-f]{6}$/i, label);
  }
});

test('the badge only shows what the backend sent; it never computes a status', () => {
  // Quantity 0 with a "Normal Stock" label stays Normal Stock: the backend decides.
  assert.equal(currentStockBadge({ quantity: 0, min_stock: 10, current_stock_status: 'Normal Stock' }).label, 'Normal Stock');
  assert.equal(currentStockBadge({ is_archived: true, current_stock_status: 'Low Stock' }).label, 'Archived');
  assert.equal(currentStockBadge({ current_stock_status: 'Excess' }).label, 'Excess Stock', 'old wording');
  assert.equal(currentStockBadge({}).label, 'Unknown');
  assert.equal(currentStockBadge(null).label, 'Unknown');
});

test('Settings defaults are the agreed table', () => {
  assert.deepEqual(RULES.defaults, {
    current_low_wet_pct: 50,
    current_low_dry_pct: 20,
    current_excess_pct: 100,
    predicted_critical_pct: 50,
    predicted_sufficient_pct: 100,
    predicted_above_pct: 200,
  });
});
