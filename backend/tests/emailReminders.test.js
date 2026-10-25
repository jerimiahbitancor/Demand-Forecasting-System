// tests/emailReminders.test.js — run: node --test tests/emailReminders.test.js
//
// Email reminders (Oct 14 2026): services/emailService.js (Brevo sender,
// moved out of otpService.js) and the reminder hook in notificationService.
// fetch is mocked: Brevo is NEVER called. In-memory fake database.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase();
installFake(fake, {
  'middleware/auth.js': (req, res, next) => { req.user = { id: 7, user_id: 7, name: 'Test Owner' }; next(); },
});

// ---- fetch mock: records every call, answers per test ----
const brevoCalls = [];
let brevoAnswer = () => ({ ok: true, status: 201, statusText: 'Created', json: async () => ({ messageId: 'm-1' }) });
global.fetch = async (url, options = {}) => {
  brevoCalls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
  return brevoAnswer(url, options);
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
const emailService = require('../services/emailService');
const otpService = require('../services/otpService');
const notificationsRouter = require('../routes/notifications');
restoreLoad();
const { createNotification, emailDedupeKey, _waitForEmails, _resetEmailState } = notificationService;

const ENV_KEYS = ['EMAIL_REMINDERS_ENABLED', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'FRONTEND_URL', 'ALLOWED_ORIGINS'];
function setEnv(values) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
}
const CONFIGURED = {
  BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: 'sender@example.com', FRONTEND_URL: 'https://chefduo.example.app/',
};

function seed({ email = 'noreplyforecasting@gmail.com' } = {}) {
  fake.reset({
    user: [{ id: 7 }, { id: 8 }],
    business_profile: [{ id: 1, business_email: email }],
    notifications: [],
  });
  brevoCalls.length = 0;
  brevoAnswer = () => ({ ok: true, status: 201, statusText: 'Created', json: async () => ({ messageId: 'm-1' }) });
  _resetEmailState();
}

const reminder = (userId, extra = {}) => ({
  userId,
  type: 'warning',
  title: "Upload yesterday's sales",
  message: 'Upload sales data for Sat, 10-10-2026, or mark the store as closed.',
  link: '/data-management#days-to-answer',
  metadata: { kind: 'upload_reminder', key: 'upload_reminder:2026-10-10:0400', business_date: '2026-10-10' },
  ...extra,
});

async function create(n) {
  const restore = quiet();
  try {
    const row = await createNotification(n);
    await _waitForEmails();
    return row;
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------- J2

test('reminder kind + flag on -> one email: subject, button link, footer, plain text', async () => {
  seed();
  setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
  const row = await create(reminder(7));
  assert.ok(row && row.id, 'the notification row is created');
  assert.equal(brevoCalls.length, 1);
  const call = brevoCalls[0];
  assert.equal(call.url, emailService.BREVO_API_URL);
  assert.ok(call.options.signal instanceof AbortSignal, 'request carries a timeout signal');
  assert.deepEqual(call.body.to, [{ email: 'noreplyforecasting@gmail.com' }]);
  assert.equal(call.body.subject, "ChefDuo: Upload yesterday's sales");
  assert.match(call.body.htmlContent, /href="https:\/\/chefduo\.example\.app\/data-management#days-to-answer"/);
  assert.match(call.body.htmlContent, />Open ChefDuo</);
  assert.match(call.body.htmlContent, /Upload sales data for Sat, 10-10-2026/);
  assert.match(call.body.textContent, /Open ChefDuo: https:\/\/chefduo\.example\.app\/data-management#days-to-answer/);
  assert.match(call.body.textContent, /You get this email because reminders are on\. Change the email in Settings > Business Profile\./);
});

test('blocked sales upload email includes a readable ingredient shortfall table', async () => {
  seed();
  setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
  await create({
    userId: 7,
    type: 'error',
    title: 'File not saved: not enough stock',
    message: '"sales.csv" was not saved because ingredients do not have enough stock.',
    link: '/ingredient-management',
    metadata: {
      kind: 'upload_blocked_stock',
      key: 'upload_blocked_stock:902',
      filename: 'sales.csv',
      shortfalls: [
        { name: 'Egg', unit: 'Pieces (pcs)', required: '19', available: '4', shortfall: '15' },
        { name: 'Strawberry Powder', unit: 'Grams (g)', required: '16', available: '3', shortfall: '13' },
      ],
    },
  });

  const email = brevoCalls[0].body;
  assert.equal(email.subject, 'ChefDuo: File not saved: not enough stock');
  assert.match(email.htmlContent, /<table/);
  assert.match(email.htmlContent, /Egg/);
  assert.match(email.htmlContent, /19 pcs/);
  assert.match(email.htmlContent, /4 pcs/);
  assert.match(email.htmlContent, /15 pcs/);
  assert.match(email.htmlContent, /Strawberry Powder/);
  assert.match(email.textContent, /Ingredient \| Needed \| In stock \| Short/);
  assert.match(email.textContent, /Strawberry Powder \| 16 g \| 3 g \| 13 g/);
});

test('flag off (the default) -> no email, notification still created', async () => {
  seed();
  setEnv({ ...CONFIGURED });
  const row = await create(reminder(7));
  assert.ok(row);
  assert.equal(brevoCalls.length, 0);
});

test('kind not in EMAIL_REMINDER_KINDS -> no email (upload success, training, forecast, prices)', async () => {
  seed();
  setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
  for (const kind of ['upload', 'upload_failed', 'training', 'forecast', 'market_price']) {
    await create({ userId: 7, type: 'success', title: `t ${kind}`, message: 'm', metadata: { kind } });
  }
  assert.equal(brevoCalls.length, 0);
  assert.equal(fake.tables.notifications.length, 5);
  // Per-ingredient 'low_stock' alerts stay in the bell (Oct 17 2026): only
  // the daily restock_summary emails, see tests/restockEmail.test.js.
  assert.deepEqual([...notificationService.EMAIL_REMINDER_KINDS].sort(),
    ['restock_summary', 'stock_shortfall', 'unconfirmed_days', 'upload_blocked_stock', 'upload_reminder']);
});

test('missing or invalid business email -> skipped, notification still created', async () => {
  for (const email of ['', 'not-an-email', null]) {
    seed({ email });
    setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
    const row = await create(reminder(7));
    assert.ok(row, `row created with email ${JSON.stringify(email)}`);
    assert.equal(brevoCalls.length, 0, `no send with email ${JSON.stringify(email)}`);
  }
});

test('Brevo not configured -> skipped, notification still created', async () => {
  seed();
  setEnv({ EMAIL_REMINDERS_ENABLED: 'true' });
  const row = await create(reminder(7));
  assert.ok(row);
  assert.equal(brevoCalls.length, 0);
});

test('Brevo failure -> notification still created; the next reminder can try again', async () => {
  seed();
  setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
  brevoAnswer = () => ({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({ message: 'boom' }) });
  const row = await create(reminder(7));
  assert.ok(row && row.id);
  assert.equal(fake.tables.notifications.length, 1);
  assert.equal(brevoCalls.length, 1);
  // A failed send does not use up the key.
  brevoAnswer = () => ({ ok: true, status: 201, statusText: 'Created', json: async () => ({}) });
  await create(reminder(8));
  assert.equal(brevoCalls.length, 2);
});

test('the email never delays the notification (fire-and-forget)', async () => {
  seed();
  setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
  let release;
  brevoAnswer = () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 201, statusText: 'Created', json: async () => ({}) }); });
  const restore = quiet();
  const row = await createNotification(reminder(7)); // resolves while the email is still pending
  assert.ok(row && row.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(brevoCalls.length, 1, 'email started');
  release();
  await _waitForEmails();
  restore();
});

test('two users, same key -> ONE email', async () => {
  seed();
  setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
  const restore = quiet();
  // The job creates both rows back to back.
  await Promise.all([createNotification(reminder(7)), createNotification(reminder(8))]);
  await _waitForEmails();
  restore();
  assert.equal(fake.tables.notifications.length, 2);
  assert.equal(brevoCalls.length, 1);
});

test('no key -> kind + title + Manila date; shortfalls grouped per ingredient per day', async () => {
  seed();
  setEnv({ ...CONFIGURED, EMAIL_REMINDERS_ENABLED: 'true' });
  const summary = { userId: 7, title: '3 day(s) still need your answer', message: 'm', metadata: { kind: 'unconfirmed_days' } };
  await create(summary);
  await create({ ...summary, userId: 8 });
  assert.equal(brevoCalls.length, 1, 'same keyless reminder, same day -> one email');

  const shortfall = (uploadId) => ({
    userId: 7, title: 'Stock shortfall: Rice', message: 'Rice: 9.07 kg used but 0 kg in stock. Please monitor it.',
    metadata: { kind: 'stock_shortfall', key: `stock_shortfall:${uploadId}:92`, upload_id: uploadId, ingredient_id: 92 },
  });
  await create(shortfall(500));
  await create(shortfall(501)); // a bulk backfill: another file, same ingredient, same day
  assert.equal(brevoCalls.length, 2, 'one shortfall email for Rice today, not one per file');

  // A refused upload (not enough stock) is emailed, once per Manila day.
  const blocked = (uploadId) => ({
    userId: 7, type: 'error', title: 'File not saved: not enough stock',
    message: '"a.csv" was not saved because these ingredients do not have enough stock: Rice: needs 2 kg, 1 kg in stock (1 kg short).',
    link: '/ingredient-management',
    metadata: { kind: 'upload_blocked_stock', key: `upload_blocked_stock:${uploadId}`, upload_id: uploadId },
  });
  await create(blocked(600));
  await create(blocked(601)); // another refused file the same day
  assert.equal(brevoCalls.length, 3, 'one "upload refused" email per day, not one per file');

  // Manila date: 2026-10-13 23:30 UTC is already Oct 14 in Manila.
  assert.equal(
    emailDedupeKey({ title: 'T', metadata: { kind: 'restock_summary' } }, new Date('2026-10-13T23:30:00Z')),
    'restock_summary|T|2026-10-14'
  );
});

// ---------------------------------------------------------------- J3

function call(server, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('POST /api/notifications/test-email: 200 masked, works with the flag OFF; 400 without an email; 503 unconfigured; 4th call in 10 min -> 429', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const restore = quiet();
  try {
    seed();
    setEnv({ ...CONFIGURED }); // EMAIL_REMINDERS_ENABLED not set
    const ok = await call(server, 'POST', '/api/notifications/test-email');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data, { sentTo: 'n***@gmail.com' });
    assert.equal(brevoCalls.length, 1);
    assert.match(brevoCalls[0].body.subject, /^ChefDuo: Upload yesterday's sales/);
    assert.equal(fake.tables.notifications.length, 0, 'a test email writes no notification');

    seed({ email: '' });
    const noEmail = await call(server, 'POST', '/api/notifications/test-email');
    assert.equal(noEmail.status, 400);
    assert.equal(noEmail.body.error, 'No business email in Settings');

    seed();
    setEnv({});
    const unconfigured = await call(server, 'POST', '/api/notifications/test-email');
    assert.equal(unconfigured.status, 503);
    assert.equal(unconfigured.body.error, 'Email is not configured on the server');

    const limited = await call(server, 'POST', '/api/notifications/test-email');
    assert.equal(limited.status, 429, 'max 3 per 10 minutes per user');
  } finally {
    restore();
    server.close();
  }
});

// ---------------------------------------------------------------- J1

test('emailService: mask, validity, missing config', async () => {
  assert.equal(emailService.maskEmail('noreplyforecasting@gmail.com'), 'n***@gmail.com');
  assert.equal(emailService.maskEmail('x'), '(invalid)');
  assert.equal(emailService.isValidEmail(' owner@chefduo.ph '), true);
  assert.equal(emailService.isValidEmail('owner@chefduo'), false);
  assert.equal(emailService.EMAIL_TIMEOUT_MS, 10000);
  setEnv({});
  await assert.rejects(emailService.sendEmail({ to: 'a@b.co', subject: 's', html: 'h' }), /BREVO_API_KEY is not set/);
});

test('OTP email behaves as before: same Brevo call, same errors', async () => {
  seed();
  setEnv({ ...CONFIGURED });
  const out = await otpService.sendOTPEmail('owner@example.com', '123456', 'verification');
  assert.deepEqual(out, { success: true });
  assert.equal(brevoCalls.length, 1);
  const body = brevoCalls[0].body;
  assert.deepEqual(body.to, [{ email: 'owner@example.com' }]);
  assert.deepEqual(body.sender, { name: 'ChefDuo', email: 'sender@example.com' });
  assert.match(body.htmlContent, /123456/);
  assert.equal(body.textContent, undefined, 'OTP sends HTML only, as before');
  setEnv({});
  await assert.rejects(otpService.sendOTPEmail('owner@example.com', '1', 'verification'), /^Error: Failed to send email: BREVO_API_KEY is not set$/);
});

test.after(() => setEnv({}));
