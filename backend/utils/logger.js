// utils/logger.js
//
// Structured logger: one JSON line per call on stdout, e.g.
//   {"ts":"...","level":"info","service":"api","msg":"request","requestId":"...", ...}
//
// - Level threshold from LOG_LEVEL (debug|info|warn|error). Default: info in
//   production, debug otherwise.
// - Values under secret-looking keys are replaced with "[hidden]", to depth 3.
// - Error values become {name, message, code} (+ stack outside production).
// - Never throws: a logging failure must not break a request.

const { getRequestId } = require('./requestStore');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /password|passwd|token|access_token|refresh_token|secret|authorization|otp|apikey|api_key|cookie|service_role/i;
const MAX_DEPTH = 3;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// Read on every call so tests (and a live env change) take effect at once.
function threshold() {
  const configured = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (LEVELS[configured]) return LEVELS[configured];
  return isProduction() ? LEVELS.info : LEVELS.debug;
}

function serializeError(err) {
  const out = { name: err.name, message: err.message };
  if (err.code !== undefined) out.code = err.code;
  if (!isProduction() && err.stack) out.stack = err.stack;
  return out;
}

// Copies `value`, hiding secrets and serializing errors. Stops at MAX_DEPTH
// and on circular references so it can never recurse forever.
function sanitize(value, depth, seen) {
  if (value instanceof Error) return serializeError(value);
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return undefined;
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[array]' : '[object]';

  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.map((item) => sanitize(item, depth + 1, seen));
  } else {
    out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? '[hidden]' : sanitize(item, depth + 1, seen);
    }
  }
  seen.delete(value);
  return out;
}

function write(level, message, fields) {
  try {
    if (LEVELS[level] < threshold()) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      service: 'api',
      msg: String(message),
    };
    const requestId = getRequestId();
    if (requestId) entry.requestId = requestId;

    if (fields && typeof fields === 'object') {
      const clean = sanitize(fields, 0, new WeakSet());
      for (const [key, item] of Object.entries(clean)) {
        // The fixed keys above always win over a field with the same name.
        if (!(key in entry)) entry[key] = item;
      }
    }

    process.stdout.write(JSON.stringify(entry) + '\n');
  } catch (err) {
    try {
      process.stdout.write(
        JSON.stringify({ ts: new Date().toISOString(), level: 'error', service: 'api', msg: 'logger_failure' }) + '\n'
      );
    } catch (_) {
      // Nothing left to do. Swallow so the caller is never affected.
    }
  }
}

const logger = {
  debug: (message, fields = {}) => write('debug', message, fields),
  info: (message, fields = {}) => write('info', message, fields),
  warn: (message, fields = {}) => write('warn', message, fields),
  error: (message, fields = {}) => write('error', message, fields),
};

module.exports = logger;
module.exports.LEVELS = LEVELS;
