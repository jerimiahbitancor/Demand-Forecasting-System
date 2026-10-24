// Shared conversion cases keep the frontend and ML-service rules aligned.
// Run: cd backend && node tests/recipeUnits.crosscheck.test.mjs
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

front.setUnitMetadata(fixture.units);
back.setUnitMetadata(fixture.units);
for (const c of fixture.cases) {
  const f = Number(front.convertRecipeQuantity(c.quantity, c.from, c.to));
  const b = Number(back.convertRecipeQuantity(c.quantity, c.from, c.to));
  check(`${c.label} (frontend)`, Math.abs(f - c.expected) < 1e-9, `expected ${c.expected}, got ${f}`);
  check(`${c.label} (backend)`, Math.abs(b - c.expected) < 1e-9, `expected ${c.expected}, got ${b}`);
}

check('Pack is rejected by frontend conversion', Number.isNaN(front.convertRecipeQuantity(1, 'Pack', 'g')));
check('zero Pack is still rejected by frontend conversion', Number.isNaN(front.convertRecipeQuantity(0, 'Pack', 'g')));
check(
  'Pack is rejected by backend conversion',
  (() => {
    try {
      back.convertRecipeQuantity(1, 'Pack', 'g');
      return false;
    } catch (error) {
      return error instanceof back.UnitConversionError;
    }
  })()
);
check(
  'zero Pack is still rejected by backend conversion',
  (() => {
    try {
      back.convertRecipeQuantity(0, 'Pack', 'g');
      return false;
    } catch (error) {
      return error instanceof back.UnitConversionError;
    }
  })()
);
check('Cups are rejected by frontend conversion', Number.isNaN(front.convertRecipeQuantity(1, 'cup', 'mL')));
check(
  'Cups are rejected by backend conversion',
  (() => {
    try {
      back.convertRecipeQuantity(1, 'cup', 'mL');
      return false;
    } catch (error) {
      return error instanceof back.UnitConversionError;
    }
  })()
);
check('mass-to-volume conversion is rejected by frontend', Number.isNaN(front.convertRecipeQuantity(1, 'g', 'mL')));

const groups = front.groupUnitsForSelect(fixture.units);
const listed = groups.flatMap((g) => g.units);
check('exactly seven supported units are offered', listed.length === 7 && new Set(listed).size === 7);
check('Pack is not offered', !listed.some((name) => name.toLowerCase().includes('pack')));
check('Cups are not offered', !listed.some((name) => name.toLowerCase().includes('cup')));

if (failures.length) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll frontend/backend recipe unit checks passed');
