// Tests utils/formatStockQty.js: stock amounts show up to 3 decimals, count
// units show a whole number when whole (DFS Formulas v3.2).
//
// Plain Node, no test runner:
//   cd frontend && node tests/formatStockQty.test.mjs

const { formatStockQty, isCountUnit, cleanStockNoteText } = await import('../src/utils/formatStockQty.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, actual, expected) => check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('formatStockQty.test.mjs');

eq('4.0999999999 kg -> 4.1', formatStockQty(4.0999999999, 'kg'), '4.1');
eq('0.706999999 L -> 0.707', formatStockQty(0.706999999, 'L'), '0.707');
eq('2 kg -> 2', formatStockQty(2, 'kg'), '2');
eq('10.000 g -> 10', formatStockQty('10.000', 'g'), '10');
eq('11.250 g -> 11.25', formatStockQty('11.250', 'g'), '11.25');
eq('"Kilograms (kg)" is not a count unit', formatStockQty(1.5, 'Kilograms (kg)'), '1.5');
eq('36 pcs -> 36', formatStockQty(36, 'pcs'), '36');
eq('0.5 pcs -> 0.5', formatStockQty(0.5, 'pcs'), '0.5');
eq('35.99999999 pcs -> 36', formatStockQty(35.99999999, 'pcs'), '36');
eq('1.23456 pcs -> 1.235', formatStockQty(1.23456, 'pcs'), '1.235');
eq('"Pieces (pcs)" counts as pcs', formatStockQty(12, 'Pieces (pcs)'), '12');
eq('sachets are a count unit', formatStockQty(10, 'sachets'), '10');
eq('packs are a count unit', formatStockQty(3, 'Packs'), '3');
eq('unknown unit -> up to 3 decimals', formatStockQty(1.2, 'tali'), '1.2');
eq('no unit -> up to 3 decimals', formatStockQty(7, undefined), '7');
eq('numeric string from Postgres', formatStockQty('4.0999999999', 'kg'), '4.1');
eq('null -> dash', formatStockQty(null, 'kg'), '—');
eq('undefined -> dash', formatStockQty(undefined, 'pcs'), '—');
eq('NaN -> dash', formatStockQty('abc', 'kg'), '—');
eq('0 kg -> 0', formatStockQty(0, 'kg'), '0');
eq('0 pcs -> 0', formatStockQty(0, 'pcs'), '0');
check('kg is not a count unit', isCountUnit('kg') === false);
check('pcs is a count unit', isCountUnit('pcs') === true);

// The transaction notes carry the same numbers, cleaned up the same way.
eq('note: whole amount loses its zeros', cleanStockNoteText('Received 150.000000 Grams (g); stock is now 150.000000 Grams (g).'), 'Received 150 Grams (g); stock is now 150 Grams (g).');
eq('note: fraction keeps its digits', cleanStockNoteText('applied: 0.500000 Grams (g).'), 'applied: 0.5 Grams (g).');
eq('note: three decimals kept', cleanStockNoteText('shortfall: 2.983500 kg'), 'shortfall: 2.9835 kg');
eq('note: two decimals lose their trailing zero', cleanStockNoteText('exact requested: 12.50 g'), 'exact requested: 12.5 g');
eq('note: version-like text is left alone', cleanStockNoteText('upload 1.2.3 of 2026-10-22'), 'upload 1.2.3 of 2026-10-22');
eq('note: null -> empty', cleanStockNoteText(null), '');
eq('note: text without numbers is left alone', cleanStockNoteText('Manual stock count'), 'Manual stock count');

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All formatStockQty checks passed.');
