// tests/forecastScheduler.test.js — run: node --test tests/forecastScheduler.test.js
//
// The scheduler now remembers its last run per type (for /api/status).
// What it schedules and what it calls must not change.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function stubModule(relPath, exports) {
  const abs = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// No database, no real cron, no real ML service.
const fakeClient = { from: () => ({ select: async () => ({ data: [], error: null }) }) };
stubModule('config/supabase.js', { supabase: fakeClient, supabaseAdmin: fakeClient, isConfigured: true });
const scheduled = [];
const cronPath = require.resolve('node-cron', { paths: [path.join(__dirname, '..')] });
require.cache[cronPath] = {
  id: cronPath, filename: cronPath, loaded: true,
  exports: { schedule: (expression, fn, options) => scheduled.push({ expression, fn, options }) },
};
const mlService = require('../services/mlService');

const quiet = () => {
  const saved = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
};

const scheduler = require('../jobs/forecastScheduler');

test('schedules the same two jobs as before, in Asia/Manila', () => {
  const restore = quiet();
  scheduler.registerForecastJobs();
  restore();
  assert.deepEqual(
    scheduled.map((s) => [s.expression, s.options.timezone]),
    [['0 9 * * *', 'Asia/Manila'], ['0 9 * * 1', 'Asia/Manila']]
  );
  const status = scheduler.getSchedulerStatus();
  assert.deepEqual(status.jobs, [
    { name: 'daily', cron: '0 9 * * *', timezone: 'Asia/Manila' },
    { name: 'weekly', cron: '0 9 * * 1', timezone: 'Asia/Manila' },
  ]);
  assert.ok(!Number.isNaN(Date.parse(status.since)));
});

test('each cron job calls mlService.forecast with the same arguments as before', async () => {
  const calls = [];
  mlService.forecast = async (args) => { calls.push(args); return { results: [] }; };
  const restore = quiet();
  for (const job of scheduled) await job.fn();
  await new Promise((r) => setTimeout(r, 10));
  restore();
  assert.deepEqual(calls, [{ horizonDays: 1, runType: 'daily' }, { horizonDays: 7, runType: 'weekly' }]);
});

test('records a succeeded run with counts', async () => {
  mlService.forecast = async () => ({
    results: [{ status: 'forecasted' }, { status: 'forecasted' }, { status: 'skipped' }],
  });
  const restore = quiet();
  await scheduler.runScheduledForecast({ horizonDays: 7, runType: 'weekly' });
  restore();
  const run = scheduler.getSchedulerStatus().lastRuns.weekly;
  assert.equal(run.status, 'succeeded');
  assert.equal(run.forecastedCount, 2);
  assert.equal(run.skippedCount, 1);
  assert.equal(run.error, null);
  assert.ok(Date.parse(run.finishedAt) >= Date.parse(run.startedAt));
});

test('records a failed run with the error message, per run type', async () => {
  mlService.forecast = async () => { throw new Error('ml-service timed out'); };
  const restore = quiet();
  await scheduler.runScheduledForecast({ horizonDays: 1, runType: 'daily' });
  restore();
  const { lastRuns } = scheduler.getSchedulerStatus();
  assert.equal(lastRuns.daily.status, 'failed');
  assert.equal(lastRuns.daily.error, 'ml-service timed out');
  assert.equal(lastRuns.weekly.status, 'succeeded', 'the other run type is kept');
});

test('shows "running" while a run is in flight', async () => {
  let release;
  mlService.forecast = () => new Promise((r) => { release = r; });
  const restore = quiet();
  const pending = scheduler.runScheduledForecast({ horizonDays: 1, runType: 'daily' });
  assert.equal(scheduler.getSchedulerStatus().lastRuns.daily.status, 'running');
  release({ results: [] });
  await pending;
  restore();
  assert.equal(scheduler.getSchedulerStatus().lastRuns.daily.status, 'succeeded');
});
