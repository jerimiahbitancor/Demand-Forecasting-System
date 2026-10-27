// utils/forecastStartChoice.js
//
// "Generate Forecast" with a chosen start (Oct 26 2026). The forecast used
// to always start today; with sales uploaded only up to an earlier day, the
// forecast read old sales as "yesterday" and could not be checked against
// anything. The owner can now start right after the latest uploaded sales
// (an accuracy test), or on a chosen date. The backend/ml-service decide
// whether the date is allowed; this only turns the dialog into a request.

export const START_TODAY = 'today';
export const START_AFTER_LATEST_SALES = 'after_latest_sales';
export const START_CHOSEN_DATE = 'date';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// { mode, date, length } from the dialog -> { body } for POST /ml/forecast,
// or { error } to show in the dialog. length: '7' (week) or '1' (one day).
export function buildForecastRequest({ mode, date, length } = {}) {
  const horizonDays = String(length) === '1' ? 1 : 7;
  if (mode === START_AFTER_LATEST_SALES) {
    return { body: { horizonDays, startDate: START_AFTER_LATEST_SALES } };
  }
  if (mode === START_CHOSEN_DATE) {
    if (!date || !YMD.test(String(date))) return { error: 'Choose the start date.' };
    return { body: { horizonDays, startDate: String(date) } };
  }
  return { body: { horizonDays } };
}

// '2026-09-29' -> 'Sep 29, 2026'
function longDate(ymd) {
  if (!ymd || !YMD.test(String(ymd))) return null;
  const [y, m, d] = String(ymd).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// Reply of POST /ml/forecast -> 'Sep 29, 2026 – Oct 4, 2026', or null
// when the run started today (the reply then has no forecast_start).
export function forecastWindowLabel(data) {
  const from = longDate(data?.forecast_start);
  if (!from) return null;
  const to = longDate(data?.forecast_end);
  return !to || to === from ? from : `${from} – ${to}`;
}

// The dialog body. Static text only (nothing from the user or the API).
export const FORECAST_START_DIALOG_HTML = `
<div class="forecast-start-dialog">
  <p class="forecast-start-dialog__intro">Uses the current trained model. It does not retrain.</p>
  <fieldset class="forecast-start-dialog__group">
    <legend>Start</legend>
    <label><input type="radio" name="forecast-start" value="${START_TODAY}" checked /><span>Today (normal forecast)</span></label>
    <label><input type="radio" name="forecast-start" value="${START_AFTER_LATEST_SALES}" /><span>The day after the latest uploaded sales (accuracy test)</span></label>
    <label><input type="radio" name="forecast-start" value="${START_CHOSEN_DATE}" /><span>A date I choose
      <input type="date" id="forecast-start-date" aria-label="Start date" /></span></label>
  </fieldset>
  <label class="forecast-start-dialog__length">Length
    <select id="forecast-length">
      <option value="7">Week</option>
      <option value="1">One day</option>
    </select>
  </label>
  <p class="forecast-start-dialog__hint">Week: starting today, the next 7 days (as before); starting on another day, through that week's Sunday.
  A chosen start must come after the days the model learned, and cannot skip sales days that were not uploaded yet.
  After the forecast, upload the actual sales for those days and compare them in the table below.</p>
</div>`;

// Reads the dialog's inputs (popup = Swal.getPopup()).
export function readForecastStartDialog(popup) {
  const checked = popup?.querySelector('input[name="forecast-start"]:checked');
  return {
    mode: checked ? checked.value : START_TODAY,
    date: popup?.querySelector('#forecast-start-date')?.value || '',
    length: popup?.querySelector('#forecast-length')?.value || '7',
  };
}
