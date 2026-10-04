// Tests POS modifier handling (utils/salesModifiers.js):
//   - name parsing: "Marinated Porksilog NO EGG" is Marinated Porksilog
//   - upload totals: modifier plates count toward the base dish, and are
//     also stored per keyword
//   - stock deduction: a NO EGG plate uses no egg, a NO RICE plate no rice
//   - uploadService really uses these rules (base names, not modifier names)
//
// Run:  cd backend && node tests/salesModifiers.test.js
// No network, no Supabase, no credentials.

const {
  splitModifiers,
  aggregateSalesRecords,
  computeStockDeductions,
} = require('../utils/salesModifiers');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}  ${detail}`);
    failures.push(label);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('salesModifiers.test.js');
const KEYWORDS = ['NO RICE', 'NO EGG']; // as they come from modifier_rules

// ---------------------------------------------------------------
console.log('\n-- name parsing');
const porksilog = ['Marinated Porksilog', 'Marinated Porksilog NO EGG', 'Marinated Porksilog NO RICE']
  .map((name) => splitModifiers(name, KEYWORDS).baseName);
check('the three Porksilog names give one base', same([...new Set(porksilog)], ['Marinated Porksilog']), JSON.stringify(porksilog));

const cases = [
  ['Marinated Porksilog (NO EGG)', 'Marinated Porksilog', ['NO EGG']],
  ['Marinated Porksilog - NO RICE', 'Marinated Porksilog', ['NO RICE']],
  ['Marinated Porksilog no rice', 'Marinated Porksilog', ['NO RICE']],
  ['Marinated Porksilog NO RICE NO EGG', 'Marinated Porksilog', ['NO RICE', 'NO EGG']],
  ['Marinated Porksilog, NO RICE, NO EGG', 'Marinated Porksilog', ['NO RICE', 'NO EGG']],
  ['Marinated Porksilog [no egg]', 'Marinated Porksilog', ['NO EGG']],
  ['Marinated Porksilog (NO RICE, NO EGG)', 'Marinated Porksilog', ['NO RICE', 'NO EGG']],
  ['Marinated Porksilog  NO   EGG', 'Marinated Porksilog', ['NO EGG']],
];
for (const [name, base, mods] of cases) {
  const got = splitModifiers(name, KEYWORDS);
  check(`"${name}" -> "${base}" + ${JSON.stringify(mods)}`,
    got.baseName === base && same(got.modifiers, mods) && got.modifierOnly === false, JSON.stringify(got));
}

const untouched = [
  'Sinigang NO RICE Bowl',          // modifier in the middle
  'NO RICE Sinigang',               // modifier at the start
  'Tapsilog No Egg-cellent Special', // "No Egg" not a whole trailing word
  'Casino Rice',                    // ends "NO RICE" only inside a word
  'Bilao (Large)',                  // bracket that is not a modifier
  'Tapa (NO RICE extra)',           // bracket with other text in it
  'Chick & Fries NO FRIES',         // NO FRIES is not a rule
];
for (const name of untouched) {
  const got = splitModifiers(name, KEYWORDS);
  check(`"${name}" is left untouched`,
    got.baseName === name && got.modifiers.length === 0 && !got.modifierOnly, JSON.stringify(got));
}

for (const name of ['NO RICE', '(NO EGG)', 'no rice no egg']) {
  const got = splitModifiers(name, KEYWORDS);
  check(`"${name}" alone is modifier-only`, got.modifierOnly === true && got.baseName === '', JSON.stringify(got));
}

check('no rules -> names used as-is',
  splitModifiers('Marinated Porksilog NO EGG', []).baseName === 'Marinated Porksilog NO EGG');
check('keyword case in the rules does not matter',
  splitModifiers('Porksilog NO EGG', ['no egg']).baseName === 'Porksilog');

// ---------------------------------------------------------------
console.log('\n-- upload totals');
const productIdByName = new Map([['marinated porksilog', 1040], ['cheesy tapa', 967]]);
const day = '2026-09-28';
const file = [
  { name: 'Marinated Porksilog', sold: 10, refunded: 0, saleDate: day, category: 'Silog' },
  { name: 'Marinated Porksilog NO EGG', sold: 3, refunded: 0, saleDate: day, category: 'Silog' },
  { name: 'Marinated Porksilog NO RICE', sold: 2, refunded: 0, saleDate: day, category: 'Silog' },
  { name: 'NO RICE', sold: 4, refunded: 0, saleDate: day },
];
const agg = aggregateSalesRecords(file, { productIdByName, keywords: KEYWORDS, uploadId: 7 });
check('quantity_sold = 15 for the one base product',
  same(agg.dailySalesRows, [{ product_id: 1040, sale_date: day, quantity_sold: 15, upload_id: 7 }]),
  JSON.stringify(agg.dailySalesRows));
const modQty = Object.fromEntries(agg.modifierRows.map((r) => [r.keyword, r.quantity]));
check('modifiers stored: NO EGG 3, NO RICE 2', modQty['NO EGG'] === 3 && modQty['NO RICE'] === 2, JSON.stringify(agg.modifierRows));
check('modifier rows carry product, date and upload', agg.modifierRows.every((r) => r.product_id === 1040 && r.sale_date === day && r.upload_id === 7));
check('modifier-only row reported, not counted', same(agg.modifierOnlyNames, ['NO RICE']));

const withRefund = aggregateSalesRecords([
  ...file.slice(0, 3),
  { name: 'Marinated Porksilog NO EGG', sold: 0, refunded: 1, saleDate: day },
], { productIdByName, keywords: KEYWORDS });
const refundEgg = withRefund.modifierRows.find((r) => r.keyword === 'NO EGG');
check('a refund on a modifier row reduces the dish total (15 -> 14)', withRefund.dailySalesRows[0].quantity_sold === 14);
check('... and that modifier count (3 -> 2)', refundEgg && refundEgg.quantity === 2, JSON.stringify(withRefund.modifierRows));

const only = aggregateSalesRecords([{ name: 'Cheesy Tapa NO RICE', sold: 5, refunded: 0, saleDate: day }],
  { productIdByName, keywords: KEYWORDS });
check('a file with ONLY the modifier row still lands on the base product',
  only.dailySalesRows.length === 1 && only.dailySalesRows[0].product_id === 967 && only.dailySalesRows[0].quantity_sold === 5);

const both = aggregateSalesRecords([
  { name: 'Marinated Porksilog', sold: 5, refunded: 0, saleDate: day },
  { name: 'Marinated Porksilog NO RICE NO EGG', sold: 2, refunded: 0, saleDate: day },
], { productIdByName, keywords: KEYWORDS });
const bothQty = Object.fromEntries(both.modifierRows.map((r) => [r.keyword, r.quantity]));
check('"NO RICE NO EGG" counts toward both keywords', both.dailySalesRows[0].quantity_sold === 7 && bothQty['NO RICE'] === 2 && bothQty['NO EGG'] === 2);

const overRefund = aggregateSalesRecords([
  { name: 'Marinated Porksilog', sold: 1, refunded: 3, saleDate: day },
  { name: 'Marinated Porksilog NO EGG', sold: 2, refunded: 0, saleDate: day },
], { productIdByName, keywords: KEYWORDS });
check('total clamped at 0 once after summing (1 - 3 + 2 = 0)', overRefund.dailySalesRows[0].quantity_sold === 0);
check('a modifier count can never exceed the dish total', overRefund.modifierRows.length === 0, JSON.stringify(overRefund.modifierRows));

// ---------------------------------------------------------------
console.log('\n-- stock deduction');
const RICE = 92;
const EGG = 156;
const PORK = 155;
const recipes = [
  { product_id: 1040, ingredient_id: RICE, per: 1 },
  { product_id: 1040, ingredient_id: EGG, per: 1 },
  { product_id: 1040, ingredient_id: PORK, per: 50 },
  { product_id: 944, ingredient_id: RICE, per: 1 }, // Breaded Porkchop: no egg in recipe
];
const ingredientIdByKeyword = new Map([['NO RICE', RICE], ['NO EGG', EGG]]);
const deductions = computeStockDeductions({
  dailySalesRows: agg.dailySalesRows,
  modifierRows: agg.modifierRows,
  recipeRows: recipes,
  activeProductIds: new Set([1040, 944]),
  ingredientIdByKeyword,
  perServingFor: (r) => r.per,
});
check('egg 12 (15 plates - 3 NO EGG)', deductions.get(EGG) === 12, String(deductions.get(EGG)));
check('rice 13 (15 plates - 2 NO RICE)', deductions.get(RICE) === 13, String(deductions.get(RICE)));
check('pork unaffected: 15 x 50 = 750', deductions.get(PORK) === 750, String(deductions.get(PORK)));

const porkchop = computeStockDeductions({
  dailySalesRows: [{ product_id: 944, sale_date: day, quantity_sold: 6 }],
  modifierRows: [{ product_id: 944, sale_date: day, keyword: 'NO EGG', quantity: 2 }],
  recipeRows: recipes,
  activeProductIds: new Set([944]),
  ingredientIdByKeyword,
  perServingFor: (r) => r.per,
});
check('product without egg in its recipe: NO EGG changes nothing (rice 6, no egg)',
  porkchop.get(RICE) === 6 && !porkchop.has(EGG), JSON.stringify([...porkchop]));

const tooMany = computeStockDeductions({
  dailySalesRows: [{ product_id: 1040, sale_date: day, quantity_sold: 2 }],
  modifierRows: [{ product_id: 1040, sale_date: day, keyword: 'NO EGG', quantity: 5 }],
  recipeRows: recipes,
  activeProductIds: new Set([1040]),
  ingredientIdByKeyword,
  perServingFor: (r) => r.per,
});
check('never below 0: more NO EGG plates than plates deducts no egg, never adds', !tooMany.has(EGG));

const inactive = computeStockDeductions({
  dailySalesRows: agg.dailySalesRows, modifierRows: agg.modifierRows, recipeRows: recipes,
  activeProductIds: new Set(), ingredientIdByKeyword, perServingFor: (r) => r.per,
});
check('inactive products deduct nothing (unchanged rule)', inactive.size === 0);

const unmapped = computeStockDeductions({
  dailySalesRows: agg.dailySalesRows, modifierRows: agg.modifierRows, recipeRows: recipes,
  activeProductIds: new Set([1040]), ingredientIdByKeyword: new Map(), perServingFor: (r) => r.per,
});
check('a keyword with no rule removes nothing (egg 15, rice 15)', unmapped.get(EGG) === 15 && unmapped.get(RICE) === 15);

// ---------------------------------------------------------------
console.log('\n-- uploadService uses the base name');
const uploadService = require('../services/uploadService');
const rows = [
  { 'Item name': 'Marinated Porksilog' },
  { 'Item name': 'Marinated Porksilog NO EGG' },
  { 'Item name': 'Marinated Porksilog - NO RICE' },
  { 'Item name': 'Cheesy Tapa NO RICE' },
  { 'Item name': 'NO EGG' },
];
const names = uploadService.extractUniqueProductNames(rows, KEYWORDS);
check('extractUniqueProductNames returns base names only',
  same(names, ['Marinated Porksilog', 'Cheesy Tapa']), JSON.stringify(names));
check('without rules (migration not run) names are kept as before',
  uploadService.extractUniqueProductNames(rows, []).includes('Marinated Porksilog NO EGG'));

console.log();
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All sales modifier checks passed.');
process.exit(0);
