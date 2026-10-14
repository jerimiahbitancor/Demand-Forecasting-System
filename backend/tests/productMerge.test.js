// tests/productMerge.test.js — run: node --test tests/productMerge.test.js
//
// Product aliases and merging (owner's v3 flowchart, page 4):
//   - uploads match product names AND aliases (same key rule)
//   - product sync never creates a product for an alias
//   - renaming keeps the old name as an alias
//   - everything still works before migration 011 (no product_aliases table)
//   - the pure "looks alike" rule
//   - merge preview / merge service / routes (the SQL function itself is
//     stubbed: it runs in Postgres, and the migration is not run here)
// In-memory fake database; no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const rpcCalls = [];
let rpcAnswer = () => ({ data: { days_moved: 1 }, error: null });
const fake = createFakeSupabase({}, {
  rpc: { merge_products: (args) => { rpcCalls.push(args); return rpcAnswer(args); } },
});
installFake(fake, {
  'middleware/auth.js': (req, res, next) => { req.user = { id: 7, user_id: 7, name: 'Test Owner' }; next(); },
});

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
};
const restoreLoad = quiet();
const uploadService = require('../services/uploadService');
const mappingService = require('../services/mappingService');
const { productNameKey } = require('../utils/productNameKey');
const { findPossibleDuplicates, variantBase, isAbbreviation } = require('../utils/productDuplicates');
const { getMergePreview, mergeProducts, MergeError } = require('../services/productMergeService');
const productsRouter = require('../routes/products');
restoreLoad();

const OLD = '2025-07-10';
const product = (id, name, extra = {}) => ({
  id, name, price: 100, category: 'Rice Meals', status: 'active', is_active: true,
  first_sold_date: OLD, created_at: OLD, inactive_reason: null, inactive_since: null, ...extra,
});

function seed(options = {}) {
  fake.reset({
    user: [{ id: 7 }],
    products: [
      product(316, 'Cheesy Spicy Hunggarian'),
      product(368, 'Original Tapsilog'),
      product(500, 'Adobo'),
    ],
    product_aliases: [
      { id: 1, alias_name: 'Cheesy Spicy Hungarian', alias_key: 'cheesy spicy hungarian', product_id: 316 },
      { id: 2, alias_name: 'OG Tapsilog', alias_key: 'og tapsilog', product_id: 368 },
      // An alias that collides with a real product name: the product wins.
      { id: 3, alias_name: 'Adobo', alias_key: 'adobo', product_id: 368 },
    ],
    daily_sales: [],
    modifier_rules: [],
  }, options);
}

const rows = (...items) => items.map(([name, sold]) => ({
  'Item name': name, Category: 'Rice Meals', 'Items sold': String(sold), 'Items refunded': '0',
}));

async function upload(file, uploadId) {
  const restore = quiet();
  try {
    return await uploadService.processSalesData(rows(...file), 7, uploadId, 'item-sales-summary-2026-10-12-2026-10-12.csv');
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------- key rule

test('name key: trim, collapse spaces, lower-case (same as SQL product_name_key)', () => {
  assert.equal(productNameKey('  Cheesy   Spicy\tHungarian '), 'cheesy spicy hungarian');
  assert.equal(productNameKey(null), '');
});

// ---------------------------------------------------------------- E2

test('upload: an alias name lands on its product; no product is created for it', async () => {
  seed();
  const result = await upload([['Cheesy Spicy Hungarian', 5], ['OG  Tapsilog', 3], ['Adobo', 2]], 60);
  const saved = fake.tables.daily_sales.filter((r) => r.upload_id === 60)
    .map((r) => [r.product_id, r.quantity_sold]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(saved, [[316, 5], [368, 3], [500, 2]], 'alias rows go to 316 / 368; "Adobo" stays on the real product');
  assert.equal(fake.tables.products.length, 3, 'no product created');
  assert.deepEqual(result.warnings, []);
});

test('sync: a name that is an alias is "existing", never created', async () => {
  seed();
  const restore = quiet();
  const out = await uploadService.syncProductsFromSales(['OG Tapsilog', 'Brand New Dish'], 7);
  restore();
  assert.deepEqual(out.existing.sort(), ['OG Tapsilog']);
  assert.equal(fake.tables.products.length, 4);
  assert.ok(fake.tables.products.some((p) => p.name === 'Brand New Dish'));
  assert.ok(!fake.tables.products.some((p) => p.name === 'OG Tapsilog'));
});

test('before migration 011 (no product_aliases table) uploads work exactly as before', async () => {
  seed({ missingTables: ['product_aliases'] });
  const result = await upload([['Adobo', 4], ['OG Tapsilog', 1]], 61);
  assert.deepEqual(fake.tables.daily_sales.filter((r) => r.upload_id === 61).map((r) => r.product_id).sort(), [500, fake.tables.products.find((p) => p.name === 'OG Tapsilog').id].sort());
  assert.ok(fake.tables.products.some((p) => p.name === 'OG Tapsilog'), 'without aliases, a new name still becomes a product (old behaviour)');
  assert.deepEqual(result.warnings, []);
});

// ---------------------------------------------------------------- E3

test('rename: the old name becomes an alias of the product', async () => {
  seed();
  const restore = quiet();
  const updated = await mappingService.updateProduct(316, { name: 'Cheesy Spicy Hungarian' }, 7);
  restore();
  assert.equal(updated.name, 'Cheesy Spicy Hungarian');
  const alias = fake.tables.product_aliases.find((a) => a.alias_key === 'cheesy spicy hunggarian');
  assert.ok(alias, 'old name kept as an alias');
  assert.equal(alias.product_id, 316);
  assert.equal(alias.alias_name, 'Cheesy Spicy Hunggarian');

  // A later file with the OLD name still matches 316.
  await upload([['Cheesy Spicy Hunggarian', 2]], 62);
  assert.deepEqual(fake.tables.daily_sales.filter((r) => r.upload_id === 62).map((r) => r.product_id), [316]);
});

test('rename: only spacing/case changed -> no alias; price-only edit -> no alias', async () => {
  seed();
  const before = fake.tables.product_aliases.length;
  const restore = quiet();
  await mappingService.updateProduct(368, { name: 'original  TAPSILOG' }, 7);
  await mappingService.updateProduct(500, { price: 150 }, 7);
  restore();
  assert.equal(fake.tables.product_aliases.length, before);
});

test('rename before migration 011: the rename still succeeds', async () => {
  seed({ missingTables: ['product_aliases'] });
  const restore = quiet();
  const updated = await mappingService.updateProduct(500, { name: 'Pork Adobo' }, 7);
  restore();
  assert.equal(updated.name, 'Pork Adobo');
});

// ---------------------------------------------------------------- E5 pure rule

test('looks alike: typo and abbreviation pairs are suggested', () => {
  const pairs = findPossibleDuplicates([
    { id: 316, name: 'Cheesy Spicy Hunggarian' },
    { id: 434, name: 'Cheesy Spicy Hungarian' },
    { id: 368, name: 'Original Tapsilog' },
    { id: 436, name: 'OG Tapsilog' },
  ]);
  assert.deepEqual(pairs.map((p) => [p.a.id, p.b.id, p.reason]), [[316, 434, 'typo'], [368, 436, 'abbreviation']]);
});

test('looks alike: size words and modifiers are variants, not duplicates', () => {
  const pairs = findPossibleDuplicates([
    { id: 1, name: 'Pansit Bihon' },
    { id: 2, name: 'Pansit Bihon Small' },
    { id: 3, name: 'Pansit Bihon Large' },
    { id: 4, name: 'Chick & Fries' },
    { id: 5, name: 'Chick & Fries NO FRIES' },
    { id: 6, name: 'Marinated Porksilog' },
    { id: 7, name: 'Marinated Porksilog (NO EGG)' },
  ], { modifierKeywords: ['NO EGG', 'NO RICE'] });
  assert.deepEqual(pairs, []);
  assert.equal(variantBase('Pansit Bihon Medium'), 'pansit bihon');
  assert.equal(variantBase('Marinated Porksilog - NO EGG', ['NO EGG']), 'marinated porksilog');
});

test('looks alike: different dishes and archived products are not suggested', () => {
  const pairs = findPossibleDuplicates([
    { id: 1, name: 'Add Chili' },
    { id: 2, name: 'Add Chili Garlic' },        // longer name that starts the same
    { id: 3, name: 'Pansit Canton' },
    { id: 4, name: 'Pansit Bihon' },
    { id: 5, name: 'Iced Coffee' },
    { id: 6, name: 'Extra Coffee' },
    { id: 7, name: 'Cheesy Spicy Hungarian' },
    { id: 8, name: 'Cheesy Spicy Hunggarian', status: 'archived' },
    { id: 9, name: 'Cheesy Spicy Hungarain', archived: true },
  ]);
  assert.deepEqual(pairs, []);
  assert.equal(isAbbreviation('og', 'original'), true);
  assert.equal(isAbbreviation('ex', 'iced'), false);
});

// ---------------------------------------------------------------- E4 service

function seedMerge() {
  fake.reset({
    user: [{ id: 7 }],
    products: [
      product(316, 'Cheesy Spicy Hunggarian'),
      product(434, 'Cheesy Spicy Hungarian'),
      product(325, 'Chick & Fries'),
      product(450, 'Chick & Fries NO FRIES'),
      product(900, 'Old Thing', { status: 'archived', is_active: false, inactive_reason: 'Archived by user' }),
      product(901, 'Merged Away (merged)', { status: 'archived', is_active: false, inactive_reason: 'Archived: merged into Adobo' }),
    ],
    daily_sales: [
      { id: 1, product_id: 434, sale_date: '2026-10-01', quantity_sold: 2 },
      { id: 2, product_id: 434, sale_date: '2026-10-02', quantity_sold: 3 },
      { id: 3, product_id: 316, sale_date: '2026-10-02', quantity_sold: 9 },
    ],
    daily_sales_modifiers: [],
    product_ingredients: [{ id: 1, product_id: 316, ingredient_id: 5, quantity_per_serving: '1' }],
    forecasts: [{ id: 1, product_id: 434, forecast_date: '2026-10-13' }],
    product_classifications: [],
    modifier_rules: [{ id: 1, keyword: 'NO RICE', ingredient_id: 1 }],
  });
}

test('merge preview: counts and plain text, read-only', async () => {
  seedMerge();
  const writesBefore = fake.writes.length;
  const p = await getMergePreview(fake, { sourceId: 434, targetId: 316 });
  assert.equal(p.daysMoved, 2);
  assert.equal(p.daysAddedTogether, 1);
  assert.equal(p.platesMoved, 5);
  assert.equal(p.recipe, 'kept_target');
  assert.equal(p.forecastsDeleted, 1);
  assert.match(p.text, /2 day\(s\) of sales \(5 plates\) move to "Cheesy Spicy Hunggarian"/);
  assert.match(p.text, /archived as "Cheesy Spicy Hungarian \(merged\)"/);
  assert.equal(fake.writes.length, writesBefore, 'the preview writes nothing');
});

test('merge checks: same product, archived target, already merged, unknown modifier', async () => {
  seedMerge();
  const fails = async (args, status, pattern) => {
    await assert.rejects(getMergePreview(fake, args), (e) => {
      assert.ok(e instanceof MergeError);
      assert.equal(e.status, status);
      assert.match(e.message, pattern);
      return true;
    });
  };
  await fails({ sourceId: 316, targetId: 316 }, 400, /itself/);
  await fails({ sourceId: 434, targetId: 900 }, 409, /archived/);
  await fails({ sourceId: 901, targetId: 316 }, 409, /already merged/);
  await fails({ sourceId: 450, targetId: 325, modifierKeyword: 'NO FRIES' }, 400, /not a modifier yet/);
  await fails({ sourceId: 434, targetId: 999 }, 404, /not found/);
  const ok = await getMergePreview(fake, { sourceId: 450, targetId: 325, modifierKeyword: ' no  rice ' });
  assert.equal(ok.modifierKeyword, 'NO RICE');
});

test('merge: calls merge_products once with the right arguments, then recomputes statuses', async () => {
  seedMerge();
  rpcCalls.length = 0;
  rpcAnswer = () => ({ data: { days_moved: 2, days_added_together: 1 }, error: null });
  let recomputed = 0;
  const out = await mergeProducts(fake, { sourceId: 434, targetId: 316, actor: 'Owner' }, { afterMerge: async () => { recomputed += 1; return { updated: 1 }; } });
  assert.deepEqual(rpcCalls, [{ p_source: 434, p_target: 316, p_modifier_keyword: null, p_actor: 'Owner' }]);
  assert.equal(recomputed, 1);
  assert.deepEqual(out.result, { days_moved: 2, days_added_together: 1 });
});

test('merge: function not installed (migration not run) -> 503 with the migration name', async () => {
  seedMerge();
  rpcAnswer = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.merge_products' } });
  await assert.rejects(mergeProducts(fake, { sourceId: 434, targetId: 316 }), (e) => e.status === 503 && /011_product_aliases_and_merge/.test(e.message));
  rpcAnswer = () => ({ data: null, error: { code: 'P0001', message: 'merge_products: product 434 (X) was already merged' } });
  await assert.rejects(mergeProducts(fake, { sourceId: 434, targetId: 316 }), (e) => e.status === 400 && /^product 434/.test(e.message));
});

// ---------------------------------------------------------------- E4 routes

function call(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('routes: preview, merge (then status recompute), duplicates, modifier keywords', async () => {
  seedMerge();
  process.env.PRODUCT_MERGE_ENABLED = 'true'; // flag ON for this test
  rpcCalls.length = 0;
  rpcAnswer = () => ({ data: { days_moved: 2 }, error: null });
  const realReconcile = mappingService.reconcileProductActivation;
  let reconciled = 0;
  mappingService.reconcileProductActivation = async () => { reconciled += 1; return { updated: 0 }; };
  const app = express();
  app.use(express.json());
  app.use('/api/products', productsRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const restore = quiet();
  try {
    const preview = await call(server, 'GET', '/api/products/434/merge-preview?targetId=316');
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.daysMoved, 2);

    const bad = await call(server, 'GET', '/api/products/434/merge-preview');
    assert.equal(bad.status, 400);

    const merged = await call(server, 'POST', '/api/products/434/merge', { targetId: 316 });
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.deepEqual(rpcCalls, [{ p_source: 434, p_target: 316, p_modifier_keyword: null, p_actor: 'Test Owner' }]);
    assert.equal(reconciled, 1, 'statuses recomputed after the merge');

    const dupes = await call(server, 'GET', '/api/products/duplicates');
    assert.equal(dupes.status, 200);
    assert.deepEqual(dupes.body.data.pairs.map((p) => [p.a.id, p.b.id]), [[316, 434]]);

    const kw = await call(server, 'GET', '/api/products/modifier-keywords');
    assert.deepEqual(kw.body.data.keywords, ['NO RICE']);
  } finally {
    delete process.env.PRODUCT_MERGE_ENABLED;
    restore();
    mappingService.reconcileProductActivation = realReconcile;
    server.close();
  }
});

test('G1f: PRODUCT_MERGE_ENABLED off (the default) -> POST merge is 403 MERGE_DISABLED and the rpc is never called', async () => {
  seedMerge();
  delete process.env.PRODUCT_MERGE_ENABLED;
  rpcCalls.length = 0;
  const realReconcile = mappingService.reconcileProductActivation;
  let reconciled = 0;
  mappingService.reconcileProductActivation = async () => { reconciled += 1; return { updated: 0 }; };
  const app = express();
  app.use(express.json());
  app.use('/api/products', productsRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const restore = quiet();
  try {
    const settings = await call(server, 'GET', '/api/products/settings');
    assert.deepEqual(settings.body.data, { mergeEnabled: false, mergeDisabledMessage: 'Merging is turned off for now.' });

    const writesBefore = fake.writes.length;
    const blocked = await call(server, 'POST', '/api/products/434/merge', { targetId: 316 });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'MERGE_DISABLED');
    assert.equal(blocked.body.message, 'Merging is turned off for now.');
    assert.equal(rpcCalls.length, 0, 'merge_products never called');
    assert.equal(reconciled, 0);
    assert.equal(fake.writes.length, writesBefore, 'nothing written');

    process.env.PRODUCT_MERGE_ENABLED = 'false';
    assert.equal((await call(server, 'POST', '/api/products/434/merge', { targetId: 316 })).status, 403, 'explicit false too');

    // Read-only endpoints keep working.
    assert.equal((await call(server, 'GET', '/api/products/434/merge-preview?targetId=316')).status, 200);
    assert.equal((await call(server, 'GET', '/api/products/duplicates')).status, 200);

    // Flag on -> the rpc is called exactly once.
    process.env.PRODUCT_MERGE_ENABLED = 'true';
    rpcAnswer = () => ({ data: { days_moved: 2 }, error: null });
    const ok = await call(server, 'POST', '/api/products/434/merge', { targetId: 316 });
    assert.equal(ok.status, 200);
    assert.equal(rpcCalls.length, 1);
  } finally {
    delete process.env.PRODUCT_MERGE_ENABLED;
    restore();
    mappingService.reconcileProductActivation = realReconcile;
    server.close();
  }
});

test('featureFlags: defaults and parsing', () => {
  const { schedulersEnabled, productMergeEnabled } = require('../utils/featureFlags');
  assert.equal(schedulersEnabled({ NODE_ENV: 'production' }), true);
  assert.equal(schedulersEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(schedulersEnabled({}), false);
  assert.equal(schedulersEnabled({ NODE_ENV: 'production', SCHEDULERS_ENABLED: 'false' }), false);
  assert.equal(schedulersEnabled({ SCHEDULERS_ENABLED: 'true' }), true);
  assert.equal(schedulersEnabled({ SCHEDULERS_ENABLED: 'maybe', NODE_ENV: 'production' }), true, 'unreadable value -> default');
  assert.equal(productMergeEnabled({}), false);
  assert.equal(productMergeEnabled({ PRODUCT_MERGE_ENABLED: 'TRUE' }), true);
  assert.equal(productMergeEnabled({ PRODUCT_MERGE_ENABLED: '0' }), false);
});
