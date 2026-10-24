// The short detail line of a stock movement.
//
// The Source column of the stock history carries ONE word (see
// stockSourceLabel.js). Everything the movement has to say beyond that word
// lives in this short line under the amount, so the table stays readable:
//   sale with a shortfall -> "Short 2.5 Kilograms (kg)"
//   sale without one      -> nothing (the change and the balance say it all)
//   restock with received quantity -> "Received 50 Grams (g)"
//   stock count           -> the note the owner typed
// The long text the database writes for a sale ("Exact requested: 2.8;
// rounded request: 2.8; applied: 2.8; shortfall: 0 Kilograms (kg)") is not
// shown: the applied amount is already the quantity change of the row.

import { formatStockQty, cleanStockNoteText } from './formatStockQty.js';

// The note of a sale is written by the database, not by the owner.
const AUTO_SALE_NOTE = /^exact requested:/i;

const amount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function stockMovementDetail(transaction = {}, stockUnit = '') {
  const unit = transaction.unit || stockUnit || '';
  const type = String(transaction.transaction_type || '').toLowerCase();
  const parts = [];

  // Stock that could not be handed out: the demand that is still open.
  // A delivery never pays it off (the delivery is stock on hand), so the line
  // says how it is closed: a stock count.
  const shortfall = amount(transaction.shortfall_quantity);
  if (shortfall !== null && shortfall > 0) {
    parts.push(`Short ${formatStockQty(shortfall, unit)} ${unit}`.trim());
    parts.push('a stock count clears it');
  }

  // A note the owner typed is worth keeping; the wording the database writes
  // is not (the balance and the change are shown in their own columns).
  const note = cleanStockNoteText(transaction.notes || '');
  if (note && !AUTO_SALE_NOTE.test(note)) {
    for (const part of note.split(' · ')) {
      const text = part.trim();
      if (!text) continue;
      if (/^stock is now\b/i.test(text)) continue;
      if (/^received\b/i.test(text)) continue;
      parts.push(text);
    }
  }

  // Show the received quantity when it differs from the amount added to stock.
  if (type === 'restock') {
    const received = amount(transaction.received_quantity);
    const change = amount(transaction.quantity);
    if (received !== null && received > 0 && (received !== change || change === null)) {
      parts.push(`Received ${formatStockQty(received, unit)} ${unit}`.trim());
    }
  }

  return parts.join(' · ');
}

export default stockMovementDetail;
