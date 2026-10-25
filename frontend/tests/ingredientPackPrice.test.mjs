// Tests utils/ingredientPackPrice.js: pack price plus pack quantity give the
// cost per stock unit for pieces (count) and grams/mass units.
//
// Plain Node, no test runner:
//   cd frontend && node tests/ingredientPackPrice.test.mjs

const { packQuantityKind, pricePerUnitFromPack, shouldShowPackFields } = await import('../src/utils/ingredientPackPrice.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, actual, expected) => check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('ingredientPackPrice.test.mjs');

eq('255 / 30 pieces = 8.5', pricePerUnitFromPack({ unit: 'Pieces (pcs)', pieces_per_pack: '30', pack_price: '255' }), 8.5);
eq('fractions are accepted', pricePerUnitFromPack({ unit: 'pcs', pieces_per_pack: '12', pack_price: '1/2' }), 0.041667);
eq('500 / 250 g = 2 per gram', pricePerUnitFromPack({ unit: 'Grams (g)', grams_per_pack: '250', pack_price: '500' }), 2);
eq('grams per pack does not price kilograms', pricePerUnitFromPack({ unit: 'Kilograms (kg)', grams_per_pack: '500', pack_price: '100' }), null);
eq('missing pack price -> null', pricePerUnitFromPack({ unit: 'Pieces (pcs)', pieces_per_pack: '30' }), null);
eq('missing pieces per pack -> null', pricePerUnitFromPack({ unit: 'Pieces (pcs)', pack_price: '255' }), null);
eq('missing grams per pack -> null', pricePerUnitFromPack({ unit: 'Grams (g)', pack_price: '500' }), null);
eq('zero pack quantity -> null', pricePerUnitFromPack({ unit: 'Pieces (pcs)', pieces_per_pack: '0', pack_price: '255' }), null);
eq('volume units do not use pack pricing', pricePerUnitFromPack({ unit: 'Liters (L)', grams_per_pack: '500', pack_price: '100' }), null);
eq('pieces use pieces per pack', packQuantityKind('Pieces (pcs)'), 'pieces');
eq('grams use grams per pack', packQuantityKind('Grams (g)'), 'grams');
eq('kilograms do not use pack pricing', packQuantityKind('Kilograms (kg)'), null);
eq('volume has no pack quantity', packQuantityKind('Liters (L)'), null);
check('piece units show the pack fields', shouldShowPackFields({ unit: 'Pieces (pcs)' }));
check('gram units show the pack fields', shouldShowPackFields({ unit: 'Grams (g)' }));
check('kilogram units hide the pack fields', !shouldShowPackFields({ unit: 'Kilograms (kg)' }));
check('existing pack data is hidden for kilograms', !shouldShowPackFields({ unit: 'Kilograms (kg)', grams_per_pack: '250' }));
check('volume units without pack data hide the pack fields', !shouldShowPackFields({ unit: 'Liters (L)' }));

if (failures.length) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nAll checks passed.');
