// Tests controllers/unitsController.js (create / rename / delete) against a
// FAKE Supabase.
//
// Why this matters:
//  * ingredient_units.family is NOT NULL with no default, and recipe costing
//    (utils/recipeUnits.js) treats a unit with no family as a plain count that
//    never converts. The old createUnit inserted only { name }, so it failed;
//    it also let a second "KG" row exist next to "Kilograms (kg)".
//  * Deleting a unit used to move its ingredients to "pcs", silently changing
//    what their price and stock mean. A unit in use must now be refused.
//  * Renaming updates ingredients.unit only, NOT product_ingredients.unit, so
//    the old name is kept as an alias to keep saved recipe lines converting.
//
// Run:  cd backend && node tests/unitsController.test.js
// No network, no Supabase, no credentials.

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

// ---- fake DB -------------------------------------------------------------
const tables = {
  ingredient_units: [
    { id: 'u-kg', name: 'Kilograms (kg)', family: 'mass', base_unit: 'g', base_factor: 1000, is_piece: false, piece_weight_grams: null, aliases: ['kg', 'kilo'], is_active: true },
    { id: 'u-g', name: 'Grams (g)', family: 'mass', base_unit: 'g', base_factor: 1, is_piece: false, piece_weight_grams: null, aliases: ['g'], is_active: true },
    { id: 'u-liter', name: 'Liters (L)', family: 'volume', base_unit: 'mL', base_factor: 1000, is_piece: false, piece_weight_grams: null, aliases: ['l', 'liter', 'liters'], is_active: true },
  ],
  ingredients: [
    { id: 1, name: 'Rice', unit: 'Kilograms (kg)', unit_id: 'u-kg' },
    { id: 2, name: 'Salt', unit: 'Grams (g)', unit_id: 'u-g' },
  ],
  product_ingredients: [
    { id: 1, product_id: 10, ingredient_id: 1, unit: 'L', quantity_per_serving: '1' },
    { id: 2, product_id: 10, ingredient_id: 2, unit: 'Grams (g)', quantity_per_serving: '5' },
  ],
};
let nextId = 1;

function builder(rows) {
  const s = { op: 'select', payload: null, filters: [], single: false, range: null };
  const b = {
    select() { return b; },
    eq(col, val) { s.filters.push([col, val]); return b; },
    order() { return b; },
    range(a, z) { s.range = [a, z]; return b; },
    insert(payload) { s.op = 'insert'; s.payload = payload; return b; },
    update(payload) { s.op = 'update'; s.payload = payload; return b; },
    delete() { s.op = 'delete'; return b; },
    single() { s.single = true; return b; },
    then(resolve, reject) {
      const match = (r) => s.filters.every(([c, v]) => r[c] === v);
      let data;
      if (s.op === 'insert') {
        data = s.payload.map((r) => ({ id: `new-${nextId++}`, is_active: true, piece_weight_grams: null, ...r }));
        rows.push(...data);
      } else if (s.op === 'update') {
        data = rows.filter(match);
        data.forEach((r) => Object.assign(r, s.payload));
      } else if (s.op === 'delete') {
        data = rows.filter(match);
        for (const r of data) rows.splice(rows.indexOf(r), 1);
      } else {
        data = rows.filter(match);
        if (s.range) data = data.slice(s.range[0], s.range[1] + 1);
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

const fakeAdmin = { from: (t) => builder(tables[t] || []) };
const configPath = require.resolve('../config/supabase');
const auditPath = require.resolve('../services/auditService');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { supabaseAdmin: fakeAdmin } };
require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true, exports: { logAction: async () => {} } };

const { createUnit, updateUnit, deleteUnit } = require('../controllers/unitsController');
const { normalizeRecipeQuantityToUnit, UnitConversionError } = require('../utils/recipeUnits');

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(p) { resolve({ status: this.statusCode, body: p }); },
    };
    handler({ body: {}, params: {}, user: { name: 'test' }, ...req }, res);
  });
}
const create = (body) => call(createUnit, { body });
const rename = (id, name) => call(updateUnit, { params: { id }, body: { name } });
const remove = (id) => call(deleteUnit, { params: { id } });
const units = tables.ingredient_units;

(async () => {
  console.log('supported units only');
  let r = await create({ name: 'Packs', family: 'count' });
  check('unsupported unit is rejected', r.status === 400, JSON.stringify(r));
  r = await create({ name: 'Sack', family: 'mass', base_factor: 50000 });
  check('custom conversion unit is rejected', r.status === 400, JSON.stringify(r));
  r = await create({ name: 'Pieces (pcs)', family: 'count' });
  check('supported count unit can be created', r.status === 201, JSON.stringify(r));
  check('cross-family mass/volume conversion is rejected', (() => {
    try {
      normalizeRecipeQuantityToUnit(1, 'L', 'kg');
      return false;
    } catch (error) {
      return error instanceof UnitConversionError;
    }
  })());
  check('Cups are rejected', (() => {
    try {
      normalizeRecipeQuantityToUnit(1, 'cup', 'kg');
      return false;
    } catch (error) {
      return error instanceof UnitConversionError;
    }
  })());
  check('unsupported pack spelling cannot convert', (() => {
    try {
      normalizeRecipeQuantityToUnit(1, 'pack', 'pcs');
      return false;
    } catch (error) {
      return error instanceof UnitConversionError;
    }
  })());

  console.log('units in use cannot be deleted');
  r = await remove('u-kg');
  check('unit used by an ingredient is refused (409)', r.status === 409 && /Rice/.test(r.body.error), JSON.stringify(r));
  r = await remove('u-liter');
  check('unit used by a recipe line is refused', r.status === 409 && /recipe line/.test(r.body.error), JSON.stringify(r));
  r = await remove('no-such-id');
  check('unknown id is 404', r.status === 404, JSON.stringify(r));

  console.log('supported names only');
  r = await rename('u-kg', 'Packs');
  check('unsupported rename is rejected', r.status === 400, JSON.stringify(r));
  r = await rename('u-g', 'Kilograms (kg)');
  check('rename onto another supported name is refused', r.status === 409, JSON.stringify(r));

  if (failures.length) {
    console.log(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed');
})();
