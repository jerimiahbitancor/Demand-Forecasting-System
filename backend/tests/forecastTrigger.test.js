// tests/forecastTrigger.test.js — run: node --test tests/forecastTrigger.test.js
//
// The 9:00 AM forecast without relying on an awake server (Oct 17 2026):
//   - POST /api/jobs/forecast (routes/jobs.js): secret, 409, 202
//   - runTriggeredForecast: forecast_runs is the record, wakes the ML
//     service, retries ONCE after a cold-start failure, never for others
//   - runForecastBootCatchUp: after 9:00 only; not again after a failure
// In-memory fake database; the ML service is a stub. No network.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';
process.env.ML_SERVICE_SHARED_SECRET = 'test-secret'; // read when mlService loads

const fake = createFakeSupabase();
installFake(fake);
const cronPath = require.resolve('node-cron', { paths: [path.join(__dirname, '..')] });
const scheduled = [];
require.cache[cronPath] = {
  id: cronPath, filename: cronPath, loaded: true,
  exports: { schedule: (expression, fn, options) => scheduled.push({ expression, fn, options }) },
};

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
};

const restoreLoad = quiet();
const scheduler = require('../jobs/forecastScheduler');
const mlService = require('../services/mlService');
const { createJobsRouter } = require('../routes/jobs');
restoreLoad();

// Sat 2026-10-17: 08:30 / 10:00 Manila. Mon 2026-10-19 10:00 Manila.
const SAT_0830 = new Date('2026-10-17T00:30:00Z');
const SAT_1000 = new Date('2026-10-17T02:00:00Z');
const MON_1000 = new Date('2026-10-19T02:00:00Z');
const SAT_0900_UTC = '2026-10-17T01:00:00.000Z';

function seedWorld({ model = true, runs = [] } = {}) {
  fake.reset({
    user: [{ id: 7 }],
    model_metrics: model ? [{ id: 1 }] : [],
    forecast_runs: runs,
    audit_logs: [],
    notifications: [],
  });
}

function stubMl({ failures = [] } = {}) {
  const calls = { forecast: [], health: 0 };
  return {
    calls,
    isForecastInFlight: () => false,
    checkHealth: async () => { calls.health += 1; return true; },
    forecast: async (args) => {
      calls.forecast.push(args);
      const f = failures.shift();
      if (f) throw f;
      return { results: [{ status: 'forecasted' }] };
    },
  };
}

const coldError = (status) => Object.assign(new Error(`ml-service returned HTTP ${status}`), { status });
const noWait = async () => {};
const attempts = () => (fake.tables.audit_logs || [])
  .filter((r) => r.action_type === scheduler.TRIGGER_ACTION_TYPE)
  .map((r) => JSON.parse(r.details));

async function run(fn) {
  const restore = quiet();
  try { return await fn(); } finally { restore(); }
}

// ---------------------------------------------------------------- slot

test('slot: Monday -> weekly 7-day, other days -> daily; 9:00 AM Manila = 01:00 UTC', () => {
  const sat = scheduler.forecastSlotFor(SAT_1000);
  assert.deepEqual([sat.today, sat.runType, sat.horizonDays, sat.slotStart, sat.pastSlot],
    ['2026-10-17', 'daily', 1, SAT_0900_UTC, true]);
  const mon = scheduler.forecastSlotFor(MON_1000);
  assert.deepEqual([mon.runType, mon.horizonDays], ['weekly', 7]);
  assert.equal(scheduler.forecastSlotFor(SAT_0830).pastSlot, false);
});

test('cold-start errors: 429/502/503/504 and network failures yes; Flask errors no', () => {
  for (const s of [429, 502, 503, 504]) assert.equal(scheduler.isColdStartError(coldError(s)), true, `HTTP ${s}`);
  assert.equal(scheduler.isColdStartError(Object.assign(new TypeError('fetch failed'), {})), true);
  assert.equal(scheduler.isColdStartError(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } })), true);
  assert.equal(scheduler.isColdStartError(new Error('ml-service timed out')), false);
  assert.equal(scheduler.isColdStartError(coldError(409)), false);
  assert.equal(scheduler.isColdStartError(coldError(500)), false);
});

// ---------------------------------------------------------------- triggered run

test('triggered: before 9:00 -> skipped, ML never called', async () => {
  seedWorld();
  const ml = stubMl();
  const out = await run(() => scheduler.runTriggeredForecast({ now: SAT_0830, ml, wait: noWait }));
  assert.equal(out.status, 'skipped');
  assert.equal(ml.calls.forecast.length, 0);
});

test('triggered: forecast_runs already has a run since 9:00 today -> skipped', async () => {
  seedWorld({ runs: [{ id: 35, run_at: '2026-10-17T01:00:58.000Z', run_type: 'daily' }] });
  const ml = stubMl();
  const out = await run(() => scheduler.runTriggeredForecast({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(out.status, 'skipped');
  assert.match(out.reason, /already ran today \(forecast_runs #35\)/);
  assert.equal(ml.calls.forecast.length, 0);
});

test('triggered: a manual run at 8:00 does not count as the 9:00 run -> runs', async () => {
  seedWorld({ runs: [{ id: 34, run_at: '2026-10-17T00:00:00.000Z', run_type: 'daily' }] });
  const ml = stubMl();
  const out = await run(() => scheduler.runTriggeredForecast({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(out.status, 'succeeded');
  assert.deepEqual(ml.calls.forecast, [{ horizonDays: 1, runType: 'daily' }]);
});

test('triggered: no trained model -> skipped (no failure notification)', async () => {
  seedWorld({ model: false });
  const ml = stubMl();
  const out = await run(() => scheduler.runTriggeredForecast({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(out.status, 'skipped');
  assert.equal(out.reason, 'no trained model yet');
  assert.equal(fake.tables.notifications.length, 0);
});

test('triggered: wakes the ML service, runs, notifies, records the attempt; Monday = weekly', async () => {
  seedWorld();
  const ml = stubMl();
  const out = await run(() => scheduler.runTriggeredForecast({ trigger: 'external', now: MON_1000, ml, wait: noWait }));
  assert.equal(out.status, 'succeeded');
  assert.ok(ml.calls.health >= 1, '/health first, to wake it');
  assert.deepEqual(ml.calls.forecast, [{ horizonDays: 7, runType: 'weekly' }]);
  assert.equal(fake.tables.notifications[0].metadata.status, 'completed');
  const [a] = attempts();
  assert.deepEqual([a.date, a.trigger, a.run_type, a.status], ['2026-10-19', 'external', 'weekly', 'succeeded']);
});

test('triggered: a cold-start failure is retried ONCE, then succeeds', async () => {
  seedWorld();
  const ml = stubMl({ failures: [coldError(503)] });
  let waited = 0;
  const out = await run(() => scheduler.runTriggeredForecast({ now: SAT_1000, ml, wait: async (ms) => { waited = ms; } }));
  assert.equal(out.status, 'succeeded');
  assert.equal(ml.calls.forecast.length, 2);
  assert.equal(waited, 30000);
});

test('triggered: two cold failures -> failed after ONE retry (no loop)', async () => {
  seedWorld();
  const ml = stubMl({ failures: [coldError(502), coldError(502)] });
  const out = await run(() => scheduler.runTriggeredForecast({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(out.status, 'failed');
  assert.equal(ml.calls.forecast.length, 2);
  assert.equal(attempts()[0].status, 'failed');
});

test('triggered: a non-cold failure (Flask error) is NOT retried', async () => {
  seedWorld();
  const ml = stubMl({ failures: [new Error('retrain required')] });
  const out = await run(() => scheduler.runTriggeredForecast({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(out.status, 'failed');
  assert.equal(ml.calls.forecast.length, 1);
});

// ---------------------------------------------------------------- boot catch-up

test('boot catch-up: before 9:00 nothing; after 9:00 with no run today -> runs once; then skips', async () => {
  seedWorld();
  const ml = stubMl();
  assert.equal((await run(() => scheduler.runForecastBootCatchUp({ now: SAT_0830, ml, wait: noWait }))).status, 'skipped');
  assert.equal(ml.calls.forecast.length, 0);

  const first = await run(() => scheduler.runForecastBootCatchUp({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(first.status, 'succeeded');
  assert.equal(attempts()[0].trigger, 'boot');

  // ml-service writes forecast_runs on success; simulate it.
  fake.tables.forecast_runs.push({ id: 36, run_at: '2026-10-17T02:00:30.000Z', run_type: 'daily' });
  const again = await run(() => scheduler.runForecastBootCatchUp({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(again.status, 'skipped');
  assert.equal(ml.calls.forecast.length, 1);
});

test('boot catch-up: not again after a triggered attempt failed today (no failure per wake-up)', async () => {
  seedWorld();
  fake.tables.audit_logs.push({ id: 1, action_type: scheduler.TRIGGER_ACTION_TYPE, details: JSON.stringify({ date: '2026-10-17', trigger: 'boot', status: 'failed' }) });
  const ml = stubMl();
  const out = await run(() => scheduler.runForecastBootCatchUp({ now: SAT_1000, ml, wait: noWait }));
  assert.equal(out.status, 'skipped');
  assert.equal(out.reason, 'failed earlier today');
  assert.equal(ml.calls.forecast.length, 0);
});

// ---------------------------------------------------------------- endpoint

function post(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withApp(options, fn) {
  const app = express();
  app.use('/api/jobs', createJobsRouter(options));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { return await fn(server.address().port); } finally { await new Promise((r) => server.close(r)); }
}

test('POST /api/jobs/forecast: 404 unset, 401 wrong, 409 jobs off, 202 + background run', async () => {
  let started = 0;
  const runForecast = () => { started += 1; return Promise.resolve({ status: 'succeeded' }); };
  const restore = quiet();
  try {
    await withApp({ env: {}, schedulersEnabled: () => true, runForecast }, async (port) => {
      assert.equal((await post(port, '/api/jobs/forecast', { 'X-Job-Secret': 's' })).status, 404);
    });
    await withApp({ env: { JOB_TRIGGER_SECRET: 's3cret' }, schedulersEnabled: () => true, runForecast }, async (port) => {
      assert.equal((await post(port, '/api/jobs/forecast', { 'X-Job-Secret': 'nope' })).status, 401);
      const ok = await post(port, '/api/jobs/forecast', { 'X-Job-Secret': 's3cret' });
      assert.equal(ok.status, 202);
      assert.deepEqual(ok.body, { success: true, accepted: true, job: 'forecast' });
    });
    await withApp({ env: { JOB_TRIGGER_SECRET: 's3cret' }, schedulersEnabled: () => false, runForecast }, async (port) => {
      assert.equal((await post(port, '/api/jobs/forecast', { 'X-Job-Secret': 's3cret' })).status, 409);
    });
  } finally {
    restore();
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(started, 1, 'only the authorised call with jobs on ran');
});

// ---------------------------------------------------------------- ONE lock (item 8)
//
// The 9:00 cron and POST /api/jobs/forecast both end in the REAL
// mlService.forecast(), whose in-process lock allows one /forecast at a
// time. fetch is mocked: /health answers at once, /forecast waits.

function controllableFetch() {
  const calls = [];
  global.fetch = (url) => {
    if (String(url).endsWith('/health')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    return new Promise((resolve) => {
      calls.push({ url, release: () => resolve({ ok: true, status: 200, json: async () => ({ results: [{ status: 'forecasted' }] }) }) });
    });
  };
  return calls;
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function dailyCronFn() {
  if (!scheduled.length) { const r = quiet(); scheduler.registerForecastJobs(); r(); }
  return scheduled.find((j) => j.expression === '0 9 * * 0,2-6').fn;
}

for (const order of ['cron first', 'external first']) {
  test(`one lock: 9:00 cron + POST /api/jobs/forecast at the same moment (${order}) -> ONE /forecast call`, async () => {
    seedWorld();
    const calls = controllableFetch();
    const restore = quiet();
    let external;
    try {
      const cronFn = dailyCronFn();
      if (order === 'cron first') {
        cronFn();
        external = scheduler.runTriggeredForecast({ trigger: 'external', now: SAT_1000, ml: mlService, wait: noWait });
      } else {
        external = scheduler.runTriggeredForecast({ trigger: 'external', now: SAT_1000, ml: mlService, wait: noWait });
        cronFn();
      }
      await tick();
      assert.equal(calls.length, 1, 'only one /forecast reached the ML service');
      assert.equal(mlService.isForecastInFlight(), true);
      calls[0].release();
      const ext = await external;
      await tick();
      assert.equal(ext.status, 'skipped', 'the external call stood down');
      assert.equal(calls.length, 1);
      assert.equal(mlService.isForecastInFlight(), false, 'lock released');
      assert.equal(scheduler.getSchedulerStatus().lastRuns.daily.status, 'succeeded', 'the run that held the lock is the one shown');
    } finally {
      restore();
    }
  });
}
