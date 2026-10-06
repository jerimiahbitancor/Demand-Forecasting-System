// tests/rateLimits.test.js — run: node --test tests/rateLimits.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  createAuthLimiter,
  createApiLimiter,
  isStrictAuthRequest,
  STRICT_AUTH_PATHS,
  RATE_LIMIT_BODY,
} = require('../middleware/rateLimits');

const AUTH_MAX = 3;
const API_MAX = 5;

// Same mounting as server.js, with small limits.
async function withApp(fn) {
  const app = express();
  app.use('/api', createAuthLimiter({ limit: AUTH_MAX }));
  app.use('/api', createApiLimiter({ limit: API_MAX }));
  app.all('/api/*', (req, res) => res.json({ ok: true }));
  app.get('/health', (req, res) => res.json({ status: 'OK' }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const hit = (path, method = 'GET') => fetch(`${base}${path}`, { method });
  try {
    await fn({ hit });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('strict path: request N+1 gets 429 with the same body as before', async () => {
  await withApp(async ({ hit }) => {
    for (let i = 0; i < AUTH_MAX; i++) {
      assert.equal((await hit('/api/auth/verify-otp', 'POST')).status, 200);
    }
    const blocked = await hit('/api/auth/verify-otp', 'POST');
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), RATE_LIMIT_BODY);
    assert.deepEqual(RATE_LIMIT_BODY, { success: false, error: 'Too many requests, please try again later.' });
    // draft-7 headers, no legacy X-RateLimit-* headers.
    assert.ok(blocked.headers.get('ratelimit'));
    assert.ok(blocked.headers.get('retry-after'));
    assert.equal(blocked.headers.get('x-ratelimit-limit'), null);
  });
});

test('all strict paths share the strict budget; case and trailing slash do not escape it', async () => {
  await withApp(async ({ hit }) => {
    await hit('/api/auth/register', 'POST');
    await hit('/api/auth/Forgot-Password/send-code/', 'POST');
    await hit('/api/auth/resend-otp', 'POST');
    assert.equal((await hit('/api/AUTH/CREATE-PASSWORD', 'POST')).status, 429);
  });
});

test('sync-user and setup are NOT limited by the strict limiter', async () => {
  await withApp(async ({ hit }) => {
    for (let i = 0; i < AUTH_MAX; i++) await hit('/api/auth/register', 'POST');
    assert.equal((await hit('/api/auth/register', 'POST')).status, 429);
    // Strict budget is used up, yet these still pass (they use the API budget).
    assert.equal((await hit('/api/auth/sync-user', 'POST')).status, 200);
    assert.equal((await hit('/api/auth/setup')).status, 200);
  });
});

test('a normal path gets 429 only after the API max', async () => {
  await withApp(async ({ hit }) => {
    for (let i = 0; i < API_MAX; i++) {
      assert.equal((await hit('/api/upload/dashboard-state')).status, 200);
    }
    const blocked = await hit('/api/upload/dashboard-state');
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), RATE_LIMIT_BODY);
    // /health is outside /api and never limited.
    assert.equal((await hit('/health')).status, 200);
  });
});

test('strict-path requests do not use up the API budget', async () => {
  await withApp(async ({ hit }) => {
    for (let i = 0; i < AUTH_MAX + 2; i++) await hit('/api/auth/verify-otp', 'POST');
    for (let i = 0; i < API_MAX; i++) {
      assert.equal((await hit('/api/notifications')).status, 200);
    }
    assert.equal((await hit('/api/notifications')).status, 429);
  });
});

test('isStrictAuthRequest: POST only, exact paths', () => {
  for (const path of STRICT_AUTH_PATHS) {
    assert.equal(isStrictAuthRequest({ method: 'POST', path }), true, path);
    assert.equal(isStrictAuthRequest({ method: 'GET', path }), false, path);
  }
  assert.equal(isStrictAuthRequest({ method: 'POST', path: '/auth/sync-user' }), false);
  assert.equal(isStrictAuthRequest({ method: 'GET', path: '/auth/setup' }), false);
  assert.equal(isStrictAuthRequest({ method: 'POST', path: '/auth/register-something' }), false);
});

test('production defaults: 20 strict, 600 API; env overrides win', async () => {
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.RATE_LIMIT_AUTH_MAX;
    delete process.env.RATE_LIMIT_API_MAX;
    const app = express();
    app.use('/api', createAuthLimiter());
    app.use('/api', createApiLimiter());
    app.all('/api/*', (req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const strict = await fetch(`${base}/api/auth/register`, { method: 'POST' });
    const normal = await fetch(`${base}/api/upload/dashboard-state`);
    await new Promise((r) => server.close(r));
    assert.match(strict.headers.get('ratelimit-policy'), /^20;/);
    assert.match(normal.headers.get('ratelimit-policy'), /^600;/);

    process.env.RATE_LIMIT_API_MAX = '42';
    const app2 = express();
    app2.use('/api', createApiLimiter());
    app2.all('/api/*', (req, res) => res.json({ ok: true }));
    const server2 = app2.listen(0);
    await new Promise((r) => server2.once('listening', r));
    const res2 = await fetch(`http://127.0.0.1:${server2.address().port}/api/x`);
    await new Promise((r) => server2.close(r));
    assert.match(res2.headers.get('ratelimit-policy'), /^42;/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
