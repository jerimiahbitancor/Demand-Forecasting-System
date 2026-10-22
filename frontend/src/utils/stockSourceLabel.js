// The "Source" of a stock movement, as ONE word.
//
// The raw reason in the database is a whole sentence ("Automatic deduction
// from mapped product sales", "Stock adjustment"), which fills the Source
// column of the stock history. The column only carries the single word that
// says where the movement came from; the details stay in the note under it.

// The reasons the restock form can send.
const REASON_WORDS = {
  purchase_order: 'Purchase',
  production: 'Production',
  return: 'Return',
  adjustment: 'Adjustment',
  other: 'Other',
  'Initial stock': 'Opening',
};

export function stockSourceLabel(transaction = {}) {
  const type = String(transaction.transaction_type || '').toLowerCase();
  const reason = String(transaction.reason || '').trim();

  if (type === 'sale') return 'Sale';
  if (type === 'adjustment') return 'Adjustment';
  if (type === 'return') return 'Return';
  if (type === 'restock') return REASON_WORDS[reason] || 'Restock';
  if (reason && REASON_WORDS[reason]) return REASON_WORDS[reason];
  return 'Update';
}

export default stockSourceLabel;
