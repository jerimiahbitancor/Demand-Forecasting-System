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
