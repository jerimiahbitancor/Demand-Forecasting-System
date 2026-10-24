// tests/porksilogDeduction.test.js — run: node --test tests/porksilogDeduction.test.js
//
// GOLDEN EXAMPLE: the owner's "Ingredient Stock Deduction Calculation" sheet.
// If this test fails, stock deduction no longer matches the agreed formula:
//
//   Net Items Sold         = Items Sold - Items Refunded
//   Plates using X         = Net Items Sold - plates with a modifier that removes X
//   Ingredient Used (X)    = Plates using X * Quantity per Serving (converted to X's stock unit)
//   New Balance (X)        = Current Stock - Ingredient Used
//
//   17 plain + 2 NO RICE + 3 NO EGG = 22 Marinated Porksilog, 0 refunded
//   Pork 60 g/plate : 22 * 60 g          = 1.32 kg -> 50 - 1.32 = 48.68 kg
//   Egg  1 pc/plate : (22 - 3) * 1 pc    = 19 pcs  -> 50 - 19   = 31 pcs
//   Rice 120 g/plate: (22 - 2) * 120 g  = 2.4 kg  -> 100 - 2.4 = 97.6 kg

const test = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase({}, {
  rpc: {
    deduct_ingredient_stock: ({ p_ingredient_id: id, p_deduction: amount, p_reference_type, p_reference_id }, tables) => {
      const row = tables.ingredients.find((i) => i.id === id);
      const previous = new Decimal(String(row.quantity));
      const requested = new Decimal(String(amount));
      const applied = Decimal.min(previous, requested);
      row.quantity = previous.minus(applied).toString();
      tables.inventory_transactions.push({
        id: tables.inventory_transactions.length + 1, ingredient_id: id, transaction_type: 'sale',
        quantity: applied.negated().toString(), reference_type: p_reference_type, reference_id: p_reference_id,
      });
      return {
        data: [{
          previous_quantity: previous.toString(), new_quantity: row.quantity,
          applied_quantity: applied.toString(), shortfall_quantity: requested.minus(applied).toString(),
          already_applied: false,
        }],
        error: null,
      };
    },
  },
});
installFake(fake);
const uploadService = require('../services/uploadService');

const OWNER = 7;
const PORKSILOG = 1;
const PORK = 10;
const EGG = 11;
const RICE = 12;

const INGREDIENTS = {
  [PORK]: { id: PORK, name: 'Pork', unit: 'Kilograms (kg)', quantity: '50', price: 100,
    base_unit: 'kg', unit_family: 'mass', stock_scale: 3, allow_fractional: true },
  [EGG]: { id: EGG, name: 'Egg', unit: 'Pieces (pcs)', quantity: '50', price: 8.5,
    base_unit: 'pcs', unit_family: 'count', stock_scale: 3, allow_fractional: false },
  [RICE]: { id: RICE, name: 'Rice', unit: 'Kilograms (kg)', quantity: '100', price: 50,
    base_unit: 'kg', unit_family: 'mass', stock_scale: 3, allow_fractional: true,
    material_type: 'dry' },
};

const recipe = (ingredientId, qty, unit) => {
  const ing = INGREDIENTS[ingredientId];
  return {
    product_id: PORKSILOG, ingredient_id: ingredientId, quantity_per_serving: qty, unit,
    ingredients: { ...ing, created_at: '2026-01-01T00:00:00Z' },
  };
};

function seed() {
  fake.reset({
    user: [{ id: OWNER }],
    products: [{
      id: PORKSILOG, name: 'Marinated Porksilog', price: 120, category: 'Rice Meals', status: 'active',
      is_active: true, first_sold_date: '2026-01-01', created_at: '2026-01-01', inactive_reason: null, inactive_since: null,
    }],
    daily_sales: [],
    ingredients: Object.values(INGREDIENTS).map((i) => ({ ...i, created_at: '2026-01-01T00:00:00Z' })),
    product_ingredients: [recipe(PORK, 60, 'g'), recipe(EGG, 1, 'pcs'), recipe(RICE, 120, 'g')],
    modifier_rules: [
      { id: 1, keyword: 'NO RICE', ingredient_id: RICE },
      { id: 2, keyword: 'NO EGG', ingredient_id: EGG },
    ],
    inventory_transactions: [],
    notifications: [],
  });
}

const row = (name, sold, refunded = 0) => ({
  'Item name': name, Category: 'Rice Meals', 'Items sold': String(sold), 'Items refunded': String(refunded),
});

async function uploadSheet(rows, uploadId = 1) {
  const log = console.log; const warn = console.warn; const err = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    return await uploadService.processSalesData(
      rows, OWNER, uploadId, 'item-sales-summary-2026-10-20-2026-10-20.csv'
    );
  } finally {
    console.log = log; console.warn = warn; console.error = err;
  }
}

const stock = (id) => new Decimal(fake.tables.ingredients.find((i) => i.id === id).quantity);

const SHEET = [
  row('Marinated Porksilog', 17),
  row('Marinated Porksilog NO RICE', 2),
  row('Marinated Porksilog NO EGG', 3),
];

test('golden example: 22 Porksilog (2 NO RICE, 3 NO EGG) -> Pork 48.68 kg, Egg 31 pcs, Rice 97.6 kg', async () => {
  seed();
  await uploadService.getModifierRules({ forceRefresh: true });
  const result = await uploadSheet(SHEET);

  const saved = fake.tables.daily_sales.find((r) => r.product_id === PORKSILOG);
  assert.equal(saved.quantity_sold, 22, 'Net Items Sold = 17 + 2 + 3 - 0 refunded');

  assert.equal(stock(PORK).toString(), '48.68', 'Pork: 50 kg - (22 x 60 g = 1.32 kg)');
  assert.equal(stock(EGG).toString(), '31', 'Egg: 50 pcs - (22 - 3) x 1 pc');
  assert.equal(stock(RICE).toString(), '97.6', 'Rice: 100 kg - (22 - 2) x 120 g');
  assert.equal(result.uploadSummary.stockNotDeducted.length, 0, JSON.stringify(result.uploadSummary.stockNotDeducted));
});

test('refunds are subtracted before anything else: 22 sold, 2 refunded -> 20 plates', async () => {
  seed();
  await uploadService.getModifierRules({ forceRefresh: true });
  await uploadSheet([row('Marinated Porksilog', 17, 2), row('Marinated Porksilog NO RICE', 2), row('Marinated Porksilog NO EGG', 3)], 3);
  // 20 plates: pork 20 x 60 g = 1.2 kg; egg 20 - 3 = 17; rice 18 x 120 g = 2.16 kg
  assert.equal(stock(PORK).toString(), '48.8');
  assert.equal(stock(EGG).toString(), '33');
  assert.equal(stock(RICE).toString(), '97.84');
});
