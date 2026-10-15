// tests/mlServiceRetry.test.js — run: node --test tests/mlServiceRetry.test.js
//
// mlService.callMlService on a host-level refusal (429/502/503):
//   /forecast retries ONCE (its writes are upserts), /train never retries,
//   and the error carries status, a body snippet and the diagnostic headers.
// fetch is replaced and the wait is instant: nothing reaches a real service.
//
// train() also wakes the ML service (GET /health polling) and retries the
// POST ONLY for the hibernate marker (HTTP 429 + x-render-routing:
// hibernate-rate-limited). Everything else — other statuses, timeouts,
// network errors — is never retried, and ambiguous failures set a cooldown.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ML_SERVICE_SHARED_SECRET = 'test-secret';
process.env.ML_TRAIN_TIMEOUT_MS = '120'; // keep the abort-timeout test fast
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

// A fetch stand-in that never answers until its AbortSignal fires.
function hangUntilAbort(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const signal = opts.signal;
    const abort = () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (!signal) return; // never resolves
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort);
  });
}

let calls = [];
function queue(...responses) {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push(url);
    const next = responses.shift();
    if (typeof next === 'function') return next(url, opts);
    if (!next) throw new Error('unexpected extra fetch');
    return next;
  };
}

const healthCalls = () => calls.filter((u) => u.endsWith('/health'));
const trainCalls = () => calls.filter((u) => u.endsWith('/train'));

// Keep the expected console output out of the test run.
const realError = console.error;
const realLog = console.log;
const logged = [];
test.before(() => {
  console.error = (...args) => logged.push(args.join(' '));
  console.log = (...args) => logged.push(args.join(' '));
});
test.after(() => { console.error = realError; console.log = realLog; });
test.beforeEach(() => {
  waits.length = 0;
  logged.length = 0;
  mlService._clearTrainCooldownForTests();
});

const RENDER_429 = '<html><body>Too Many Requests — rate limited by the edge</body></html>';
const H429 = { server: 'cloudflare', 'cf-ray': 'abc123-SIN', 'x-render-origin-server': 'Render' };
const HIBERNATE_429 = { ...H429, 'x-render-routing': 'hibernate-rate-limited' };

// ---------------------------------------------------------------------------
// forecast — unchanged behavior (must keep passing exactly as before)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// train — wake-up polling
// ---------------------------------------------------------------------------

test('train wakes the ML service: health fails a few times, then train runs', async () => {
  queue(
    fakeResponse(503, 'asleep'),
    fakeResponse(429, RENDER_429, H429),
    fakeResponse(200, { ok: true }),
    fakeResponse(200, { success: true, data: { model: 'v1' } })
  );
  const result = await mlService.train();
  assert.equal(result.success, true);
  assert.equal(healthCalls().length, 3);
  assert.equal(trainCalls().length, 1);
  assert.deepEqual(waits, [5000, 5000]); // one wait after each failed health poll
  assert.equal(mlService.isTrainingInFlight(), false);
  assert.equal(mlService.getTrainCooldownRemaining(), 0);
});

test('train: health never succeeds within the cap -> 503, train never called, no cooldown', async () => {
  queue(...Array.from({ length: 50 }, () => fakeResponse(503, 'still asleep')));
  await assert.rejects(mlService.train(), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.details.wakeupTimedOut, true);
    return true;
  });
  assert.equal(trainCalls().length, 0);
  assert.equal(healthCalls().length, 12); // cap 60 s / interval 5 s
  assert.equal(mlService.isTrainingInFlight(), false);
  assert.equal(mlService.getTrainCooldownRemaining(), 0);
});

// ---------------------------------------------------------------------------
// train — hibernate retry (the only retried case)
// ---------------------------------------------------------------------------

test('train: 429 + x-render-routing: hibernate-rate-limited -> retried, then succeeds', async () => {
  queue(
    fakeResponse(200, { ok: true }),
    fakeResponse(429, RENDER_429, HIBERNATE_429),
    fakeResponse(200, { success: true })
  );
  const result = await mlService.train();
  assert.equal(result.success, true);
  assert.equal(trainCalls().length, 2); // 1 initial + 1 retry
  assert.ok(waits.includes(2000)); // ML_TRAIN_RETRY_WAIT_MS
  assert.equal(mlService.getTrainCooldownRemaining(), 0);
});

test('train: 429 WITHOUT the hibernate marker -> NOT retried', async () => {
  queue(fakeResponse(200, { ok: true }), fakeResponse(429, RENDER_429, H429));
  await assert.rejects(mlService.train(), (error) => {
    assert.equal(error.status, 429);
    return true;
  });
  assert.equal(trainCalls().length, 1);
  assert.equal(mlService.getTrainCooldownRemaining(), 0); // never reached Flask
  assert.equal(mlService.isTrainingInFlight(), false);
});

test('train: hibernate 429 on every attempt -> exhausts retries, no cooldown', async () => {
  queue(
    fakeResponse(200, { ok: true }),
    fakeResponse(429, RENDER_429, HIBERNATE_429),
    fakeResponse(429, RENDER_429, HIBERNATE_429),
    fakeResponse(429, RENDER_429, HIBERNATE_429)
  );
  await assert.rejects(mlService.train(), (error) => {
    assert.equal(error.status, 429);
    return true;
  });
  assert.equal(trainCalls().length, 3); // 1 initial + 2 retries
  assert.equal(mlService.getTrainCooldownRemaining(), 0);
});

// ---------------------------------------------------------------------------
// train — everything else is never retried
// ---------------------------------------------------------------------------

for (const status of [422, 500, 502, 503]) {
  test(`train: Flask HTTP ${status} -> NOT retried`, async () => {
    queue(fakeResponse(200, { ok: true }), fakeResponse(status, { error: `flask ${status}` }));
    await assert.rejects(mlService.train(), (error) => {
      assert.equal(error.status, status);
      return true;
    });
    assert.equal(trainCalls().length, 1);
    assert.equal(mlService.isTrainingInFlight(), false);
    // 502 is an ambiguous edge error (may have been forwarded); others are not.
    const expectedCooldown = status === 502 ? 180000 : 0;
    assert.equal(mlService.getTrainCooldownRemaining() > 0, expectedCooldown > 0);
  });
}

test('train: timeout -> 504, no retry, flags cleared, cooldown set', async () => {
  queue(fakeResponse(200, { ok: true }), hangUntilAbort);
  await assert.rejects(mlService.train(), (error) => {
    assert.equal(error.status, 504);
    assert.equal(error.details.attempts, 1);
    return true;
  });
  assert.equal(trainCalls().length, 1); // never retried
  assert.equal(mlService.isTrainingInFlight(), false);
  assert.ok(mlService.getTrainCooldownRemaining() > 0, 'cooldown must be set after a timeout');
});

// ---------------------------------------------------------------------------
// train — cooldown after ambiguous failure
// ---------------------------------------------------------------------------

test('train: after a timeout, a new call returns 409 (cooldown) without fetching', async () => {
  queue(fakeResponse(200, { ok: true }), hangUntilAbort);
  await assert.rejects(mlService.train(), (error) => error.status === 504);

  calls = [];
  await assert.rejects(mlService.train(), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'TRAIN_COOLDOWN');
    assert.match(error.message, /may still be running/);
    return true;
  });
  assert.equal(calls.length, 0, 'no fetch may happen while in cooldown');
});

test('train: cooldown does NOT apply after a wake-up timeout', async () => {
  queue(...Array.from({ length: 50 }, () => fakeResponse(503, 'still asleep')));
  await assert.rejects(mlService.train(), (error) => error.details.wakeupTimedOut === true);
  assert.equal(mlService.getTrainCooldownRemaining(), 0);
});

test('train: cooldown does NOT apply after a hibernate 429', async () => {
  queue(
    fakeResponse(200, { ok: true }),
    fakeResponse(429, RENDER_429, HIBERNATE_429),
    fakeResponse(429, RENDER_429, HIBERNATE_429),
    fakeResponse(429, RENDER_429, HIBERNATE_429)
  );
  await assert.rejects(mlService.train(), (error) => error.status === 429);
  assert.equal(mlService.getTrainCooldownRemaining(), 0);
});

// ---------------------------------------------------------------------------
// train — in-flight guard
// ---------------------------------------------------------------------------

test('train: a second call during the wake-up phase returns 409', async () => {
  queue(...Array.from({ length: 50 }, () => fakeResponse(503, 'still asleep')));
  const first = mlService.train();
  // Issued synchronously while the first call is still polling /health.
  await assert.rejects(mlService.train(), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'TRAINING_IN_FLIGHT');
    return true;
  });
  await assert.rejects(first, (error) => error.status === 503);
  assert.equal(mlService.isTrainingInFlight(), false);
});
