const assert = require('node:assert/strict');
const test = require('node:test');
const Decimal = require('decimal.js');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

const fake = createFakeSupabase({
  ingredients: [
    {
      id: 1,
      name: 'Strawberry Powder',
      unit: 'Grams (g)',
      quantity: '0.1',
      pack_size: '0.1',
      updated_by: null,
    },
  ],
  inventory_transactions: [],
  inventory_shortfall_balances: [],
}, {
  rpc: {
    restock_ingredient_stock: async (args, tables) => {
      const ingredient = tables.ingredients.find((row) => String(row.id) === String(args.p_ingredient_id));
      if (!ingredient) return { data: null, error: { message: 'Ingredient not found' } };

      const received = new Decimal(args.p_quantity);
      let unallocated = received;
      let settled = new Decimal(0);
      const pendingRows = (tables.inventory_shortfall_balances || [])
        .filter((row) => String(row.ingredient_id) === String(args.p_ingredient_id))
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      for (const pending of pendingRows) {
        if (!unallocated.gt(0)) break;
        const remaining = new Decimal(pending.remaining_quantity);
        const amount = Decimal.min(unallocated, remaining);
        pending.remaining_quantity = remaining.minus(amount).toString();
        settled = settled.plus(amount);
        unallocated = unallocated.minus(amount);
      }

      const previous = new Decimal(ingredient.quantity);
      const next = previous.plus(unallocated);
      ingredient.quantity = next.toString();
      tables.inventory_transactions.push({
        ingredient_id: Number(args.p_ingredient_id),
        transaction_type: 'restock',
        quantity: unallocated.toString(),
        previous_quantity: previous.toString(),
        new_quantity: next.toString(),
        received_quantity: received.toString(),
        shortfall_settled_quantity: settled.toString(),
        notes: [
          args.p_notes,
          `Received ${received}; ${settled} settled previous sales shortfalls.`,
        ].filter(Boolean).join(' '),
      });
      return {
        data: [{
          previous_quantity: previous.toString(),
          new_quantity: next.toString(),
          received_quantity: received.toString(),
          shortfall_settled_quantity: settled.toString(),
          added_quantity: unallocated.toString(),
          unit: ingredient.unit,
        }],
        error: null,
      };
    },
  },
});

installFake(fake, {
  'services/auditService.js': { logAction: async () => {} },
  'services/analyticsService.js': {},
});

const { createInventoryItem, restockInventoryItem } = require('../controllers/inventoryController');

function callController(handler, { body, id } = {}) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
      },
    };
    Promise.resolve(handler({
      params: id == null ? {} : { id: String(id) },
      body: body || {},
      user: { id: 7, name: 'Test User' },
    }, response)).catch(reject);
  });
}

test('creating stock from a pack saves usable unit metadata and derives per-unit cost', async () => {
  const result = await callController(createInventoryItem, {
    body: {
      name: 'New Strawberry Powder',
      category: 'Ingredients',
      unit: 'Grams (g)',
      quantity: '50',
      pack_qty: '50',
      pack_unit: '',
      pack_price: '125',
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.data.quantity, '50');
  assert.equal(result.body.data.price, '2.5');
  assert.equal(result.body.data.base_unit, 'g');
  assert.equal(result.body.data.unit_family, 'mass');
  assert.equal(result.body.data.pack_size, '50');
  assert.equal(result.body.data.pack_unit, 'Grams (g)');
});

test('restocking by pack count adds exact pack contents and logs the movement', async () => {
  const result = await callController(restockInventoryItem, {
    id: 1,
    body: { pack_count: '2', reason: 'purchase_order' },
  });

  assert.equal(result.status, 200);
  assert.equal(fake.tables.ingredients[0].quantity, '0.3');
  const transaction = fake.tables.inventory_transactions.find((row) => (
    String(row.ingredient_id) === '1' && row.transaction_type === 'restock'
  ));
  assert.equal(transaction.quantity, '0.2');
  assert.equal(transaction.previous_quantity, '0.1');
  assert.equal(transaction.new_quantity, '0.3');
  assert.match(transaction.notes, /Received 2 packs \(0\.2 Grams \(g\)\)/);
  assert.match(transaction.notes, /Stock is now 0\.3 Grams \(g\)/);
  assert.equal(fake.rpcCalls[0].name, 'restock_ingredient_stock');
  assert.equal(fake.rpcCalls[0].args.p_quantity, '0.2');
});

test('restocking adds the received stock and leaves earlier sales shortfalls on record', async () => {
  fake.reset({
    ingredients: [{
      id: 1,
      name: 'Strawberry Powder',
      unit: 'Grams (g)',
      base_unit: 'g',
      quantity: '0',
      pack_size: '50',
      updated_by: null,
    }],
    inventory_transactions: [],
    inventory_shortfall_balances: [{
      sale_transaction_id: 'sale-1',
      ingredient_id: 1,
      reference_type: 'upload',
      reference_id: 55,
      original_quantity: '100',
      remaining_quantity: '100',
      created_at: '2026-10-22T00:00:00Z',
    }],
  });

  const firstRestock = await callController(restockInventoryItem, {
    id: 1,
    body: { quantity: '50', reason: 'purchase_order' },
  });
  assert.equal(firstRestock.status, 200);
  assert.equal(firstRestock.body.data.quantity, '50');
  assert.match(firstRestock.body.message, /Added 50 Grams \(g\) to Strawberry Powder/);
  assert.match(firstRestock.body.message, /Stock is now 50 Grams \(g\)/);
  // The unmet sale stays on record, it is not paid with the received stock.
  assert.equal(fake.tables.inventory_shortfall_balances[0].remaining_quantity, '100');

  const transaction = fake.tables.inventory_transactions.find((row) => row.transaction_type === 'restock');
  assert.equal(transaction.quantity, '50');
  assert.equal(transaction.previous_quantity, '0');
  assert.equal(transaction.new_quantity, '50');
  assert.match(transaction.notes, /Received 50 Grams \(g\); stock is now 50 Grams \(g\)/);

  const secondRestock = await callController(restockInventoryItem, {
    id: 1,
    body: { quantity: '100', reason: 'purchase_order' },
  });
  assert.equal(secondRestock.status, 200);
  assert.equal(secondRestock.body.data.quantity, '150');
  assert.match(secondRestock.body.message, /Stock is now 150 Grams \(g\)/);
  assert.equal(fake.tables.inventory_shortfall_balances[0].remaining_quantity, '100');
});

test('restock messages and movement notes carry no trailing-zero decimals', async () => {
  fake.reset({
    ingredients: [{
      id: 1,
      name: 'Strawberry Powder',
      unit: 'Grams (g)',
      base_unit: 'g',
      quantity: '20',
      pack_size: '50',
      updated_by: null,
    }],
    inventory_transactions: [],
    inventory_shortfall_balances: [],
  });

  const result = await callController(restockInventoryItem, {
    id: 1,
    body: { quantity: '30.000000', reason: 'purchase_order' },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.data.quantity, '50');
  assert.match(result.body.message, /Added 30 Grams \(g\)/);
  assert.match(result.body.message, /Stock is now 50 Grams \(g\)/);
  assert.doesNotMatch(result.body.message, /30\.000000|50\.000000/);

  const transaction = fake.tables.inventory_transactions.find((row) => row.transaction_type === 'restock');
  assert.doesNotMatch(transaction.notes, /\d+\.\d*0{2,}/);
  assert.match(transaction.notes, /Received 30 Grams \(g\); stock is now 50 Grams \(g\)/);
});

test('restocking still adds the stock when the shortfall table is not installed', async () => {
  fake.reset({
    ingredients: [{
      id: 1,
      name: 'Strawberry Powder',
      unit: 'Grams (g)',
      base_unit: 'g',
      quantity: '20',
      pack_size: '50',
      updated_by: null,
    }],
    inventory_transactions: [],
  }, { missingTables: ['inventory_shortfall_balances'] });

  const result = await callController(restockInventoryItem, {
    id: 1,
    body: { quantity: '30', reason: 'purchase_order' },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.data.quantity, '50');
  assert.match(result.body.message, /Stock is now 50 Grams \(g\)/);
});
