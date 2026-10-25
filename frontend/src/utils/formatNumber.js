// One display rule for decimals (owner, Oct 26 2026): at most 2 decimals,
// and a value whose decimals are ".00" shows without them, whatever its unit
// or currency:
//   9      -> "9"        9.00 -> "9"       9.5 -> "9.50"     1234.5 -> "1,234.50"
//   ₱9.00  -> "₱9"       ₱115.50 -> "₱115.50"
// Display only: the stored value and the math keep every decimal.

// -> "9" | "9.50" | null for no value. grouping: thousands separators.
export function fmt2(value, { grouping = true } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const whole = Number.isInteger(rounded);
  return rounded.toLocaleString('en-US', {
    useGrouping: grouping,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

// "₱9" | "₱115.50" | fallback ("—") for no value.
export function peso(value, { fallback = '—', space = false } = {}) {
  const text = fmt2(value);
  return text === null ? fallback : `₱${space ? ' ' : ''}${text}`;
}

export default fmt2;
