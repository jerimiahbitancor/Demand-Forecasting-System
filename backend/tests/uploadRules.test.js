// tests/uploadRules.test.js — run: node --test tests/uploadRules.test.js
//
// Upload / status / stock rules, against an in-memory fake database
// (tests/helpers/fakeSupabase.js). No network, no real Supabase.
//
//   A1  an archived product sold in an upload stays archived
//   A2  an invalid sales file is rejected before anything is written
//   A3  item names that match no product are reported, not lost silently
//   A5  a stock edit logs an 'adjustment' only when the quantity really changed
//   A7  DELETE /api/upload/:id is turned off
//   (plus a valid upload still goes all the way through)

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

// A plain deduct_ingredient_stock for apply_sales_upload() to call: the
// amount was already checked against the stock, so it is applied in full and
// logged once. (tests/stockDeduction.test.js has the exact-decimal version.)
const fake = createFakeSupabase({}, {
  rpc: {
    deduct_ingredient_stock: (args, tables) => {
      const row = (tables.ingredients || []).find((i) => String(i.id) === String(args.p_ingredient_id));
      if (!row) return { data: null, error: { message: `Ingredient ${args.p_ingredient_id} does not exist` } };
      const previous = Number(row.quantity || 0);
      const applied = Number(args.p_deduction);
      row.quantity = String(+(previous - applied).toFixed(6));
      tables.inventory_transactions = tables.inventory_transactions || [];
      tables.inventory_transactions.push({
        ingredient_id: row.id, transaction_type: 'sale', quantity: -applied,
        previous_quantity: previous, new_quantity: Number(row.quantity),
        reference_type: args.p_reference_type, reference_id: args.p_reference_id,
      });
      return {
        data: [{
          previous_quantity: previous, new_quantity: Number(row.quantity), requested_quantity: applied,
          applied_quantity: applied, shortfall_quantity: 0, already_applied: false,
        }],
        error: null,
      };
    },
  },
});
const OWNER_ID = 7;
installFake(fake, {
  'middleware/auth.js': (req, res, next) => { req.user = { id: OWNER_ID, user_id: OWNER_ID, name: 'Test Owner' }; next(); },
  'middleware/virusScan.js': (req, res, next) => next(),
  // multer replaced: the test posts JSON { filename, csv } instead of multipart.
  'middleware/upload.js': {
    uploadSingle: (req, res, next) => {
      const { filename, csv } = req.body || {};
      if (filename) {
        const buffer = Buffer.from(csv || '', 'utf8');
        req.file = { originalname: filename, buffer, mimetype: 'text/csv', size: buffer.length };
      }
      req.body.fileType = 'sales';
      next();
    },
  },
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
const inventoryController = require('../controllers/inventoryController');
const uploadRouter = require('../routes/upload');
restoreLoad();

const OLD = '2025-07-10';
const HEADER = 'Item name,Category,Items sold,Gross sales,Items refunded,Refunds,Net sales';
const csv = (...rows) => [HEADER, ...rows].join('\n');

function seedProducts() {
  return {
    user: [{ id: OWNER_ID, auth_id: null }],
    products: [
      { id: 1, name: 'Adobo', price: 120, category: 'Rice Meals', status: 'active', is_active: true, first_sold_date: OLD, created_at: OLD, inactive_reason: null, inactive_since: null },
      { id: 2, name: 'Spork', price: 0, category: 'Uncategorized', status: 'archived', is_active: false, first_sold_date: OLD, created_at: OLD, inactive_reason: 'Archived by user', inactive_since: '2026-10-11T03:57:09' },
      // Archived by status, but its reason already lost the prefix (what the
      // old bug left behind). status alone must keep it archived.
      { id: 3, name: 'Delivery Fee', price: 0, category: 'Uncategorized', status: 'archived', is_active: false, first_sold_date: OLD, created_at: OLD, inactive_reason: 'by user', inactive_since: '2026-10-11T03:57:12' },
    ],
    daily_sales: [
      { id: 100, product_id: 1, sale_date: OLD, quantity_sold: 10, upload_id: 1 },
      { id: 101, product_id: 2, sale_date: OLD, quantity_sold: 1, upload_id: 1 },
      { id: 102, product_id: 3, sale_date: OLD, quantity_sold: 1, upload_id: 1 },
    ],
    uploads: [{ id: 1, filename: 'old.csv', status: 'processed', user_id: OWNER_ID, upload_date: '2025-07-11T00:00:00' }],
  };
}

const product = (id) => fake.tables.products.find((p) => p.id === id);

function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/upload', uploadRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: urlPath,
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

// Notifications and audit rows are written fire-and-forget after the
// response; let them land before the next case resets the tables.
const settle = () => new Promise((r) => setTimeout(r, 30));

// ---------------------------------------------------------------- A1

test('A1: archived products sold in an upload stay archived, reason unchanged; sales still saved', async () => {
  fake.reset(seedProducts());
  const restore = quiet();
  const result = await uploadService.processSalesData(
    [
      { 'Item name': 'Adobo', Category: 'Rice Meals', 'Items sold': '5', 'Items refunded': '0' },
      { 'Item name': 'Spork', Category: 'Uncategorized', 'Items sold': '3', 'Items refunded': '0' },
      { 'Item name': 'Delivery Fee', Category: 'Uncategorized', 'Items sold': '2', 'Items refunded': '0' },
    ],
    OWNER_ID, 50, 'item-sales-summary-2026-10-10-2026-10-10.csv'
  );
  await mappingService.reconcileProductActivation(OWNER_ID);
  restore();

  assert.equal(product(2).status, 'archived');
  assert.equal(product(2).inactive_reason, 'Archived by user', 'reason keeps its "Archived" prefix');
  assert.equal(product(2).inactive_since, '2026-10-11T03:57:09');
  assert.equal(product(3).status, 'archived', 'status = archived wins even without the prefix');
  assert.equal(product(3).inactive_reason, 'by user');

  const newRows = fake.tables.daily_sales.filter((r) => r.upload_id === 50);
  assert.deepEqual(
    newRows.map((r) => [r.product_id, r.quantity_sold]).sort((a, b) => a[0] - b[0]),
    [[1, 5], [2, 3], [3, 2]],
    'sales rows for archived products are still saved'
  );
  const statusWrites = fake.writesTo('products').filter((w) => w.op === 'update' && 'status' in (w.values || {}));
  assert.ok(statusWrites.every((w) => w.rows.every((r) => r.id === 1)), 'no status write touched an archived product');
  assert.deepEqual(result.warnings, []);
});

test('A1: reconcile never un-archives, and still updates non-archived products', async () => {
  const seed = seedProducts();
  // Product 1 last sold long ago -> should become discontinued.
  seed.daily_sales = seed.daily_sales.filter((r) => r.product_id !== 1);
  seed.daily_sales.push({ id: 200, product_id: 1, sale_date: '2025-08-01', quantity_sold: 4, upload_id: 1 });
  // Discontinued now means more than 28 confirmed-OPEN days since the last sale.
  seed.business_days = Array.from({ length: 30 }, (_, i) => ({
    business_date: new Date(Date.UTC(2025, 7, 2 + i)).toISOString().slice(0, 10), status: 'confirmed_open',
  }));
  fake.reset(seed);
  const restore = quiet();
  const out = await mappingService.reconcileProductActivation();
  restore();
  assert.equal(product(1).status, 'inactive_discontinued');
  assert.equal(product(2).status, 'archived');
  assert.equal(product(3).status, 'archived');
  assert.equal(out.updated, 1);
});

// ---------------------------------------------------------------- A3

test('A3: names that match no product are reported as a warning, plates not counted', async () => {
  // The product insert for "Ghost Dish" returns nothing (as if the sync
  // insert failed), so the name stays unmatched.
  fake.reset(seedProducts(), { rejectInsert: (table, row) => table === 'products' && row.name === 'Ghost Dish' });
  const restore = quiet();
  const result = await uploadService.processSalesData(
    [
      { 'Item name': 'Adobo', Category: 'Rice Meals', 'Items sold': '5', 'Items refunded': '0' },
      { 'Item name': 'Ghost Dish', Category: 'Rice Meals', 'Items sold': '9', 'Items refunded': '0' },
    ],
    OWNER_ID, 51, 'item-sales-summary-2026-10-10-2026-10-10.csv'
  );
  restore();
  assert.ok(
    result.warnings.includes('Skipped 1 item name(s) that matched no product: Ghost Dish. Their plates were not counted.'),
    JSON.stringify(result.warnings)
  );
  const rows = fake.tables.daily_sales.filter((r) => r.upload_id === 51);
  assert.deepEqual(rows.map((r) => r.product_id), [1], 'only the matched product was saved');
});

// ---------------------------------------------------------------- A2 + happy path

test('A2: a file with an empty "Items sold" is rejected with 400 and nothing is written but a failed upload row', async () => {
  fake.reset(seedProducts());
  const server = await startServer();
  const restore = quiet();
  try {
    const res = await request(server, 'POST', '/api/upload', {
      filename: 'item-sales-summary-2026-10-12-2026-10-12.csv',
      csv: csv('Adobo,Rice Meals,5,600,0,0,600', 'New Dish,Rice Meals,,100,0,0,100'),
    });
    await settle();
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.deepEqual(res.body.errors, [{ row: 3, column: 'Items sold', message: 'Items sold is empty' }]);
    assert.equal(res.body.errorCount, 1);

    const upload = fake.tables.uploads.find((u) => u.id === res.body.uploadId);
    assert.equal(upload.status, 'failed');
    assert.match(upload.error_message, /Items sold is empty/);

    assert.equal(fake.tables.daily_sales.length, 3, 'no sales rows added');
    assert.equal(fake.tables.products.length, 3, 'no product created for "New Dish"');
    assert.equal((fake.tables.business_days || []).length, 0, 'no open day confirmed');
    assert.equal(fake.rpcCalls.length, 0, 'no stock deducted');
    assert.equal(fake.writesTo('products').length, 0, 'products untouched');
  } finally {
    restore();
    server.close();
  }
});

test('a valid file still goes through: sales saved, day confirmed open, upload processed', async () => {
  fake.reset(seedProducts());
  const server = await startServer();
  const restore = quiet();
  try {
    const res = await request(server, 'POST', '/api/upload', {
      filename: 'item-sales-summary-2026-10-12-2026-10-12.csv',
      csv: csv('Adobo,Rice Meals,5,600,1,120,480', 'Spork,Uncategorized,2,0,0,0,0'),
    });
    await settle();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const rows = fake.tables.daily_sales.filter((r) => r.upload_id === res.body.uploadId);
    assert.deepEqual(rows.map((r) => [r.product_id, r.quantity_sold]).sort(), [[1, 4], [2, 2]]);
    assert.equal(fake.tables.uploads.find((u) => u.id === res.body.uploadId).status, 'processed');
    assert.deepEqual(fake.tables.business_days.map((d) => [d.business_date.slice(0, 10), d.status]), [['2026-10-12', 'confirmed_open']]);
    assert.equal(product(2).status, 'archived', 'archived Spork stays archived through the real route');
    assert.equal(product(2).inactive_reason, 'Archived by user');
  } finally {
    restore();
    server.close();
  }
});

function seedAdoboEggStock(quantity) {
  const seed = seedProducts();
  const egg = {
    id: 10,
    name: 'Egg',
    unit: 'Pieces (pcs)',
    base_unit: 'pcs',
    unit_family: 'count',
    stock_scale: 3,
    allow_fractional: false,
    material_type: 'dry',
    quantity: String(quantity),
  };
  seed.ingredients = [egg];
  seed.product_ingredients = [{
    product_id: 1,
    ingredient_id: egg.id,
    quantity_per_serving: '1',
    unit: 'Pieces (pcs)',
    ingredients: egg,
  }];
  return seed;
}

test('insufficient ingredient stock (wet/dry recipe units) refuses the upload: nothing saved or deducted', async () => {
  fake.reset(seedAdoboEggStock(1));
  const server = await startServer();
  const restore = quiet();
  try {
    const res = await request(server, 'POST', '/api/upload', {
      filename: 'item-sales-summary-2026-10-12-2026-10-12.csv',
      csv: csv('Adobo,Rice Meals,2,240,0,0,240'),
    });
    await settle();
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.success, false);
    assert.equal(res.body.insufficientStock, true);
    assert.deepEqual(res.body.shortfalls, [{
      ingredientId: 10, name: 'Egg', unit: 'Pieces (pcs)', required: '2', available: '1', shortfall: '1',
    }]);
    assert.equal(fake.tables.daily_sales.length, 3, 'no sales rows were added');
    assert.equal(fake.tables.ingredients[0].quantity, '1', 'stock untouched');
    assert.equal(fake.rpcCalls.length, 0, 'nothing was sent to the database to deduct');
    assert.equal(fake.tables.uploads.find((u) => u.id === res.body.uploadId).status, 'failed',
      'the upload row is failed, so the same file can be uploaded again after restocking');
  } finally {
    restore();
    server.close();
  }
});

test('a recipe unit that cannot be converted refuses the upload: nothing saved or deducted', async () => {
  const seed = seedAdoboEggStock(10);
  seed.product_ingredients[0].unit = 'handful';
  fake.reset(seed);
  const server = await startServer();
  const restore = quiet();
  try {
    const res = await request(server, 'POST', '/api/upload', {
      filename: 'item-sales-summary-2026-10-12-2026-10-12.csv',
      csv: csv('Adobo,Rice Meals,2,240,0,0,240'),
    });
    await settle();
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.recipeUnitProblem, true);
    assert.equal(res.body.validationErrors.length, 1);
    assert.equal(res.body.validationErrors[0].ingredientId, 10);
    assert.equal(res.body.validationErrors[0].ingredient, 'Egg');
    assert.ok(res.body.validationErrors[0].reasons.length > 0, JSON.stringify(res.body.validationErrors));
    assert.match(res.body.message, /was not saved/);
    assert.equal(fake.tables.daily_sales.length, 3, 'no sales rows were added');
    assert.equal(fake.tables.ingredients[0].quantity, '10', 'stock untouched');
    assert.equal(fake.rpcCalls.length, 0, 'nothing was sent to the database to deduct');
    assert.equal(fake.tables.uploads.find((u) => u.id === res.body.uploadId).status, 'failed');
  } finally {
    restore();
    server.close();
  }
});

test('sufficient ingredient stock allows a sales upload', async () => {
  fake.reset(seedAdoboEggStock(10));
  const server = await startServer();
  const restore = quiet();
  try {
    const res = await request(server, 'POST', '/api/upload', {
      filename: 'item-sales-summary-2026-10-12-2026-10-12.csv',
      csv: csv('Adobo,Rice Meals,2,240,0,0,240'),
    });
    await settle();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(fake.tables.uploads.find((u) => u.id === res.body.uploadId).status, 'processed');
    assert.equal(fake.tables.daily_sales.filter((r) => r.upload_id === res.body.uploadId).length, 1);
    assert.equal(
      fake.writesTo('uploads').filter((write) => ['insert', 'upsert'].includes(write.op)).length,
      1,
      'valid upload record was saved'
    );
  } finally {
    restore();
    server.close();
  }
});

// ---------------------------------------------------------------- A8 (migration 020)

test('A8: not enough stock -> 422, nothing saved, upload failed, one "Unmet condition" notice (no generic one)', async () => {
  const seedData = seedProducts();
  seedData.ingredients = [{
    id: 40, name: 'Rice', unit: 'Kilograms (kg)', quantity: 1, created_at: '2026-01-01T00:00:00Z',
    base_unit: 'kg', unit_family: 'mass', stock_scale: 3, allow_fractional: true,
  }];
  seedData.product_ingredients = [{
    product_id: 1, ingredient_id: 40, quantity_per_serving: 0.2, unit: 'Kilograms (kg)',
    ingredients: {
      name: 'Rice', unit: 'Kilograms (kg)', grams_per_cup: null, created_at: '2026-01-01T00:00:00Z',
      base_unit: 'kg', unit_family: 'mass', stock_scale: 3, allow_fractional: true,
    },
  }];
  seedData.inventory_transactions = [];
  seedData.notifications = [];
  fake.reset(seedData);

  const server = await startServer();
  const restore = quiet();
  try {
    // 5 sold - 1 refunded = 4 plates x 0.2 kg = 0.8 kg: fits in 1 kg.
    // 10 plates x 0.2 kg = 2 kg: does not.
    const res = await request(server, 'POST', '/api/upload', {
      filename: 'item-sales-summary-2026-10-12-2026-10-12.csv',
      csv: csv('Adobo,Rice Meals,10,1200,0,0,1200'),
    });
    await settle();
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.insufficientStock, true);
    assert.equal(res.body.error, 'Not enough stock');
    assert.deepEqual(res.body.shortfalls, [{
      ingredientId: 40, name: 'Rice', unit: 'Kilograms (kg)', required: '2', available: '1', shortfall: '1',
    }]);
    assert.match(res.body.message, /was not saved/);

    assert.equal(fake.tables.daily_sales.filter((r) => r.upload_id === res.body.uploadId).length, 0, 'no sales saved');
    assert.equal(fake.tables.ingredients[0].quantity, 1, 'stock untouched');
    const uploadRow = fake.tables.uploads.find((u) => u.id === res.body.uploadId);
    assert.equal(uploadRow.status, 'failed', 'a failed row never blocks re-uploading the same file later');
    assert.equal((fake.tables.business_days || []).length, 0, 'the day is NOT confirmed open');

    const notes = fake.tables.notifications;
    assert.equal(notes.length, 1, JSON.stringify(notes.map((n) => n.title)));
    assert.equal(notes[0].title, 'Unmet condition: not enough stock (1 ingredient)');
    assert.equal(notes[0].type, 'error');
    assert.equal(notes[0].link, '/ingredient-management');
    assert.equal(notes[0].metadata.kind, 'upload_blocked_stock');
    assert.equal(notes[0].metadata.key, `upload_blocked_stock:${res.body.uploadId}`);
    assert.match(notes[0].message, /Rice: needs 2 kg, 1 kg in stock \(1 kg short\)\./);
  } finally {
    restore();
    server.close();
  }
});

// ---------------------------------------------------------------- A7

test('A7: DELETE /api/upload/:id returns 403 and deletes nothing', async () => {
  fake.reset(seedProducts());
  const server = await startServer();
  try {
    const res = await request(server, 'DELETE', '/api/upload/1');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Deleting uploads is turned off. It would not restore ingredient stock.');
    assert.equal(fake.tables.uploads.length, 1);
    assert.equal(fake.tables.daily_sales.length, 3);
    assert.equal(fake.writes.filter((w) => w.op === 'delete').length, 0);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------- A5

async function editIngredient(body) {
  const req = { params: { id: 9 }, body, user: { id: OWNER_ID, name: 'Test Owner' } };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(p) { this.payload = p; return this; },
  };
  const restore = quiet();
  await inventoryController.updateInventoryItem(req, res);
  restore();
  await settle();
  return res;
}

const adjustments = () => (fake.tables.inventory_transactions || []).filter((t) => t.transaction_type === 'adjustment');

test('A5: a stock edit logs an adjustment only when the quantity was really written and changed', async () => {
  const seedIngredient = () => ({ ingredients: [{ id: 9, name: 'Egg', unit: 'pcs', quantity: 10, price: 8, min_stock: 0, is_archived: false }] });

  fake.reset(seedIngredient());
  let res = await editIngredient({ quantity: 10, price: 9 });
  assert.equal(res.statusCode, 200);
  assert.equal(adjustments().length, 0, 'same quantity -> no adjustment');

  for (const bad of [-5, 'abc', null]) {
    fake.reset(seedIngredient());
    res = await editIngredient({ quantity: bad });
    assert.equal(fake.tables.ingredients[0].quantity, 10, `quantity ${bad} is not saved`);
    assert.equal(adjustments().length, 0, `quantity ${bad} -> no adjustment`);
  }

  fake.reset(seedIngredient());
  res = await editIngredient({ quantity: 12 });
  // The stock is stored as a decimal string, so it can be written to a
  // Postgres numeric without ever passing through a binary float.
  assert.equal(fake.tables.ingredients[0].quantity, '12');
  const rows = adjustments();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, '2');
  assert.equal(rows[0].previous_quantity, '10');
  assert.equal(rows[0].new_quantity, '12');
});
