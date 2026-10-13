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

async function callMlService(path, body) {
  if (!ML_SERVICE_SHARED_SECRET) {
    throw new MlServiceError(
      'ML_SERVICE_SHARED_SECRET is not configured on the Express side',
      500
    );
  }

  let response;
  try {
    response = await fetch(`${ML_SERVICE_URL}${path}`, {
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

  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    // Non-JSON response (e.g. a proxy error page) — data stays null,
    // response.ok / response.status below still drive the error path.
  }

  if (!response.ok) {
    throw new MlServiceError(
      (data && (data.reason || data.error)) || `ml-service returned HTTP ${response.status}`,
      response.status,
      data
    );
  }

  return data;
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
    pending = callMlService('/forecast', { horizon_days: horizonDays, run_type: runType });
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
  MlServiceError, FORECAST_IN_FLIGHT_MESSAGE,
};
