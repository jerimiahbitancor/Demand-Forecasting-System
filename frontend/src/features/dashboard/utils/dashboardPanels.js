import { fmt2 } from "../../../utils/formatNumber.js";
// Pure helpers for the three Dashboard panels (FullyOperational.jsx):
// Demand Overview chart, Top Best Sellers, Top Ingredients to Prepare.
// The data comes from the same endpoints the Analytics pages use, so the
// Dashboard and Analytics always show the same numbers.

// "YYYY-MM-DD" for the current day in Asia/Manila (the business calendar),
// whatever time zone the browser is in.
export function manilaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// Calendar arithmetic on a "YYYY-MM-DD" string (UTC math, no DST surprises).
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// "Last 7 Days" = today-7 .. today+6; "Last 30 Days" = today-30 .. today+6.
// The forward 6 days show the coming forecast next to the past sales.
export function chartRange(period, today = manilaToday()) {
  const back = period === 'month' ? 30 : 7;
  return { from: addDays(today, -back), to: addDays(today, 6) };
}

export function shortDateLabel(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// prediction.series -> Recharts rows. A closed day keeps its row with null
// values, so the line shows a gap (connectNulls={false}), never a 0.
export function toChartRows(series) {
  return (series || []).map((p) => ({
    date: p.date,
    day: shortDateLabel(p.date),
    actual: p.actual ?? null,
    forecast: p.forecast ?? null,
    future: p.future ?? null,
    closed: Boolean(p.closed),
  }));
}

// performanceRatio.rows -> top 5 by rank, products with a ratio only.
export function pickBestSellers(rows, limit = 5) {
  return (rows || [])
    .filter((r) => r.performanceRatio !== null && r.performanceRatio !== undefined)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => ({
      name: r.product,
      sold: r.quantitySold,
      ratio: fmt2(r.performanceRatio),
    }));
}

const STATUS_ORDER = { Critical: 0, Low: 1, Normal: 2, Excess: 3 };

// daily.rows -> top 5: worst stock status first, then the biggest need.
export function pickIngredients(rows, limit = 5) {
  return [...(rows || [])]
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      || (Number(b.forecastedNeed) || 0) - (Number(a.forecastedNeed) || 0))
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      need: r.forecastedNeed,
      unit: r.unit,
      status: r.status,
    }));
}

// Stock status -> the existing .ingredient-status badge classes.
export function statusBadgeClass(status) {
  if (status === 'Critical') return 'urgent';
  if (status === 'Low') return 'warning';
  return 'ok';
}
