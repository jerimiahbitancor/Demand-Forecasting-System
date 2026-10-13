// tests/uploadReminders.test.js — run: node --test tests/uploadReminders.test.js
//
// Upload reminders (4:00 AM / 7:00 AM Asia/Manila):
//   - the pure rule (utils/uploadReminders.js)
//   - sending + dedupe + every user (services/uploadReminderService.js)
//   - the job: crons, timezone, lastRuns (jobs/uploadReminderJob.js)
//   - GET /api/business-days/pending (the Data Management card)
// In-memory fake database; no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase();
installFake(fake, {
  'middleware/auth.js': (req, res, next) => { req.user = { id: 7, name: 'Test Owner' }; next(); },
});
const scheduled = [];
const cronPath = require.resolve('node-cron', { paths: [path.join(__dirname, '..')] });
require.cache[cronPath] = {
  id: cronPath, filename: cronPath, loaded: true,
  exports: { schedule: (expression, fn, options) => scheduled.push({ expression, fn, options }) },
};

const { planUploadReminders, findUnresolvedOperatingDays, formatReminderDate, addDays } = require('../utils/uploadReminders');
const { sendUploadReminders, getPendingDays, REMINDER_LINK } = require('../services/uploadReminderService');
const job = require('../jobs/uploadReminderJob');
const businessDaysRouter = require('../routes/businessDays');

const MON_SAT = new Set([0, 1, 2, 3, 4, 5]); // 0 = Monday
// 2026-10-10 is a Saturday, 2026-10-11 a Sunday, 2026-10-12 a Monday.

// Every date in the 60-day window resolved except `open` (so only the
// days a case cares about are unresolved).
function resolvedExcept(today, ...open) {
  const out = [];
  for (let back = 1; back <= 60; back += 1) {
    const d = addDays(today, -back);
    if (!open.includes(d)) out.push(d);
  }
  return out;
}
const plan = (over) => planUploadReminders({ operatingDays: MON_SAT, modelExists: true, link: '/x', ...over });
const keys = (reminders) => reminders.map((r) => r.key);

// ---------------------------------------------------------------- pure rule

test('date format: "Sat, 10-10-2026"', () => {
  assert.equal(formatReminderDate('2026-10-10'), 'Sat, 10-10-2026');
  assert.equal(formatReminderDate('2026-10-12'), 'Mon, 12-10-2026');
});

test('Sunday 04:00, Saturday is an operating day and not resolved -> reminder for Saturday', () => {
  const today = '2026-10-11';
  const out = plan({ today, slot: '0400', resolvedDates: resolvedExcept(today, '2026-10-10') });
  assert.deepEqual(keys(out), ['upload_reminder:2026-10-10:0400']);
  assert.equal(out[0].title, "Upload yesterday's sales");
  assert.equal(out[0].message, 'Upload sales data for Sat, 10-10-2026, or mark the store as closed.');
  assert.equal(out[0].type, 'warning');
  assert.equal(out[0].link, '/x');
  assert.deepEqual(out[0].metadata, {
    kind: 'upload_reminder', key: 'upload_reminder:2026-10-10:0400', business_date: '2026-10-10', slot: '0400',
  });
});

test('Monday 04:00, Sunday is not an operating day -> no reminder for Sunday', () => {
  const today = '2026-10-12';
  assert.deepEqual(plan({ today, slot: '0400', resolvedDates: resolvedExcept(today, '2026-10-11') }), []);
  assert.deepEqual(plan({ today, slot: '0700', resolvedDates: resolvedExcept(today, '2026-10-11') }), []);
});

test('business_date already uploaded -> none; marked closed -> none (both are "resolved")', () => {
  const today = '2026-10-11';
  // resolvedDates holds confirmed_open AND confirmed_closed dates alike.
  assert.deepEqual(plan({ today, slot: '0400', resolvedDates: resolvedExcept(today) }), []);
  assert.deepEqual(plan({ today, slot: '0700', resolvedDates: resolvedExcept(today) }), []);
});

test('07:00: still unresolved -> second reminder; uploaded at 05:00 -> none', () => {
  const today = '2026-10-11';
  const still = plan({ today, slot: '0700', resolvedDates: resolvedExcept(today, '2026-10-10') });
  assert.deepEqual(keys(still), ['upload_reminder:2026-10-10:0700']);
  assert.equal(still[0].message,
    "Don't forget to upload sales data for Sat, 10-10-2026 before the forecast at 9:00 AM, or mark the store as closed.");
  // The 05:00 upload confirmed Saturday open.
  assert.deepEqual(plan({ today, slot: '0700', resolvedDates: resolvedExcept(today) }), []);
});

test('no trained model -> nothing, whatever else is missing', () => {
  assert.deepEqual(plan({ today: '2026-10-11', slot: '0400', resolvedDates: [], modelExists: false }), []);
  assert.deepEqual(plan({ today: '2026-10-11', slot: '0700', resolvedDates: [], modelExists: false }), []);
});

test('04:00 also sends ONE summary of other unresolved operating days (not business_date, not today)', () => {
  const today = '2026-10-11';
  const out = plan({ today, slot: '0400', resolvedDates: resolvedExcept(today, '2026-10-10', '2026-10-07', '2026-09-28', '2026-10-04') });
  assert.deepEqual(keys(out), ['upload_reminder:2026-10-10:0400', 'unconfirmed_days:2026-10-11']);
  const summary = out[1];
  // 2026-10-04 is a Sunday (not an operating day) -> left out.
  assert.deepEqual(summary.metadata.dates, ['2026-09-28', '2026-10-07']);
  assert.equal(summary.message,
    'Sales data for (Mon, 28-09-2026; Wed, 07-10-2026) has not been uploaded. Please upload the sales file or mark the store as closed.');
  // The summary is a 04:00 thing only.
  assert.deepEqual(keys(plan({ today, slot: '0700', resolvedDates: resolvedExcept(today, '2026-10-07') })), []);
});

test('summary lists at most 10 dates, then "and N more"; window is 60 days; nothing before the first sale', () => {
  const today = '2026-10-11';
  const out = plan({ today, slot: '0400', resolvedDates: ['2026-10-10'] });
  assert.equal(out.length, 1);
  assert.match(out[0].message, /; and \d+ more\)/);
  assert.ok(out[0].metadata.dates.every((d) => d >= addDays(today, -60) && d < '2026-10-10'));
  const days = findUnresolvedOperatingDays({ today, operatingDays: MON_SAT, resolvedDates: [], firstSaleDate: '2026-10-08' });
  assert.deepEqual(days, ['2026-10-08', '2026-10-09', '2026-10-10']);
});

test('a bad slot or bad date gives nothing', () => {
  assert.deepEqual(plan({ today: '2026-10-11', slot: '0900', resolvedDates: [] }), []);
  assert.deepEqual(plan({ today: 'yesterday', slot: '0400', resolvedDates: [] }), []);
});

// ---------------------------------------------------------------- sending

// 04:00 Sunday 2026-10-11 in Manila = 2026-10-10T20:00Z.
const SUNDAY_0400 = new Date('2026-10-10T20:00:00Z');

function seedWorld({ users = [{ id: 7 }, { id: 8 }], model = true } = {}) {
  const businessDays = resolvedExcept('2026-10-11', '2026-10-10').map((d) => ({ business_date: d, status: 'confirmed_open' }));
  fake.reset({
    user: users,
    model_metrics: model ? [{ id: 1 }] : [],
    business_profile: [{ id: 1, operating_days: [0, 1, 2, 3, 4, 5] }],
    business_days: businessDays,
    daily_sales: [{ id: 1, product_id: 1, sale_date: '2025-07-10', quantity_sold: 1 }],
    notifications: [],
  });
}

const createNotification = async ({ userId, type, title, message, link, metadata }) => {
  const { data } = await fake.from('notifications')
    .insert([{ user_id: userId, type, title, message, link, metadata, read: false }])
    .select().single();
  return data;
};

test('send: every user gets the reminder once, with the link and key', async () => {
  seedWorld();
  const summary = await sendUploadReminders(fake, createNotification, { slot: '0400', now: SUNDAY_0400 });
  assert.equal(summary.today, '2026-10-11');
  assert.deepEqual(summary.planned, ['upload_reminder:2026-10-10:0400']);
  assert.equal(summary.sent, 2);
  const rows = fake.tables.notifications;
  assert.deepEqual(rows.map((r) => r.user_id).sort(), [7, 8]);
  assert.ok(rows.every((r) => r.link === REMINDER_LINK && r.metadata.key === 'upload_reminder:2026-10-10:0400'));
});

test('send: a key is never sent twice, even after the owner read it', async () => {
  seedWorld();
  await sendUploadReminders(fake, createNotification, { slot: '0400', now: SUNDAY_0400 });
  fake.tables.notifications.forEach((n) => { n.read = true; });
  const again = await sendUploadReminders(fake, createNotification, { slot: '0400', now: SUNDAY_0400 });
  assert.equal(again.sent, 0);
  assert.equal(again.duplicates, 2);
  assert.equal(fake.tables.notifications.length, 2);
  // The 07:00 reminder is a different key, so it does go out.
  const seven = await sendUploadReminders(fake, createNotification, { slot: '0700', now: new Date('2026-10-10T23:00:00Z') });
  assert.equal(seven.sent, 2);
});

test('send: no trained model -> nothing sent', async () => {
  seedWorld({ model: false });
  const summary = await sendUploadReminders(fake, createNotification, { slot: '0400', now: SUNDAY_0400 });
  assert.equal(summary.modelExists, false);
  assert.equal(summary.sent, 0);
  assert.equal(fake.tables.notifications.length, 0);
});

// ---------------------------------------------------------------- job

test('job: two crons at 04:00 and 07:00 Asia/Manila', () => {
  const saved = console.log;
  console.log = () => {};
  job.registerUploadReminderJobs();
  console.log = saved;
  assert.deepEqual(scheduled.map((s) => [s.expression, s.options.timezone]),
    [['0 4 * * *', 'Asia/Manila'], ['0 7 * * *', 'Asia/Manila']]);
  const status = job.getUploadReminderStatus();
  assert.equal(status.name, 'uploadReminder');
  assert.deepEqual(status.jobs.map((j) => j.slot), ['0400', '0700']);
});

test('job: lastRuns records succeeded / skipped (no model) / failed', async () => {
  const saved = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  try {
    seedWorld();
    await job.runUploadReminders('0400', { client: fake, notify: createNotification, now: SUNDAY_0400 });
    let run = job.getUploadReminderStatus().lastRuns['0400'];
    assert.equal(run.status, 'succeeded');
    assert.equal(run.sent, 2);

    seedWorld({ model: false });
    await job.runUploadReminders('0700', { client: fake, notify: createNotification, now: SUNDAY_0400 });
    run = job.getUploadReminderStatus().lastRuns['0700'];
    assert.equal(run.status, 'skipped');
    assert.equal(run.error, 'no trained model yet');

    const broken = { from: () => { throw new Error('database down'); } };
    await job.runUploadReminders('0400', { client: broken, notify: createNotification, now: SUNDAY_0400 });
    run = job.getUploadReminderStatus().lastRuns['0400'];
    assert.equal(run.status, 'failed');
    assert.match(run.error, /database down/);
  } finally {
    Object.assign(console, saved);
  }
});

// ---------------------------------------------------------------- card endpoint

test('GET /api/business-days/pending lists unanswered operating days, newest last', async () => {
  seedWorld();
  // Also leave Wed 2026-10-07 unanswered; Sun 2026-10-04 is not an operating day.
  fake.tables.business_days = fake.tables.business_days.filter((d) => d.business_date !== '2026-10-07' && d.business_date !== '2026-10-04');
  const direct = await getPendingDays(fake, { now: SUNDAY_0400 });
  assert.deepEqual(direct.days, [
    { date: '2026-10-07', label: 'Wed, 07-10-2026' },
    { date: '2026-10-10', label: 'Sat, 10-10-2026' },
  ]);
  assert.equal(direct.businessDate, '2026-10-10');

  const app = express();
  app.use(express.json());
  app.use('/api/business-days', businessDaysRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/business-days/pending' }, (r) => {
        let raw = '';
        r.on('data', (c) => { raw += c; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(raw) }));
      }).on('error', reject);
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.days));
  } finally {
    server.close();
  }
});
