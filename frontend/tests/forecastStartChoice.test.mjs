// Generate Forecast with a chosen start (Oct 26 2026): the dialog -> request.
//   cd frontend && node --test tests/forecastStartChoice.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildForecastRequest, forecastWindowLabel, FORECAST_START_DIALOG_HTML,
  START_TODAY, START_AFTER_LATEST_SALES, START_CHOSEN_DATE,
} from '../src/utils/forecastStartChoice.js';

test('today + week = exactly the old request (no startDate)', () => {
  assert.deepEqual(buildForecastRequest({ mode: START_TODAY, length: '7' }), { body: { horizonDays: 7 } });
  assert.deepEqual(buildForecastRequest(), { body: { horizonDays: 7 } });
});

test('after the latest sales -> the keyword the ML service resolves', () => {
  assert.deepEqual(
    buildForecastRequest({ mode: START_AFTER_LATEST_SALES, length: '7' }),
    { body: { horizonDays: 7, startDate: 'after_latest_sales' } },
  );
});

test('chosen date: sent as YYYY-MM-DD; missing date asks for one', () => {
  assert.deepEqual(
    buildForecastRequest({ mode: START_CHOSEN_DATE, date: '2026-09-29', length: '1' }),
    { body: { horizonDays: 1, startDate: '2026-09-29' } },
  );
  assert.ok(buildForecastRequest({ mode: START_CHOSEN_DATE, date: '' }).error);
});

test('window label from the reply; none for a normal run', () => {
  assert.equal(forecastWindowLabel({ forecast_start: '2026-09-29', forecast_end: '2026-10-04' }), 'Sep 29, 2026 – Oct 4, 2026');
  assert.equal(forecastWindowLabel({ forecast_start: '2026-09-29', forecast_end: '2026-09-29' }), 'Sep 29, 2026');
  assert.equal(forecastWindowLabel({ results: [] }), null);
});

test('dialog has the three start options and the length choice; Forecasting.jsx uses it', () => {
  for (const v of [START_TODAY, START_AFTER_LATEST_SALES, START_CHOSEN_DATE]) {
    assert.ok(FORECAST_START_DIALOG_HTML.includes(`value="${v}"`), v);
  }
  assert.ok(FORECAST_START_DIALOG_HTML.includes('id="forecast-start-date"'));
  assert.ok(FORECAST_START_DIALOG_HTML.includes('id="forecast-length"'));
  assert.ok(!/plates?\b/i.test(FORECAST_START_DIALOG_HTML), 'never say plates');
  const jsx = readFileSync(new URL('../src/features/analytics/components/Forecasting.jsx', import.meta.url), 'utf8');
  assert.ok(jsx.includes('html: FORECAST_START_DIALOG_HTML'));
  assert.ok(jsx.includes('confirmation.value'), 'posts the dialog request, not a hard-coded body');
});
