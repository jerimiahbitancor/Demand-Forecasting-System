// Tests utils/accuracyText.js: the plain accuracy wording shared by
// Analytics > Forecasting and the Dashboard.
//
// Plain Node, no test runner:
//   cd frontend && node tests/accuracyText.test.mjs

const { accuracyPercent, accuracyVerdict, accuracyOffByLine, lowAccuracyNotice, ACCURACY_HELP_SENTENCES } =
  await import('../src/utils/accuracyText.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const eq = (label, actual, expected) => check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log('accuracyText.test.mjs');

eq('72.4 -> 72', accuracyPercent(72.4), 72);
eq('64.64 -> 65', accuracyPercent(64.64), 65);
eq('null -> null (never 0)', accuracyPercent(null), null);
eq('undefined -> null', accuracyPercent(undefined), null);
eq('"abc" -> null', accuracyPercent('abc'), null);

check('beats -> better than a weekly average', /better than a simple weekly average/.test(accuracyVerdict(true)));
check('does not beat -> still learning', /still learning/.test(accuracyVerdict(false)));
eq('unknown -> no line', accuracyVerdict(null), null);
eq('undefined -> no line', accuracyVerdict(undefined), null);

eq('72% -> off by about 28', accuracyOffByLine(72), 'Out of 100 items you sell, the forecast is usually off by about 28.');
eq('64.6% -> off by about 35 (rounded accuracy + off-by = 100)', accuracyOffByLine(64.6), 'Out of 100 items you sell, the forecast is usually off by about 35.');
eq('unknown accuracy -> no line', accuracyOffByLine(null), null);

eq('low-accuracy notice, owner wording', lowAccuracyNotice(64.6), "Forecast accuracy: 65%. It's not yet better than a simple 7-day average, so use it as a rough guide.");
eq('low-accuracy notice without a number', lowAccuracyNotice(null), "It's not yet better than a simple 7-day average, so use it as a rough guide.");

const help = ACCURACY_HELP_SENTENCES.join(' ');
check('help text has 3-4 sentences', ACCURACY_HELP_SENTENCES.length >= 3 && ACCURACY_HELP_SENTENCES.length <= 4);
check('help text has no jargon', !/WMAPE|baseline|MAE|MAPE|%\s*−/i.test(help), help);

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All accuracyText checks passed.');
