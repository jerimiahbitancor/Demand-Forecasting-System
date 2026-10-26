// tests/forecastStartDate.test.js — run: node --test tests/forecastStartDate.test.js
//
// Forecast with a chosen start date (Oct 26 2026): POST /api/ml/forecast
// passes { startDate } to ml-service as start_date, checks its shape, and
// words the notification with the forecast's dates. Without startDate the
// request to ml-service is byte-for-byte the old one.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');

process.env.LOG_LEVEL = 'error';
process.env.ML_SERVICE_SHARED_SECRET = 'test-secret';

function stubModule(rel, exportsValue) {
  const abs = require.resolve(path.join(__dirname, '..', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsValue };
}
const fakeClient = { from: () => ({ select: async () => ({ data: [], error: null }) }) };
stubModule('config/supabase.js', { supabase: fakeClient, supabaseAdmin: fakeClient, isConfigured: true });
stubModule('middleware/auth.js', (req, res, next) => { req.user = { id: 7, user_id: 7 }; next(); });
const notifications = [];
stubModule('services/notificationService.js', {
  createNotification: async (n) => { notifications.push(n); return n; },
  queueStockRefresh: () => null,
});

// ml-service stub: records each /forecast body, answers with `nextReply`.
const sentBodies = [];
let nextReply = { status: 200, body: { results: [] } };
global.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/health')) return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
  sentBodies.push(JSON.parse(options.body || '{}'));
  const { status, body } = nextReply;
  return { ok: status < 400, status, json: async () => body };
};

const { normalizeStartDate, describeForecastWindow } = require('../utils/forecastStart');
const mlRouter = require('../routes/ml');

function request(server, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/ml/forecast', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/ml', mlRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const saved = console.error;
  console.error = () => {};
  try { await fn(server); } finally { console.error = saved; server.close(); }
}

test('normalizeStartDate: empty -> null, real dates and the keyword pass, the rest is refused', () => {
  assert.deepEqual(normalizeStartDate(undefined), { value: null });
  assert.deepEqual(normalizeStartDate(''), { value: null });
  assert.deepEqual(normalizeStartDate('2026-09-29'), { value: '2026-09-29' });
  assert.deepEqual(normalizeStartDate('after_latest_sales'), { value: 'after_latest_sales' });
  assert.ok(normalizeStartDate('2026-02-30').error, 'Feb 30 is not a date');
  assert.ok(normalizeStartDate('09/29/2026').error);
  assert.ok(normalizeStartDate('tomorrow').error);
});

test('describeForecastWindow: plain dates, one day reads as one date', () => {
  assert.equal(describeForecastWindow('2026-09-29', '2026-10-04'), 'Sep 29, 2026 to Oct 4, 2026');
  assert.equal(describeForecastWindow('2026-09-29', '2026-09-29'), 'Sep 29, 2026');
  assert.equal(describeForecastWindow(undefined, undefined), null);
});

test('POST /forecast without startDate sends exactly the old body', async () => {
  await withServer(async (server) => {
    sentBodies.length = 0;
    notifications.length = 0;
    nextReply = { status: 200, body: { results: [] } };
    const res = await request(server, { horizonDays: 7 });
    assert.equal(res.status, 200);
    assert.deepEqual(sentBodies, [{ horizon_days: 7 }], 'no start_date key at all');
    assert.match(notifications[0].message, /for the next week/);
  });
});

test('POST /forecast with startDate passes start_date and names the dates in the notification', async () => {
  await withServer(async (server) => {
    sentBodies.length = 0;
    notifications.length = 0;
    nextReply = { status: 200, body: { results: [], forecast_start: '2026-09-29', forecast_end: '2026-10-04' } };
    const res = await request(server, { horizonDays: 7, startDate: 'after_latest_sales' });
    assert.equal(res.status, 200);
    assert.deepEqual(sentBodies, [{ horizon_days: 7, start_date: 'after_latest_sales' }]);
    assert.match(notifications[0].message, /Sep 29, 2026 to Oct 4, 2026/);
    assert.equal(res.body.data.forecast_start, '2026-09-29');
  });
});

test('POST /forecast with a malformed startDate -> 400, ml-service never called', async () => {
  await withServer(async (server) => {
    sentBodies.length = 0;
    const res = await request(server, { horizonDays: 7, startDate: '29/09/2026' });
    assert.equal(res.status, 400);
    assert.equal(sentBodies.length, 0);
  });
});

test("POST /forecast: ml-service's plain refusal (gap / training data) reaches the owner", async () => {
  await withServer(async (server) => {
    const reason = 'Sales data ends on Sep 28, 2026. A forecast starting on Oct 26, 2026 would skip the days in between.';
    nextReply = { status: 422, body: { status: 'failed', reason } };
    const res = await request(server, { horizonDays: 7, startDate: '2026-10-26' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error, reason);
  });
});
