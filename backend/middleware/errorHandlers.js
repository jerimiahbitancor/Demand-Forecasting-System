// middleware/errorHandlers.js
//
// The 404 handler and the global error handler, moved out of server.js so
// they can be tested. Both now return the request ID in the body, so the
// owner can quote it and it can be found in the logs.

const logger = require('../utils/logger');
const { CORS_REJECTED } = require('./corsConfig');

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    requestId: req.id,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];

  // A refused CORS origin is expected traffic, not a server fault: answer
  // 403 and log a warning, so it never shows up as a 5xx.
  if (err && err.code === CORS_REJECTED) {
    logger.warn('cors_rejected', { origin: err.origin });
    return res.status(403).json({
      success: false,
      error: 'Origin not allowed',
      requestId: req.id,
    });
  }

  const status = (err && err.status) || 500;
  const message = (err && err.message) || 'Internal Server Error';

  logger.error('unhandled_error', { err, status, method: req.method, path });

  const response = {
    success: false,
    error: status === 500 && process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : message,
    requestId: req.id,
  };

  res.status(status).json(response);
}

module.exports = { notFoundHandler, errorHandler };
