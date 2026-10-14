// Tests utils/formatStockQty.js: stock amounts show 3 decimals, count
// units show a whole number when whole (DFS Formulas v3.2).
//
// Plain Node, no test runner:
//   cd frontend && node tests/formatStockQty.test.mjs

const { formatStockQty, isCountUnit } = await import('../src/utils/formatStockQty.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, actual, expected) => check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('formatStockQty.test.mjs');

eq('4.0999999999 kg -> 4.100', formatStockQty(4.0999999999, 'kg'), '4.100');
eq('0.706999999 L -> 0.707', formatStockQty(0.706999999, 'L'), '0.707');
eq('2 kg -> 2.000', formatStockQty(2, 'kg'), '2.000');
eq('"Kilograms (kg)" is not a count unit', formatStockQty(1.5, 'Kilograms (kg)'), '1.500');
eq('36 pcs -> 36', formatStockQty(36, 'pcs'), '36');
eq('0.5 pcs -> 0.5', formatStockQty(0.5, 'pcs'), '0.5');
eq('35.99999999 pcs -> 36', formatStockQty(35.99999999, 'pcs'), '36');
eq('1.23456 pcs -> 1.235', formatStockQty(1.23456, 'pcs'), '1.235');
eq('"Pieces (pcs)" counts as pcs', formatStockQty(12, 'Pieces (pcs)'), '12');
eq('sachets are a count unit', formatStockQty(10, 'sachets'), '10');
eq('packs are a count unit', formatStockQty(3, 'Packs'), '3');
eq('unknown unit -> 3 decimals', formatStockQty(1.2, 'tali'), '1.200');
eq('no unit -> 3 decimals', formatStockQty(7, undefined), '7.000');
eq('numeric string from Postgres', formatStockQty('4.0999999999', 'kg'), '4.100');
eq('null -> dash', formatStockQty(null, 'kg'), '—');
eq('undefined -> dash', formatStockQty(undefined, 'pcs'), '—');
eq('NaN -> dash', formatStockQty('abc', 'kg'), '—');
eq('0 kg -> 0.000', formatStockQty(0, 'kg'), '0.000');
eq('0 pcs -> 0', formatStockQty(0, 'pcs'), '0');
check('kg is not a count unit', isCountUnit('kg') === false);
check('pcs is a count unit', isCountUnit('pcs') === true);

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All formatStockQty checks passed.');
