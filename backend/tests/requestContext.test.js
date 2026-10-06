// tests/requestContext.test.js — run: node --test tests/requestContext.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createRequestContext } = require('../middleware/requestContext');
const { createRequestStats } = require('../utils/requestStats');
const { getRequestId } = require('../utils/requestStore');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A fake logger that records calls instead of writing to stdout.
function fakeLog() {
  const lines = [];
  const make = (level) => (msg, fields) => lines.push({ level, msg, fields, requestId: getRequestId() });
  return { lines, debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
}

async function withApp(fn) {
  const log = fakeLog();
  const stats = createRequestStats();
  const app = express();
  app.use(createRequestContext({ stats, log }));
  app.get('/ok', (req, res) => res.json({ id: req.id, storeId: getRequestId() }));
  app.get('/later', async (req, res) => {
    await new Promise((r) => setTimeout(r, 5));
    res.json({ storeId: getRequestId() });
  });
  app.get('/boom', (req, res) => res.status(500).json({ error: 'x' }));
  app.get('/missing', (req, res) => res.status(404).json({ error: 'x' }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, log, stats });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// The access line is written on 'finish', which can land just after fetch resolves.
const settle = () => new Promise((r) => setTimeout(r, 20));

test('a request with no ID gets a UUID back, also inside the handler', async () => {
  await withApp(async ({ base }) => {
    const res = await fetch(`${base}/ok`);
    const id = res.headers.get('x-request-id');
    assert.match(id, UUID);
    const body = await res.json();
    assert.equal(body.id, id);
    assert.equal(body.storeId, id);
  });
});

test('a safe incoming ID is echoed and survives an await', async () => {
  await withApp(async ({ base }) => {
    const res = await fetch(`${base}/later`, { headers: { 'X-Request-ID': 'demo-1234' } });
    assert.equal(res.headers.get('x-request-id'), 'demo-1234');
    assert.equal((await res.json()).storeId, 'demo-1234');
  });
});

test('unsafe or badly sized IDs are replaced', async () => {
  await withApp(async ({ base }) => {
    for (const bad of ['<script>', 'short', 'a'.repeat(65), 'has space1', 'semi;colon1']) {
      const res = await fetch(`${base}/ok`, { headers: { 'X-Request-ID': bad } });
      const id = res.headers.get('x-request-id');
      assert.notEqual(id, bad);
      assert.match(id, UUID);
    }
  });
});

test('one access line per request, no query string, level by status', async () => {
  await withApp(async ({ base, log }) => {
    await fetch(`${base}/ok?email=owner@example.com&token=abc`, { headers: { 'X-Request-ID': 'demo-1234' } });
    await fetch(`${base}/boom`);
    await fetch(`${base}/missing`);
    await settle();

    const access = log.lines.filter((l) => l.msg === 'request');
    assert.equal(access.length, 3);

    const ok = access[0];
    assert.equal(ok.level, 'info');
    assert.equal(ok.requestId, 'demo-1234');
    assert.equal(ok.fields.method, 'GET');
    assert.equal(ok.fields.path, '/ok');
    assert.equal(ok.fields.status, 200);
    assert.equal(ok.fields.aborted, false);
    assert.equal(typeof ok.fields.duration_ms, 'number');
    assert.ok(!JSON.stringify(ok).includes('owner@example.com'));

    assert.equal(access[1].level, 'error');
    assert.equal(access[1].fields.status, 500);
    assert.equal(access[2].level, 'warn');
    assert.equal(access[2].fields.status, 404);
  });
});

test('snapshot() counts requests, 5xx and timings', async () => {
  await withApp(async ({ base, stats }) => {
    await fetch(`${base}/ok`);
    await fetch(`${base}/ok`);
    await fetch(`${base}/boom`);
    await settle();
    const snap = stats.snapshot();
    assert.equal(snap.count, 3);
    assert.equal(snap.errors5xx, 1);
    assert.equal(snap.rateLimited429, 0);
    assert.equal(typeof snap.p50Ms, 'number');
    assert.ok(snap.maxMs >= snap.p95Ms && snap.p95Ms >= snap.p50Ms);
    assert.ok(!Number.isNaN(Date.parse(snap.since)));
  });
});

test('requestStats drops entries older than the window', () => {
  let clock = 1_000_000;
  const stats = createRequestStats({ now: () => clock, windowMs: 1000 });
  stats.record({ durationMs: 10, status: 200 });
  stats.record({ durationMs: 30, status: 429 });
  assert.equal(stats.snapshot().count, 2);
  assert.equal(stats.snapshot().rateLimited429, 1);
  clock += 1001;
  stats.record({ durationMs: 5, status: 200 });
  const snap = stats.snapshot();
  assert.equal(snap.count, 1);
  assert.equal(snap.rateLimited429, 0);
  assert.equal(snap.maxMs, 5);
});

test('an empty window reports null timings, not zero', () => {
  const snap = createRequestStats().snapshot();
  assert.equal(snap.count, 0);
  assert.equal(snap.p50Ms, null);
  assert.equal(snap.maxMs, null);
});
