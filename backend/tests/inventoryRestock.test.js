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

let ingredientDailyNeeds = new Map();
installFake(fake, {
  'services/auditService.js': { logAction: async () => {} },
  'services/analyticsService.js': {
    getIngredientDailyNeeds: async () => ingredientDailyNeeds,
    getMappedIngredientIds: async () => new Set(),
    getForecastBasis: async () => null,
  },
});

const {
  createInventoryItem,
  getInventoryItems,
  restockInventoryItem,
} = require('../controllers/inventoryController');

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

test('creating stock saves the supported unit and entered per-unit cost', async () => {
  const result = await callController(createInventoryItem, {
    body: {
      name: 'New Strawberry Powder',
      category: 'Ingredients',
      unit: 'Grams (g)',
      quantity: '50',
      price: '2.5',
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.data.quantity, '50');
  assert.equal(result.body.data.price, '2.5');
  assert.equal(result.body.data.base_unit, 'g');
  assert.equal(result.body.data.unit_family, 'mass');
  assert.equal(result.body.data.material_type, 'dry');
});

test('creating stock rejects unsupported material types', async () => {
  const result = await callController(createInventoryItem, {
    body: {
      name: 'Invalid Material',
      category: 'Ingredients',
      unit: 'Grams (g)',
      quantity: '1',
      price: '1',
      material_type: 'liquid',
    },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Material type must be dry or wet');
  assert.equal(fake.writesTo('ingredients').length, 0);
});

test('creating stock rejects a negative or junk ideal stock level', async () => {
  for (const min_stock of ['-5', 'abc']) {
    const result = await callController(createInventoryItem, {
      body: { name: `Bad Ideal ${min_stock}`, category: 'Ingredients', unit: 'Grams (g)', quantity: '1', price: '1', min_stock },
    });
    assert.equal(result.status, 400, min_stock);
    assert.equal(result.body.error, 'Ideal stock level must be a valid number greater than or equal to 0');
    assert.equal((fake.tables.ingredients || []).some((row) => row.name === `Bad Ideal ${min_stock}`), false);
  }
});

test('ingredient list exposes separate stock statuses and omits removed purchase fields', async () => {
  // Current Stock Level Status: stock vs ideal level (min_stock), wet 50% /
  // dry 20%. Predicted: stock vs forecast need, 50 / 100 / 200% for wet AND
  // dry (the wet/dry split belongs to the current status only; it used to be
  // applied to the predicted one).
  const statusRows = [
    ['Out of Stock', 0, 10, 'dry'],
    ['Low Stock', 1, 10, 'dry'],              // 10% < 20%
    ['Normal Stock', 2, 10, 'dry'],           // exactly 20%: Normal for dry
    ['Wet Low Stock', 3, 10, 'wet'],          // 30% < 50%: Low for wet
    ['Excess Stock', 11, 10, 'dry'],          // 110% > 100%
    ['Critical Shortage', 0, 10, 'dry'],      // need 1, no stock
    ['Critical Shortage 40%', 4, 10, 'wet'],  // 4 of need 10 = 40%
    ['Insufficient Supply', 5, 10, 'dry'],    // 5 of need 10 = exactly 50%
    ['Sufficient Supply', 10, 10, 'dry'],     // 10 of need 10 = 100%
    ['Above Forecast Limit', 21, 10, 'wet'],  // 21 of need 10 = 210%
    ['Unassigned', 5, 0, 'dry'],              // no need
  ];
  const ingredients = statusRows.map(([name, quantity, minStock, materialType], index) => ({
    id: index + 1,
    name,
    unit: 'Grams (g)',
    base_unit: 'g',
    quantity,
    min_stock: minStock,
    material_type: materialType,
    category: materialType === 'wet' ? 'Wet Raw Materials' : 'Dry Raw Materials',
    price: 1,
    is_archived: false,
    pack_qty: 5,
    pack_unit: 'Pack',
    pack_price: 10,
    pack_size: 5,
    grams_per_cup: 200,
    density_g_per_ml: 0.8,
  }));
  fake.reset({ ingredients, inventory_transactions: [], inventory_shortfall_balances: [] });
  ingredientDailyNeeds = new Map([
    [1, 1],
    [2, 10],
    [3, 10],
    [4, 10],
    [5, 10],
    [6, 1],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
  ]);

  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; },
  };
  await getInventoryItems({ query: { statusField: 'predicted', limit: '20' } }, response);

  assert.equal(response.statusCode, 200);
  const byName = new Map(response.payload.data.map((item) => [item.name, item]));
  assert.equal(byName.get('Out of Stock').current_stock_status, 'Out of Stock');
  assert.equal(byName.get('Low Stock').current_stock_status, 'Low Stock');
  assert.equal(byName.get('Normal Stock').current_stock_status, 'Normal Stock');
  assert.equal(byName.get('Wet Low Stock').current_stock_status, 'Low Stock');
  assert.equal(byName.get('Excess Stock').current_stock_status, 'Excess Stock');
  assert.equal(byName.get('Low Stock').current_low_threshold_pct, 20, 'dry threshold applied');
  assert.equal(byName.get('Wet Low Stock').current_low_threshold_pct, 50, 'wet threshold applied');
  assert.equal(byName.get('Wet Low Stock').current_stock_pct, 30);
  assert.equal(byName.get('Critical Shortage').predicted_stock_status, 'Critical Shortage');
  assert.equal(byName.get('Critical Shortage 40%').predicted_stock_status, 'Critical Shortage');
  assert.equal(byName.get('Insufficient Supply').predicted_stock_status, 'Insufficient Supply');
  assert.equal(byName.get('Sufficient Supply').predicted_stock_status, 'Sufficient Supply');
  assert.equal(byName.get('Above Forecast Limit').predicted_stock_status, 'Above Forecast Limit');
  assert.equal(byName.get('Above Forecast Limit').predicted_coverage_pct, 210);
  assert.equal(byName.get('Above Forecast Limit').predicted_action, 'Delay restocking — overstock detected');
  assert.equal(byName.get('Unassigned').predicted_stock_status, 'Unassigned');
  // KPI cards count the CURRENT status; Low Stock Alerts = Low + Out.
  assert.equal(response.payload.summary.criticalStock, 2, 'two rows have 0 stock');
  // Low Stock: 'Low Stock' (dry 10%), 'Wet Low Stock' (30%) and the wet
  // 'Critical Shortage 40%' row (4 of ideal 10 = 40% < 50%). Out: two rows.
  assert.equal(response.payload.summary.lowStockAlerts, 5, '3 Low Stock + 2 Out of Stock');
  assert.deepEqual(response.payload.stockThresholds, {
    current_low_wet_pct: 50, current_low_dry_pct: 20,
    predicted_critical_pct: 50, predicted_sufficient_pct: 100, predicted_above_pct: 200,
  }, 'no saved thresholds: the defaults are used and returned');
  for (const item of response.payload.data) {
    assert.equal('pack_qty' in item, false);
    assert.equal('pack_unit' in item, false);
    assert.equal('pack_price' in item, false);
    assert.equal('grams_per_cup' in item, false);
  }
  ingredientDailyNeeds = new Map();
  fake.reset({
    ingredients: [{
      id: 1,
      name: 'Strawberry Powder',
      unit: 'Grams (g)',
      quantity: '0.1',
      updated_by: null,
    }],
    inventory_transactions: [],
    inventory_shortfall_balances: [],
  });
});

test('restocking adds a quantity in the ingredient stock unit', async () => {
  const result = await callController(restockInventoryItem, {
    id: 1,
    body: { quantity: '0.2', unit: 'Grams (g)', reason: 'purchase_order' },
  });

  assert.equal(result.status, 200);
  assert.equal(fake.tables.ingredients[0].quantity, '0.3');
  const transaction = fake.tables.inventory_transactions.find((row) => (
    String(row.ingredient_id) === '1' && row.transaction_type === 'restock'
  ));
  assert.equal(transaction.quantity, '0.2');
  assert.equal(transaction.previous_quantity, '0.1');
  assert.equal(transaction.new_quantity, '0.3');
  assert.match(transaction.notes, /Received 0\.2 Grams \(g\)/);
  assert.match(transaction.notes, /stock is now 0\.3 Grams \(g\)/);
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
