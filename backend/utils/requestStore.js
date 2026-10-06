// utils/requestStore.js
//
// One AsyncLocalStorage store per HTTP request. middleware/requestContext.js
// runs every request inside it, so any code called during that request
// (routes, services, the logger) can read the request ID without having it
// passed down as an argument.

const { AsyncLocalStorage } = require('async_hooks');

const requestStore = new AsyncLocalStorage();

// Returns the current request ID, or undefined outside a request
// (startup, cron jobs, timers).
function getRequestId() {
  const store = requestStore.getStore();
  return store ? store.requestId : undefined;
}

module.exports = { requestStore, getRequestId };
