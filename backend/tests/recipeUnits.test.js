// Runs the shared recipe-unit cases (ml-service/tests/fixtures/recipe_unit_cases.json)
// against backend/utils/recipeUnits.js. The same file is checked by the
// frontend copy (tests/recipeUnits.crosscheck.test.mjs) and by
// ml-service/tests/test_recipe_units.py, so the three copies cannot drift.
//
// Run:  cd backend && node tests/recipeUnits.test.js
// No network, no Supabase, no credentials.

const path = require('path');
const fixture = require(path.join(__dirname, '..', '..', 'ml-service', 'tests', 'fixtures', 'recipe_unit_cases.json'));
const { convertRecipeQuantity, setUnitMetadata } = require('../utils/recipeUnits');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

function run(cases) {
  for (const c of cases) {
    const got = Number(convertRecipeQuantity(c.quantity, c.from, c.to, {
      gramsPerCup: c.gramsPerCup ?? null,
      ingredientName: c.ingredient || '',
    }));
    check(c.label, Math.abs(got - c.expected) < 1e-9, `expected ${c.expected}, got ${got}`);
  }
}

console.log('with database units');
setUnitMetadata(fixture.units);
run(fixture.cases);

console.log('built-in tables only (no database units)');
setUnitMetadata([]);
run(fixture.fallback_cases);

if (failures.length) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll recipe unit checks passed');
