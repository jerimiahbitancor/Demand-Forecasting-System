// Tests features/analytics/components/shared/ratioBar.js: Performance Ratio
// bars stay inside their half of the track.
//
// Plain Node, no test runner:
//   cd frontend && node tests/ratioBar.test.mjs

const { ratioBarGeometry, ratioBarMax } = await import('../src/features/analytics/components/shared/ratioBar.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

console.log('ratioBar.test.mjs');

check('max is at least 2', ratioBarMax([1.2, 0.5]) === 2);
check('max = largest ratio on the page', ratioBarMax([6.05, 1.1, null]) === 6.05);

const big = ratioBarGeometry(6.05, 6.05);
check('6.05 on a 6.05 page fills exactly the right half', big.isAbove && big.leftPct === 50 && near(big.widthPct, 50));

const over = ratioBarGeometry(6.05, 2);
check('a ratio above maxRatio is capped at 50%', near(over.widthPct, 50));

const mid = ratioBarGeometry(1.5, 2);
check('1.5 with max 2 -> 25% from the centre', mid.isAbove && near(mid.widthPct, 25) && mid.leftPct === 50);

const avg = ratioBarGeometry(1, 2);
check('exactly 1.0 is above-average with width 0', avg.isAbove && avg.widthPct === 0);

const low = ratioBarGeometry(0.4, 2);
check('0.4 -> 30% wide, ending at the centre', !low.isAbove && near(low.widthPct, 30) && near(low.leftPct + low.widthPct, 50));

const zero = ratioBarGeometry(0, 2);
check('0 -> full left half, starts at 0%', near(zero.widthPct, 50) && near(zero.leftPct, 0));

for (const r of [0, 0.3, 0.99, 1, 1.01, 2, 3.7, 6.05, 50]) {
  const g = ratioBarGeometry(r, ratioBarMax([6.05]));
  check(`ratio ${r} stays inside the track`, g.leftPct >= 0 && g.leftPct + g.widthPct <= 100 + 1e-9);
}

check('null ratio -> no bar', ratioBarGeometry(null) === null);

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All ratioBar checks passed.');
