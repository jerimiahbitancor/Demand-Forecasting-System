// Tests features/dashboard/utils/dashboardPanels.js (Dashboard panels).
//
// Plain Node, no test runner:
//   cd frontend && node tests/dashboardPanels.test.mjs

const {
  manilaToday, addDays, chartRange, toChartRows, pickBestSellers, pickIngredients, statusBadgeClass,
} = await import('../src/features/dashboard/utils/dashboardPanels.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, a, b) => check(label, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log('dashboardPanels.test.mjs');

// 2026-10-13 20:30 UTC is already Oct 14 in Manila.
eq('Manila date, not UTC', manilaToday(new Date('2026-10-13T20:30:00Z')), '2026-10-14');
eq('addDays across a month', addDays('2026-10-30', 3), '2026-11-02');
eq('Last 7 Days = today-7 .. today+6', chartRange('week', '2026-10-14'), { from: '2026-10-07', to: '2026-10-20' });
eq('Last 30 Days = today-30 .. today+6', chartRange('month', '2026-10-14'), { from: '2026-09-14', to: '2026-10-20' });

const rows = toChartRows([
  { date: '2026-10-13', actual: 120, forecast: 110, future: null, closed: false },
  { date: '2026-10-14', actual: null, forecast: 115, future: 115, closed: false },
  { date: '2026-10-18', actual: null, forecast: null, future: null, closed: true },
]);
eq('chart row label', rows[0].day, 'Oct 13');
check('closed day keeps its row with nulls (a gap)', rows[2].closed && rows[2].future === null && rows[2].actual === null);
check('today on both forecast lines', rows[1].forecast === 115 && rows[1].future === 115);

const best = pickBestSellers([
  { rank: 3, product: 'C', quantitySold: 30, performanceRatio: 1.1 },
  { rank: 1, product: 'A', quantitySold: 90, performanceRatio: 2.456 },
  { rank: 2, product: 'B', quantitySold: 50, performanceRatio: 1.5 },
  { rank: 7, product: 'NoRatio', quantitySold: 99, performanceRatio: null },
  { rank: 4, product: 'D', quantitySold: 20, performanceRatio: 0.9 },
  { rank: 5, product: 'E', quantitySold: 10, performanceRatio: 0.5 },
  { rank: 6, product: 'F', quantitySold: 5, performanceRatio: 0.2 },
]);
eq('best sellers: top 5 by rank, ratio required', best.map((b) => b.name), ['A', 'B', 'C', 'D', 'E']);
eq('ratio to 2 decimals', best[0].ratio, '2.46');

const ing = pickIngredients([
  { name: 'Oil', status: 'Normal', forecastedNeed: 50, unit: 'L' },
  { name: 'Egg', status: 'Low', forecastedNeed: 30, unit: 'pcs' },
  { name: 'Rice', status: 'Critical', forecastedNeed: 10, unit: 'kg' },
  { name: 'Pork', status: 'Critical', forecastedNeed: 12, unit: 'kg' },
  { name: 'Salt', status: 'Excess', forecastedNeed: 99, unit: 'kg' },
  { name: 'Garlic', status: 'Low', forecastedNeed: 2, unit: 'kg' },
]);
eq('ingredients: severity, then biggest need', ing.map((i) => i.name), ['Pork', 'Rice', 'Egg', 'Garlic', 'Oil']);
eq('badge classes', ['Critical', 'Low', 'Normal', 'Excess'].map(statusBadgeClass), ['urgent', 'warning', 'ok', 'ok']);
eq('empty inputs are safe', [pickBestSellers(null), pickIngredients(undefined), toChartRows(null)], [[], [], []]);

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All dashboardPanels checks passed.');
