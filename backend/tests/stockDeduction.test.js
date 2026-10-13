// tests/stockDeduction.test.js — run: node --test tests/stockDeduction.test.js
//
// Ingredient stock deduction on a sales upload (owner's v3 flowchart, page 2):
//   C1  last stock count = newest of the latest 'adjustment' and created_at
//       ('restock' is a delivery, never a count)
//   C2  a day's plates deduct only if the day ended (D+1 03:00 Manila) after
//       that count — shouldDeduct()
//   C3  every non-archived product in the file with a recipe deducts,
//       whatever its status
//   C4  shortfall: stock floors at 0, notes on the transaction, one warning
//       per ingredient per upload, and an upload warning
// In-memory fake database; no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');
const {
  shouldDeduct, businessDayEnd, lastStockCountAt, describeShortfall, unitLabel, formatAmount,
  computeStockDeductionsByDate,
} = require('../utils/salesModifiers');

process.env.LOG_LEVEL = 'error';

// Same rule as public.deduct_ingredient_stock: GREATEST(0, quantity - p_deduction).
const fake = createFakeSupabase({}, {
  rpc: {
    deduct_ingredient_stock: ({ p_ingredient_id: id, p_deduction: amount }, tables) => {
      const row = (tables.ingredients || []).find((i) => i.id === id);
      if (!row) return { data: [], error: null };
      const previous = Number(row.quantity) || 0;
      row.quantity = Math.max(0, previous - Number(amount));
      return { data: [{ previous_quantity: previous, new_quantity: row.quantity }], error: null };
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
restoreLoad();

// ---------------------------------------------------------------- C2 pure

test('shouldDeduct: count before the day ended -> deduct; after -> skip; exactly 03:00 -> skip', () => {
  // Sale date Sat 2026-10-10; that business day ends Sun 2026-10-11 03:00 Manila.
  assert.equal(shouldDeduct('2026-10-10', '2026-10-11T02:59:59+08:00'), true);
  assert.equal(shouldDeduct('2026-10-10', '2026-10-10T15:00:00+08:00'), true, 'counted when the store opened');
  assert.equal(shouldDeduct('2026-10-10', '2026-10-11T03:00:01+08:00'), false);
  assert.equal(shouldDeduct('2026-10-10', '2026-10-11T03:00:00+08:00'), false, 'exactly at 03:00 -> skip');
  assert.equal(shouldDeduct('2026-10-10', '2026-10-10T19:00:00Z'), false, 'same instant written in UTC');
  assert.equal(shouldDeduct('2026-10-10', '2026-10-10T18:59:59.999Z'), true);
  assert.equal(shouldDeduct('2026-10-10', null), true, 'no count known -> deduct');
  // A filename date arrives as an ISO timestamp; only the date part counts.
  assert.equal(shouldDeduct('2026-10-10T00:00:00.000Z', '2026-10-11T03:00:00+08:00'), false);
});

test('businessDayEnd crosses month and year ends', () => {
  assert.equal(businessDayEnd('2026-10-31').toISOString(), '2026-10-31T19:00:00.000Z'); // Nov 1, 03:00 Manila
  assert.equal(businessDayEnd('2026-12-31').toISOString(), '2026-12-31T19:00:00.000Z'); // Jan 1, 03:00 Manila
  assert.equal(businessDayEnd('2028-02-28').toISOString(), '2028-02-28T19:00:00.000Z'); // leap year: Feb 29
});

test('lastStockCountAt: the newer of the latest adjustment and created_at', () => {
  assert.equal(lastStockCountAt({ createdAt: '2026-10-01T00:00:00Z', latestAdjustmentAt: '2026-10-05T00:00:00Z' }).toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(lastStockCountAt({ createdAt: '2026-10-09T00:00:00Z', latestAdjustmentAt: '2026-10-05T00:00:00Z' }).toISOString(), '2026-10-09T00:00:00.000Z');
  assert.equal(lastStockCountAt({ createdAt: '2026-10-01T00:00:00Z' }).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(lastStockCountAt({}), null);
});

// ---------------------------------------------------------------- C4 pure

test('shortfall message, notes and title (unit from the ingredient, up to 3 decimals)', () => {
  const rice = describeShortfall({ ingredientName: 'Rice', unit: 'Kilograms (kg)', requested: 9.07, inStock: 0 });
  assert.equal(rice.title, 'Low stock: Rice');
  assert.equal(rice.message, 'Rice: 9.07 kg used but 0 kg in stock. Please monitor it.');
  assert.equal(rice.notes, 'Requested 9.07 kg, only 0 kg in stock. Shortfall 9.07 kg.');
  assert.equal(rice.shortfall, 9.07);

  const egg = describeShortfall({ ingredientName: 'Egg', unit: 'Pieces (pcs)', requested: 1.23456, inStock: 0.5 });
  assert.equal(egg.notes, 'Requested 1.235 pcs, only 0.5 pcs in stock. Shortfall 0.735 pcs.');
  assert.ok(Math.abs(egg.shortfall - 0.73456) < 1e-12, 'full value kept, not rounded');

  assert.equal(describeShortfall({ ingredientName: 'Rice', unit: 'kg', requested: 3, inStock: 5 }), null, 'enough stock -> no shortfall');
  assert.equal(describeShortfall({ ingredientName: 'Rice', unit: 'kg', requested: 5, inStock: 5 }), null, 'exactly enough -> none');
  assert.equal(unitLabel('Liters (L)'), 'L');
  assert.equal(unitLabel('g'), 'g');
  assert.equal(formatAmount(2), '2');
});

test('per-day amounts: a product outside the deducting set adds nothing', () => {
  const byDate = computeStockDeductionsByDate({
    dailySalesRows: [
      { product_id: 1, sale_date: '2026-10-09', quantity_sold: 2 },
      { product_id: 1, sale_date: '2026-10-10', quantity_sold: 3 },
      { product_id: 9, sale_date: '2026-10-10', quantity_sold: 50 },
    ],
    recipeRows: [{ product_id: 1, ingredient_id: 100 }, { product_id: 9, ingredient_id: 100 }],
    deductingProductIds: new Set([1]),
    perServingFor: () => 2,
  });
  assert.deepEqual([...byDate.get(100)], [['2026-10-09', 4], ['2026-10-10', 6]]);
});

// ---------------------------------------------------------------- C3 + C1 + C4 through processSalesData

const OWNER = 7;
const OLD = '2025-07-10';
const RICE = 100;
const EGG = 101;
const CHEESE = 102;
const PORK = 103;

const recipe = (product_id, ingredient_id, qty, ing) => ({
  product_id, ingredient_id, quantity_per_serving: qty, unit: ing.unit,
  // The fake has no joins: the nested ingredient travels on the row.
  ingredients: { name: ing.name, unit: ing.unit, grams_per_cup: null, created_at: ing.created_at },
});

function seed({ ingredientCreatedAt = '2026-01-01T00:00:00Z' } = {}) {
  const ing = {
    [RICE]: { id: RICE, name: 'Rice', unit: 'Kilograms (kg)', quantity: 10, created_at: ingredientCreatedAt },
    [EGG]: { id: EGG, name: 'Egg', unit: 'Pieces (pcs)', quantity: 2, created_at: ingredientCreatedAt },
    [CHEESE]: { id: CHEESE, name: 'Cheese', unit: 'Kilograms (kg)', quantity: 5, created_at: ingredientCreatedAt },
    [PORK]: { id: PORK, name: 'Pork', unit: 'Kilograms (kg)', quantity: 8, created_at: ingredientCreatedAt },
  };
  const product = (id, name, status, firstSold, reason = null) => ({
    id, name, price: 100, category: 'Rice Meals', status, is_active: status === 'active',
    first_sold_date: firstSold, created_at: OLD, inactive_reason: reason, inactive_since: null,
  });
  fake.reset({
    user: [{ id: OWNER }],
    products: [
      product(1, 'Adobo', 'active', OLD),
      product(2, 'No Recipe Dish', 'active', OLD),
      product(3, 'Spork', 'archived', OLD, 'Archived by user'),
      product(4, 'Old Dish', 'inactive_discontinued', OLD),
      product(5, 'Brand New Dish', 'inactive_new', null),
    ],
    daily_sales: [
      { id: 1, product_id: 1, sale_date: OLD, quantity_sold: 1, upload_id: 1 },
      { id: 2, product_id: 3, sale_date: OLD, quantity_sold: 1, upload_id: 1 },
      { id: 3, product_id: 4, sale_date: OLD, quantity_sold: 1, upload_id: 1 },
    ],
    ingredients: Object.values(ing),
    product_ingredients: [
      recipe(1, RICE, 0.2, ing[RICE]),     // Adobo: rice
      recipe(3, CHEESE, 1, ing[CHEESE]),   // Spork (archived): cheese
      recipe(4, EGG, 1, ing[EGG]),         // Old Dish (discontinued): egg
      recipe(5, PORK, 0.5, ing[PORK]),     // Brand New Dish: pork
    ],
    inventory_transactions: [],
    notifications: [],
    modifier_rules: [],
  });
}

const rows = (...items) => items.map(([name, sold]) => ({
  'Item name': name, Category: 'Rice Meals', 'Items sold': String(sold), 'Items refunded': '0',
}));

async function upload(file, uploadId, filename) {
  const restore = quiet();
  try {
    return await uploadService.processSalesData(rows(...file), OWNER, uploadId, filename);
  } finally {
    restore();
  }
}

const stock = (id) => fake.tables.ingredients.find((i) => i.id === id).quantity;
const sales = (id) => fake.tables.inventory_transactions.filter((t) => t.ingredient_id === id && t.transaction_type === 'sale');

test('C3: no-recipe product skipped while others deduct; archived skipped; New and Discontinued deduct', async () => {
  seed();
  const result = await upload(
    [['Adobo', 10], ['No Recipe Dish', 7], ['Spork', 4], ['Old Dish', 1], ['Brand New Dish', 2]],
    50, 'item-sales-summary-2026-10-10-2026-10-10.csv'
  );
  assert.ok(Math.abs(stock(RICE) - 8) < 1e-9, 'Adobo deducted 10 x 0.2 kg rice');
  assert.equal(stock(CHEESE), 5, 'archived Spork deducted nothing');
  assert.equal(sales(CHEESE).length, 0);
  assert.equal(stock(EGG), 1, 'Old Dish (was Discontinued) deducted 1 egg');
  assert.equal(stock(PORK), 7, 'Brand New Dish (New) deducted 2 x 0.5 kg pork');
  // The no-recipe dish was saved as sales, just with nothing to deduct.
  assert.ok(fake.tables.daily_sales.some((r) => r.product_id === 2 && r.upload_id === 50));
  assert.deepEqual(result.warnings, []);
});

test('C3: a product still Discontinued after this upload\'s refresh deducts (old-history upload)', async () => {
  seed({ ingredientCreatedAt: '2025-07-01T00:00:00Z' });
  // 30 confirmed-open days after 2025-08-01: more than 28 -> Discontinued.
  fake.tables.business_days = Array.from({ length: 30 }, (_, i) => ({
    business_date: new Date(Date.UTC(2025, 7, 2 + i)).toISOString().slice(0, 10), status: 'confirmed_open',
  }));
  await upload([['Old Dish', 1]], 51, 'item-sales-summary-2025-08-01-2025-08-01.csv');
  const product4 = fake.tables.products.find((p) => p.id === 4);
  assert.equal(product4.status, 'inactive_discontinued', 'its last sale is still months ago');
  assert.equal(stock(EGG), 1, 'and its egg was still deducted');
});

test('C1/C2: a stock count after the day ended skips that day; a restock is not a count', async () => {
  seed();
  // Rice counted (Edit) on Sun 2026-10-11 08:00 Manila -> Sat 10-10 already counted.
  fake.tables.inventory_transactions.push(
    { id: 1, ingredient_id: RICE, transaction_type: 'adjustment', quantity: 1, previous_quantity: 9, new_quantity: 10, created_at: '2026-10-11T00:00:00+00:00' },
    // Pork delivered (restock) after the day ended: NOT a count, still deducts.
    { id: 2, ingredient_id: PORK, transaction_type: 'restock', quantity: 3, previous_quantity: 5, new_quantity: 8, created_at: '2026-10-11T01:00:00+00:00' }
  );
  const result = await upload([['Adobo', 10], ['Brand New Dish', 2]], 52, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(stock(RICE), 10, 'rice not deducted: the count already includes Saturday');
  assert.equal(sales(RICE).length, 0, 'no sale transaction for a fully skipped ingredient');
  assert.equal(stock(PORK), 7, 'pork still deducted after a restock');
  assert.ok(
    result.warnings.some((w) => /not deducted for 1 ingredient\(s\).*Rice/.test(w)),
    JSON.stringify(result.warnings)
  );
});

test('C1/C2: an ingredient created after the day ended counts as a stock count', async () => {
  seed({ ingredientCreatedAt: '2026-10-11T05:00:00+08:00' });
  await upload([['Adobo', 10]], 53, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(stock(RICE), 10);
});

test('C4: shortfall floors stock at 0, writes notes, one warning per ingredient per upload', async () => {
  seed();
  // Old Dish uses 1 egg per plate; 5 plates against 2 eggs in stock.
  const result = await upload([['Old Dish', 5], ['Adobo', 10]], 54, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(stock(EGG), 0, 'never negative');
  const tx = sales(EGG)[0];
  assert.equal(tx.quantity, -5, 'full requested amount kept');
  assert.equal(tx.previous_quantity, 2);
  assert.equal(tx.new_quantity, 0);
  assert.equal(tx.notes, 'Requested 5 pcs, only 2 pcs in stock. Shortfall 3 pcs.');
  assert.equal(sales(RICE)[0].notes, null, 'enough rice -> no notes');

  assert.ok(result.warnings.includes('Egg: 5 pcs used but 2 pcs in stock. Please monitor it.'), JSON.stringify(result.warnings));

  const notes = fake.tables.notifications;
  assert.equal(notes.length, 1, 'one notification: egg only');
  assert.equal(notes[0].title, 'Stock shortfall: Egg', 'not "Low stock", which looks like the out-of-stock alert');
  assert.equal(notes[0].message, 'Egg: 5 pcs used but 2 pcs in stock. Please monitor it.');
  assert.equal(notes[0].type, 'warning');
  assert.equal(notes[0].link, '/ingredient-management');
  assert.deepEqual(notes[0].metadata, {
    kind: 'stock_shortfall', key: `stock_shortfall:54:${EGG}`, upload_id: 54, ingredient_id: EGG, shortfall: 3,
  });

  // The same upload's shortfall is never sent twice.
  const restore = quiet();
  await uploadService.notifyStockShortfalls([{ ingredientId: EGG, shortfall: 3, title: 't', message: 'm' }], 54);
  restore();
  assert.equal(fake.tables.notifications.length, 1);
});
