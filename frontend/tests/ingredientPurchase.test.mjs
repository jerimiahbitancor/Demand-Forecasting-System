// Tests utils/ingredientPurchase.js: the wording and the rules behind the
// "how much do you buy" fields of the ingredient form.
//
//   - shouldShowCupField: "One cup weighs (grams)" only shows for items that
//     can really be measured with cups.
//   - purchasePackSummary: the plain-English line that explains the purchase
//     pack, with the cost per unit (and per kilo / per litre).
//
// Plain Node, no test runner:
//   cd frontend && node tests/ingredientPurchase.test.mjs

const {
	shouldShowCupField,
	purchasePackSummary,
	packSizeHelp,
	unitFamily,
	perUnitNoun,
	formatPeso,
} = await import('../src/utils/ingredientPurchase.js');

const failures = [];
function check(label, condition, detail = '') {
	if (condition) console.log(`  PASS  ${label}`);
	else {
		console.log(`  FAIL  ${label}  ${detail}`);
		failures.push(label);
	}
}
const eq = (label, actual, expected) =>
	check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('ingredientPurchase.test.mjs');

// ---------------------------------------------------------------------------
// The unit families
// ---------------------------------------------------------------------------
eq('kg is a mass unit', unitFamily('Kilograms (kg)'), 'mass');
eq('g is a mass unit', unitFamily('Grams (g)'), 'mass');
eq('liters are a volume unit', unitFamily('Liters (L)'), 'volume');
eq('mL is a volume unit', unitFamily('Milliliters (mL)'), 'volume');
eq('pcs are a count unit', unitFamily('Pieces (pcs)'), 'count');
eq('packs are a count unit', unitFamily('Packs'), 'count');
eq('bottles are a count unit', unitFamily('Bottles'), 'count');
eq('no unit is unknown', unitFamily(''), null);

eq('per kg reads as kg', perUnitNoun('Kilograms (kg)'), 'kg');
eq('per pcs reads as pc', perUnitNoun('Pieces (pcs)'), 'pc');

// ---------------------------------------------------------------------------
// "One cup weighs (grams)"
// ---------------------------------------------------------------------------
check(
	'dry goods weighed in kg show the cup field',
	shouldShowCupField({ category: 'Dry Goods', stockUnit: 'Kilograms (kg)', packUnit: '' }) === true
);
check(
	'meat weighed in kg does not show the cup field',
	shouldShowCupField({ category: 'Meat & Poultry', stockUnit: 'Kilograms (kg)', packUnit: '' }) === false
);
check(
	'seafood does not show the cup field',
	shouldShowCupField({ category: 'Seafood', stockUnit: 'Kilograms (kg)', packUnit: '' }) === false
);
check(
	'vegetables do not show the cup field',
	shouldShowCupField({ category: 'Vegetables & Fruits', stockUnit: 'Kilograms (kg)', packUnit: '' }) === false
);
check(
	'herbs and spices do show the cup field',
	shouldShowCupField({ category: 'Herbs & Spices', stockUnit: 'Grams (g)', packUnit: '' }) === true
);
check(
	'a new category shows the cup field',
	shouldShowCupField({ category: 'Something New', stockUnit: 'Kilograms (kg)', packUnit: '' }) === true
);
check(
	'a count unit never shows the cup field',
	shouldShowCupField({ category: 'Dry Goods', stockUnit: 'Pieces (pcs)', packUnit: 'Pieces (pcs)' }) === false
);
check(
	'a pack unit never shows the cup field',
	shouldShowCupField({ category: 'Dry Goods', stockUnit: 'Packs', packUnit: 'Packs' }) === false
);
check(
	'a weight pack stocked in liters shows the cup field',
	shouldShowCupField({ category: 'Beverages, Drinks & Syrups', stockUnit: 'Liters (L)', packUnit: 'Kilograms (kg)' }) === true
);
check(
	'liters without a weight pack do not show the cup field',
	shouldShowCupField({ category: 'Beverages, Drinks & Syrups', stockUnit: 'Liters (L)', packUnit: 'Liters (L)' }) === false
);
check(
	'an unknown unit shows the cup field',
	shouldShowCupField({ category: '', stockUnit: '', packUnit: '' }) === true
);

// ---------------------------------------------------------------------------
// The purchase pack summary
// ---------------------------------------------------------------------------
const pork = purchasePackSummary({
	packQty: '1',
	packUnit: 'Kilograms (kg)',
	packPrice: '300',
	stockUnit: 'Kilograms (kg)',
	derivedUnitCost: 300,
});
eq(
	'pork reads as one kilo for 300 pesos',
	pork.headline,
	'1 purchase pack = 1 kg, and it costs ₱300.00 → ₱300.00 per kg.'
);
eq('pork needs no note', pork.note, '');

const sachet = purchasePackSummary({
	packQty: '50',
	packUnit: 'Grams (g)',
	packPrice: '125',
	stockUnit: 'Grams (g)',
	derivedUnitCost: 2.5,
});
eq(
	'a 50 g sachet also shows the price per kilo',
	sachet.headline,
	'1 purchase pack = 50 g, and it costs ₱125.00 → ₱2.50 per g (₱2,500.00 per kg).'
);

const tray = purchasePackSummary({
	packQty: '250',
	packUnit: 'Grams (g)',
	packPrice: '300',
	stockUnit: 'Kilograms (kg)',
	derivedUnitCost: 1200,
});
eq(
	'a 250 g pack in a kilo stock reads as 1200 per kilo',
	tray.headline,
	'1 purchase pack = 250 g, and it costs ₱300.00 → ₱1,200.00 per kg.'
);
check(
	'a pack counted in another measure explains itself',
	tray.note.includes('If you buy it by the kg, set the pack to 1 kg instead.'),
	tray.note
);
check(
	'a pack counted in another measure says what it holds',
	tray.note.includes('This pack holds 250 g'),
	tray.note
);

const eggs = purchasePackSummary({
	packQty: '30',
	packUnit: 'Pieces (pcs)',
	packPrice: '255',
	stockUnit: 'Pieces (pcs)',
	derivedUnitCost: 8.5,
});
eq(
	'a 30 piece pack reads as 8.50 per pc',
	eggs.headline,
	'1 purchase pack = 30 pcs, and it costs ₱255.00 → ₱8.50 per pc.'
);

const noCost = purchasePackSummary({
	packQty: '1',
	packUnit: 'Bottles',
	packPrice: '60',
	stockUnit: 'Kilograms (kg)',
	derivedUnitCost: null,
});
check(
	'a pack that cannot be compared says so',
	noCost.note.includes('cannot be compared'),
	noCost.note
);

eq(
	'an empty pack has no summary',
	purchasePackSummary({ packQty: '', packUnit: 'Kilograms (kg)', packPrice: '300', stockUnit: 'Kilograms (kg)', derivedUnitCost: 300 }),
	null
);

// ---------------------------------------------------------------------------
// The help texts
// ---------------------------------------------------------------------------
check(
	'the pack help says the portion belongs to the Menu Builder',
	packSizeHelp('Kilograms (kg)').includes('the portion is set in the Menu Builder'),
	packSizeHelp('Kilograms (kg)')
);
check(
	'the pack help tells how to buy by the kilo',
	packSizeHelp('Kilograms (kg)').includes('type 1 and keep Kilograms (kg) if you buy it by the kilo'),
	packSizeHelp('Kilograms (kg)')
);
check(
	'the pack help for a count unit talks about pieces',
	packSizeHelp('Pieces (pcs)').includes('30-piece pack'),
	packSizeHelp('Pieces (pcs)')
);

eq('one peso is written as 1.00', formatPeso(1), '₱1.00');
eq('a big peso keeps its separators', formatPeso(1234.5), '₱1,234.50');

if (failures.length) {
	console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
	process.exit(1);
}
console.log('All ingredientPurchase checks passed.');
