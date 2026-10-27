// utils/forecastStart.js
//
// Forecast with a chosen start date (Oct 26 2026). The owner can start a
// forecast on the day after the latest uploaded sales (an accuracy test:
// upload the real sales later and compare), instead of always today.
// ml-service decides whether the date is allowed (after the model's training
// data, no unuploaded days skipped); this file only checks the shape and
// words the result for the notification.

const AFTER_LATEST_SALES = 'after_latest_sales';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// -> null (no start date: today, as before), 'after_latest_sales', or a
// real 'YYYY-MM-DD'. Anything else -> { error } for a 400.
function normalizeStartDate(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const text = String(value).trim();
  if (text === AFTER_LATEST_SALES) return { value: text };
  if (YMD.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) {
      return { value: text };
    }
  }
  return { error: 'The start date must be a date in the form YYYY-MM-DD, or "after_latest_sales".' };
}

// '2026-09-29' -> 'Sep 29, 2026'
function longDate(ymd) {
  if (!ymd || !YMD.test(String(ymd))) return null;
  const [y, m, d] = String(ymd).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// 'Sep 29, 2026 to Oct 4, 2026', or 'Sep 29, 2026' for one day.
function describeForecastWindow(start, end) {
  const from = longDate(start);
  const to = longDate(end);
  if (!from) return null;
  return !to || to === from ? from : `${from} to ${to}`;
}

module.exports = { AFTER_LATEST_SALES, normalizeStartDate, describeForecastWindow, longDate };
