// tests/uploadSummary.test.js — run: node --test tests/uploadSummary.test.js
//
// The upload summary (owner's v3 flowchart, page 2, "Output (upload
// summary)"), returned with every sales upload. In-memory fake database.

const test = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase({}, {
  rpc: {
    deduct_ingredient_stock: ({ p_ingredient_id: id, p_deduction: amount }, tables) => {
      const row = (tables.ingredients || []).find((i) => i.id === id);
      const previous = new Decimal(String(row.quantity || 0));
      const requested = new Decimal(String(amount));
      const applied = Decimal.min(previous, requested);
      row.quantity = Decimal.max(0, previous.minus(applied)).toString();
      return {
        data: [{
          previous_quantity: previous.toString(),
          new_quantity: row.quantity,
          applied_quantity: applied.toString(),
          shortfall_quantity: Decimal.max(0, requested.minus(previous)).toString(),
          already_applied: false,
        }],
        error: null,
      };
    },
  },
});
installFake(fake);

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
};
const restoreLoad = quiet();
const uploadService = require('../services/uploadService');
const { buildUploadSummary, emptyUploadSummary } = require('../utils/uploadSummary');
restoreLoad();

const OLD = '2025-07-10';
const product = (id, name, extra = {}) => ({
  id, name, price: 100, category: 'Rice Meals', status: 'active', is_active: true,
  first_sold_date: OLD, created_at: OLD, inactive_reason: null, inactive_since: null, ...extra,
});
const EGG = 101;

function seed() {
  fake.reset({
    user: [{ id: 7 }],
    products: [
      product(1, 'Marinated Porksilog'),
      product(2, 'Pansit Bihon Small'),
      product(3, 'Original Tapsilog'),
      product(4, 'Cheesy Spicy Hungarian'),
    ],
    product_aliases: [{ id: 1, alias_name: 'OG Tapsilog', alias_key: 'og tapsilog', product_id: 3 }],
    modifier_rules: [{ id: 1, keyword: 'NO EGG', ingredient_id: EGG }],
    ingredients: [{ id: EGG, name: 'Egg', unit: 'Pieces (pcs)', quantity: 2, created_at: '2026-01-01T00:00:00Z' }],
    product_ingredients: [{
      product_id: 1, ingredient_id: EGG, quantity_per_serving: 1, unit: 'Pieces (pcs)',
      ingredients: { name: 'Egg', unit: 'Pieces (pcs)', grams_per_cup: null, created_at: '2026-01-01T00:00:00Z' },
    }],
    daily_sales: [],
    inventory_transactions: [],
    notifications: [],
  });
}

const rows = (...items) => items.map(([name, sold]) => ({
  'Item name': name, Category: 'Rice Meals', 'Items sold': String(sold), 'Items refunded': '0',
}));

test('processSalesData returns the upload summary: modifiers, sizes, new products, aliases, duplicates', async () => {
  seed();
  // Enough eggs: a short ingredient now refuses the whole file (next test).
  fake.tables.ingredients.find((i) => i.id === EGG).quantity = 10;
  const restore = quiet();
  let result;
  try {
    result = await uploadService.processSalesData(
      rows(
        ['Marinated Porksilog', 4],
        ['Marinated Porksilog NO EGG', 1],
        ['Pansit Bihon Small', 2],
        ['OG Tapsilog', 3],
        ['Cheesy Spicy Hunggarian', 1], // new product, looks like product 4
      ),
      7, 70, 'item-sales-summary-2026-10-12-2026-10-12.csv'
    );
  } finally {
    restore();
  }
  const s = result.uploadSummary;
  assert.deepEqual(s.modifierProducts, [{ productId: 1, name: 'Marinated Porksilog', plates: { 'NO EGG': 1 } }]);
  assert.deepEqual(s.sizeProducts, [{ productId: 2, name: 'Pansit Bihon Small' }]);
  assert.equal(s.newProducts.length, 1);
  assert.equal(s.newProducts[0].name, 'Cheesy Spicy Hunggarian');
  assert.ok(s.newProducts[0].productId);
  assert.deepEqual(s.aliasMatches, [{ alias: 'OG Tapsilog', productId: 3, productName: 'Original Tapsilog' }]);
  assert.deepEqual(s.possibleDuplicates.map((d) => [d.newProduct.name, d.looksLike.name, d.reason]),
    [['Cheesy Spicy Hunggarian', 'Cheesy Spicy Hungarian', 'typo']]);
  assert.deepEqual(s.unmatchedNames, []);
  // 5 plates of Porksilog, 1 of them NO EGG -> 4 eggs out of 10.
  assert.deepEqual(s.shortfalls, []);
  assert.equal(fake.tables.ingredients.find((i) => i.id === EGG).quantity, '6');
  assert.equal(result.productsDetected, 1);
});

test('a short ingredient refuses the file: the modifier rule is applied before the stock check', async () => {
  seed(); // 2 eggs in stock
  const restore = quiet();
  let error = null;
  try {
    await uploadService.processSalesData(
      rows(['Marinated Porksilog', 4], ['Marinated Porksilog NO EGG', 1]),
      7, 72, 'item-sales-summary-2026-10-12-2026-10-12.csv'
    );
  } catch (e) {
    error = e;
  } finally {
    restore();
  }
  assert.ok(error, 'refused');
  assert.equal(error.code, 'INSUFFICIENT_STOCK');
  // 5 plates, 1 of them NO EGG -> 4 eggs needed, not 5.
  assert.deepEqual(error.shortfalls.map((x) => [x.name, x.required, x.available, x.shortfall]), [['Egg', '4', '2', '2']]);
  assert.equal(fake.tables.daily_sales.length, 0);
  assert.equal((fake.tables.daily_sales_modifiers || []).length, 0, 'modifier counts are not saved either');
});

test('products the route already created still count as new (route syncs first)', async () => {
  seed();
  // Simulate routes/upload.js: the product exists before processSalesData runs.
  fake.tables.products.push(product(9, 'Brand New Dish', { status: 'inactive_new', is_active: false, first_sold_date: null }));
  const restore = quiet();
  let result;
  try {
    result = await uploadService.processSalesData(
      rows(['Brand New Dish', 2]), 7, 71, 'item-sales-summary-2026-10-12-2026-10-12.csv',
      { createdProductNames: ['Brand New Dish'] }
    );
  } finally {
    restore();
  }
  assert.deepEqual(result.uploadSummary.newProducts, [{ productId: 9, name: 'Brand New Dish' }]);
  assert.equal(result.productsDetected, 1, 'the upload notification no longer says 0 products');
});

test('buildUploadSummary: unmatched names, archived products never suggested, empty shape', () => {
  const s = buildUploadSummary({
    products: [
      { id: 1, name: 'Adobo' },
      { id: 2, name: 'Adoboo' },
      { id: 3, name: 'Adobbo', status: 'archived' },
    ],
    newProductNames: ['Adoboo'],
    unmatchedNames: ['Ghost Dish', 'Ghost Dish'],
    isArchived: (p) => p.status === 'archived',
  });
  assert.deepEqual(s.unmatchedNames, ['Ghost Dish']);
  assert.deepEqual(s.possibleDuplicates.map((d) => [d.newProduct.id, d.looksLike.id]), [[2, 1]]);
  assert.deepEqual(Object.keys(emptyUploadSummary()).sort(),
    ['aliasMatches', 'modifierProducts', 'newProducts', 'possibleDuplicates', 'shortfalls', 'sizeProducts', 'unmatchedNames']);
});
