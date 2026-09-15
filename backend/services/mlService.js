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

// Manual-only, per the confirmed design — this function doesn't decide
// WHETHER to train, it just calls /train. The "should we allow this
// right now" checks (upload completeness, 12-month gate) live in the
// route handler and inside ml-service's /train respectively.
function train() {
  return callMlService('/train', {});
}

// horizonDays: 1 for the daily refresh, 7 for the weekly Monday run.
// runType is optional — ml-service infers 'daily'/'weekly' from
// horizonDays if omitted (see app.py's /forecast).
function forecast({ horizonDays = 1, runType } = {}) {
  return callMlService('/forecast', { horizon_days: horizonDays, run_type: runType });
}

module.exports = { train, forecast, checkHealth, MlServiceError };
