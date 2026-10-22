// Tests controllers/inventoryController.js -> getIngredientRecipes against a
// FAKE Supabase.
//
// Why this matters:
//  * The ingredient window shows the owner WHERE the recipe portion lives,
//    because the purchase pack fields ("how much do you buy") are the easiest
//    thing in the system to confuse with a portion ("250 g per serving").
//  * The endpoint is read only: it must never write, and it must never
//    change the portion, because the portion belongs to the dish.
//  * product_ingredients.unit arrived with migration 008. A database without
//    it still has to answer, with the unit left empty.
//
// Run:  cd backend && node tests/ingredientRecipes.test.js
// No network, no Supabase, no credentials.

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

// ---- fake DB -------------------------------------------------------------
const tables = {
  product_ingredients: [
    { id: 1, product_id: 10, ingredient_id: 155, quantity_per_serving: '250', unit: 'Grams (g)' },
    { id: 2, product_id: 11, ingredient_id: 155, quantity_per_serving: '1/2', unit: 'Kilograms (kg)' },
    { id: 3, product_id: 10, ingredient_id: 60, quantity_per_serving: '150', unit: 'Grams (g)' },
  ],
  products: [
    { id: 10, name: 'Pork Sinigang' },
    { id: 11, name: 'Lechon Kawali' },
  ],
};
let writes = 0;

function builder(table, rows) {
  const s = { op: 'select', columns: '', payload: null, filters: [], inList: null, single: false, range: null };
  const b = {
    select(columns) { s.columns = String(columns || ''); return b; },
    eq(col, val) { s.filters.push([col, val]); return b; },
    in(col, values) { s.inList = [col, values]; return b; },
    order() { return b; },
    range(a, z) { s.range = [a, z]; return b; },
    insert(payload) { writes += 1; s.op = 'insert'; s.payload = payload; return b; },
    update(payload) { writes += 1; s.op = 'update'; s.payload = payload; return b; },
    delete() { writes += 1; s.op = 'delete'; return b; },
    single() { s.single = true; return b; },
    then(resolve, reject) {
      // The fake answers an error for a select of a column the table does not
      // have, the way PostgREST does (Postgres 42703).
      if (missingUnitColumn && table === 'product_ingredients' && s.columns.includes('unit')) {
        return Promise.resolve({
          data: null,
          error: { code: '42703', message: 'column product_ingredients.unit does not exist' },
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
        if (s.range) data = data.slice(s.range[0], s.range[1] + 1);
        // A database without the column cannot return it.
        if (missingUnitColumn && table === 'product_ingredients' && !s.columns.includes('unit')) {
          data = data.map((r) => { const { unit, ...rest } = r; return rest; });
        }
      }
      if (s.single) {
        if (!data.length) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } }).then(resolve, reject);
        data = data[0];
      }
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return b;
}

// The database can be one that has not run migration 008 yet.
let missingUnitColumn = false;
const fakeAdmin = {
  from(table) {
    return builder(table, tables[table] || []);
  },
};

const configPath = require.resolve('../config/supabase');
const auditPath = require.resolve('../services/auditService');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { supabaseAdmin: fakeAdmin } };
require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true, exports: { logAction: async () => {} } };

const { getIngredientRecipes } = require('../controllers/inventoryController');

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
const recipesOf = (id) => call(getIngredientRecipes, { params: { id } });

(async () => {
  console.log('getIngredientRecipes');
  let r = await recipesOf(155);
  check('it answers with 200', r.status === 200, JSON.stringify(r));
  check('it reports success', r.body.success === true, JSON.stringify(r.body));
  check('both recipes of the ingredient are listed', r.body.data.length === 2, JSON.stringify(r.body.data));
  const sinigang = r.body.data.find((line) => line.product_id === 10);
  check('the dish name comes with it', sinigang && sinigang.product_name === 'Pork Sinigang', JSON.stringify(sinigang));
  check('the portion is kept as it is stored', sinigang && sinigang.quantity_per_serving === '250', JSON.stringify(sinigang));
  check('the portion unit comes with it', sinigang && sinigang.unit === 'Grams (g)', JSON.stringify(sinigang));
  const lechon = r.body.data.find((line) => line.product_id === 11);
  check('a fraction is not turned into a number', lechon && lechon.quantity_per_serving === '1/2', JSON.stringify(lechon));
  check('nothing was written', writes === 0, `writes=${writes}`);
  check('the recipe rows are untouched', tables.product_ingredients.length === 3);

  console.log('getIngredientRecipes: an ingredient no dish uses');
  r = await recipesOf(999);
  check('it answers with 200 and no rows', r.status === 200 && Array.isArray(r.body.data) && r.body.data.length === 0, JSON.stringify(r));

  console.log('getIngredientRecipes: a database without product_ingredients.unit');
  missingUnitColumn = true;
  r = await recipesOf(155);
  missingUnitColumn = false;
  check('it still answers with 200', r.status === 200, JSON.stringify(r));
  check('the recipes are still listed', r.body.data.length === 2, JSON.stringify(r.body.data));
  check('the unit is left empty', r.body.data.every((line) => !line.unit), JSON.stringify(r.body.data));
  check('still nothing was written', writes === 0, `writes=${writes}`);

  if (failures.length) {
    console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
    process.exit(1);
  }
  console.log('All getIngredientRecipes checks passed.');
})();
