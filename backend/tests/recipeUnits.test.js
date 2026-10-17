// Runs the shared recipe-unit cases (ml-service/tests/fixtures/recipe_unit_cases.json)
// against backend/utils/recipeUnits.js. The same file is checked by the
// frontend copy (tests/recipeUnits.crosscheck.test.mjs) and by
// ml-service/tests/test_recipe_units.py, so the three copies cannot drift.
//
// Run:  cd backend && node tests/recipeUnits.test.js
// No network, no Supabase, no credentials.

const path = require('path');
const fixture = require(path.join(__dirname, '..', '..', 'ml-service', 'tests', 'fixtures', 'recipe_unit_cases.json'));
const { convertRecipeQuantity, deriveUnitPrice, setUnitMetadata } = require('../utils/recipeUnits');

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
      packQty: c.packQty ?? null,
      packUnit: c.packUnit ?? '',
    }));
    check(c.label, Math.abs(got - c.expected) < 1e-9, `expected ${c.expected}, got ${got}`);
  }
}

console.log('with database units');
setUnitMetadata(fixture.units);
run(fixture.cases);

console.log('with purchase packs ("150 g per sachet")');
run(fixture.pack_cases);

console.log('built-in tables only (no database units)');
setUnitMetadata([]);
run(fixture.fallback_cases);

console.log('deriveUnitPrice (purchase pack -> cost per stock unit)');
setUnitMetadata(fixture.units);
const near = (a, b) => Math.abs(a - b) < 1e-6;
check('150 g for 200 on a kg ingredient -> 1333.333333/kg', near(deriveUnitPrice({ packQty: 150, packUnit: 'Grams (g)', packPrice: 200, stockUnit: 'Kilograms (kg)' }), 1333.333333));
check('100 g for 25 on a g ingredient -> 0.25/g', near(deriveUnitPrice({ packQty: 100, packUnit: 'Grams (g)', packPrice: 25, stockUnit: 'Grams (g)' }), 0.25));
check('12 pcs for 60 in the same unit -> 5/pc', near(deriveUnitPrice({ packQty: 12, packUnit: 'Pieces (pcs)', packPrice: 60, stockUnit: 'Pieces (pcs)' }), 5));
check('1 cup pack for 50 with 120 g/cup -> 50/120 per g', near(deriveUnitPrice({ packQty: 1, packUnit: 'Cups (cup)', packPrice: 50, stockUnit: 'Grams (g)', gramsPerCup: 120 }), 50 / 120));
check('volume pack for a mass ingredient without density -> null', deriveUnitPrice({ packQty: 1, packUnit: 'Cups (cup)', packPrice: 50, stockUnit: 'Kilograms (kg)' }) === null);
check('count pack unit that cannot be weighed -> null', deriveUnitPrice({ packQty: 12, packUnit: 'Carton', packPrice: 60, stockUnit: 'Kilograms (kg)' }) === null);
check('incomplete pack -> null', deriveUnitPrice({ packQty: 150, packUnit: '', packPrice: 200, stockUnit: 'Kilograms (kg)' }) === null);

if (failures.length) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll recipe unit checks passed');
