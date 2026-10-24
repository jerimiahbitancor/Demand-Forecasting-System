// tests/postTrainingForecast.test.js — run: node --test tests/postTrainingForecast.test.js
//
// A successful POST /api/ml/train starts the first forecast right away
// (Oct 24 2026), so the dashboard does not wait for tomorrow's 9:00 AM run.
// A failed training starts nothing. mlService is replaced: nothing reaches a
// real ml-service.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

function stubModule(rel, exportsValue) {
  const abs = require.resolve(path.join(__dirname, '..', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsValue };
}

const fake = createFakeSupabase({ uploads: [{ id: 1, status: 'processed', upload_date: '2026-10-20T00:00:00' }], user: [{ id: 7 }] });
stubModule('config/supabase.js', { supabase: fake, supabaseAdmin: fake, isConfigured: true });
stubModule('middleware/auth.js', (req, res, next) => { req.user = { id: 7, user_id: 7 }; next(); });
const notifications = [];
stubModule('services/notificationService.js', {
  createNotification: async (n) => { notifications.push(n); return n; },
  queueStockRefresh: () => null,
});

class MlServiceError extends Error {
  constructor(message, status) { super(message); this.name = 'MlServiceError'; this.status = status; }
}
const ml = {
  trainResult: { ok: true },
  trainError: null,
  forecastCalls: [],
  MlServiceError,
  FORECAST_IN_FLIGHT_MESSAGE: 'A forecast is already running',
  getTrainCooldownRemaining: () => 0,
  isTrainingInFlight: () => false,
  isForecastInFlight: () => false,
  train: async () => { if (ml.trainError) throw ml.trainError; return ml.trainResult; },
  forecast: async (args) => { ml.forecastCalls.push(args); return { results: [{ product_id: 1, status: 'forecasted' }] }; },
};
stubModule('services/mlService.js', ml);

const mlRouter = require('../routes/ml');
const { forecastSlotFor } = require('../jobs/forecastScheduler');

function post(server, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: urlPath, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}
const settle = () => new Promise((r) => setTimeout(r, 30));

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/ml', mlRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(server); } finally { Object.assign(console, quiet); server.close(); }
}

test('training succeeds -> the first forecast starts right away, for today\'s slot', async () => {
  ml.forecastCalls.length = 0;
  notifications.length = 0;
  ml.trainError = null;
  await withServer(async (server) => {
    const res = await post(server, '/api/ml/train');
    await settle();
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
  const slot = forecastSlotFor(new Date());
  assert.deepEqual(ml.forecastCalls, [{ horizonDays: slot.horizonDays, runType: slot.runType }]);
  const done = notifications.find((n) => n.metadata && n.metadata.kind === 'forecast');
  assert.ok(done, JSON.stringify(notifications.map((n) => n.title)));
  assert.match(done.message, /first forecast after training finished/);
});

test('training fails -> no forecast is started', async () => {
  ml.forecastCalls.length = 0;
  ml.trainError = new MlServiceError('ml-service returned HTTP 500', 500);
  await withServer(async (server) => {
    const res = await post(server, '/api/ml/train');
    await settle();
    assert.equal(res.status, 500);
  });
  assert.equal(ml.forecastCalls.length, 0);
  ml.trainError = null;
});
