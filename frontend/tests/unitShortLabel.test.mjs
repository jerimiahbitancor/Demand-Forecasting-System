// Tests utils/recipeUnits.js: unitShortLabel turns a full unit name into the
// short form used in the ingredient forms ("Grams (g)" -> "g").
//
// Plain Node, no test runner:
//   cd frontend && node tests/unitShortLabel.test.mjs

const { unitShortLabel } = await import('../src/utils/recipeUnits.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, actual, expected) => check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('unitShortLabel.test.mjs');

eq('grams become g', unitShortLabel('Grams (g)'), 'g');
eq('kilogram becomes kg', unitShortLabel('Kilogram (kg)'), 'kg');
eq('pieces become pcs', unitShortLabel('Pieces (pcs)'), 'pcs');
eq('milliliter becomes mL', unitShortLabel('Milliliter (mL)'), 'mL');
eq('a plain unit is kept', unitShortLabel('kg'), 'kg');
eq('an empty unit falls back', unitShortLabel(''), 'unit');
eq('a missing unit falls back', unitShortLabel(null), 'unit');

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All unitShortLabel checks passed.');
