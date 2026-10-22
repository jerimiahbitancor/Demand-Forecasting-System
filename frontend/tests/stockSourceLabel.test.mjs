// Tests utils/stockSourceLabel.js: the Source column of the stock history
// carries ONE word, not the sentence the database keeps as the reason.
//
// Plain Node, no test runner:
//   cd frontend && node tests/stockSourceLabel.test.mjs

const { stockSourceLabel } = await import('../src/utils/stockSourceLabel.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, actual, expected) => check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('stockSourceLabel.test.mjs');

eq('a sale is one word', stockSourceLabel({ transaction_type: 'sale', reason: 'Automatic deduction from mapped product sales' }), 'Sale');
eq('a stock count is one word', stockSourceLabel({ transaction_type: 'adjustment', reason: 'Stock adjustment' }), 'Adjustment');
eq('a purchase restock is one word', stockSourceLabel({ transaction_type: 'restock', reason: 'purchase_order' }), 'Purchase');
eq('a production restock is one word', stockSourceLabel({ transaction_type: 'restock', reason: 'production' }), 'Production');
eq('a return restock is one word', stockSourceLabel({ transaction_type: 'restock', reason: 'return' }), 'Return');
eq('another restock is one word', stockSourceLabel({ transaction_type: 'restock', reason: 'other' }), 'Other');
eq('a restock without a reason is one word', stockSourceLabel({ transaction_type: 'restock', reason: '' }), 'Restock');
eq('the opening stock is one word', stockSourceLabel({ transaction_type: 'restock', reason: 'Initial stock' }), 'Opening');
eq('a return transaction is one word', stockSourceLabel({ transaction_type: 'return' }), 'Return');
eq('an unknown movement is one word', stockSourceLabel({ transaction_type: 'something_else' }), 'Update');
eq('a missing movement is one word', stockSourceLabel({}), 'Update');
eq('every source is a single word', [
  stockSourceLabel({ transaction_type: 'sale' }),
  stockSourceLabel({ transaction_type: 'adjustment' }),
  stockSourceLabel({ transaction_type: 'restock', reason: 'purchase_order' }),
  stockSourceLabel({ transaction_type: 'restock', reason: 'Initial stock' }),
].every((word) => word.split(/\s+/).length === 1), true);

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All stockSourceLabel checks passed.');
