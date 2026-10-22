// Tests utils/localDate.js: a date picked in Manila stays the same calendar
// day (toISOString() would give the day before).
//
// Plain Node, no test runner:
//   cd frontend && TZ=Asia/Manila node tests/localDate.test.mjs
// The test also sets TZ itself, so it checks UTC+8 however it is run.

process.env.TZ = 'Asia/Manila';

const { toYmd, fromYmd, mondayOf } = await import('../src/utils/localDate.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, actual, expected) => check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('localDate.test.mjs');

check('running in UTC+8', new Date(2026, 9, 18).getTimezoneOffset() === -480, `offset ${new Date(2026, 9, 18).getTimezoneOffset()}`);

// Local midnight Oct 18 = Oct 17 16:00 UTC: the bug this helper prevents.
const pickedMidnight = new Date(2026, 9, 18, 0, 0, 0);
eq('toISOString() really shifts a Manila midnight to the day before', pickedMidnight.toISOString().slice(0, 10), '2026-10-17');
eq('toYmd(local midnight Oct 18) -> 2026-10-18', toYmd(pickedMidnight), '2026-10-18');
eq('toYmd(Oct 18, 7:59 AM) -> 2026-10-18', toYmd(new Date(2026, 9, 18, 7, 59)), '2026-10-18');
eq('toYmd(Oct 18, 11:59 PM) -> 2026-10-18', toYmd(new Date(2026, 9, 18, 23, 59)), '2026-10-18');
eq('toYmd pads month and day', toYmd(new Date(2026, 0, 5)), '2026-01-05');

const parsed = fromYmd('2026-10-18');
check('fromYmd gives local midnight', parsed.getHours() === 0 && parsed.getDate() === 18 && parsed.getMonth() === 9);
eq('fromYmd -> toYmd round trip', toYmd(fromYmd('2026-10-18')), '2026-10-18');
eq('round trip across a month end', toYmd(fromYmd('2026-02-28')), '2026-02-28');
eq('fromYmd(empty) -> null', fromYmd(''), null);
eq('fromYmd(null) -> null', fromYmd(null), null);

eq('mondayOf(Sun Oct 18) -> Mon Oct 12', mondayOf('2026-10-18'), '2026-10-12');
eq('mondayOf(Mon Oct 12) -> itself', mondayOf('2026-10-12'), '2026-10-12');
eq('mondayOf(Sat Oct 17) -> Mon Oct 12', mondayOf('2026-10-17'), '2026-10-12');
eq('mondayOf across a month start (Thu Oct 1) -> Mon Sep 28', mondayOf('2026-10-01'), '2026-09-28');

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All localDate checks passed.');
