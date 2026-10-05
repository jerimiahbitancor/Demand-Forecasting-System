// middleware/rateLimits.js
//
// Two rate limits instead of one, both mounted at /api:
//
// - authLimiter: strict, only for POSTs to the endpoints that send or check
//   one-time codes and set passwords (brute-force targets). 20 / 15 min per
//   IP in production.
// - apiLimiter: generous, for every other /api request (normal logged-in
//   use, dashboard polling). 600 / 15 min per IP in production.
//
// Password LOGIN is not here on purpose: the browser calls Supabase Auth
// directly (supabase.auth.signInWithPassword in AuthContext.jsx), so Express
// never sees password guesses. /auth/sync-user (after login) and
// /auth/setup (page loads) are normal traffic and use the API budget.
//
// Each request is counted by exactly one limiter. The per-email OTP lockout
// (utils/otpAttemptLimiter.js) still applies on top of the strict limit.

const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;

// Relative to the /api mount point.
const STRICT_AUTH_PATHS = [
  '/auth/register',
  '/auth/verify-otp',
  '/auth/create-password',
  '/auth/resend-otp',
  '/auth/forgot-password/send-code',
  '/auth/forgot-password/verify-code',
  '/auth/forgot-password/reset-password',
];
const STRICT_SET = new Set(STRICT_AUTH_PATHS);

// Same body as the single limiter used before.
const RATE_LIMIT_BODY = {
  success: false,
  error: 'Too many requests, please try again later.',
};

// Express routes ignore case and a trailing slash, so "/auth/Register/"
// reaches the same handler. Normalize the same way so it cannot dodge
// the strict limit.
function normalizePath(path) {
  const lower = String(path || '').toLowerCase();
  return lower.length > 1 ? lower.replace(/\/+$/, '') : lower;
}

function isStrictAuthRequest(req) {
  return req.method === 'POST' && STRICT_SET.has(normalizePath(req.path));
}

function envNumber(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function baseOptions(overrides) {
  return {
    windowMs: WINDOW_MS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: RATE_LIMIT_BODY,
    ...overrides,
  };
}

function createAuthLimiter(overrides = {}) {
  const limit = envNumber('RATE_LIMIT_AUTH_MAX') ?? (isProduction() ? 20 : 200);
  return rateLimit(baseOptions({
    limit,
    skip: (req) => !isStrictAuthRequest(req),
    ...overrides,
  }));
}

function createApiLimiter(overrides = {}) {
  const limit = envNumber('RATE_LIMIT_API_MAX') ?? (isProduction() ? 600 : 3000);
  return rateLimit(baseOptions({
    limit,
    skip: (req) => isStrictAuthRequest(req),
    ...overrides,
  }));
}

module.exports = {
  createAuthLimiter,
  createApiLimiter,
  isStrictAuthRequest,
  STRICT_AUTH_PATHS,
  RATE_LIMIT_BODY,
};
