// Tests utils/apiError.js: every failed request becomes one honest
// { kind, status, requestId, message, retryAfterSec } object.
//
// Plain Node, no test runner:
//   cd frontend && node tests/apiError.test.mjs

const { toApiError, parseRetryAfter, makeRequestId, shortRef } = await import('../src/utils/apiError.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

// Shapes axios produces.
const httpError = (status, { data = {}, headers = {} } = {}) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data, headers },
});
// AxiosHeaders-like object with a get() method.
const axiosHeaders = (obj) => ({ ...obj, get: (name) => obj[name.toLowerCase()] ?? null });

console.log('kinds');
{
  const e = toApiError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }, 'sent-0001');
  check('ECONNABORTED -> timeout', e.kind === 'timeout', JSON.stringify(e));
  check('timeout keeps the sent request ID', e.requestId === 'sent-0001');
  check('timeout has no status', e.status === null);
}
check('ETIMEDOUT -> timeout', toApiError({ code: 'ETIMEDOUT' }).kind === 'timeout');
{
  const e = toApiError({ code: 'ERR_NETWORK', message: 'Network Error' }, 'sent-0002');
  check('no response -> network', e.kind === 'network');
  check('network message is plain', e.message === "Can't reach the server right now.", e.message);
}
check('401 -> auth', toApiError(httpError(401)).kind === 'auth');
check('403 -> auth', toApiError(httpError(403)).kind === 'auth');
{
  const e = toApiError(httpError(429, {
    data: { success: false, error: 'Too many requests, please try again later.' },
    headers: { 'retry-after': '42' },
  }));
  check('429 -> rate_limited', e.kind === 'rate_limited');
  check('429 reads Retry-After seconds', e.retryAfterSec === 42, String(e.retryAfterSec));
  check('429 keeps the server message', e.message === 'Too many requests, please try again later.');
}
check('429 without Retry-After -> null', toApiError(httpError(429)).retryAfterSec === null);
check('500 -> server', toApiError(httpError(500)).kind === 'server');
check('503 -> server', toApiError(httpError(503)).kind === 'server');
check('404 -> client', toApiError(httpError(404)).kind === 'client');
check('400 -> client', toApiError(httpError(400)).kind === 'client');
check('ERR_CANCELED -> canceled', toApiError({ code: 'ERR_CANCELED', name: 'CanceledError' }).kind === 'canceled');
{
  const e = toApiError({ code: 'API_URL_MISSING', message: 'VITE_API_URL is not set' }, 'sent-0009');
  check('API_URL_MISSING -> config (no URL in this build, nothing sent)', e.kind === 'config', JSON.stringify(e));
  check('config message names VITE_API_URL', /VITE_API_URL/.test(e.message));
}
check('retryAfterSec is null when not rate limited', toApiError(httpError(500, { headers: { 'retry-after': '5' } })).retryAfterSec === null);

console.log('request ID');
{
  const e = toApiError(httpError(500, { headers: axiosHeaders({ 'x-request-id': 'from-server-01' }) }), 'sent-0003');
  check('response header wins (AxiosHeaders)', e.requestId === 'from-server-01', e.requestId);
}
{
  const e = toApiError(httpError(500, { headers: { 'X-Request-ID': 'from-server-02' } }), 'sent-0004');
  check('response header wins (plain object, any case)', e.requestId === 'from-server-02', e.requestId);
}
check('falls back to the sent ID', toApiError(httpError(502), 'sent-0005').requestId === 'sent-0005');
check('null when neither exists', toApiError(httpError(502)).requestId === null);

console.log('message');
check('uses the server error field', toApiError(httpError(500, { data: { error: 'Something went wrong' } })).message === 'Something went wrong');
check('ignores a non-string error field', toApiError(httpError(500, { data: { error: { x: 1 } } })).message === 'The server had a problem.');
check('server default text', toApiError(httpError(500)).message === 'The server had a problem.');
check('auth default text', toApiError(httpError(401)).message === 'Your session has expired. Please log in again.');
check('survives undefined', toApiError(undefined).kind === 'network');

console.log('Retry-After parsing');
check('seconds', parseRetryAfter('120') === 120);
check('HTTP date', parseRetryAfter(new Date(10_000 + 30_000).toUTCString(), 10_000) === 30);
check('date in the past -> 0', parseRetryAfter(new Date(0).toUTCString(), 10_000) === 0);
check('garbage -> null', parseRetryAfter('soon') === null);
check('empty -> null', parseRetryAfter('') === null && parseRetryAfter(null) === null);

console.log('makeRequestId / shortRef');
const SAFE = /^[A-Za-z0-9-]{8,64}$/;
check('uses crypto.randomUUID when present', makeRequestId({ randomUUID: () => 'abcdefgh-1234' }) === 'abcdefgh-1234');
{
  const id = makeRequestId({});
  check('fallback without randomUUID passes the backend rule', SAFE.test(id), id);
}
{
  const id = makeRequestId({ randomUUID: () => { throw new Error('insecure context'); } });
  check('fallback when randomUUID throws', SAFE.test(id), id);
}
check('real crypto ID passes the backend rule', SAFE.test(makeRequestId()));
check('shortRef keeps 8 chars', shortRef('1b53a296-c2e3-463e') === '1b53a296');
check('shortRef of nothing is null', shortRef(null) === null);

console.log('');
if (failures.length) { console.log(`FAILED: ${failures.length}: ${JSON.stringify(failures)}`); process.exit(1); }
console.log('All apiError checks passed.');
