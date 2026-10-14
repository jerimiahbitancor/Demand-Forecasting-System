// Geometry for the Performance Ratio bars (ProductPerformance.jsx RatioBar).
//
// The centre line is the store average (1.0). Each side is 50% of the track:
//   above (>= 1): width = min((ratio - 1) / (maxRatio - 1), 1) × 50%, from the centre
//   below (< 1):  width = (1 - ratio) × 50%, ending at the centre
// maxRatio = the largest ratio on the current page, at least 2, so small
// differences stay visible and no bar can ever be wider than its half.

export const RATIO_BAR_MIN_MAX = 2;

export function ratioBarMax(ratios) {
  const finite = (ratios || []).map(Number).filter((r) => Number.isFinite(r));
  return Math.max(RATIO_BAR_MIN_MAX, ...finite);
}

// -> { isAbove, leftPct, widthPct } in % of the track, always inside 0..100.
export function ratioBarGeometry(ratio, maxRatio = RATIO_BAR_MIN_MAX) {
  // Number(null) is 0, which would draw a full "below average" bar.
  if (ratio === null || ratio === undefined || ratio === '') return null;
  const r = Number(ratio);
  if (!Number.isFinite(r)) return null;
  const max = Math.max(RATIO_BAR_MIN_MAX, Number(maxRatio) || RATIO_BAR_MIN_MAX);
  if (r >= 1) {
    const share = Math.min((r - 1) / (max - 1), 1);
    return { isAbove: true, leftPct: 50, widthPct: share * 50 };
  }
  const widthPct = Math.min(Math.max(1 - r, 0), 1) * 50;
  return { isAbove: false, leftPct: 50 - widthPct, widthPct };
}
