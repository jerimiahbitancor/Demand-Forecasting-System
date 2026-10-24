// tests/uploadRecovery.test.js — run: node --test tests/uploadRecovery.test.js
//
// POST /api/upload/status-by-filename: after a page refresh mid-upload, the
// screen asks which of its files the server actually saved.
//   - pure rule (utils/uploadRecovery.js)
//   - the real route, against the in-memory fake database

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase();
const OWNER = 7;
installFake(fake, {
  'middleware/auth.js': (req, res, next) => { req.user = { id: OWNER, user_id: OWNER }; next(); },
  'middleware/virusScan.js': (req, res, next) => next(),
});

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return () => Object.assign(console, saved);
};
const restoreLoad = quiet();
const { parseFilenames, summarizeUploadStatuses, failureReason } = require('../utils/uploadRecovery');
const uploadRouter = require('../routes/upload');
restoreLoad();

// ---------------------------------------------------------------- pure

test('summarize: newest row per filename wins; four states; same order as asked', () => {
  const out = summarizeUploadStatuses(
    ['a.csv', 'b.csv', 'c.csv', 'd.csv'],
    [
      // a.csv failed once, then went through: saved.
      { id: 1, filename: 'a.csv', status: 'failed', upload_date: '2026-10-24T10:00:00', error_message: 'Not enough stock for 1 ingredient(s): Rice. The sales file was not saved.' },
      { id: 5, filename: 'a.csv', status: 'processed', upload_date: '2026-10-24T11:00:00', error_message: '{"validRows":3}' },
      { id: 2, filename: 'b.csv', status: 'pending', upload_date: '2026-10-24T11:00:01', error_message: '{"validRows":3}' },
      { id: 3, filename: 'c.csv', status: 'failed', upload_date: '2026-10-24T11:00:02', error_message: 'Not enough stock for 1 ingredient(s): Egg. The sales file was not saved.' },
    ]
  );
  assert.deepEqual(out.map((r) => [r.filename, r.state]), [
    ['a.csv', 'saved'], ['b.csv', 'processing'], ['c.csv', 'failed'], ['d.csv', 'not_found'],
  ]);
  assert.equal(out[0].uploadId, 5);
  assert.equal(out[0].reason, null, 'a saved file has no reason');
  assert.match(out[2].reason, /Not enough stock/);
  assert.equal(out[3].uploadId, null);
});

test('failureReason: a validation JSON summary is not a reason; plain text is', () => {
  assert.equal(failureReason('{"validRows":1,"invalidRows":2}'), null);
  assert.equal(failureReason(''), null);
  assert.equal(failureReason(null), null);
  assert.equal(failureReason('Failed to process upload'), 'Failed to process upload');
});

test('parseFilenames: validates and de-duplicates', () => {
  assert.deepEqual(parseFilenames({ filenames: ['a.csv', 'a.csv', 'b.csv'] }), { ok: true, filenames: ['a.csv', 'b.csv'] });
  assert.equal(parseFilenames({}).ok, false);
  assert.equal(parseFilenames({ filenames: [] }).ok, false);
  assert.equal(parseFilenames({ filenames: [''] }).ok, false);
  assert.equal(parseFilenames({ filenames: [42] }).ok, false);
  assert.equal(parseFilenames({ filenames: ['x'.repeat(256)] }).ok, false);
  assert.equal(parseFilenames({ filenames: Array.from({ length: 501 }, (_, i) => `${i}.csv`) }).ok, false);
});

// ---------------------------------------------------------------- route

function post(server, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/upload/status-by-filename',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('POST /api/upload/status-by-filename: only this user\'s uploads, one answer per file', async () => {
  fake.reset({
    user: [{ id: OWNER }, { id: 8 }],
    uploads: [
      { id: 10, user_id: OWNER, filename: 'day-1.csv', status: 'processed', upload_date: '2026-10-24T11:00:00', error_message: '{}' },
      { id: 11, user_id: OWNER, filename: 'day-2.csv', status: 'pending', upload_date: '2026-10-24T11:00:05', error_message: '{}' },
      // Another user's file with the same name must not count.
      { id: 12, user_id: 8, filename: 'day-3.csv', status: 'processed', upload_date: '2026-10-24T11:00:06', error_message: '{}' },
    ],
  });
  const app = express();
  app.use(express.json());
  app.use('/api/upload', uploadRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const restore = quiet();
  try {
    const res = await post(server, { filenames: ['day-1.csv', 'day-2.csv', 'day-3.csv'] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.map((r) => [r.filename, r.state]), [
      ['day-1.csv', 'saved'], ['day-2.csv', 'processing'], ['day-3.csv', 'not_found'],
    ]);
    const bad = await post(server, { filenames: 'day-1.csv' });
    assert.equal(bad.status, 400);
  } finally {
    restore();
    server.close();
  }
});
