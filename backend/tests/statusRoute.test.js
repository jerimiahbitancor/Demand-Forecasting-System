// tests/statusRoute.test.js — run: node --test tests/statusRoute.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

// The real auth middleware, with a fake Supabase config (no network).
const fakeClient = { from: () => { throw new Error('no DB in this test'); } };
const configPath = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { supabase: fakeClient, supabaseAdmin: fakeClient, isConfigured: true },
};
const realAuthenticate = require('../middleware/auth');
const { createStatusRouter } = require('../routes/status');

async function withApp(router, fn) {
  const app = express();
  app.use((req, res, next) => { req.id = 'test-req-0001'; next(); });
  app.use('/api/status', router);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('no token -> 401 from the real auth middleware; the checks never run', async () => {
  let ran = 0;
  const router = createStatusRouter({
    authenticate: realAuthenticate,
    getStatusService: () => ({ getStatus: async () => { ran += 1; return {}; } }),
  });
  const realLog = console.log;
  console.log = () => {};
  try {
    await withApp(router, async (base) => {
      const res = await fetch(`${base}/api/status`);
      assert.equal(res.status, 401);
    });
  } finally {
    console.log = realLog;
  }
  assert.equal(ran, 0);
});

test('logged in -> { success: true, data }', async () => {
  const report = { overall: 'ok', checkedAt: '2026-10-06T00:00:00.000Z', checks: {} };
  const router = createStatusRouter({
    authenticate: (req, res, next) => next(),
    getStatusService: () => ({ getStatus: async () => report }),
  });
  await withApp(router, async (base) => {
    const res = await fetch(`${base}/api/status`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: report });
  });
});

test('if the engine itself breaks -> 500 with the request ID, no details', async () => {
  const router = createStatusRouter({
    authenticate: (req, res, next) => next(),
    getStatusService: () => ({ getStatus: async () => { throw new Error('secret detail'); } }),
  });
  const logger = require('../utils/logger');
  const realError = logger.error;
  logger.error = () => {};
  try {
    await withApp(router, async (base) => {
      const res = await fetch(`${base}/api/status`);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.requestId, 'test-req-0001');
      assert.ok(!JSON.stringify(body).includes('secret detail'));
    });
  } finally {
    logger.error = realError;
  }
});
