// tests/weeklyGroceryList.test.js — run: node --test tests/weeklyGroceryList.test.js
//
// Weekly Grocery List (Analytics > Ingredient Demand, "Weekly"): the daily
// list's rules applied to unbuffered predicted demand = the sum of the 7 heatmap values.
// No network: the fake Supabase client is installed before the service loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

installFake(createFakeSupabase({}));
const { buildWeeklyGroceryList } = require('../services/analyticsService');

const row = (over) => ({
  ingredientId: 1, name: 'Rice', category: 'Grains & Starches', unit: 'kg',
  currentStock: 0, usedIn: 'Tapsilog', values: [0, 0, 0, 0, 0, 0, 0], ...over,
});

test('weekly need = sum of the 7 days; Critical/Low listed with toBuy and cost', () => {
  const { all, totals } = buildWeeklyGroceryList([
    // need 10 kg, stock 2 -> Critical, buy 8
    row({ ingredientId: 1, values: [2, 2, 2, 2, 2, 0, 0], currentStock: 2 }),
    // need 7 L, stock 5 -> Low, buy 2
    row({ ingredientId: 2, name: 'Oil', unit: 'L', values: [1, 1, 1, 1, 1, 1, 1], currentStock: 5 }),
  ], (id) => ({ 1: 50, 2: 100 }[id]));
  assert.deepEqual(all.map((i) => [i.name, i.status, i.forecastedNeed, i.toBuy, i.estCost]), [
    ['Rice', 'Critical', 10, 8, 400],
    ['Oil', 'Low', 7, 2, 200],
  ]);
  assert.equal(all[0].category, 'Grains & Starches');
  assert.equal(all[0].usedIn, 'Tapsilog');
  assert.deepEqual(totals, { estTotalCost: 600, totalItemsToBuy: 2 });
});

test('an ingredient already stocked for the week is left out', () => {
  const { all, totals } = buildWeeklyGroceryList([
    row({ values: [1, 1, 1, 1, 1, 1, 1], currentStock: 7 }), // exactly the need -> Normal
    row({ ingredientId: 2, values: [1, 1, 1, 1, 1, 1, 1], currentStock: 30 }), // Excess
    row({ ingredientId: 3, values: [0, 0, 0, 0, 0, 0, 0], currentStock: 0 }), // no need -> No Forecast
  ], () => 10);
  assert.equal(all.length, 0);
  assert.deepEqual(totals, { estTotalCost: 0, totalItemsToBuy: 0 });
});

test('a count unit rounds UP, the same as the daily list (toBuyQuantity)', () => {
  // need 7 × 1.3 = 9.1 pcs, stock 4 (44% -> Critical) -> raw 5.1 -> buy 6
  const { all } = buildWeeklyGroceryList([
    row({ name: 'Egg', unit: 'pcs', values: [1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3], currentStock: 4 }),
  ], () => 8);
  assert.equal(all[0].status, 'Critical');
  assert.equal(all[0].toBuy, 6);
  assert.equal(all[0].estCost, 48);
});

test('no market price -> estCost null (never ₱0), and it adds nothing to the total', () => {
  const { all, totals } = buildWeeklyGroceryList([
    row({ values: [5, 5, 0, 0, 0, 0, 0], currentStock: 1 }),
  ], () => null);
  assert.equal(all[0].marketPrice, null);
  assert.equal(all[0].estCost, null);
  assert.equal(all[0].toBuy, 9);
  assert.deepEqual(totals, { estTotalCost: 0, totalItemsToBuy: 1 });
});

test('configured ingredient unit price overrides external price and cost rounds to cents', () => {
  const { all, totals } = buildWeeklyGroceryList([
    row({ values: [1.25, 0, 0, 0, 0, 0, 0], currentStock: 0, unitPrice: '2.335' }),
  ], () => 99);
  assert.equal(all[0].marketPrice, '2.335');
  assert.equal(all[0].toBuy, 1.25);
  assert.equal(all[0].estCost, 2.92);
  assert.equal(totals.estTotalCost, 2.92);
});

test('weekly quantity and purchase amount use two decimals; piece purchases stay whole', () => {
  const { all } = buildWeeklyGroceryList([
    row({ values: [0.105, 0.105, 0, 0, 0, 0, 0], currentStock: 0, unitPrice: '10' }),
    row({ ingredientId: 2, unit: 'pcs', values: [0.4, 0, 0, 0, 0, 0, 0], currentStock: 0, unitPrice: '3' }),
  ]);
  assert.deepEqual(all.map((item) => [item.forecastedNeed, item.toBuy, item.estCost]), [
    [0.21, 0.21, 2.1],
    [1, 1, 3],
  ]);
});
