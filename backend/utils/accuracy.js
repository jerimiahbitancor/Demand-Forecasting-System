// The accuracy rule, in one place.
//
// Owner decision, Oct 1 2026: accuracy is 100 - WMAPE, and "is it good
// enough?" is answered by comparison against the 7-day average rather than
// by a threshold. Both analyticsService (what Analytics shows) and
// uploadService (whether the dashboard says "Data Needs Attention") need
// the same answer, and they must never disagree — a dashboard warning next
// to an Analytics page claiming the model is fine would be worse than
// either alone. So the rule lives here and both require it.
//
// Tested in backend/tests/accuracy.test.js.

// WMAPE = total units missed / total units sold * 100.
//
// Why not MAPE: MAPE divides each row's error by that row's own actual, so
// on a menu where many dishes sell 1-3 a day it is dominated by rounding on
// tiny numbers — missing by one plate on a dish that sold one scores 100%,
// the same as missing by 40 on a dish that sold 40. WMAPE divides one total
// by another, so busy dishes count proportionally more.
//
// Clamped to [0, 100]: WMAPE has no upper bound, so a model off by more
// than total sales would otherwise show negative accuracy.
function accuracyFromWmape(wmape) {
  if (wmape === null || wmape === undefined) return null;
  const value = Number(wmape);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, 100 - value));
}

// Does the model beat the 7-day average on the same test rows?
//
// Returns true/false, or null when the comparison cannot be made — rows
// written before migration 008 have no wmape/baseline_wmape and never
// will. null must NOT be read as "bad": an older model is not evidence of
// a problem, and guessing would either nag about a fine model or hide a
// broken one.
function beatsBaseline(wmape, baselineWmape) {
  if (wmape === null || wmape === undefined) return null;
  if (baselineWmape === null || baselineWmape === undefined) return null;
  const model = Number(wmape);
  const baseline = Number(baselineWmape);
  if (!Number.isFinite(model) || !Number.isFinite(baseline)) return null;
  return model < baseline;
}

// The dashboard's "Data Needs Attention" input for model quality.
//
// This replaced a hardcoded "accuracy below 70%" check, which was a number
// nobody chose — it came from the Lewis (1982) MAPE bands, which are
// dropped along with MAPE itself. There is deliberately NO replacement
// numeric threshold: if one is ever wanted it is the owner's call.
//
// Only a definite false flags attention. null (no baseline recorded) does
// not.
function modelNeedsAttention(wmape, baselineWmape) {
  return beatsBaseline(wmape, baselineWmape) === false;
}

module.exports = { accuracyFromWmape, beatsBaseline, modelNeedsAttention };
