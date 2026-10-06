// tests/statusService.test.js — run: node --test tests/statusService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStatusService,
  buildDefaultChecks,
  classifyMlUrl,
  cleanReason,
  overallOf,
  THRESHOLDS,
} = require('../services/statusService');

const ok = (details = {}) => async () => ({ status: 'ok', details });
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

// ---------------- engine ----------------

test('a 5 s check times out ALONE and the whole result arrives in about timeoutMs', async () => {
  const service = createStatusService({
    timeoutMs: 200,
    checks: {
      database: ok(),
      slow: async () => { await sleep(5000); return { status: 'ok' }; },
      fast: ok({ x: 1 }),
    },
  });
  const started = Date.now();
  const result = await service.getStatus();
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
  assert.equal(result.checks.slow.status, 'fail');
  assert.match(result.checks.slow.reason, /timed out after 200 ms/);
  assert.equal(result.checks.fast.status, 'ok');
  assert.deepEqual(result.checks.fast.details, { x: 1 });
  assert.equal(result.overall, 'degraded');
});

test('the cache returns the same checkedAt within 15 s, then refreshes', async () => {
  let clock = 1_000_000;
  let runs = 0;
  const service = createStatusService({
    now: () => clock,
    checks: { database: async () => { runs += 1; return { status: 'ok' }; } },
  });
  const a = await service.getStatus();
  clock += 14_999;
  const b = await service.getStatus();
  assert.equal(b.checkedAt, a.checkedAt);
  assert.equal(runs, 1);
  clock += 1;
  const c = await service.getStatus();
  assert.notEqual(c.checkedAt, a.checkedAt);
  assert.equal(runs, 2);
  assert.equal(THRESHOLDS.cacheMs, 15000);
});

test('two calls at the same moment share one run', async () => {
  let runs = 0;
  const service = createStatusService({ checks: { database: async () => { runs += 1; await sleep(20); return { status: 'ok' }; } } });
  const [a, b] = await Promise.all([service.getStatus(), service.getStatus()]);
  assert.equal(runs, 1);
  assert.equal(a, b);
});

test('overall: down if database fails; degraded on any warn/fail; ok otherwise', () => {
  assert.equal(overallOf({ database: { status: 'fail' }, server: { status: 'ok' } }), 'down');
  assert.equal(overallOf({ database: { status: 'ok' }, mlService: { status: 'fail' } }), 'degraded');
  assert.equal(overallOf({ database: { status: 'warn' }, server: { status: 'ok' } }), 'degraded');
  assert.equal(overallOf({ database: { status: 'ok' }, server: { status: 'ok' } }), 'ok');
});

test('a throwing check does not break the others', async () => {
  const service = createStatusService({
    checks: {
      database: ok(),
      broken: async () => { throw new Error('boom at https://secret-host.example.com/x?key=abc'); },
      server: ok(),
    },
  });
  const result = await service.getStatus();
  assert.equal(result.checks.broken.status, 'fail');
  assert.match(result.checks.broken.reason, /boom/);
  assert.ok(!result.checks.broken.reason.includes('secret-host'), 'URLs are removed from reasons');
  assert.equal(result.checks.database.status, 'ok');
  assert.equal(result.checks.server.status, 'ok');
  assert.equal(result.overall, 'degraded');
  for (const c of Object.values(result.checks)) {
    assert.ok(c.checkedAt && typeof c.latencyMs === 'number');
  }
});

test('an unknown status value counts as fail', async () => {
  const service = createStatusService({ checks: { database: async () => ({ status: 'great' }) } });
  assert.equal((await service.getStatus()).checks.database.status, 'fail');
});

test('cleanReason / classifyMlUrl', () => {
  assert.equal(cleanReason('failed http://a.b/c and https://x.y'), 'failed [url] and [url]');
  assert.equal(classifyMlUrl('http://ml-service.railway.internal:8080'), 'private');
  assert.equal(classifyMlUrl('https://ml-production.up.railway.app'), 'public');
  assert.equal(classifyMlUrl('http://localhost:5001'), 'local');
  assert.equal(classifyMlUrl('not a url'), null);
});

// ---------------- real checks, fake dependencies ----------------

// A Supabase-like fake answering per table: answers[table](query) -> { data, count, error }.
function fakeClient(answers) {
  return {
    from(table) {
      const q = { table, filters: {}, head: false, range: null };
      const b = {
        select(_c, o = {}) { q.head = Boolean(o.head); return b; },
        order() { return b; },
        limit() { return b; },
        eq(c, v) { q.filters[c] = v; return b; },
        gte(c, v) { q.filters[`${c}>=`] = v; return b; },
        in() { return b; },
        gt() { return b; },
        lt() { return b; },
        range(f, t) { q.range = [f, t]; return b; },
        then(res, rej) {
          const answer = answers[table] ? answers[table](q) : { data: [], count: 0, error: null };
          // fetchAllRows pages until an empty page.
          if (q.range && q.range[0] > 0) return Promise.resolve({ data: [], error: null }).then(res, rej);
          return Promise.resolve(answer).then(res, rej);
        },
      };
      return b;
    },
  };
}

const baseDeps = (over = {}) => ({
  client: fakeClient({}),
  requestStats: { snapshot: () => ({ since: '2026-10-06T00:00:00.000Z', count: 10, errors5xx: 0, rateLimited429: 0, p50Ms: 50, p95Ms: 300, maxMs: 400 }) },
  getSchedulerStatus: () => ({ since: '2026-10-06T00:00:00.000Z', jobs: [], lastRuns: { daily: null, weekly: null } }),
  isTrainingInFlight: () => false,
  getMissingOperatingDays: async () => ({ missingOperatingDays: 0, missingDates: [], operatingDaysSource: 'configured' }),
  fetchImpl: async () => ({ status: 200 }),
  env: { NODE_ENV: 'production', ML_SERVICE_URL: 'http://ml.railway.internal:8080', RAILWAY_GIT_COMMIT_SHA: 'abcdef1234567' },
  process: { memoryUsage: () => ({ rss: 200 * 1024 * 1024 }), uptime: () => 3600, version: 'v22.20.0' },
  ...over,
});

test('server: ok, commit shortened; warns on memory, p95 and 5xx', async () => {
  const okResult = await buildDefaultChecks(baseDeps()).server();
  assert.equal(okResult.status, 'ok');
  assert.equal(okResult.details.commit, 'abcdef1');
  assert.equal(okResult.details.memoryLimitMb, 512);

  const bad = await buildDefaultChecks(baseDeps({
    process: { memoryUsage: () => ({ rss: 450 * 1024 * 1024 }), uptime: () => 10, version: 'v22' },
    requestStats: { snapshot: () => ({ count: 5, errors5xx: 2, rateLimited429: 0, p50Ms: 100, p95Ms: 2500, maxMs: 3000 }) },
  })).server();
  assert.equal(bad.status, 'warn');
  assert.match(bad.reason, /memory 450 MB is 88% of 512 MB/);
  assert.match(bad.reason, /p95 2500 ms/);
  assert.match(bad.reason, /2 server error/);

  const noSha = await buildDefaultChecks(baseDeps({ env: { NODE_ENV: 'production' } })).server();
  assert.equal(noSha.details.commit, 'unknown');
});

test('database: error -> fail; slow -> warn/fail by threshold', async () => {
  const failing = await buildDefaultChecks(baseDeps({
    client: fakeClient({ forecast_config: () => ({ data: null, error: { code: 'XX', message: 'down' } }) }),
  })).database();
  assert.equal(failing.status, 'fail');

  let clock = 0;
  const slowClient = { from: () => ({ select: () => ({ limit: async () => { clock += 700; return { data: [], error: null }; } }) }) };
  const slow = await buildDefaultChecks(baseDeps({ client: slowClient, now: () => clock })).database();
  assert.equal(slow.status, 'warn');
  clock = 0;
  const verySlowClient = { from: () => ({ select: () => ({ limit: async () => { clock += 1600; return { data: [], error: null }; } }) }) };
  const verySlow = await buildDefaultChecks(baseDeps({ client: verySlowClient, now: () => clock })).database();
  assert.equal(verySlow.status, 'fail');
});

test('mlService: private ok, public warns, unreachable fails, URL never exposed', async () => {
  const priv = await buildDefaultChecks(baseDeps()).mlService();
  assert.equal(priv.status, 'ok');
  assert.equal(priv.details.networkType, 'private');

  const pub = await buildDefaultChecks(baseDeps({ env: { ML_SERVICE_URL: 'https://ml-prod.up.railway.app' } })).mlService();
  assert.equal(pub.status, 'warn');
  assert.equal(pub.reason, 'public URL: long ML calls can be cut by the edge after ~60 s');
  assert.ok(!JSON.stringify(pub).includes('ml-prod'), 'no hostname in the output');

  const down = await buildDefaultChecks(baseDeps({
    fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); },
  })).mlService();
  assert.equal(down.status, 'fail');
  assert.equal(down.reason, 'not reachable (ECONNREFUSED)');

  const non200 = await buildDefaultChecks(baseDeps({ fetchImpl: async () => ({ status: 503 }) })).mlService();
  assert.equal(non200.status, 'fail');
});

test('uploads: counts today; warns on failures and old pending uploads', async () => {
  const now = Date.parse('2026-10-06T05:00:00Z'); // 13:00 in Manila
  const client = fakeClient({
    uploads: (q) => (q.filters.status === 'pending'
      ? { data: [{ upload_date: '2026-10-06T10:30:00' }], error: null } // 150 min before 13:00
      : { data: [{ status: 'processed' }, { status: 'processed' }, { status: 'failed' }], error: null }),
  });
  const result = await buildDefaultChecks(baseDeps({ client, now: () => now })).uploads();
  assert.equal(result.status, 'warn');
  assert.deepEqual(result.details.today, { processed: 2, pending: 0, failed: 1, other: 0 });
  assert.equal(result.details.oldestPendingMinutes, 150);
  assert.match(result.reason, /1 upload\(s\) failed today/);
  assert.match(result.reason, /pending for 150 minutes/);
  assert.equal(result.details.date, '2026-10-06');
});

test('mlPipeline: formats the beats-baseline warning from the row, never hardcoded', async () => {
  const client = fakeClient({
    model_metrics: () => ({ data: [{ model_version: 'model_v20261006_101932', evaluation_date: '2026-10-06', wmape: 32.26, baseline_wmape: 31.27 }], error: null }),
    forecast_runs: () => ({ data: [{ run_at: '2026-10-06T02:00:00Z', run_type: 'weekly', stale_days: 2, last_confirmed_date: '2026-10-03' }], error: null }),
    forecasts: () => ({ data: null, count: 64, error: null }),
  });
  const result = await buildDefaultChecks(baseDeps({
    client,
    getMissingOperatingDays: async ({ lastConfirmedDate }) => {
      assert.equal(lastConfirmedDate, '2026-10-03');
      return { missingOperatingDays: 1, missingDates: ['2026-10-05'], operatingDaysSource: 'configured' };
    },
  })).mlPipeline();
  assert.equal(result.status, 'warn');
  assert.match(result.reason, /model does not beat the 7-day average \(32\.3% vs 31\.3% WMAPE\)/);
  assert.match(result.reason, /1 operating day\(s\) with no upload or closed mark since 2026-10-03/);
  assert.equal(result.details.model.beatsBaseline, false);
  assert.equal(result.details.latestRun.rawStaleDays, 2);
  assert.equal(result.details.missingOperatingDays, 1);
  assert.equal(result.details.operatingDaysSource, 'configured');
  assert.equal(result.details.forecastsToday, 64);

  // A different row gives different numbers: nothing is hardcoded.
  const other = await buildDefaultChecks(baseDeps({
    client: fakeClient({
      model_metrics: () => ({ data: [{ model_version: 'v2', evaluation_date: '2026-11-01', wmape: 25.04, baseline_wmape: 24.96 }], error: null }),
      forecasts: () => ({ data: null, count: 10, error: null }),
    }),
  })).mlPipeline();
  assert.match(other.reason, /\(25\.0% vs 25\.0% WMAPE\)/);
});

test('mlPipeline: healthy model -> ok; no model -> warn; no forecasts today -> warn', async () => {
  const healthy = await buildDefaultChecks(baseDeps({
    client: fakeClient({
      model_metrics: () => ({ data: [{ model_version: 'v', evaluation_date: '2026-10-06', wmape: 20, baseline_wmape: 25 }], error: null }),
      forecasts: () => ({ data: null, count: 5, error: null }),
    }),
  })).mlPipeline();
  assert.equal(healthy.status, 'ok');
  assert.equal(healthy.details.model.beatsBaseline, true);

  const none = await buildDefaultChecks(baseDeps()).mlPipeline();
  assert.equal(none.status, 'warn');
  assert.match(none.reason, /no model trained yet/);

  const noForecasts = await buildDefaultChecks(baseDeps({
    client: fakeClient({
      model_metrics: () => ({ data: [{ model_version: 'v', evaluation_date: '2026-10-06', wmape: 20, baseline_wmape: 25 }], error: null }),
      forecasts: () => ({ data: null, count: 0, error: null }),
    }),
  })).mlPipeline();
  assert.match(noForecasts.reason, /no forecasts for today/);
});

test('scheduler: a failed last run warns', async () => {
  const result = await buildDefaultChecks(baseDeps({
    getSchedulerStatus: () => ({
      since: 'x', jobs: [],
      lastRuns: { daily: { status: 'failed', finishedAt: '2026-10-06T01:00:05.000Z', error: 'ml-service timed out' }, weekly: null },
    }),
  })).scheduler();
  assert.equal(result.status, 'warn');
  assert.match(result.reason, /daily run failed at .*: ml-service timed out/);
  const fine = await buildDefaultChecks(baseDeps()).scheduler();
  assert.equal(fine.status, 'ok');
});

test('the full result with the real checks has 6 checks and no secrets', async () => {
  const deps = baseDeps({ env: { ...baseDeps().env, SUPABASE_SERVICE_ROLE_KEY: 'super-secret-key', ML_SERVICE_SHARED_SECRET: 'shh' } });
  const service = createStatusService({ checks: buildDefaultChecks(deps) });
  const result = await service.getStatus();
  assert.deepEqual(Object.keys(result.checks).sort(), ['database', 'mlPipeline', 'mlService', 'scheduler', 'server', 'uploads']);
  const text = JSON.stringify(result);
  for (const secret of ['super-secret-key', 'shh', 'ml.railway.internal', 'http://']) {
    assert.ok(!text.includes(secret), `output must not contain ${secret}`);
  }
});
