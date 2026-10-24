// tests/stockDeduction.test.js — run: node --test tests/stockDeduction.test.js
//
// Ingredient stock deduction on a sales upload (owner's v3 flowchart, page 2):
//   C1  last stock count = the newest 'adjustment' transaction
//       ('restock' is a delivery, never a count; created_at is NOT a count)
//   C2  a day's plates deduct only if the day ended (D+1 03:00 Manila) after
//       that count — shouldDeduct()
//   C3  every non-archived product in the file with a recipe deducts,
//       whatever its status
//   C4  not enough of ANY ingredient -> the whole file is refused: no sales
//       rows, no deductions (migration 020, Oct 2026)
//   H1  units are resolved strictly: no 1:1 fallback; an unconvertible
//       recipe unit refuses the whole file (Oct 24 2026)
//   H2  quantities are exact decimals, rounded ONCE at the end
//   H3  the deduction is atomic and idempotent per (upload, ingredient)
// In-memory fake database; no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');
const {
  shouldDeduct, businessDayEnd, lastStockCountAt, describeShortfall, unitLabel, formatAmount,
  computeStockDeductionsByDate, roundQuantity, Decimal,
} = require('../utils/salesModifiers');
const { unitService, UnitConversionError, parseRecipeQuantityDecimal } = require('../utils/recipeUnits');
const fileProcessor = require('../services/fileProcessor');

process.env.LOG_LEVEL = 'error';

// The fake deduct_ingredient_stock mirrors the SQL in
// migrations/013_inventory_stock_hardening.sql: clamp, write the stock and
// write the log in one go, and never deduct twice for the same
// (reference_type, reference_id, ingredient_id).
let nextTransactionId = 1000;
const fake = createFakeSupabase({}, {
  rpc: {
    deduct_ingredient_stock: (args, tables) => {
      const {
        p_ingredient_id: id,
        p_deduction: amount,
        p_reference_type: referenceType,
        p_reference_id: referenceId,
        p_updated_by: updatedBy,
        p_notes: notes,
        p_requested_exact: requestedExact,
      } = args;
      const row = (tables.ingredients || []).find((i) => i.id === id);
      if (!row) return { data: [], error: null };

      // Already applied? Report the original result, change nothing.
      const existing = (tables.inventory_transactions || []).find((t) => (
        t.transaction_type === 'sale'
        && String(t.reference_type) === String(referenceType)
        && String(t.reference_id) === String(referenceId)
        && t.ingredient_id === id
      ));
      if (existing) {
        return {
          data: [{
            previous_quantity: existing.previous_quantity,
            new_quantity: existing.new_quantity,
            requested_quantity: existing.requested_quantity,
            requested_exact_quantity: existing.requested_exact_quantity,
            rounded_quantity: existing.requested_quantity,
            applied_quantity: existing.applied_quantity,
            shortfall_quantity: existing.shortfall_quantity,
            already_applied: true,
          }],
          error: null,
        };
      }

      const previous = new Decimal(row.quantity == null ? 0 : row.quantity);
      const requested = new Decimal(String(amount));
      const available = previous.gt(0) ? previous : new Decimal(0);
      const applied = Decimal.min(requested, available);
      const next = Decimal.max(0, previous.minus(applied));
      const shortfall = Decimal.max(0, requested.minus(available));

      row.quantity = next.toString();

      const tx = {
        id: nextTransactionId++,
        ingredient_id: id,
        transaction_type: 'sale',
        quantity: applied.neg().toString(),
        previous_quantity: previous.toString(),
        new_quantity: next.toString(),
        requested_quantity: requested.toString(),
        requested_exact_quantity: requestedExact == null ? null : String(requestedExact),
        applied_quantity: applied.toString(),
        shortfall_quantity: shortfall.toString(),
        unit: row.unit || null,
        reference_type: referenceType,
        reference_id: referenceId,
        reason: 'Automatic deduction from mapped product sales',
        notes: [
          notes,
          `Exact requested: ${requestedExact == null ? requested.toString() : requestedExact}; `
            + `rounded request: ${requested.toString()}; applied: ${applied.toString()}; `
            + `shortfall: ${shortfall.toString()} ${row.unit || ''}.`,
        ].filter(Boolean).join(' '),
        created_by: updatedBy,
      };
      if (!tables.inventory_transactions) tables.inventory_transactions = [];
      tables.inventory_transactions.push(tx);

      return {
        data: [{
          previous_quantity: previous.toString(),
          new_quantity: next.toString(),
          requested_quantity: requested.toString(),
          requested_exact_quantity: tx.requested_exact_quantity,
          rounded_quantity: requested.toString(),
          applied_quantity: applied.toString(),
          shortfall_quantity: shortfall.toString(),
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

test('C1/U7: lastStockCountAt uses the newest adjustment only; created_at is not a count', () => {
  assert.equal(lastStockCountAt({ latestAdjustmentAt: '2026-10-05T00:00:00Z' }).toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(lastStockCountAt({}), null, 'no adjustment -> no known count');
  // U7: the ingredient's own created_at is NOT part of the maximum.
  assert.equal(
    lastStockCountAt({ createdAt: '2026-10-09T00:00:00Z', latestAdjustmentAt: '2026-10-05T00:00:00Z' }).toISOString(),
    '2026-10-05T00:00:00.000Z',
    'created_at must not push the count forward'
  );
  assert.equal(lastStockCountAt({ createdAt: '2026-10-01T00:00:00Z' }), null, 'created_at alone is not a count');
});

// ---------------------------------------------------------------- C4 pure

test('shortfall message, notes and title (unit from the ingredient, up to 3 decimals)', () => {
  const rice = describeShortfall({ ingredientName: 'Rice', unit: 'Kilograms (kg)', requested: 9.07, inStock: 0 });
  assert.equal(rice.title, 'Stock shortfall: Rice', 'same title as the notification, not "Low stock"');
  assert.equal(
    rice.message,
    'Rice: 9.07 kg requested, but no stock was available. None of this usage could be deducted; record the usage and restock.'
  );
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
  const entry = byDate.get(100);
  assert.deepEqual(
    [...entry.byDate].map(([day, amount]) => [day, amount.toString()]),
    [['2026-10-09', '4'], ['2026-10-10', '6']],
    'the amounts are exact Decimals'
  );
  assert.equal(entry.exact.toString(), '10');
});

// ---------------------------------------------------------------- H1 units

test('H1: units are resolved exactly, and an unresolvable unit throws instead of guessing', () => {
  const rice = { id: 1, name: 'Rice', unit: 'Kilograms (kg)', base_unit: 'kg', unit_family: 'mass', material_type: 'dry' };
  assert.equal(unitService.resolve('0.5', 'kg', rice).baseAmount.toString(), '0.5', 'same unit, unchanged');
  assert.equal(unitService.resolve('500', 'g', rice).baseAmount.toString(), '0.5', 'g -> kg is exact');
  assert.equal(unitService.resolve('1', 'kg', rice).baseAmount.toString(), '1');

  const water = { id: 2, name: 'Water', unit: 'Liters (L)', base_unit: 'l', unit_family: 'volume', material_type: 'wet' };
  assert.equal(unitService.resolve('500', 'mL', water).baseAmount.toString(), '0.5', 'mL -> L is exact');
  assert.equal(unitService.resolve('1', 'tsp', water).baseAmount.toString(), '0.005', 'tsp -> L is exact');
  assert.throws(() => unitService.resolve('1', 'cup', water), UnitConversionError, 'Cups are unsupported');
  assert.throws(() => unitService.resolve('100', 'mL', { ...rice, base_unit: 'g' }), UnitConversionError, 'mass and volume are not interchangeable');

  // An unknown unit is an error too.
  assert.throws(
    () => unitService.resolve('1', 'handful', rice),
    (error) => error instanceof UnitConversionError
  );

  const eggs = { id: 4, name: 'Egg', unit: 'Pieces (pcs)', base_unit: 'pcs', unit_family: 'count' };
  assert.throws(
    () => unitService.resolve('1', 'pack', eggs),
    (error) => error instanceof UnitConversionError,
    'unsupported units cannot be converted'
  );
});

test('H1: fractions are exact, never binary floats', () => {
  assert.equal(parseRecipeQuantityDecimal('1/3').toString(), '0.3333333333333333333333333333333333333333');
  assert.equal(parseRecipeQuantityDecimal('1 1/2').toString(), '1.5');
  assert.equal(parseRecipeQuantityDecimal('0.1').plus('0.2').toString(), '0.3', '0.1 + 0.2 is exactly 0.3');
  assert.equal(new Decimal('0.1').plus('0.2').toString(), '0.3');
});

test('H1: one unconvertible recipe prevents partial deduction and is returned for warning', () => {
  const deductions = computeStockDeductionsByDate({
    dailySalesRows: [{ product_id: 1, sale_date: '2026-10-10', quantity_sold: '2' }],
    recipeRows: [{ product_id: 1, ingredient_id: 21, unit: 'handful' }],
    deductingProductIds: new Set([1]),
    perServingFor: () => { throw new UnitConversionError('Cannot resolve handful'); },
  });
  assert.equal(deductions.get(21).unconvertible, true);
  assert.equal(deductions.get(21).exact.toString(), '0');
  assert.equal(deductions.unconvertible[0].ingredient_id, 21);
});

// ---------------------------------------------------------------- H2 rounding

test('H2: the rounding happens once, at the end', () => {
  // A discrete unit cannot be split: 1.5 eggs means 2 eggs.
  assert.equal(roundQuantity(new Decimal('1.5'), { unit_family: 'count', allow_fractional: false }).toString(), '2');
  // A fractionable count is rounded half-up.
  assert.equal(roundQuantity(new Decimal('1.5'), { unit_family: 'count', allow_fractional: true, stock_scale: 2 }).toString(), '1.5');
  // Mass is rounded half-up to stock_scale.
  assert.equal(roundQuantity(new Decimal('1.0005'), { unit_family: 'mass', stock_scale: 3 }).toString(), '1.001');
  assert.equal(roundQuantity(new Decimal('1.23456'), { unit_family: 'mass', stock_scale: 3 }).toString(), '1.235');
  assert.equal(roundQuantity(new Decimal('0'), { unit_family: 'mass' }).toString(), '0', 'nothing to deduct');
});

test('H2: different recipe units and products sum exactly before rounding once', () => {
  const deductions = computeStockDeductionsByDate({
    dailySalesRows: [
      { product_id: 1, sale_date: '2026-10-10', quantity_sold: '1' },
      { product_id: 2, sale_date: '2026-10-10', quantity_sold: '1' },
    ],
    recipeRows: [
      { product_id: 1, ingredient_id: 20, unit: 'kg' },
      { product_id: 2, ingredient_id: 20, unit: 'g' },
    ],
    deductingProductIds: new Set([1, 2]),
    perServingFor: (recipe) => unitService.resolve(
      recipe.product_id === 1 ? '0.0004' : '0.4',
      recipe.unit,
      { id: 20, name: 'Rice', unit: 'kg', base_unit: 'kg', unit_family: 'mass' }
    ).baseAmount,
  });
  const entry = deductions.get(20);
  assert.equal(entry.exact.toString(), '0.0008');
  assert.equal(roundQuantity(entry.exact, { unit_family: 'mass', stock_scale: 3 }).toString(), '0.001');
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
  ingredients: {
    name: ing.name,
    unit: ing.unit,
    created_at: ing.created_at,
    base_unit: ing.base_unit,
    unit_family: ing.unit_family,
    stock_scale: ing.stock_scale,
    allow_fractional: ing.allow_fractional,
  },
});

function seed({ ingredientCreatedAt = '2026-01-01T00:00:00Z' } = {}) {
  const ing = {
    [RICE]: {
      id: RICE, name: 'Rice', unit: 'Kilograms (kg)', quantity: 10, created_at: ingredientCreatedAt,
      base_unit: 'kg', unit_family: 'mass', stock_scale: 3, allow_fractional: true,
    },
    [EGG]: {
      id: EGG, name: 'Egg', unit: 'Pieces (pcs)', quantity: 2, created_at: ingredientCreatedAt,
      base_unit: 'pcs', unit_family: 'count', stock_scale: 3, allow_fractional: false,
    },
    [CHEESE]: {
      id: CHEESE, name: 'Cheese', unit: 'Kilograms (kg)', quantity: 5, created_at: ingredientCreatedAt,
      base_unit: 'kg', unit_family: 'mass', stock_scale: 3, allow_fractional: true,
    },
    [PORK]: {
      id: PORK, name: 'Pork', unit: 'Kilograms (kg)', quantity: 8, created_at: ingredientCreatedAt,
      base_unit: 'kg', unit_family: 'mass', stock_scale: 3, allow_fractional: true,
    },
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

const stock = (id) => new Decimal(fake.tables.ingredients.find((i) => i.id === id).quantity);
const sales = (id) => fake.tables.inventory_transactions.filter((t) => t.ingredient_id === id && t.transaction_type === 'sale');

test('C3: no-recipe product skipped while others deduct; archived skipped; New and Discontinued deduct', async () => {
  seed();
  const result = await upload(
    [['Adobo', 10], ['No Recipe Dish', 7], ['Spork', 4], ['Old Dish', 1], ['Brand New Dish', 2]],
    50, 'item-sales-summary-2026-10-10-2026-10-10.csv'
  );
  assert.equal(stock(RICE).toString(), '8', 'Adobo deducted 10 x 0.2 kg rice');
  assert.equal(stock(CHEESE).toString(), '5', 'archived Spork deducted nothing');
  assert.equal(sales(CHEESE).length, 0);
  assert.equal(stock(EGG).toString(), '1', 'Old Dish (was Discontinued) deducted 1 egg');
  assert.equal(stock(PORK).toString(), '7', 'Brand New Dish (New) deducted 2 x 0.5 kg pork');
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
  assert.equal(stock(EGG).toString(), '1', 'and its egg was still deducted');
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
  assert.equal(stock(RICE).toString(), '10', 'rice not deducted: the count already includes Saturday');
  assert.equal(sales(RICE).length, 0, 'no sale transaction for a fully skipped ingredient');
  assert.equal(stock(PORK).toString(), '7', 'pork still deducted after a restock');
  assert.ok(
    result.warnings.some((w) => /not deducted for 1 ingredient\(s\).*Rice/.test(w)),
    JSON.stringify(result.warnings)
  );
  // The upload screen only shows uploadSummary, so the skip must be there too.
  const skipped = result.uploadSummary.stockNotDeducted;
  assert.equal(skipped.length, 1, JSON.stringify(skipped));
  assert.equal(skipped[0].ingredientId, RICE);
  assert.equal(skipped[0].reason, 'counted_after');
  assert.deepEqual(skipped[0].days, ['2026-10-10']);
  assert.match(skipped[0].message, /Rice: sales on 2026-10-10 were not deducted/);
});

test('C1/U7: an ingredient created after the day ended is NOT a stock count', async () => {
  seed({ ingredientCreatedAt: '2026-10-11T05:00:00+08:00' });
  await upload([['Adobo', 10]], 53, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(stock(RICE).toString(), '8', 'created_at is not a count, so the plates still deduct');
});

// ---------------------------------------------------------------- C4 (Oct 2026): not enough stock -> nothing saved
//
// The owner's rule since Oct 2026 (migration 020): a sales file that needs
// more of ANY ingredient than is in stock is not saved at all. No
// daily_sales rows, no deductions, no partial "floor at 0". This replaced
// the old C4 (deduct what is there, record the shortfall, keep the sales).

const { InsufficientStockError } = require('../utils/insufficientStock');

const salesOfUpload = (uploadId) => fake.tables.daily_sales.filter((r) => r.upload_id === uploadId);

async function uploadExpectingRefusal(file, uploadId, filename) {
  const restore = quiet();
  try {
    await uploadService.processSalesData(rows(...file), OWNER, uploadId, filename);
  } catch (error) {
    return error;
  } finally {
    restore();
  }
  assert.fail('the upload should have been refused');
  return null;
}

test('C4: one short ingredient -> the whole file is refused; nothing is saved or deducted', async () => {
  seed();
  // Old Dish uses 1 egg per plate: 5 plates against 2 eggs. Adobo's rice
  // (10 x 0.2 = 2 kg of 10 kg) is fine on its own, but must NOT be deducted.
  const error = await uploadExpectingRefusal([['Old Dish', 5], ['Adobo', 10]], 54, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.ok(error instanceof InsufficientStockError, String(error));
  assert.equal(error.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(error.shortfalls, [{
    ingredientId: EGG, name: 'Egg', unit: 'Pieces (pcs)', required: '5', available: '2', shortfall: '3',
  }]);
  assert.match(error.message, /Not enough stock for 1 ingredient\(s\): Egg/);

  assert.equal(salesOfUpload(54).length, 0, 'no daily_sales rows were saved');
  assert.equal(stock(EGG).toString(), '2', 'egg untouched');
  assert.equal(stock(RICE).toString(), '10', 'rice untouched too: all or nothing');
  assert.equal(fake.tables.inventory_transactions.length, 0, 'no stock movement logged');
  assert.equal(fake.tables.notifications.length, 0, 'the route sends the notice, not the service');
  assert.equal(fake.rpcCalls.filter((c) => c.name === 'apply_sales_upload').length, 0,
    'the read-only pre-check refused it before any write was attempted');
});

test('C4: exactly enough stock is enough (the check is "more than in stock", not "all of it")', async () => {
  seed();
  await upload([['Old Dish', 2]], 56, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(stock(EGG).toString(), '0');
  assert.equal(salesOfUpload(56).length, 1);
  assert.equal(new Decimal(sales(EGG)[0].shortfall_quantity).toString(), '0');
});

test('C4: the locked re-check refuses even when the pre-check passed (two uploads racing)', async () => {
  seed();
  // Simulate the race: the pre-check ran while there were still eggs, then
  // another upload took them before this one's transaction started.
  const original = uploadService.findInsufficientStock;
  uploadService.findInsufficientStock = async () => [];
  try {
    const error = await uploadExpectingRefusal([['Old Dish', 5]], 57, 'item-sales-summary-2026-10-10-2026-10-10.csv');
    assert.ok(error instanceof InsufficientStockError, String(error));
    assert.equal(error.shortfalls[0].ingredientId, EGG);
    assert.equal(error.shortfalls[0].shortfall, '3');
  } finally {
    uploadService.findInsufficientStock = original;
  }
  assert.equal(fake.rpcCalls.filter((c) => c.name === 'apply_sales_upload').length, 1);
  assert.equal(salesOfUpload(57).length, 0);
  assert.equal(stock(EGG).toString(), '2');
});

test('real sales CSV with zero stock is refused with the exact amount needed', async () => {
  seed();
  const rice = fake.tables.ingredients.find((ingredient) => ingredient.id === RICE);
  rice.quantity = '0';
  fake.tables.products = [{
    id: 1,
    name: 'Plain Rice',
    price: 17,
    category: 'Rice',
    status: 'active',
    is_active: true,
    first_sold_date: OLD,
    created_at: OLD,
    inactive_reason: null,
    inactive_since: null,
  }];
  fake.tables.product_ingredients = [recipe(1, RICE, '0.125', rice)];

  const filename = 'item-sales-summary-2026-07-06-2026-07-06.csv';
  const csvPath = path.join(__dirname, filename);
  const parsedRows = await fileProcessor.processCSV(fs.readFileSync(csvPath));
  const plainRiceRow = parsedRows.find((row) => row['Item name'] === 'Plain Rice');
  assert.ok(plainRiceRow, 'test exercises the provided sales CSV');
  assert.equal(plainRiceRow['Items sold'], '12.000');

  const restore = quiet();
  let error = null;
  try {
    await uploadService.processSalesData([plainRiceRow], OWNER, 55, filename);
  } catch (e) {
    error = e;
  } finally {
    restore();
  }

  assert.ok(error instanceof InsufficientStockError, String(error));
  assert.deepEqual(error.shortfalls, [{
    ingredientId: RICE, name: 'Rice', unit: 'Kilograms (kg)', required: '1.5', available: '0', shortfall: '1.5',
  }], '12 sold x 0.125 kg per serving');
  assert.ok(stock(RICE).isZero());
  assert.equal(sales(RICE).length, 0);
  assert.equal(salesOfUpload(55).length, 0);
});

test('H3: the same file retried is refused as a duplicate and deducts nothing more', async () => {
  seed();
  await upload([['Adobo', 10]], 60, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(stock(RICE).toString(), '8', 'first pass deducted 2 kg');
  // A new request is a new upload row; its daily_sales hit the unique key.
  const error = await uploadExpectingRefusal([['Adobo', 10]], 61, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(error.code, '23505', String(error && error.message));
  assert.equal(stock(RICE).toString(), '8', 'the retry changed nothing: the insert and deduction roll back together');
  assert.equal(sales(RICE).length, 1, 'and it did not write a second transaction');
});

test('migration 020 not run (no apply_sales_upload): the upload is refused, nothing saved, no old fallback', async () => {
  seed();
  fake.reset({ ...JSON.parse(JSON.stringify(fake.tables)) }, { missingFunctions: ['apply_sales_upload'] });
  const error = await uploadExpectingRefusal([['Adobo', 10]], 62, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  assert.equal(error.code, 'STOCK_GUARD_MISSING');
  assert.match(error.message, /020_sales_upload_requires_stock\.sql/);
  assert.equal(salesOfUpload(62).length, 0, 'no sales saved');
  assert.equal(stock(RICE).toString(), '10', 'no stock deducted');
  assert.equal(fake.rpcCalls.filter((c) => c.name === 'deduct_ingredient_stock').length, 0,
    'the old per-ingredient deduction is never called directly');
});

test('H3: a fractional discrete unit is requested exactly and applied whole', async () => {
  seed();
  // 0.5 egg per plate, 3 plates: exactly 1.5 eggs requested, 2 applied.
  fake.tables.product_ingredients = [
    recipe(1, EGG, 0.5, fake.tables.ingredients.find((i) => i.id === EGG)),
  ];
  fake.tables.ingredients.find((i) => i.id === EGG).quantity = '5';
  await upload([['Adobo', 3]], 64, 'item-sales-summary-2026-10-10-2026-10-10.csv');
  const tx = sales(EGG)[0];
  assert.equal(new Decimal(tx.requested_exact_quantity).toString(), '1.5', 'the exact amount is recorded');
  assert.equal(new Decimal(tx.requested_quantity).toString(), '2', 'the request is rounded up to a whole egg');
  assert.equal(new Decimal(tx.applied_quantity).toString(), '2');
  assert.equal(stock(EGG).toString(), '3');
});

test('H1: an unconvertible recipe unit refuses the whole file; nothing saved or deducted', async () => {
  seed();
  fake.tables.product_ingredients[0].unit = 'handful';
  const error = await uploadExpectingRefusal([['Adobo', 2]], 65, 'item-sales-summary-2026-10-10-2026-10-10.csv');

  assert.equal(error.code, 'RECIPE_UNIT_UNCONVERTIBLE', String(error));
  assert.deepEqual(error.items.map((item) => [item.ingredientId, item.ingredient]), [[RICE, 'Rice']]);
  assert.ok(error.items[0].reasons.length > 0, 'the reason is kept for the owner');
  assert.match(error.message, /was not saved/);
  assert.ok(stock(RICE).eq('10'));
  assert.equal(sales(RICE).length, 0);
  assert.equal(salesOfUpload(65).length, 0, 'no daily_sales rows');
  assert.equal(fake.rpcCalls.filter((c) => c.name === 'apply_sales_upload').length, 0);
});
