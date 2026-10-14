// tests/mlServiceRetry.test.js — run: node --test tests/mlServiceRetry.test.js
//
// mlService.callMlService on a host-level refusal (429/502/503):
//   /forecast retries ONCE (its writes are upserts), /train never retries,
//   and the error carries status, a body snippet and the diagnostic headers.
// fetch is replaced and the wait is instant: nothing reaches a real service.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ML_SERVICE_SHARED_SECRET = 'test-secret';
const mlService = require('../services/mlService');

const waits = [];
mlService._setSleepForTests(async (ms) => { waits.push(ms); });

// Minimal Response stand-in: text(), headers.get/forEach, ok, status.
function fakeResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      get: (name) => lower[name.toLowerCase()] ?? null,
      forEach: (fn) => Object.entries(lower).forEach(([k, v]) => fn(v, k)),
    },
  };
}

let calls = [];
function queue(...responses) {
  calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return next;
  };
}

// Keep the expected console.error lines out of the test output.
const realError = console.error;
const logged = [];
test.before(() => { console.error = (...args) => logged.push(args.join(' ')); });
test.after(() => { console.error = realError; });
test.beforeEach(() => { waits.length = 0; logged.length = 0; });

const RENDER_429 = '<html><body>Too Many Requests — rate limited by the edge</body></html>';
const H429 = { server: 'cloudflare', 'cf-ray': 'abc123-SIN', 'x-render-origin-server': 'Render' };

test('/forecast: 429 then 200 -> succeeds after one retry, waits 8 s by default', async () => {
  queue(fakeResponse(429, RENDER_429, H429), fakeResponse(200, { results: [{ status: 'forecasted' }] }));
  const result = await mlService.forecast({ horizonDays: 7 });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [8000]);
  assert.equal(result.results.length, 1);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /HTTP 429 \(attempt 1\), retrying in 8s/);
  assert.match(logged[0], /cf-ray/);
  assert.equal(mlService.isForecastInFlight(), false);
});

test('/forecast: 429 twice -> error with status, body snippet, headers, busy message', async () => {
  queue(fakeResponse(429, RENDER_429, H429), fakeResponse(429, RENDER_429, H429));
  await assert.rejects(mlService.forecast({ horizonDays: 1 }), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.message, mlService.FORECAST_BUSY_MESSAGE);
    assert.equal(error.details.status, 429);
    assert.equal(error.details.body, RENDER_429);
    assert.equal(error.details.headers.server, 'cloudflare');
    assert.equal(error.details.headers['cf-ray'], 'abc123-SIN');
    assert.equal(error.details.headers['x-render-origin-server'], 'Render');
    assert.equal(error.details.attempts, 2);
    return true;
  });
  assert.equal(calls.length, 2); // retried once, not more
  assert.equal(logged.length, 2);
  assert.equal(mlService.isForecastInFlight(), false);
});

test('/forecast: honours Retry-After up to 20 s, else 8 s', async () => {
  queue(fakeResponse(503, 'busy', { 'retry-after': '3' }), fakeResponse(200, { results: [] }));
  await mlService.forecast({});
  assert.deepEqual(waits, [3000]);
  assert.equal(mlService.retryWaitMs('20'), 20000);
  assert.equal(mlService.retryWaitMs('120'), 8000);
  assert.equal(mlService.retryWaitMs(null), 8000);
  assert.equal(mlService.retryWaitMs('nonsense'), 8000);
});

test('body snippet is cut to 300 characters', async () => {
  const long = 'x'.repeat(1000);
  queue(fakeResponse(502, long), fakeResponse(502, long));
  await assert.rejects(mlService.forecast({}), (error) => {
    assert.equal(error.details.body.length, 300);
    assert.equal(error.status, 502);
    return true;
  });
});

test('/train: 429 -> no retry, error with details', async () => {
  queue(fakeResponse(429, RENDER_429, H429));
  await assert.rejects(mlService.train(), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.details.status, 429);
    assert.equal(error.details.body, RENDER_429);
    assert.equal(error.details.attempts, 1);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
  assert.equal(mlService.isTrainingInFlight(), false);
});

test('a Flask JSON error keeps its own message (no retry on 422)', async () => {
  queue(fakeResponse(422, { success: false, error: 'Not enough history' }));
  await assert.rejects(mlService.forecast({}), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.message, 'Not enough history');
    assert.equal(error.details.response.error, 'Not enough history');
    return true;
  });
  assert.equal(calls.length, 1);
});
