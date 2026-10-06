// utils/apiError.js
//
// Turns any failed request into one small, predictable object the UI can
// show honestly:
//
//   { kind, status, requestId, message, retryAfterSec }
//
//   kind: 'timeout'      — no answer in time
//         'network'      — no answer at all (server down, offline, CORS)
//         'auth'         — 401 / 403: not logged in, or not allowed
//         'rate_limited' — 429: too many requests (see retryAfterSec)
//         'server'       — 5xx: the server had a problem
//         'client'       — any other 4xx
//         'canceled'     — we aborted it ourselves (page closed, poll stopped);
//                          never shown to the user
//
// Pure: no axios or Vite imports, so it runs in plain Node tests.

const DEFAULT_MESSAGES = {
  timeout: 'The server took too long to answer.',
  network: "Can't reach the server right now.",
  auth: 'Your session has expired. Please log in again.',
  rate_limited: 'Too many requests.',
  server: 'The server had a problem.',
  client: 'The request was not accepted.',
  canceled: 'The request was canceled.',
};

// Reads a header from axios's AxiosHeaders, a fetch Headers, or a plain object.
function readHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    if (value != null && value !== '') return String(value);
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower && headers[key] != null && headers[key] !== '') {
      return String(headers[key]);
    }
  }
  return null;
}

// Retry-After is either whole seconds or an HTTP date.
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const when = Date.parse(text);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.ceil((when - now) / 1000));
}

function classify(error, status) {
  const code = error && error.code;
  if (code === 'ERR_CANCELED' || (error && error.name === 'CanceledError')) return 'canceled';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
  if (!status) return 'network';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'client';
}

export function toApiError(error, sentRequestId = null) {
  const response = error && error.response;
  const status = response && typeof response.status === 'number' ? response.status : null;
  const kind = classify(error, status);
  const headers = response && response.headers;

  const serverMessage = response && response.data && typeof response.data.error === 'string'
    ? response.data.error
    : null;

  return {
    kind,
    status,
    requestId: readHeader(headers, 'x-request-id') || sentRequestId || null,
    message: serverMessage || DEFAULT_MESSAGES[kind],
    retryAfterSec: kind === 'rate_limited' ? parseRetryAfter(readHeader(headers, 'retry-after')) : null,
  };
}

// A request ID the backend accepts (8–64 letters, digits or dashes).
// crypto.randomUUID needs a secure context (https or localhost); fall back
// to random hex otherwise.
export function makeRequestId(cryptoImpl = globalThis.crypto) {
  if (cryptoImpl && typeof cryptoImpl.randomUUID === 'function') {
    try {
      return cryptoImpl.randomUUID();
    } catch {
      // fall through
    }
  }
  let id = '';
  for (let i = 0; i < 32; i += 1) id += Math.floor(Math.random() * 16).toString(16);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

// First 8 characters, for showing on screen ("Ref: 1b53a296").
export function shortRef(requestId) {
  return requestId ? String(requestId).slice(0, 8) : null;
}
