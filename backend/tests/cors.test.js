// tests/cors.test.js — run: node --test tests/cors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');

const { createCorsOptions, vercelPreviewPattern } = require('../middleware/corsConfig');

const ALLOWED = 'http://localhost:5173';

async function withApp(fn) {
  const app = express();
  let handlerCalls = 0;
  app.use(cors(createCorsOptions({ allowedOrigins: [ALLOWED] })));
  app.get('/api/thing', (req, res) => {
    handlerCalls += 1;
    res.json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await fn({ base: `http://127.0.0.1:${server.address().port}`, calls: () => handlerCalls });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('preflight from an allowed origin allows X-Request-ID', async () => {
  await withApp(async ({ base }) => {
    const res = await fetch(`${base}/api/thing`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,x-request-id',
      },
    });
    assert.equal(res.status, 204);
    const allowed = res.headers.get('access-control-allow-headers').toLowerCase();
    assert.ok(allowed.includes('x-request-id'));
    assert.ok(allowed.includes('authorization'));
    assert.ok(allowed.includes('content-type'));
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(res.headers.get('access-control-max-age'), '600');
  });
});

test('allowed origin gets a normal response that exposes X-Request-ID and Retry-After', async () => {
  await withApp(async ({ base, calls }) => {
    const res = await fetch(`${base}/api/thing`, { headers: { Origin: ALLOWED } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED);
    const exposed = res.headers.get('access-control-expose-headers').toLowerCase();
    assert.ok(exposed.includes('x-request-id'));
    assert.ok(exposed.includes('retry-after'));
    assert.equal(calls(), 1);
  });
});

test('the Vercel preview pattern is unchanged', () => {
  assert.equal(
    vercelPreviewPattern.source,
    '^https:\\/\\/demand-forecasting-system-[a-z0-9]+-[a-z0-9]+\\.vercel\\.app$'
  );
  assert.ok(vercelPreviewPattern.test('https://demand-forecasting-system-abc123-team9.vercel.app'));
  assert.ok(!vercelPreviewPattern.test('https://evil-site.vercel.app'));
});

// ---- Task 1.4: refused origins answer 403 and never reach a route ----

const { createRequestContext } = require('../middleware/requestContext');
const { createRequestStats } = require('../utils/requestStats');
const { notFoundHandler, errorHandler } = require('../middleware/errorHandlers');
const logger = require('../utils/logger');

// Same order as server.js: request context, CORS, routes, 404, error handler.
async function withFullApp(fn) {
  const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
  const stats = createRequestStats();
  const app = express();
  let handlerCalls = 0;
  app.use(createRequestContext({ stats, log: quietLog }));
  app.use(cors(createCorsOptions({ allowedOrigins: [ALLOWED] })));
  app.get('/api/thing', (req, res) => {
    handlerCalls += 1;
    res.json({ ok: true });
  });
  app.post('/api/thing', (req, res) => {
    handlerCalls += 1;
    res.json({ ok: true });
  });
  app.get('/api/fail', () => {
    throw new Error('kaput');
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  // The error handler logs through the shared logger; record its calls
  // instead of writing them (and keep the request ID it would attach).
  const { getRequestId } = require('../utils/requestStore');
  const levels = ['debug', 'info', 'warn', 'error'];
  const originals = {};
  const logged = [];
  for (const level of levels) {
    originals[level] = logger[level];
    logger[level] = (msg, fields = {}) => logged.push({ level, msg, requestId: getRequestId(), ...fields });
  }
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await fn({ base: `http://127.0.0.1:${server.address().port}`, calls: () => handlerCalls, logged, stats });
  } finally {
    for (const level of levels) logger[level] = originals[level];
    await new Promise((r) => server.close(r));
  }
}

test('a disallowed origin gets 403 "Origin not allowed" and never reaches the route', async () => {
  await withFullApp(async ({ base, calls, logged, stats }) => {
    for (const method of ['GET', 'POST']) {
      const res = await fetch(`${base}/api/thing`, {
        method,
        headers: { Origin: 'https://evil.example.com', 'X-Request-ID': 'cors-test-1' },
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.deepEqual(body, { success: false, error: 'Origin not allowed', requestId: 'cors-test-1' });
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    }
    // Preflight from a refused origin is refused the same way.
    const pre = await fetch(`${base}/api/thing`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(pre.status, 403);
    assert.equal(calls(), 0);

    const lines = logged;
    const rejected = lines.filter((l) => l.msg === 'cors_rejected');
    assert.equal(rejected.length, 3);
    assert.equal(rejected[0].level, 'warn');
    assert.equal(rejected[0].origin, 'https://evil.example.com');
    assert.equal(lines.filter((l) => l.level === 'error').length, 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(stats.snapshot().errors5xx, 0);
  });
});

test('an allowed origin still gets a normal response with CORS headers', async () => {
  await withFullApp(async ({ base, calls }) => {
    const res = await fetch(`${base}/api/thing`, { headers: { Origin: ALLOWED } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls(), 1);
  });
});

test('404 and error bodies include the request ID; other fields unchanged', async () => {
  await withFullApp(async ({ base, logged }) => {
    const nf = await fetch(`${base}/api/does-not-exist`, { headers: { 'X-Request-ID': 'nf-req-0001' } });
    assert.equal(nf.status, 404);
    assert.deepEqual(await nf.json(), { success: false, error: 'Route not found', requestId: 'nf-req-0001' });

    const boom = await fetch(`${base}/api/fail?secret=1`, { headers: { 'X-Request-ID': 'err-req-0001' } });
    assert.equal(boom.status, 500);
    const body = await boom.json();
    assert.equal(body.success, false);
    assert.equal(body.requestId, 'err-req-0001');
    // Outside production the message is shown, as before.
    if (process.env.NODE_ENV !== 'production') assert.equal(body.error, 'kaput');

    const line = logged.find((l) => l.msg === 'unhandled_error');
    assert.equal(line.level, 'error');
    assert.equal(line.requestId, 'err-req-0001');
    assert.equal(line.status, 500);
    assert.equal(line.path, '/api/fail');
    assert.equal(line.err.message, 'kaput');
  });
});
