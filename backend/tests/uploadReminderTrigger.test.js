// tests/uploadReminderTrigger.test.js — run: node --test tests/uploadReminderTrigger.test.js
//
// Reliable 4:00 / 7:00 AM upload reminders (Oct 17 2026):
//   - POST /api/jobs/upload-reminders (routes/jobs.js): secret, 404/401/409/400/202
//   - idempotent: 3 calls -> 1 notification, 1 email (sequential and at once)
//   - boot catch-up (jobs/uploadReminderJob.js runBootCatchUp)
//   - the run log row in audit_logs
//   - reminder_email_skipped once per run, not once per row
// In-memory fake database; fetch is mocked, so Brevo is NEVER called.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase();
installFake(fake);
// node-cron is never really scheduled here.
const cronPath = require.resolve('node-cron', { paths: [path.join(__dirname, '..')] });
require.cache[cronPath] = { id: cronPath, filename: cronPath, loaded: true, exports: { schedule: () => {} } };

const brevoCalls = [];
global.fetch = async (url, options = {}) => {
  brevoCalls.push({ url, body: options.body ? JSON.parse(options.body) : null });
  return { ok: true, status: 201, statusText: 'Created', json: async () => ({ messageId: 'm-1' }) };
};

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
};

const restoreLoad = quiet();
const notificationService = require('../services/notificationService');
const job = require('../jobs/uploadReminderJob');
const { createJobsRouter, secretMatches } = require('../routes/jobs');
const { addDays } = require('../utils/uploadReminders');
restoreLoad();
const { _waitForEmails, _resetEmailState } = notificationService;

// 2026-10-10T20:00Z = Sun 2026-10-11 04:00 Manila; business date Sat 2026-10-10.
const SUNDAY_0400 = new Date('2026-10-10T20:00:00Z');
const SUNDAY_0330 = new Date('2026-10-10T19:30:00Z');
const SUNDAY_0730 = new Date('2026-10-10T23:30:00Z');
const SECRET = 'test-job-secret-123';

const EMAIL_ENV = ['EMAIL_REMINDERS_ENABLED', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'FRONTEND_URL'];
function setEmail(on) {
  for (const k of EMAIL_ENV) delete process.env[k];
  if (on) {
    Object.assign(process.env, {
      EMAIL_REMINDERS_ENABLED: 'true', BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: 'sender@example.com',
      FRONTEND_URL: 'https://chefduo.example.app',
    });
  }
}

// Every date in the 60-day window confirmed except Sat 2026-10-10.
function seedWorld({ users = [{ id: 7 }], model = true } = {}) {
  const businessDays = [];
  for (let back = 1; back <= 60; back += 1) {
    const d = addDays('2026-10-11', -back);
    if (d !== '2026-10-10') businessDays.push({ business_date: d, status: 'confirmed_open' });
  }
  fake.reset({
    user: users,
    model_metrics: model ? [{ id: 1 }] : [],
    business_profile: [{ id: 1, operating_days: [0, 1, 2, 3, 4, 5], business_email: 'owner@example.com' }],
    business_days: businessDays,
    daily_sales: [{ id: 1, product_id: 1, sale_date: '2025-07-10', quantity_sold: 1 }],
    notifications: [],
    audit_logs: [],
  });
  brevoCalls.length = 0;
  _resetEmailState();
}

const runLogRows = () => (fake.tables.audit_logs || [])
  .filter((r) => r.action_type === 'upload_reminder_run')
  .map((r) => ({ ...r, d: JSON.parse(r.details) }));

// ---- HTTP helpers ----
async function withApp(routerOptions, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter(routerOptions));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    return await fn(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(port, pathAndQuery, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathAndQuery, method: 'POST', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Router whose background run is the real job against the fake DB.
function realRunOptions(runs, extra = {}) {
  return {
    env: { JOB_TRIGGER_SECRET: SECRET },
    schedulersEnabled: () => true,
    runUploadReminders: (slot) => {
      const p = job.runUploadReminders(slot, { now: SUNDAY_0400, trigger: 'external' });
      runs.push(p);
      return p;
    },
    ...extra,
  };
}

async function settle(runs) {
  await Promise.all(runs);
  await _waitForEmails();
}

// ---------------------------------------------------------------- secret

test('secretMatches: constant-time compare, any length', () => {
  assert.equal(secretMatches(SECRET, SECRET), true);
  assert.equal(secretMatches('wrong', SECRET), false);
  assert.equal(secretMatches(`${SECRET}x`, SECRET), false);
  assert.equal(secretMatches('', SECRET), false);
  assert.equal(secretMatches(undefined, SECRET), false);
});

test('trigger: JOB_TRIGGER_SECRET unset -> 404; missing or wrong header -> 401; nothing runs', async () => {
  let started = 0;
  const run = () => { started += 1; return Promise.resolve(null); };

  await withApp({ env: {}, schedulersEnabled: () => true, runUploadReminders: run }, async (port) => {
    const res = await post(port, '/api/jobs/upload-reminders?slot=0400', { 'X-Job-Secret': SECRET });
    assert.equal(res.status, 404);
  });

  const restore = quiet();
  try {
    await withApp({ env: { JOB_TRIGGER_SECRET: SECRET }, schedulersEnabled: () => true, runUploadReminders: run }, async (port) => {
      assert.equal((await post(port, '/api/jobs/upload-reminders?slot=0400')).status, 401);
      assert.equal((await post(port, '/api/jobs/upload-reminders?slot=0400', { 'X-Job-Secret': 'nope' })).status, 401);
    });
  } finally {
    restore();
  }
  assert.equal(started, 0);
});

test('trigger: right secret but SCHEDULERS_ENABLED off -> 409 (local dev never sends)', async () => {
  let started = 0;
  await withApp({
    env: { JOB_TRIGGER_SECRET: SECRET }, schedulersEnabled: () => false,
    runUploadReminders: () => { started += 1; return Promise.resolve(null); },
  }, async (port) => {
    const res = await post(port, '/api/jobs/upload-reminders?slot=0400', { 'X-Job-Secret': SECRET });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /SCHEDULERS_ENABLED=false/);
  });
  assert.equal(started, 0);
});

test('trigger: bad slot -> 400', async () => {
  await withApp({ env: { JOB_TRIGGER_SECRET: SECRET }, schedulersEnabled: () => true, runUploadReminders: () => null }, async (port) => {
    for (const q of ['', '?slot=0900', '?slot=4']) {
      const res = await post(port, `/api/jobs/upload-reminders${q}`, { 'X-Job-Secret': SECRET });
      assert.equal(res.status, 400, `slot query ${JSON.stringify(q)}`);
    }
  });
});

test('trigger: 202 at once, before the run finishes (cold start never times out the caller)', async () => {
  let release;
  const started = [];
  await withApp({
    env: { JOB_TRIGGER_SECRET: SECRET }, schedulersEnabled: () => true,
    runUploadReminders: (slot) => { started.push(slot); return new Promise((r) => { release = r; }); },
  }, async (port) => {
    const res = await post(port, '/api/jobs/upload-reminders?slot=0700', { 'X-Job-Secret': SECRET });
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { success: true, accepted: true, slot: '0700' });
  });
  assert.deepEqual(started, ['0700'], 'the run started in the background');
  release(null);
});

// ---------------------------------------------------------------- idempotent

test('trigger: 3 calls one after another -> 1 notification, 1 email, 3 run log rows', async () => {
  seedWorld();
  setEmail(true);
  const runs = [];
  const restore = quiet();
  try {
    await withApp(realRunOptions(runs), async (port) => {
      for (let i = 0; i < 3; i += 1) {
        const res = await post(port, '/api/jobs/upload-reminders?slot=0400', { 'X-Job-Secret': SECRET });
        assert.equal(res.status, 202);
        await settle(runs);
      }
    });
  } finally {
    restore();
    setEmail(false);
  }
  assert.equal(fake.tables.notifications.length, 1);
  assert.equal(fake.tables.notifications[0].metadata.key, 'upload_reminder:2026-10-10:0400');
  assert.equal(brevoCalls.length, 1);
  const rows = runLogRows();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.d.sent, r.d.duplicates]), [[1, 0], [0, 1], [0, 1]]);
  assert.deepEqual(rows[0].d.emails, [{ key: 'upload_reminder:2026-10-10:0400', email: 'sent' }]);
  assert.deepEqual(rows[2].d.emails, [{ key: 'upload_reminder:2026-10-10:0400', email: 'duplicate' }]);
});

test('trigger: 3 calls at the same moment -> still 1 notification, 1 email', async () => {
  seedWorld();
  setEmail(true);
  const runs = [];
  const restore = quiet();
  try {
    await withApp(realRunOptions(runs), async (port) => {
      const answers = await Promise.all([0, 1, 2].map(() => post(port, '/api/jobs/upload-reminders?slot=0400', { 'X-Job-Secret': SECRET })));
      assert.deepEqual(answers.map((a) => a.status), [202, 202, 202]);
      await new Promise((r) => setTimeout(r, 20));
      await settle(runs);
    });
  } finally {
    restore();
    setEmail(false);
  }
  assert.equal(fake.tables.notifications.length, 1);
  assert.equal(brevoCalls.length, 1);
});

// ---------------------------------------------------------------- run log

test('run log: one audit_logs row per run with slot, Manila date, trigger, keys, counts, email outcome, host', async () => {
  seedWorld();
  const restore = quiet();
  try {
    await job.runUploadReminders('0400', { now: SUNDAY_0400, trigger: 'cron', env: { RENDER_SERVICE_NAME: 'dfs-api' } });
    await _waitForEmails();
  } finally {
    restore();
  }
  const rows = runLogRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].performed_by, 'system:cron');
  const d = rows[0].d;
  assert.equal(d.slot, '0400');
  assert.equal(d.date, '2026-10-11', 'Manila date, not UTC (UTC is still Oct 10)');
  assert.equal(d.trigger, 'cron');
  assert.equal(d.status, 'succeeded');
  assert.deepEqual(d.planned, ['upload_reminder:2026-10-10:0400']);
  assert.equal(d.sent, 1);
  assert.equal(d.duplicates, 0);
  assert.deepEqual(d.emails, [{ key: 'upload_reminder:2026-10-10:0400', email: 'disabled' }]);
  assert.equal(d.host.platform, 'render');
  assert.equal(d.host.service, 'dfs-api');

  // /api/status reads it back per slot.
  const last = await job.getLastRunsFromLog(fake);
  assert.equal(last['0400'].trigger, 'cron');
  assert.equal(last['0700'], null);
});

test('run log: a failed run is still recorded', async () => {
  seedWorld();
  const broken = {
    from: (table) => (table === 'audit_logs' ? fake.from(table) : (() => { throw new Error('database down'); })()),
  };
  const restore = quiet();
  try {
    const out = await job.runUploadReminders('0700', { client: broken, now: SUNDAY_0400, trigger: 'external' });
    assert.equal(out, null);
  } finally {
    restore();
  }
  const [row] = runLogRows();
  assert.equal(row.d.status, 'failed');
  assert.match(row.d.error, /database down/);
  assert.equal(row.d.trigger, 'external');
});

// ---------------------------------------------------------------- boot catch-up

test('boot catch-up: before 04:00 Manila -> nothing runs', async () => {
  seedWorld();
  const ran = await job.runBootCatchUp({ now: SUNDAY_0330 });
  assert.deepEqual(ran, []);
  assert.equal(runLogRows().length, 0);
  assert.equal(fake.tables.notifications.length, 0);
});

test('boot catch-up: only the latest slot that applies (owner rule, Oct 17)', () => {
  const expected = [[0, null], [3, null], [4, '0400'], [6, '0400'], [7, '0700'], [8, '0700'], [9, '0400'], [15, '0400'], [23, '0400']];
  for (const [hour, slot] of expected) assert.equal(job.catchUpSlotFor(hour), slot, `hour ${hour}`);
});

test('boot catch-up: 07:30 -> 0700 only, once; a second boot runs nothing', async () => {
  seedWorld();
  setEmail(true);
  const restore = quiet();
  try {
    assert.deepEqual(await job.runBootCatchUp({ now: SUNDAY_0730 }), ['0700']);
    await _waitForEmails();
    assert.deepEqual(await job.runBootCatchUp({ now: SUNDAY_0730 }), [], 'the slot has a run record today');
    await _waitForEmails();
  } finally {
    restore();
    setEmail(false);
  }
  assert.deepEqual(fake.tables.notifications.map((n) => n.metadata.key), ['upload_reminder:2026-10-10:0700']);
  assert.equal(brevoCalls.length, 1);
  assert.deepEqual(runLogRows().map((r) => [r.d.slot, r.d.trigger]), [['0700', 'boot']]);
});

test('boot catch-up: after 09:00 -> 0400 only, never 0700', async () => {
  seedWorld();
  const restore = quiet();
  try {
    // 2026-10-11 14:00 Manila
    assert.deepEqual(await job.runBootCatchUp({ now: new Date('2026-10-11T06:00:00Z') }), ['0400']);
  } finally {
    restore();
  }
  assert.deepEqual(fake.tables.notifications.map((n) => n.metadata.key), ['upload_reminder:2026-10-10:0400']);
});

test('boot catch-up: a slot that already ran today (cron or external) is skipped; yesterday\'s run does not count', async () => {
  seedWorld();
  fake.tables.audit_logs.push(
    { id: 1, action_type: 'upload_reminder_run', details: JSON.stringify({ slot: '0700', date: '2026-10-11', trigger: 'external', status: 'succeeded' }) },
    { id: 2, action_type: 'upload_reminder_run', details: JSON.stringify({ slot: '0400', date: '2026-10-10', trigger: 'cron', status: 'succeeded' }) },
  );
  const restore = quiet();
  try {
    assert.deepEqual(await job.runBootCatchUp({ now: SUNDAY_0730 }), [], '0700 already ran today');
    assert.deepEqual(await job.runBootCatchUp({ now: new Date('2026-10-11T06:00:00Z') }), ['0400'], "yesterday's 0400 does not count");
  } finally {
    restore();
  }
});

test('boot catch-up: a failed run today does not count as done', async () => {
  seedWorld();
  fake.tables.audit_logs.push(
    { id: 1, action_type: 'upload_reminder_run', details: JSON.stringify({ slot: '0400', date: '2026-10-11', trigger: 'cron', status: 'failed' }) },
  );
  const restore = quiet();
  try {
    assert.deepEqual(await job.runBootCatchUp({ now: SUNDAY_0400 }), ['0400']);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------- skip logging

function captureLogs(fn) {
  const lines = [];
  const savedWrite = process.stdout.write;
  const savedLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  process.stdout.write = (chunk, ...rest) => {
    const text = String(chunk);
    if (text.startsWith('{')) { try { lines.push(JSON.parse(text)); return true; } catch (_) { /* not a log line */ } }
    return savedWrite.call(process.stdout, chunk, ...rest);
  };
  const restore = () => { process.stdout.write = savedWrite; process.env.LOG_LEVEL = savedLevel; };
  return Promise.resolve().then(fn).then(() => { restore(); return lines; }, (e) => { restore(); throw e; });
}

test('reminder_email_skipped: once per run per reason (two users, emails off -> one "disabled" line)', async () => {
  seedWorld({ users: [{ id: 7 }, { id: 8 }] });
  setEmail(false);
  const restore = quiet();
  let lines;
  try {
    lines = await captureLogs(async () => {
      await job.runUploadReminders('0400', { now: SUNDAY_0400 });
      await _waitForEmails();
    });
  } finally {
    restore();
  }
  const skipped = lines.filter((l) => l.msg === 'reminder_email_skipped');
  assert.equal(fake.tables.notifications.length, 2, 'both users get the bell row');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].level, 'warn');
  assert.equal(skipped[0].reason, 'disabled');
  assert.equal(skipped[0].slot, '0400');
  assert.deepEqual(skipped[0].keys, ['upload_reminder:2026-10-10:0400']);

  // Second run: already in the bell -> one 'duplicate' line (info).
  const again = await captureLogs(async () => {
    const r = quiet();
    try { await job.runUploadReminders('0400', { now: SUNDAY_0400 }); } finally { r(); }
  });
  const dup = again.filter((l) => l.msg === 'reminder_email_skipped');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].reason, 'duplicate');
  assert.equal(dup[0].level, 'info');
});

test('a failing Brevo send is logged (reminder_email_failed) and recorded as failed in the run log', async () => {
  seedWorld();
  setEmail(true);
  const savedFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  const restore = quiet();
  let lines;
  try {
    lines = await captureLogs(async () => {
      await job.runUploadReminders('0400', { now: SUNDAY_0400 });
      await _waitForEmails();
    });
  } finally {
    restore();
    global.fetch = savedFetch;
    setEmail(false);
  }
  assert.ok(lines.some((l) => l.msg === 'reminder_email_failed'), 'the failure is in the log');
  assert.deepEqual(runLogRows()[0].d.emails, [{ key: 'upload_reminder:2026-10-10:0400', email: 'failed' }]);
});

// ---------------------------------------------------------------- boot flags

test('boot flags: one line with effective values, never a key or secret value', () => {
  const { describeBootFlags, bootFlagLine, bootFlagWarnings } = require('../utils/bootFlags');
  const env = {
    NODE_ENV: 'production', SCHEDULERS_ENABLED: 'true', BREVO_API_KEY: 'xkeysib-SECRET', BREVO_SENDER_EMAIL: 'sender@example.com',
    JOB_TRIGGER_SECRET: SECRET, RENDER_SERVICE_NAME: 'dfs-api',
  };
  const flags = describeBootFlags(env);
  const line = bootFlagLine(flags);
  assert.equal(line, 'SCHEDULERS_ENABLED=on EMAIL_REMINDERS_ENABLED=off brevo=configured JOB_TRIGGER_SECRET=set service=dfs-api');
  assert.doesNotMatch(JSON.stringify({ flags, line }), /xkeysib-SECRET|test-job-secret-123|sender@example/);
  assert.deepEqual(bootFlagWarnings(flags), ['timed jobs are on but EMAIL_REMINDERS_ENABLED is off: reminders reach the bell only, no email']);
  assert.deepEqual(bootFlagWarnings(describeBootFlags({ NODE_ENV: 'development' })), [], 'jobs off locally: nothing to warn about');
});
