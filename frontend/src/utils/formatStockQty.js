// Display rule for stock and ingredient amounts:
// the database keeps the full value; the screen shows up to 3 decimals and
// hides insignificant trailing zeros.
//   4.0999999999 kg -> "4.1"     0.706999999 L -> "0.707"
// Count units (pcs) -> a whole number when whole,
// otherwise up to 3 decimals without trailing zeros: 36 pcs -> "36",
// 0.5 pcs -> "0.5".
// Display only: never round a value before it is saved or used in math.

import { unitKindOf } from './recipeUnits.js';

// Fallback for count units the unit tables may not list (or before
// GET /units has loaded). Matched on the whole unit and on the
// abbreviation in brackets, e.g. "Pieces (pcs)" -> "pcs".
const COUNT_UNIT_WORDS = new Set([
  'pc', 'pcs', 'piece', 'pieces',
]);

export function isCountUnit(unit) {
  const text = String(unit || '').trim().toLowerCase();
  if (!text) return false;
  const kind = unitKindOf(text);
  if (kind === 'count' || kind === 'piece') return true;
  if (kind === 'mass' || kind === 'volume') return false;
  const inBrackets = /\(([^)]+)\)/.exec(text);
  const candidates = [text, inBrackets ? inBrackets[1].trim() : null].filter(Boolean);
  return candidates.some((c) => {
    const k = unitKindOf(c);
    return k === 'count' || k === 'piece' || COUNT_UNIT_WORDS.has(c);
  });
}

export function formatStockQty(value, unit) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (isCountUnit(unit)) {
    // Up to 3 decimals, trailing zeros dropped: 36 -> "36", 0.5 -> "0.5".
    return String(Number(n.toFixed(3)));
  }
  return n.toFixed(3).replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1');
}

// The transaction notes are plain text written by the database. Every amount
// in them is cleaned up the same way the numbers are, so the stock history
// never shows the raw decimals of the database:
//   "Received 150.000000 Grams (g)" -> "Received 150 Grams (g)"
//   "applied: 0.500000" -> "applied: 0.5"
export function cleanStockNoteText(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/(\d+)\.(\d*?[1-9])0+(?!\d)/g, '$1.$2')
    .replace(/(\d+)\.0+(?!\d)/g, '$1');
}

export default formatStockQty;
