// Tests controllers/inventoryController.js -> getInventoryItem against a
// FAKE Supabase.
//
// Why this matters:
//  * A sale that could not be fully served leaves a "short" behind. A delivery
//    never pays it off (the delivery is stock on hand), so the short stays
//    open until a stock count records what is really on hand.
//  * The owner has to SEE that short next to the stock, otherwise the stock
//    history looks broken: the delivery shows up in the stock, but the sale
//    still says "Short 1.35".
//  * A database without the shortfall ledger (migration 014 was never run)
//    still has to answer, with no short at all.
//
// Run:  cd backend && node tests/openShortfall.test.js
// No network, no Supabase, no credentials.

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

// ---- fake DB -------------------------------------------------------------
const tables = {
  ingredients: [
    { id: 155, name: 'Pork', quantity: '2.7', unit: 'Kilograms (kg)', min_stock: '5' },
    { id: 60, name: 'Garlic', quantity: '1', unit: 'Kilograms (kg)', min_stock: '1' },
  ],
  inventory_shortfall_balances: [
    {
      sale_transaction_id: 'sale-1',
      ingredient_id: 155,
      original_quantity: '1.35',
      remaining_quantity: '1.35',
    },
    {
      sale_transaction_id: 'sale-2',
      ingredient_id: 155,
      original_quantity: '0.5',
      remaining_quantity: '0',
    },
  ],
};
let writes = 0;

// The ledger table may not exist yet (migration 014 was never run).
let missingShortfallTable = false;

function builder(table, rows) {
  const s = {
    op: 'select', columns: '', payload: null, filters: [], inList: null,
    single: false, range: null, greater: null,
  };
  const b = {
    select(columns) { s.columns = String(columns || ''); return b; },
    eq(col, val) { s.filters.push([col, val]); return b; },
    gt(col, val) { s.greater = [col, val]; return b; },
    in(col, values) { s.inList = [col, values]; return b; },
    order() { return b; },
    range(a, z) { s.range = [a, z]; return b; },
    insert(payload) { writes += 1; s.op = 'insert'; s.payload = payload; return b; },
    update(payload) { writes += 1; s.op = 'update'; s.payload = payload; return b; },
    delete() { writes += 1; s.op = 'delete'; return b; },
    single() { s.single = true; return b; },
    then(resolve, reject) {
      if (missingShortfallTable && table === 'inventory_shortfall_balances') {
        // PostgREST on a table that does not exist: Postgres 42P01.
        return Promise.resolve({
          data: null,
          error: { code: '42P01', message: `relation "${table}" does not exist` },
        }).then(resolve, reject);
      }
      const match = (r) => s.filters.every(([c, v]) => r[c] === v);
      let data;
      if (s.op === 'insert') {
        data = s.payload.map((r) => ({ id: `new-${rows.length + 1}`, ...r }));
        rows.push(...data);
      } else if (s.op === 'update') {
        data = rows.filter(match);
        data.forEach((r) => Object.assign(r, s.payload));
      } else if (s.op === 'delete') {
        data = rows.filter(match);
        for (const r of data) rows.splice(rows.indexOf(r), 1);
      } else {
        data = rows.filter(match);
        if (s.inList) {
          const [col, values] = s.inList;
          data = data.filter((r) => values.includes(r[col]));
        }
        if (s.greater) {
          const [col, value] = s.greater;
          data = data.filter((r) => Number(r[col]) > Number(value));
        }
        if (s.range) data = data.slice(s.range[0], s.range[1] + 1);
      }
      if (s.single) {
        if (!data.length) {
          return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } }).then(resolve, reject);
        }
        data = data[0];
      }
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return b;
}

const fakeAdmin = {
  from(table) {
    return builder(table, tables[table] || []);
  },
};

const configPath = require.resolve('../config/supabase');
const auditPath = require.resolve('../services/auditService');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { supabaseAdmin: fakeAdmin } };
require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true, exports: { logAction: async () => {} } };

const { getInventoryItem } = require('../controllers/inventoryController');

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(p) { resolve({ status: this.statusCode, body: p }); },
    };
    handler({ body: {}, params: {}, query: {}, user: { name: 'test' }, ...req }, res);
  });
}
const itemOf = (id) => call(getInventoryItem, { params: { id } });

(async () => {
  console.log('getInventoryItem: an ingredient with an open short');
  let r = await itemOf(155);
  check('it answers with 200', r.status === 200, JSON.stringify(r));
  check('it reports success', r.body.success === true, JSON.stringify(r.body));
  check('the open short is reported', Number(r.body.data.open_shortfall) === 1.35, JSON.stringify(r.body.data));
  check('the number of sales is reported', Number(r.body.data.open_shortfall_sales) === 1, JSON.stringify(r.body.data));
  check('the stock itself is untouched', String(r.body.data.quantity) === '2.7', JSON.stringify(r.body.data));
  check('nothing was written', writes === 0, `writes=${writes}`);

  console.log('getInventoryItem: an ingredient without a short');
  r = await itemOf(60);
  check('it answers with 200', r.status === 200, JSON.stringify(r));
  check('there is no short', Number(r.body.data.open_shortfall) === 0, JSON.stringify(r.body.data));
  check('no sales are counted', Number(r.body.data.open_shortfall_sales) === 0, JSON.stringify(r.body.data));
  check('still nothing was written', writes === 0, `writes=${writes}`);

  console.log('getInventoryItem: a database without the shortfall ledger');
  missingShortfallTable = true;
  r = await itemOf(155);
  missingShortfallTable = false;
  check('it still answers with 200', r.status === 200, JSON.stringify(r));
  check('there is no short', Number(r.body.data?.open_shortfall) === 0, JSON.stringify(r.body));
  check('the stock is still there', String(r.body.data?.quantity) === '2.7', JSON.stringify(r.body.data));
  check('still nothing was written', writes === 0, `writes=${writes}`);

  if (failures.length) {
    console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
    process.exit(1);
  }
  console.log('All open shortfall checks passed.');
})();
