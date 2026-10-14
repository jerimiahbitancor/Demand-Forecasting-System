// services/mlService.js
//
// Thin HTTP client for the Python ml-service (Flask). Express is the
// only thing allowed to call it — the shared secret in X-ML-Service-Secret
// is what enforces that (see ml-service/app.py's require_shared_secret).
// ml-service never calls back into Express; it talks to Supabase directly.
const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://localhost:5001').replace(/\/+$/, '');
const ML_SERVICE_SHARED_SECRET = process.env.ML_SERVICE_SHARED_SECRET;

class MlServiceError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'MlServiceError';
    this.status = status || 500;
    this.details = details;
  }
}

// Flask never answers 429; a 429/502/503 comes from the host in front of it
// (Render's proxy / Cloudflare). Only /forecast is retried, once: its writes
// are upserts on (product_id, forecast_date), so a repeat is harmless.
// /train is never retried (it uploads a new model file every run).
const RETRYABLE_STATUSES = new Set([429, 502, 503]);
const RETRY_DEFAULT_WAIT_MS = 8000;
const RETRY_MAX_HONORED_WAIT_S = 20;
const BODY_SNIPPET_CHARS = 300;
const FORECAST_BUSY_MESSAGE = 'The forecast server is busy right now. Please try again in a minute.';

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  for (;;) {
    attempt += 1;
    const response = await postOnce(path, body);
    const { text, data } = await readBody(response);
    if (response.ok) return data;

    const headers = diagnosticHeaders(response);
    const snippet = String(text || '').slice(0, BODY_SNIPPET_CHARS);
    const retryable = retryOnBusy && attempt === 1 && RETRYABLE_STATUSES.has(response.status);
    const waitMs = retryable ? retryWaitMs(headers['retry-after']) : null;
    // One line per failed attempt; the details stay in the log, not the UI.
    console.error(`ml-service ${path} HTTP ${response.status} (attempt ${attempt})`
      + `${retryable ? `, retrying in ${waitMs / 1000}s` : ''}: ${JSON.stringify({ headers, body: snippet })}`);

    if (retryable) {
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
    return response.ok;
  } catch (error) {
    return false;
  }
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

function isTrainingInFlight() {
  return trainingInFlight;
}

// Manual-only, per the confirmed design — this function doesn't decide
// WHETHER to train, it just calls /train. The "should we allow this
// right now" checks (upload completeness, 12-month gate) live in the
// route handler and inside ml-service's /train respectively.
function train() {
  trainingInFlight = true;
  return callMlService('/train', {}).finally(() => {
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
function forecast({ horizonDays = 1, runType } = {}) {
  if (forecastInFlight) {
    const error = new MlServiceError(FORECAST_IN_FLIGHT_MESSAGE, 409);
    error.code = 'FORECAST_IN_FLIGHT';
    return Promise.reject(error);
  }
  forecastInFlight = true;
  let pending;
  try {
    pending = callMlService('/forecast', { horizon_days: horizonDays, run_type: runType }, { retryOnBusy: true });
  } catch (error) {
    forecastInFlight = false;
    return Promise.reject(error);
  }
  return pending.finally(() => {
    forecastInFlight = false;
  });
}

module.exports = {
  train, forecast, checkHealth, isTrainingInFlight, isForecastInFlight,
  MlServiceError, FORECAST_IN_FLIGHT_MESSAGE, FORECAST_BUSY_MESSAGE,
  retryWaitMs,
  // Tests only: replace the wait between attempts.
  _setSleepForTests(fn) { sleep = fn; },
};
