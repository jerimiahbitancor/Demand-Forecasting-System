// utils/accuracyText.js
//
// Plain-language accuracy wording, shared by Analytics > Forecasting and the
// Dashboard's Forecast Accuracy card so both screens say the same thing.
// Presentation only: the number itself is 100% − WMAPE from the backend
// (backend/utils/accuracy.js), never recomputed here.

// 72.4 -> 72 (a whole number: one decimal is false precision here). Unknown -> null.
export function accuracyPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// beatsBaseline from the backend: true / false / null (no comparison recorded).
export function accuracyVerdict(beatsBaseline) {
  if (beatsBaseline === true) return '✓ The forecast is doing better than a simple weekly average.';
  if (beatsBaseline === false) return 'The forecast is still learning your sales pattern. Keep uploading daily sales.';
  return null;
}

// "Out of 100 items you sell, the forecast is usually off by about 28."
export function accuracyOffByLine(value) {
  const pct = accuracyPercent(value);
  if (pct === null) return null;
  const offBy = Math.max(0, 100 - pct);
  return `Out of 100 items you sell, the forecast is usually off by about ${offBy}.`;
}

// The Dashboard's amber low-accuracy notice (owner wording, Oct 18 2026).
// Shown only when the forecast does not beat the weekly average.
export function lowAccuracyNotice(value) {
  const pct = accuracyPercent(value);
  const rest = "It's not yet better than a simple 7-day average, so use it as a rough guide.";
  return pct === null ? rest : `Forecast accuracy: ${pct}%. ${rest}`;
}

// The ⓘ text, in short sentences: no formulas, no jargon.
export const ACCURACY_HELP_SENTENCES = [
  'This shows how close the forecast came to what you really sold.',
  'Measured on the most recent part of the data the model never saw.',
  'Higher is better.',
  'It only changes after the system is trained again.',
];
