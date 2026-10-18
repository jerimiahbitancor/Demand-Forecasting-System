// tests/forecastLock.test.js — run: node --test tests/forecastLock.test.js
//
// One forecast at a time (A4): mlService.forecast() refuses a second call
// while one is in flight, and POST /api/ml/forecast answers 409.
// fetch is replaced, so nothing reaches a real ml-service.

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
  queueStockRefresh: () => null, // the stock refresh after a forecast is not under test here
});

// Controllable ml-service: each /forecast call waits until released.
// /health (the wake probe forecast() sends first) answers at once and is not
// counted, otherwise every forecast would hang on the wake.
const fetchCalls = [];
global.fetch = (url) => new Promise((resolve) => {
  if (String(url).endsWith('/health')) {
    resolve({ ok: true, status: 200, json: async () => ({ status: 'ok' }) });
    return;
  }
  fetchCalls.push({
    url,
    release: (body = { results: [] }, status = 200) => resolve({ ok: status < 400, status, json: async () => body }),
  });
});
const waitForFetch = async (n) => {
  for (let i = 0; i < 100 && fetchCalls.length < n; i += 1) await new Promise((r) => setTimeout(r, 5));
};

const mlService = require('../services/mlService');
const mlRouter = require('../routes/ml');

test('mlService.forecast: a second call while one runs is refused with 409, and the lock is released after', async () => {
  fetchCalls.length = 0;
  const first = mlService.forecast({ horizonDays: 7 });
  assert.equal(mlService.isForecastInFlight(), true);

  await assert.rejects(mlService.forecast({ horizonDays: 1 }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'FORECAST_IN_FLIGHT');
    assert.equal(error.message, 'A forecast is already running');
    return true;
  });
  // The first call reaches /forecast only after its wake probe resolves.
  await waitForFetch(1);
  assert.equal(fetchCalls.length, 1, 'the refused call never reached ml-service');

  fetchCalls[0].release();
  await first;
  assert.equal(mlService.isForecastInFlight(), false);

  const third = mlService.forecast({ horizonDays: 1 });
  await waitForFetch(2);
  fetchCalls[1].release();
  await third;
  assert.equal(fetchCalls.length, 2, 'works again once the first one finished');
});

test('mlService.forecast: the lock is released when ml-service fails', async () => {
  fetchCalls.length = 0;
  const pending = mlService.forecast({ horizonDays: 1 });
  await waitForFetch(1);
  fetchCalls[0].release({ reason: 'boom' }, 500);
  await assert.rejects(pending, (e) => e.status === 500);
  assert.equal(mlService.isForecastInFlight(), false);

  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(mlService.forecast({ horizonDays: 1 }), (e) => e.status === 503);
  assert.equal(mlService.isForecastInFlight(), false);
  global.fetch = realFetch;
});

function request(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: urlPath,
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

test('POST /api/ml/forecast: overlapping requests -> the second gets 409, no failure notification', async () => {
  fetchCalls.length = 0;
  notifications.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/ml', mlRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const saved = console.error;
  console.error = () => {};
  try {
    const first = request(server, 'POST', '/api/ml/forecast', { horizonDays: 7 });
    await waitForFetch(1);

    const second = await request(server, 'POST', '/api/ml/forecast', { horizonDays: 1 });
    assert.equal(second.status, 409);
    assert.deepEqual(second.body, { success: false, error: 'A forecast is already running' });
    assert.equal(fetchCalls.length, 1);

    fetchCalls[0].release({ results: [] });
    const done = await first;
    assert.equal(done.status, 200);
    assert.deepEqual(notifications.map((n) => n.type), ['success'], 'only the real run notified');
  } finally {
    console.error = saved;
    server.close();
  }
});
