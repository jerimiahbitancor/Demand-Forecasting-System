// Display rule for FORECAST quantities of items sold.
//
// The model predicts an expected value (average demand), so a forecast is a
// decimal (ml-service stores round(predicted, 2)). That decimal stays as it
// is everywhere it is used in math: metrics, demand classification,
// ingredient needs and revenue (quantity x price). Rounding each product
// first and then multiplying or adding would add error.
//
// So: round ONLY at the moment a quantity of items sold is shown, and for a
// total, add up the raw values first and round once (never add up values
// that were already rounded).
//
// Not for ingredient amounts (g, kg, mL): those use formatStockQty.

// null / undefined / not a finite number -> null; otherwise the nearest whole number.
export function roundItems(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

// 4.37 -> "4"; 1234.6 -> "1,235"; null -> "—".
// withUnit: "4 items sold" / "1 item sold".
export function formatItemsSold(value, { withUnit = false } = {}) {
  const n = roundItems(value);
  if (n === null) return '—';
  const text = n.toLocaleString('en-US');
  if (!withUnit) return text;
  return `${text} ${n === 1 ? 'item sold' : 'items sold'}`;
}
