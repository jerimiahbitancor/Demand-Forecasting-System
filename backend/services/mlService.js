// services/mlService.js
//
// Thin HTTP client for the Python ml-service (Flask). Express is the
// only thing allowed to call it — the shared secret in X-ML-Service-Secret
// is what enforces that (see ml-service/app.py's require_shared_secret).
// ml-service never calls back into Express; it talks to Supabase directly.
const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://localhost:5001').replace(/\/+$/, '');
const ML_SERVICE_SHARED_SECRET = process.env.ML_SERVICE_SHARED_SECRET;

// Read a positive numeric env var, falling back to the default when unset,
// non-numeric or <= 0 (a bad value must never make every call time out or
// make the wake loop spin). All are plain milliseconds.
const numEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const ML_TRAIN_WAKE_TOTAL_MS = numEnv('ML_TRAIN_WAKE_TOTAL_MS', 60000);
const ML_TRAIN_WAKE_INTERVAL_MS = numEnv('ML_TRAIN_WAKE_INTERVAL_MS', 5000);
const ML_TRAIN_TIMEOUT_MS = numEnv('ML_TRAIN_TIMEOUT_MS', 125000); // just above gunicorn's 120 s
// Retries may legitimately be 0, so this one allows zero.
const ML_TRAIN_RETRIES_429_HIBERNATE = (() => {
  const value = Number(process.env.ML_TRAIN_RETRIES_429_HIBERNATE);
  return Number.isFinite(value) && value >= 0 ? value : 2; // 1 initial + 2 retries
})();
const ML_TRAIN_RETRY_WAIT_MS = numEnv('ML_TRAIN_RETRY_WAIT_MS', 2000);
const ML_TRAIN_COOLDOWN_MS = numEnv('ML_TRAIN_COOLDOWN_MS', 180000); // 3 minutes

// Shared wake (ensureMlServiceAwake, used by forecast). One /health probe at a
// time with a long timeout: a single request usually rides the whole ~60 s
// Render cold start, while short repeated probes are what Render answers with
// 429 hibernate-rate-limited.
const ML_WAKE_PROBE_TIMEOUT_MS = numEnv('ML_WAKE_PROBE_TIMEOUT_MS', 70000);
const ML_WAKE_RETRY_WAIT_MS = numEnv('ML_WAKE_RETRY_WAIT_MS', 10000);
const ML_WAKE_TOTAL_MS = numEnv('ML_WAKE_TOTAL_MS', 120000);
// Render sleeps after 15 minutes idle; a success within 10 minutes means awake.
const ML_AWAKE_CACHE_MS = 10 * 60 * 1000;
// /forecast: retries after a hibernate 429 (each one re-wakes first).
const FORECAST_HIBERNATE_RETRIES = 2;

class MlServiceError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'MlServiceError';
    this.status = status || 500;
    this.details = details;
  }
}

// Flask never answers 429; a 429/502/503 comes from the host in front of it
// (Render's proxy / Cloudflare). Only /forecast is retried: once for a plain
// 429/502/503, up to twice (re-waking first) for a hibernate 429. Its writes
// are upserts on (product_id, forecast_date), so a repeat is harmless.
// /train never goes through here (it uploads a new model file every run).
const RETRYABLE_STATUSES = new Set([429, 502, 503]);
const RETRY_DEFAULT_WAIT_MS = 8000;
const RETRY_MAX_HONORED_WAIT_S = 20;
const BODY_SNIPPET_CHARS = 300;
const FORECAST_BUSY_MESSAGE = 'The forecast server is still starting up. Please try again in a minute.';
const WAKE_TIMEOUT_MESSAGE = 'The forecast server is starting up. This takes about a minute. Please try again shortly.';

// A connection error with one of these codes never established a connection,
// so a training request could not have reached Flask. Anything else (a socket
// reset mid-request) is ambiguous — training may have started.
const PRE_SEND_NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Get current time in Asia/Manila for logging (Ph time zone)
const nowManila = () => {
  try {
    return new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour12: false });
  } catch (e) {
    return new Date().toISOString();
  }
};

const headerOf = (response, name) => {
  try {
    return response.headers && typeof response.headers.get === 'function'
      ? response.headers.get(name)
      : null;
  } catch (e) {
    return null;
  }
};

// The headers that tell who really answered: Flask, Render, or Cloudflare.
function diagnosticHeaders(response) {
  const picked = {
    server: headerOf(response, 'server'),
    'retry-after': headerOf(response, 'retry-after'),
    'cf-ray': headerOf(response, 'cf-ray'),
  };
  if (response.headers && typeof response.headers.forEach === 'function') {
    response.headers.forEach((value, key) => {
      if (/^x-render-/i.test(key)) picked[key.toLowerCase()] = value;
    });
  }
  return picked;
}

// Retry-After in seconds (number or HTTP date). Used only if <= 20 s;
// otherwise (or missing) we wait 8 s.
function retryWaitMs(retryAfter, now = Date.now()) {
  if (retryAfter == null || retryAfter === '') return RETRY_DEFAULT_WAIT_MS;
  let seconds = Number(retryAfter);
  if (!Number.isFinite(seconds)) {
    const at = Date.parse(retryAfter);
    seconds = Number.isFinite(at) ? Math.ceil((at - now) / 1000) : NaN;
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > RETRY_MAX_HONORED_WAIT_S) {
    return RETRY_DEFAULT_WAIT_MS;
  }
  return seconds * 1000;
}

// Render's edge marker for "refused because the app was hibernating": HTTP
// 429 with x-render-routing: hibernate-rate-limited. That refusal happens
// before Flask runs, so a retry cannot duplicate a training run.
function isHibernate429(response) {
  if (!response || response.status !== 429) return false;
  return headerOf(response, 'x-render-routing') === 'hibernate-rate-limited';
}

async function postOnce(path, body) {
  try {
    return await fetch(`${ML_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ML-Service-Secret': ML_SERVICE_SHARED_SECRET,
      },
      body: JSON.stringify(body || {}),
    });
  } catch (networkError) {
    throw new MlServiceError(
      `Could not reach ml-service at ${ML_SERVICE_URL}`,
      503,
      networkError.message
    );
  }
}

// Train-only POST: adds an AbortSignal so the request can be given up on
// after ML_TRAIN_TIMEOUT_MS. Kept separate from postOnce above so the
// forecast path (which has no timeout) is byte-for-byte unchanged. The
// thrown network error carries whether the connection was never made
// (pre-send) so the caller can tell a safe failure from an ambiguous one.
async function postTrainOnce(body, signal) {
  try {
    return await fetch(`${ML_SERVICE_URL}/train`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ML-Service-Secret': ML_SERVICE_SHARED_SECRET,
      },
      body: JSON.stringify(body || {}),
      signal,
    });
  } catch (networkError) {
    // An abort from our own AbortController is not a network error — let it
    // through so the caller can label it a timeout.
    if (networkError && (networkError.name === 'AbortError' || networkError.name === 'TimeoutError')) {
      throw networkError;
    }
    const causeCode = networkError && networkError.cause && networkError.cause.code;
    throw new MlServiceError(
      `Could not reach ml-service at ${ML_SERVICE_URL}`,
      503,
      {
        network: true,
        networkPreSend: PRE_SEND_NETWORK_CODES.has(causeCode),
        causeCode: causeCode || null,
        message: networkError.message,
      }
    );
  }
}

// Body as text first (a proxy error page is not JSON), then JSON if it parses.
async function readBody(response) {
  if (typeof response.text === 'function') {
    let text = '';
    try { text = await response.text(); } catch (e) { text = ''; }
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return { text, data };
  }
  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }
  return { text: data == null ? '' : JSON.stringify(data), data };
}

async function callMlService(path, body, { retryOnBusy = false } = {}) {
  if (!ML_SERVICE_SHARED_SECRET) {
    throw new MlServiceError(
      'ML_SERVICE_SHARED_SECRET is not configured on the Express side',
      500
    );
  }

  let attempt = 0;
  let busyRetries = 0;
  let hibernateRetries = 0;
  for (;;) {
    attempt += 1;
    const response = await postOnce(path, body);
    const { text, data } = await readBody(response);
    if (response.ok) {
      markMlServiceAwake();
      return data;
    }

    const headers = diagnosticHeaders(response);
    const snippet = String(text || '').slice(0, BODY_SNIPPET_CHARS);
    const hibernate = isHibernate429(response);
    // A hibernate 429 is Render refusing before Flask ran: wake, then retry.
    const rewake = retryOnBusy && hibernate && hibernateRetries < FORECAST_HIBERNATE_RETRIES;
    const retryable = retryOnBusy && !hibernate && busyRetries === 0 && RETRYABLE_STATUSES.has(response.status);
    const waitMs = retryable ? retryWaitMs(headers['retry-after']) : null;
    // One line per failed attempt; the details stay in the log, not the UI.
    console.error(`ml-service ${path} HTTP ${response.status} (attempt ${attempt})`
      + `${retryable ? `, retrying in ${waitMs / 1000}s` : ''}`
      + `${rewake ? ', hibernating: waking, then retrying' : ''}: ${JSON.stringify({ headers, body: snippet })}`);

    if (rewake) {
      hibernateRetries += 1;
      lastAwakeAt = 0; // it is clearly not awake
      await ensureMlServiceAwake(); // a wake timeout (503) passes through
      continue;
    }
    if (retryable) {
      busyRetries += 1;
      await sleep(waitMs);
      continue;
    }

    const message = path === '/forecast' && response.status === 429
      ? FORECAST_BUSY_MESSAGE
      : (data && (data.reason || data.error)) || `ml-service returned HTTP ${response.status}`;
    throw new MlServiceError(message, response.status, {
      status: response.status,
      body: snippet,
      headers,
      attempts: attempt,
      ...(data && typeof data === 'object' ? { response: data } : {}),
    });
  }
}

async function checkHealth() {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/health`, { method: 'GET' });
    if (response.ok) markMlServiceAwake();
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Last successful answer from the ML service (health, forecast or train).
let lastAwakeAt = 0;
let wakeInFlight = null;

function markMlServiceAwake() {
  lastAwakeAt = Date.now();
}

// One /health probe with its own long timeout. Any failure (network error,
// timeout, 429, 502, 503, ...) is just "not awake yet".
async function probeHealthOnce(timeoutMs) {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: null, error: (error && error.name) || 'error' };
  }
}

async function wakeMlService() {
  const start = Date.now();
  // Bounded by probe count too, not only wall clock: tests (and any patched
  // sleep) can make the clock stand still. Fast failures (an instant 429)
  // give at most one probe per retry wait.
  const maxProbes = Math.max(1, Math.ceil(ML_WAKE_TOTAL_MS / ML_WAKE_RETRY_WAIT_MS));
  let probes = 0;
  let last = null;
  while (probes < maxProbes) {
    const remaining = ML_WAKE_TOTAL_MS - (Date.now() - start);
    if (remaining <= 0) break;
    probes += 1;
    last = await probeHealthOnce(Math.min(ML_WAKE_PROBE_TIMEOUT_MS, remaining));
    if (last.ok) {
      markMlServiceAwake();
      console.log(`[mlService.wake] [${nowManila()}] outcome=awake probes=${probes} wake_ms=${Date.now() - start}`);
      return { ok: true, probes, elapsedMs: Date.now() - start };
    }
    if (ML_WAKE_TOTAL_MS - (Date.now() - start) <= ML_WAKE_RETRY_WAIT_MS) break;
    await sleep(ML_WAKE_RETRY_WAIT_MS);
  }
  const elapsedMs = Date.now() - start;
  console.log(`[mlService.wake] [${nowManila()}] outcome=wakeup-timeout probes=${probes}/${maxProbes} wake_ms=${elapsedMs}`
    + ` last=${last ? (last.status || last.error) : 'none'}`);
  throw new MlServiceError(WAKE_TIMEOUT_MESSAGE, 503, {
    wakeupTimedOut: true, capMs: ML_WAKE_TOTAL_MS, probes,
  });
}

// Resolves once the ML service answers /health. Returns at once when it
// answered anything within the last 10 minutes. Single flight: concurrent
// callers (manual button, scheduler, boot catch-up) share one probe sequence.
// Rejects with MlServiceError 503 { wakeupTimedOut: true } at the cap.
function ensureMlServiceAwake() {
  if (lastAwakeAt && Date.now() - lastAwakeAt < ML_AWAKE_CACHE_MS) {
    return Promise.resolve({ ok: true, cached: true, probes: 0 });
  }
  if (!wakeInFlight) {
    wakeInFlight = wakeMlService().finally(() => { wakeInFlight = null; });
  }
  return wakeInFlight;
}

async function waitForMlServiceReady(capMs, intervalMs) {
  const cap = capMs || ML_TRAIN_WAKE_TOTAL_MS;
  const interval = intervalMs || ML_TRAIN_WAKE_INTERVAL_MS;
  // Attempts are bounded too, not only by wall clock: tests (and any
  // environment with a patched sleep) can make the clock stand still.
  const maxAttempts = Math.max(1, Math.ceil(cap / interval));
  const start = Date.now();
  let attempts = 0;
  let lastUp = false;
  while (attempts < maxAttempts && Date.now() - start < cap) {
    attempts += 1;
    lastUp = await checkHealth();
    if (lastUp) {
      return { ok: true, attempts, elapsedMs: Date.now() - start };
    }
    await sleep(interval);
  }
  const elapsedMs = Date.now() - start;
  console.log(`[mlService.train] [${nowManila()}] wake=FAILED attempts=${attempts}/${maxAttempts} elapsed=${elapsedMs}ms outcome=wakeup-timeout`);
  const err = new MlServiceError(
    'ML service is still waking up; please try again in a minute.',
    503,
    { wakeupTimedOut: true, capMs: cap, attempts }
  );
  throw err;
}

// POST /api/ml/train blocks synchronously until Flask's /train finishes
// (no job queue) — there's otherwise no way for anything else (the
// Dashboard state machine, TrainingInProgress.jsx's polling) to know
// "training is actually running right now" versus just "an upload is
// pending". This in-memory flag is the same pattern uploadService.js
// already uses for processingUploads. It resets on an Express restart
// mid-training, same tradeoff as that existing pattern — acceptable at
// capstone/single-owner scale, not something a multi-instance
// deployment could rely on.
let trainingInFlight = false;
let trainCooldownUntil = 0; // epoch ms when cooldown ends (after ambiguous failure)

function isTrainingInFlight() {
  return trainingInFlight;
}

function getTrainCooldownRemaining() {
  const now = Date.now();
  if (now < trainCooldownUntil) return trainCooldownUntil - now;
  return 0;
}

function setTrainCooldown(ms = ML_TRAIN_COOLDOWN_MS) {
  trainCooldownUntil = Date.now() + ms;
}

function clearTrainCooldown() {
  trainCooldownUntil = 0;
}

// The one place /train is called. Wakes the service first, then POSTs with an
// AbortController timeout. Retries ONLY when the host refused the request
// before Flask ran (HTTP 429 + x-render-routing: hibernate-rate-limited).
// Never retries any other status, a timeout, or a network error: a retry
// after training started can save a duplicate model_v{timestamp}.json, and
// each run uploads a brand-new file (see the file header comment).
async function callTrainWithRetryAndTimeout() {
  if (!ML_SERVICE_SHARED_SECRET) {
    throw new MlServiceError(
      'ML_SERVICE_SHARED_SECRET is not configured on the Express side',
      500
    );
  }

  const maxAttempts = 1 + Math.max(0, ML_TRAIN_RETRIES_429_HIBERNATE); // 1 initial + N retries

  // Wake-up phase first. A wake-up timeout throws here (503, wakeupTimedOut)
  // and never reaches /train.
  const wakeStart = Date.now();
  const wake = await waitForMlServiceReady(ML_TRAIN_WAKE_TOTAL_MS, ML_TRAIN_WAKE_INTERVAL_MS);
  const wakeupMs = Date.now() - wakeStart;
  console.log(`[mlService.train] [${nowManila()}] wake=ok attempts=${wake.attempts} wake_ms=${wakeupMs} outcome=awake`);

  let attempt = 0;
  let lastError = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    const trainStart = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ML_TRAIN_TIMEOUT_MS);
    try {
      const response = await postTrainOnce({}, controller.signal);
      const { text, data } = await readBody(response);
      const trainMs = Date.now() - trainStart;

      if (response.ok) {
        markMlServiceAwake();
        console.log(`[mlService.train] [${nowManila()}] wake_ms=${wakeupMs} train_req_ms=${trainMs} outcome=success attempt=${attempt}/${maxAttempts}`);
        return data;
      }

      const headers = diagnosticHeaders(response);
      const snippet = String(text || '').slice(0, BODY_SNIPPET_CHARS);
      const isHibernate = isHibernate429(response);
      console.error(`ml-service /train HTTP ${response.status} (attempt ${attempt}/${maxAttempts}) hibernate=${isHibernate}: ${JSON.stringify({ headers, body: snippet })}`);

      const message = (data && (data.reason || data.error)) || `ml-service returned HTTP ${response.status}`;
      lastError = new MlServiceError(message, response.status, {
        status: response.status,
        body: snippet,
        headers,
        attempts: attempt,
        ...(data && typeof data === 'object' ? { response: data } : {}),
      });

      if (isHibernate && attempt < maxAttempts) {
        console.log(`[mlService.train] [${nowManila()}] wake_ms=${wakeupMs} train_req_ms=${trainMs} outcome=hibernate-retry http=429 attempt=${attempt}/${maxAttempts} retry_in_ms=${ML_TRAIN_RETRY_WAIT_MS}`);
        await sleep(ML_TRAIN_RETRY_WAIT_MS);
        continue;
      }

      if (isHibernate) {
        console.log(`[mlService.train] [${nowManila()}] wake_ms=${wakeupMs} train_req_ms=${trainMs} outcome=hibernate-exhausted http=429 attempt=${attempt}/${maxAttempts}`);
      } else {
        console.log(`[mlService.train] [${nowManila()}] wake_ms=${wakeupMs} train_req_ms=${trainMs} outcome=other-error http=${response.status} attempt=${attempt}/${maxAttempts}`);
      }
      throw lastError;
    } catch (err) {
      const trainMs = Date.now() - trainStart;
      // (1) Our AbortController fired: the request was sent, so training may
      // still be running on Flask. Ambiguous — caller sets the cooldown.
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        console.log(`[mlService.train] [${nowManila()}] wake_ms=${wakeupMs} train_req_ms=${trainMs} outcome=timeout attempt=${attempt}/${maxAttempts}`);
        throw new MlServiceError('Training request timed out waiting for the ML service', 504, {
          timeoutMs: ML_TRAIN_TIMEOUT_MS,
          attempts: attempt,
          ambiguous: true,
        });
      }
      // (2) Network failure from postOnce. Pre-send (connection never made)
      // is safe; anything else is ambiguous.
      if (err && err.name === 'MlServiceError' && err.details && err.details.network) {
        const preSend = err.details.networkPreSend === true;
        console.log(`[mlService.train] [${nowManila()}] wake_ms=${wakeupMs} train_req_ms=${trainMs} outcome=network-error preSend=${preSend} attempt=${attempt}/${maxAttempts}`);
        throw new MlServiceError(err.message || 'Network error during training', 503, {
          network: true,
          networkPreSend: preSend,
          attempts: attempt,
          ambiguous: !preSend,
        });
      }
      // (3) A response-derived MlServiceError we threw ourselves (lastError).
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new MlServiceError('Training failed', 500);
}

// An ambiguous failure = the request may have reached Flask and training may
// still be running. Those set a cooldown; a wake-up timeout or a hibernate
// 429 proves training never started and does NOT.
function isAmbiguousTrainFailure(error) {
  if (!error) return false;
  const details = error.details || {};
  if (details.wakeupTimedOut) return false; // never reached Flask
  if (error.status === 429) return false; // hibernate/edge refusal, never reached Flask
  if (typeof details.ambiguous === 'boolean') return details.ambiguous;
  if (error.status === 504) return true; // our AbortController timeout
  if (error.status === 502) return true; // edge/gateway error after forwarding
  return false;
}

// Manual-only, per the confirmed design — this function doesn't decide
// WHETHER to train, it just calls /train. The "should we allow this right
// now" checks (upload completeness, 12-month gate) live in the route handler
// and inside ml-service's /train respectively. Rejects with 409 while another
// run is in flight (TRAINING_IN_FLIGHT) or during the post-ambiguous-failure
// cooldown (TRAIN_COOLDOWN); the cooldown is NOT set by a wake-up timeout or
// a hibernate 429, because those prove training never started on Flask.
function train() {
  if (trainingInFlight) {
    const error = new MlServiceError('Training is already in progress', 409);
    error.code = 'TRAINING_IN_FLIGHT';
    return Promise.reject(error);
  }
  const cooldownMs = getTrainCooldownRemaining();
  if (cooldownMs > 0) {
    const err = new MlServiceError(
      'A previous training request ended without a result and may still be running. Please wait a few minutes before trying again.',
      409,
      { cooldownRemainingMs: cooldownMs }
    );
    err.code = 'TRAIN_COOLDOWN';
    return Promise.reject(err);
  }

  trainingInFlight = true;
  const startAll = Date.now();
  return callTrainWithRetryAndTimeout()
    .then((result) => {
      console.log(`[mlService.train] [${nowManila()}] total_ms=${Date.now() - startAll} outcome=success`);
      return result;
    })
    .catch((error) => {
      if (isAmbiguousTrainFailure(error)) {
        setTrainCooldown(ML_TRAIN_COOLDOWN_MS);
        console.log(`[mlService.train] [${nowManila()}] total_ms=${Date.now() - startAll} outcome=ambiguous-failure cooldown_ms=${ML_TRAIN_COOLDOWN_MS} status=${error && error.status}`);
      }
      throw error;
    })
    .finally(() => {
      trainingInFlight = false;
    });
}


// One forecast at a time. A manual "Generate Forecast" and a scheduled run
// (or two clicks) used to reach ml-service together and write the same
// forecasts rows at once. Same in-memory pattern and same restart/replica
// tradeoff as trainingInFlight above. The flag is set before the first
// await, so two calls in the same tick cannot both get through.
let forecastInFlight = false;

function isForecastInFlight() {
  return forecastInFlight;
}

const FORECAST_IN_FLIGHT_MESSAGE = 'A forecast is already running';

// horizonDays: 1 for the daily refresh, 7 for the weekly Monday run.
// runType is optional — ml-service infers 'daily'/'weekly' from
// horizonDays if omitted (see app.py's /forecast).
// Rejects with MlServiceError status 409, code 'FORECAST_IN_FLIGHT', when
// another forecast is still running; nothing is sent to ml-service then.
// Wakes the ML service first (inside the lock); a wake timeout rejects
// with 503 { wakeupTimedOut: true } and /forecast is never POSTed.
// startDate (Oct 26 2026, optional): 'YYYY-MM-DD' or 'after_latest_sales'
// for an accuracy test. Omitted -> today, as before; the scheduled jobs
// never pass it.
function forecast({ horizonDays = 1, runType, startDate } = {}) {
  if (forecastInFlight) {
    const error = new MlServiceError(FORECAST_IN_FLIGHT_MESSAGE, 409);
    error.code = 'FORECAST_IN_FLIGHT';
    return Promise.reject(error);
  }
  forecastInFlight = true;
  let pending;
  try {
    const body = { horizon_days: horizonDays, run_type: runType };
    if (startDate) body.start_date = startDate;
    pending = ensureMlServiceAwake().then(() => callMlService(
      '/forecast', body, { retryOnBusy: true }
    ));
  } catch (error) {
    forecastInFlight = false;
    return Promise.reject(error);
  }
  return pending.finally(() => {
    forecastInFlight = false;
  });
}

module.exports = {
  train, forecast, checkHealth, ensureMlServiceAwake, isTrainingInFlight, isForecastInFlight,
  MlServiceError, FORECAST_IN_FLIGHT_MESSAGE, FORECAST_BUSY_MESSAGE, WAKE_TIMEOUT_MESSAGE,
  retryWaitMs,
  getTrainCooldownRemaining,
  // Tests only: replace the wait between attempts.
  _setSleepForTests(fn) { sleep = fn; },
  // Tests only: set or forget the "answered recently" time.
  _markAwakeForTests() { markMlServiceAwake(); },
  _resetWakeStateForTests() { lastAwakeAt = 0; wakeInFlight = null; },
  _clearTrainCooldownForTests() { clearTrainCooldown(); },
  _setTrainCooldownForTests(ms) { setTrainCooldown(ms); },
};
