// Tests the WMAPE accuracy rule and the "Data Needs Attention" decision
// (utils/accuracy.js), plus the accuracyStanding wrapper Analytics returns.
//
// Why this is worth a test: the rule changed from "accuracy = 100 - MAPE,
// flag below 70%" to "accuracy = 100 - WMAPE, flag when it loses to the
// 7-day average." The dangerous case is the middle one — a model with no
// baseline recorded (every row written before migration 008). That must
// read as "unknown", never as "bad", or the dashboard would nag forever
// about models it cannot actually judge.
//
// Run:  cd backend && node tests/accuracy.test.js
// No network, no Supabase, no credentials.

const { accuracyFromWmape, beatsBaseline, modelNeedsAttention } = require('../utils/accuracy');
const { accuracyStanding } = require('../services/analyticsService');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}  ${detail}`);
    failures.push(label);
  }
}

console.log('accuracy.test.js');

// ---------------------------------------------------------------
// accuracyFromWmape
// ---------------------------------------------------------------
check('WMAPE 22 -> 78% accuracy', accuracyFromWmape(22) === 78);
check('WMAPE 0 -> 100% accuracy', accuracyFromWmape(0) === 100);
check('WMAPE 25.4 -> 74.6% accuracy', Math.abs(accuracyFromWmape(25.4) - 74.6) < 1e-9);
check('WMAPE above 100 clamps to 0, never negative', accuracyFromWmape(140) === 0);
check('null WMAPE -> null (not 0%)', accuracyFromWmape(null) === null);
check('undefined WMAPE -> null', accuracyFromWmape(undefined) === null);
check('NaN WMAPE -> null, not NaN%', accuracyFromWmape(Number.NaN) === null);
check('numeric strings from Postgres are handled', accuracyFromWmape('22') === 78);

// ---------------------------------------------------------------
// beatsBaseline
// ---------------------------------------------------------------
check('model 22 vs baseline 25 -> beats it', beatsBaseline(22, 25) === true);
check('model 25 vs baseline 22 -> does not beat it', beatsBaseline(25, 22) === false);
check('an exact tie does NOT count as beating it', beatsBaseline(22, 22) === false);
check('missing baseline -> null (cannot judge)', beatsBaseline(22, null) === null);
check('missing model wmape -> null', beatsBaseline(null, 25) === null);
check('both missing -> null', beatsBaseline(null, null) === null);

// ---------------------------------------------------------------
// modelNeedsAttention — the dashboard rule
// ---------------------------------------------------------------
check('a model that loses to the 7-day average NEEDS attention',
      modelNeedsAttention(30, 25) === true);
check('a model that beats it does NOT need attention',
      modelNeedsAttention(20, 25) === false);
check('a tie needs attention (it is not beating the average)',
      modelNeedsAttention(25, 25) === true);
check('an OLD model with no baseline does NOT need attention (unknown != bad)',
      modelNeedsAttention(40, null) === false);
check('no metrics at all does not need attention',
      modelNeedsAttention(null, null) === false);
check('the old 70% MAPE threshold is truly gone: WMAPE 40 (=60% accuracy) '
      + 'but beating the baseline is fine',
      modelNeedsAttention(40, 45) === false);

// ---------------------------------------------------------------
// accuracyStanding — what Analytics renders
// ---------------------------------------------------------------
let s = accuracyStanding(22, 25);
check('standing: beating the baseline is green',
      s.beatsBaseline === true && s.color === 'green', JSON.stringify(s));
check('standing: beating label reads "Better than a simple average"',
      s.label === 'Better than a simple average', s.label);

s = accuracyStanding(30, 25);
check('standing: losing is amber, not red (it is fixable by uploading data)',
      s.beatsBaseline === false && s.color === 'amber', JSON.stringify(s));
check('standing: losing label reads "Not yet better than a simple average"',
      s.label === 'Not yet better than a simple average', s.label);

s = accuracyStanding(22, null);
check('standing: no baseline recorded is reported honestly, not as a pass',
      s.beatsBaseline === null && s.label === 'No baseline recorded', JSON.stringify(s));

check('standing: null wmape yields no standing at all',
      accuracyStanding(null, 25) === null);

// ---------------------------------------------------------------
// The owner's sentence, end to end, from real numbers
// ---------------------------------------------------------------
const wmape = 22;
const baseline = 25;
const acc = accuracyFromWmape(wmape);
check('the approved sentence numbers line up: 78% accuracy, off by 22%, average off by 25%',
      acc === 78 && wmape === 22 && baseline === 25 && beatsBaseline(wmape, baseline) === true);

console.log();
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All accuracy checks passed.');
