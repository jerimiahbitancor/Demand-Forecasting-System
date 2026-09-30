// Runs the shared recipe-unit cases (ml-service/tests/fixtures/recipe_unit_cases.json)
// against the FRONTEND copy, frontend/src/utils/recipeUnits.js, and then checks
// that it gives exactly the same answer as the backend copy on every case.
//
// Why: the owner sees cost previews from the frontend copy, while demand, COGS
// and stock deduction are booked by the backend / ml-service copies. If they
// disagree, the screen shows one number and the system books another.
//
// Run:  cd backend && node tests/recipeUnits.crosscheck.test.mjs
// No network, no Supabase, no credentials.

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const fixture = JSON.parse(readFileSync(path.join(here, '..', '..', 'ml-service', 'tests', 'fixtures', 'recipe_unit_cases.json'), 'utf8'));
const front = await import(pathToFileURL(path.join(here, '..', '..', 'frontend', 'src', 'utils', 'recipeUnits.js')).href);
const back = require('../utils/recipeUnits');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

function run(cases) {
  for (const c of cases) {
    const opts = { gramsPerCup: c.gramsPerCup ?? null, ingredientName: c.ingredient || '' };
    const f = Number(front.convertRecipeQuantity(c.quantity, c.from, c.to, opts));
    const b = Number(back.convertRecipeQuantity(c.quantity, c.from, c.to, opts));
    check(`${c.label} (frontend = ${c.expected})`, Math.abs(f - c.expected) < 1e-9, `expected ${c.expected}, got ${f}`);
    check(`${c.label} (frontend = backend)`, Math.abs(f - b) < 1e-12, `frontend ${f} vs backend ${b}`);
  }
}

console.log('with database units');
front.setUnitMetadata(fixture.units);
back.setUnitMetadata(fixture.units);
run(fixture.cases);

console.log('built-in tables only (no database units)');
front.setUnitMetadata([]);
back.setUnitMetadata([]);
run(fixture.fallback_cases);

console.log('rows the old-schema /units fallback returns (family null) are ignored, not turned into counts');
front.setUnitMetadata([{ name: 'Kilograms (kg)', family: null, base_factor: null, is_piece: false, aliases: [], is_active: true }]);
check('kg still converts to g', Number(front.convertRecipeQuantity(1, 'kg', 'g')) === 1000);

console.log('inactive units are not used');
front.setUnitMetadata([{ name: 'Sack', family: 'mass', base_factor: 50000, is_piece: false, aliases: [], is_active: false }]);
check('an inactive Sack is unknown, so it passes through', Number(front.convertRecipeQuantity(2, 'Sack', 'kg')) === 2);

console.log('unitKindOf');
front.setUnitMetadata(fixture.units);
check('Sack is mass', front.unitKindOf('Sack') === 'mass');
check('Wedge is a piece', front.unitKindOf('Wedge') === 'piece');
check('Carton is a plain count', front.unitKindOf('Carton') === 'count');
check('unknown unit is null', front.unitKindOf('flurb') === null);

console.log('unit dropdown lists exactly the database units');
const groups = front.groupUnitsForSelect(fixture.units);
const listed = groups.flatMap((g) => g.units);
check('groups are Weight, Volume, Count / pieces in that order', JSON.stringify(groups.map((g) => g.label)) === JSON.stringify(['Weight', 'Volume', 'Count / pieces']), JSON.stringify(groups.map((g) => g.label)));
check('every database unit is listed once', listed.length === fixture.units.length && new Set(listed).size === listed.length, `${listed.length} listed`);
check('no alias is offered as its own choice (cup, kg, tps, pcs, sacks)', !listed.some((n) => ['cup', 'kg', 'tps', 'pcs', 'sacks', 'tbsp'].includes(n)), listed.join(' | '));
check('weight is small -> large', JSON.stringify(groups[0].units) === JSON.stringify(['Grams (g)', 'Kilograms (kg)', 'Sack']), JSON.stringify(groups[0].units));
check('volume is small -> large', JSON.stringify(groups[1].units) === JSON.stringify(['Milliliters (mL)', 'Teaspoons (tsp)', 'Tablespoons (tbsp)', 'Scoop', 'Cups (cup)', 'Liters (L)']), JSON.stringify(groups[1].units));
const withInactive = [...fixture.units, { name: 'Retired', family: 'mass', base_factor: 7, aliases: [], is_active: false }];
check('inactive units are not offered', !front.groupUnitsForSelect(withInactive).flatMap((g) => g.units).includes('Retired'));
check('no rows loaded -> built-in cooking units as a fallback', front.groupUnitsForSelect([]).flatMap((g) => g.units).includes('cup'));

console.log('canonicalUnitName');
front.setUnitMetadata(fixture.units);
check('"cup" -> "Cups (cup)"', front.canonicalUnitName('cup') === 'Cups (cup)');
check('"KG" -> "Kilograms (kg)" (case-insensitive)', front.canonicalUnitName('KG') === 'Kilograms (kg)');
check('"tps" -> "Teaspoons (tsp)"', front.canonicalUnitName('tps') === 'Teaspoons (tsp)');
check('already canonical stays', front.canonicalUnitName('Sack') === 'Sack');
check('unknown unit is returned unchanged', front.canonicalUnitName('flurb') === 'flurb');
front.setUnitMetadata([]);
check('with no database units nothing is renamed', front.canonicalUnitName('cup') === 'cup');

if (failures.length) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll frontend recipe unit checks passed');
