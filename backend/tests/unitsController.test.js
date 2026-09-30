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
    { id: 'u-cup', name: 'Cups (cup)', family: 'volume', base_unit: 'mL', base_factor: 240, is_piece: false, piece_weight_grams: null, aliases: ['cup', 'cups'], is_active: true },
  ],
  ingredients: [
    { id: 1, name: 'Rice', unit: 'Kilograms (kg)', unit_id: 'u-kg' },
    { id: 2, name: 'Salt', unit: 'Grams (g)', unit_id: 'u-g' },
  ],
  product_ingredients: [
    { id: 1, product_id: 10, ingredient_id: 1, unit: 'cup', quantity_per_serving: '1' },
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
const { normalizeRecipeQuantityToUnit } = require('../utils/recipeUnits');

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
  console.log('create: validation');
  let r = await create({ name: 'Sack' });
  check('missing family is rejected (400)', r.status === 400 && /type/i.test(r.body.error), JSON.stringify(r));
  r = await create({ name: 'Sack', family: 'mass' });
  check('mass without base_factor is rejected', r.status === 400, JSON.stringify(r));
  r = await create({ name: 'Sack', family: 'mass', base_factor: 0 });
  check('base_factor 0 is rejected', r.status === 400, JSON.stringify(r));
  r = await create({ name: 'Sack', family: 'mass', base_factor: 'abc' });
  check('non-numeric base_factor is rejected', r.status === 400, JSON.stringify(r));
  r = await create({ name: 'Sack', family: 'weight', base_factor: 50000 });
  check('unknown family is rejected', r.status === 400, JSON.stringify(r));
  r = await create({ name: 'Box', family: 'count', piece_weight_grams: 30 });
  check('grams per piece on a non-piece unit is rejected', r.status === 400, JSON.stringify(r));
  check('nothing was inserted by the rejected calls', units.length === 3, `rows=${units.length}`);

  console.log('create: name / alias collisions');
  r = await create({ name: 'KG', family: 'count' });
  check('"KG" is refused: "kg" already belongs to Kilograms (kg)', r.status === 409 && /Kilograms \(kg\)/.test(r.body.error), JSON.stringify(r));
  r = await create({ name: 'Sack', family: 'mass', base_factor: 50000, aliases: 'Kilo' });
  check('alias that collides (case-insensitive) is refused', r.status === 409, JSON.stringify(r));
  check('still nothing inserted', units.length === 3, `rows=${units.length}`);

  console.log('create: success');
  r = await create({ name: 'Sack', family: 'mass', base_factor: '50000', aliases: 'sacks, SACK ,' });
  check('mass unit created (201)', r.status === 201, JSON.stringify(r));
  const sack = units.find((u) => u.name === 'Sack');
  check('stored with base_unit g and numeric factor', sack && sack.base_unit === 'g' && sack.base_factor === 50000, JSON.stringify(sack));
  check('aliases trimmed and de-duplicated', sack && JSON.stringify(sack.aliases) === JSON.stringify(['sacks', 'SACK']), JSON.stringify(sack && sack.aliases));
  r = await create({ name: 'Scoop', family: 'volume', base_factor: 60 });
  check('volume unit gets base_unit mL', r.status === 201 && units.find((u) => u.name === 'Scoop').base_unit === 'mL');
  r = await create({ name: 'Tray', family: 'count', base_factor: 999, is_piece: false });
  const tray = units.find((u) => u.name === 'Tray');
  check('count unit never stores a factor', r.status === 201 && tray.base_factor === null && tray.base_unit === null, JSON.stringify(tray));
  r = await create({ name: 'Wedge', family: 'count', is_piece: true, piece_weight_grams: 25 });
  const wedge = units.find((u) => u.name === 'Wedge');
  check('piece unit keeps grams per piece', r.status === 201 && wedge.is_piece === true && wedge.piece_weight_grams === 25, JSON.stringify(wedge));

  console.log('create: usable by the recipe math right away (metadata refreshed)');
  check('2 Sack -> 100 kg', normalizeRecipeQuantityToUnit(2, 'Sack', 'Kilograms (kg)') === 100);
  check('alias "sacks" also converts', normalizeRecipeQuantityToUnit(1, 'sacks', 'g') === 50000);
  check('5 Scoop -> 300 mL', normalizeRecipeQuantityToUnit(5, 'Scoop', 'mL') === 300);

  console.log('delete: a unit in use is locked');
  r = await remove('u-kg');
  check('unit used by an ingredient is refused (409)', r.status === 409 && /Rice/.test(r.body.error), JSON.stringify(r));
  check('the unit row is still there', units.some((u) => u.id === 'u-kg'));
  check('ingredient kept its unit (no silent move to pcs)', tables.ingredients[0].unit === 'Kilograms (kg)');

  r = await remove('u-cup');
  check('unit used only by a recipe line, stored as alias "cup", is refused', r.status === 409 && /recipe line/.test(r.body.error), JSON.stringify(r));
  check('Cups (cup) row is still there', units.some((u) => u.id === 'u-cup'));

  tables.ingredients.push({ id: 3, name: 'Pepper', unit: 'something else', unit_id: 'u-g' });
  tables.ingredients[1].unit = 'Milligrams';
  r = await remove('u-g');
  check('unit referenced only through unit_id is refused', r.status === 409 && /Pepper/.test(r.body.error), JSON.stringify(r));
  tables.ingredients.pop();
  tables.ingredients[1].unit = 'Grams (g)';

  r = await remove('no-such-id');
  check('unknown id is 404', r.status === 404, JSON.stringify(r));

  console.log('delete: an unused unit can go');
  const scoopId = units.find((u) => u.name === 'Scoop').id;
  r = await remove(scoopId);
  check('unused unit is deleted (200)', r.status === 200, JSON.stringify(r));
  check('row is gone', !units.some((u) => u.name === 'Scoop'));
  check('and its conversion is gone too (metadata refreshed): 5 Scoop passes through', normalizeRecipeQuantityToUnit(5, 'Scoop', 'mL') === 5);

  console.log('rename: ingredients.unit only, recipe lines untouched');
  const recipeBefore = JSON.stringify(tables.product_ingredients);
  r = await rename('u-kg', 'Kilos');
  check('rename succeeds (200)', r.status === 200, JSON.stringify(r));
  check('ingredients.unit follows the new name', tables.ingredients[0].unit === 'Kilos', tables.ingredients[0].unit);
  check('product_ingredients.unit is NOT touched', JSON.stringify(tables.product_ingredients) === recipeBefore);
  const kilos = units.find((u) => u.id === 'u-kg');
  check('old name is kept as an alias', kilos.name === 'Kilos' && kilos.aliases.includes('Kilograms (kg)'), JSON.stringify(kilos));
  check('saved recipe lines still convert with the OLD name', normalizeRecipeQuantityToUnit(2, 'Kilograms (kg)', 'g') === 2000);
  check('the new name converts', normalizeRecipeQuantityToUnit(2, 'Kilos', 'g') === 2000);

  r = await rename('u-g', 'Kilos');
  check('rename onto another unit\'s name is refused (409)', r.status === 409, JSON.stringify(r));
  r = await rename('u-g', 'KG');
  check('rename onto another unit\'s alias is refused (409)', r.status === 409, JSON.stringify(r));
  r = await rename('no-such-id', 'Whatever');
  check('rename of an unknown id is 404', r.status === 404, JSON.stringify(r));
  r = await rename('u-g', 'Grams (g)');
  check('saving a unit under its own name is fine and adds no alias', r.status === 200 && JSON.stringify(units.find((u) => u.id === 'u-g').aliases) === JSON.stringify(['g']), JSON.stringify(units.find((u) => u.id === 'u-g')));

  if (failures.length) {
    console.log(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed');
})();
