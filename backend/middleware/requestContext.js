// middleware/requestContext.js
//
// Gives every request an ID and writes one access-log line when it ends.
//
// - Reuses an incoming X-Request-ID only if it looks safe
//   (8–64 letters, digits or dashes); otherwise makes a new UUID.
// - Sets req.id and the X-Request-ID response header.
// - Runs the rest of the request inside the request store, so the logger
//   adds the ID to every line written while handling it.
// - Logs method, path (no query string, which may hold personal data),
//   status, duration and whether the client hung up before the response
//   finished.

const crypto = require('crypto');
const logger = require('../utils/logger');
const requestStats = require('../utils/requestStats');
const { requestStore } = require('../utils/requestStore');

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

function pickRequestId(incoming) {
  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function createRequestContext({ stats = requestStats, log = logger } = {}) {
  return function requestContext(req, res, next) {
    const startedAt = process.hrtime.bigint();
    const requestId = pickRequestId(req.get('X-Request-ID'));

    req.id = requestId;
    res.setHeader('X-Request-ID', requestId);

    let logged = false;
    const done = (aborted) => {
      if (logged) return;
      logged = true;
      try {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const status = res.statusCode;
        stats.record({ durationMs, status });

        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        // Run inside the store so the line carries the request ID.
        requestStore.run({ requestId }, () => {
          log[level]('request', {
            method: req.method,
            path: String(req.originalUrl || req.url || '').split('?')[0],
            status,
            duration_ms: Math.round(durationMs * 10) / 10,
            aborted,
          });
        });
      } catch (_) {
        // Logging must never break a request.
      }
    };

    res.on('finish', () => done(false));
    // 'close' also fires after a normal finish; `logged` makes that a no-op.
    res.on('close', () => done(!res.writableFinished));

    requestStore.run({ requestId }, next);
  };
}

module.exports = createRequestContext();
module.exports.createRequestContext = createRequestContext;
module.exports.pickRequestId = pickRequestId;
module.exports.SAFE_REQUEST_ID = SAFE_REQUEST_ID;
