// jobs/uploadReminderJob.js
//
// Upload reminders, Asia/Manila (owner's v3 flowchart, page 1):
//   04:00  "Upload yesterday's sales" for business_date (= yesterday) if it
//          is an operating day with no upload and no closed mark, plus one
//          summary of any other unanswered operating days (last 60 days).
//   07:00  a second reminder if business_date is still unanswered, before
//          the 9:00 AM forecast.
// Nothing is sent until a model has been trained. Each reminder has a
// dedupe key (metadata.key) and is never sent twice.
//
// The rules live in utils/uploadReminders.js (pure, unit-tested); the reads
// and the dedupe in services/uploadReminderService.js.
//
// Three ways a run starts (Oct 17 2026), all through runUploadReminders():
//   cron      node-cron inside this process (registerUploadReminderJobs).
//   external  POST /api/jobs/upload-reminders (routes/jobs.js), called by
//             cron-job.org. A Render free instance sleeps after ~15 min
//             idle and node-cron never runs a missed job, so the cron alone
//             misses 4:00 / 7:00. The call also wakes the server.
//   boot      runBootCatchUp(): on startup, the LATEST slot that applies
//             now (owner's rule, Oct 17 2026) runs once if it has no run
//             record today: 04:00-07:00 -> 0400; 07:00-09:00 -> 0700;
//             after 09:00 -> 0400 (the 0700 text says "before the forecast
//             at 9:00 AM", so it never goes out after 9:00).
// All three are safe to overlap: the DB dedupe (alreadySent by
// metadata.key) means one notification and one email per reminder, and a
// run already in flight for a slot is shared instead of started twice.
//
// Every run writes one audit_logs row (action_type 'upload_reminder_run')
// so the history survives restarts; /api/status reads the last one per slot.

const os = require('os');
const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { createNotification, emailOutcomeOf } = require('../services/notificationService');
const { sendUploadReminders, todayManila, PH_TZ } = require('../services/uploadReminderService');

dayjs.extend(utc);
dayjs.extend(timezone);

const JOBS = [
  { name: 'uploadReminder', slot: '0400', cron: '0 4 * * *', timezone: PH_TZ },
  { name: 'uploadReminder', slot: '0700', cron: '0 7 * * *', timezone: PH_TZ },
];
const SLOTS = JOBS.map((j) => j.slot);
const TRIGGERS = ['cron', 'external', 'boot'];
const RUN_ACTION_TYPE = 'upload_reminder_run';
const DETAILS_MAX = 2000; // audit_logs.details limit used by services/auditService.js

// Last run per slot, in memory (for /api/status). Resets on restart; the
// audit_logs rows are the history that survives.
const SINCE = new Date(Date.now() - process.uptime() * 1000).toISOString();
const lastRuns = { '0400': null, '0700': null };
const inFlight = { '0400': null, '0700': null };

// Which server ran the job — a second server with SCHEDULERS_ENABLED=true
// (e.g. an old Railway service next to Render) shows up in the run log.
function hostInfo(env = process.env) {
  let platform = 'other';
  if (env.RENDER_SERVICE_NAME || env.RENDER) platform = 'render';
  else if (env.RAILWAY_SERVICE_NAME || env.RAILWAY_ENVIRONMENT) platform = 'railway';
  return {
    platform,
    service: env.RENDER_SERVICE_NAME || env.RAILWAY_SERVICE_NAME || null,
    hostname: os.hostname(),
  };
}

// emailReminder() reasons -> run-log outcomes.
function outcomeOf(result) {
  if (!result) return 'failed';
  if (result.sent) return 'sent';
  if (result.reason === 'send_failed') return 'failed';
  return result.reason || 'failed';
}

// One outcome per reminder key: 'sent' if any user's row was emailed,
// otherwise the first reason (one user today; several would share a key).
async function collectEmailOutcomes(results, emailOutcome) {
  const byKey = new Map();
  for (const r of results || []) {
    let outcome;
    if (r.duplicate) outcome = 'duplicate'; // already in the bell: no new row, no email
    else if (!r.row) outcome = 'not_created';
    else outcome = outcomeOf(await emailOutcome(r.row));
    const prev = byKey.get(r.key);
    if (!prev || (prev !== 'sent' && outcome === 'sent')) byKey.set(r.key, outcome);
  }
  return [...byKey.entries()].map(([key, email]) => ({ key, email }));
}

// reminder_email_skipped, once per run per reason (not once per row).
function logSkippedEmails(run) {
  const groups = new Map();
  for (const e of run.emails || []) {
    if (!['disabled', 'duplicate', 'not_a_reminder'].includes(e.email)) continue;
    if (!groups.has(e.email)) groups.set(e.email, []);
    groups.get(e.email).push(e.key);
  }
  for (const [reason, keys] of groups) {
    const level = reason === 'duplicate' ? 'info' : 'warn';
    logger[level]('reminder_email_skipped', {
      job: 'uploadReminder', slot: run.slot, trigger: run.trigger, reason, count: keys.length, keys,
    });
  }
}

// The audit_logs.details text: JSON, kept under DETAILS_MAX so it stays
// parseable (a plain slice would cut the JSON in half).
function runDetails(run) {
  const full = {
    slot: run.slot,
    date: run.date,
    trigger: run.trigger,
    status: run.status,
    planned: run.planned || [],
    sent: run.sent,
    duplicates: run.duplicates,
    emails: run.emails || [],
    error: run.error,
    host: run.host,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
  let text = JSON.stringify(full);
  if (text.length <= DETAILS_MAX) return text;
  text = JSON.stringify({ ...full, emails: `${full.emails.length} entries (truncated)`, error: full.error && String(full.error).slice(0, 200) });
  if (text.length <= DETAILS_MAX) return text;
  return JSON.stringify({ ...full, planned: `${full.planned.length} keys (truncated)`, emails: 'truncated', error: null });
}

async function recordRun(client, run) {
  try {
    const { error } = await client.from('audit_logs').insert({
      action_type: RUN_ACTION_TYPE,
      details: runDetails(run),
      performed_by: `system:${run.trigger}`,
    });
    if (error) logger.warn('upload_reminder_run_log_failed', { slot: run.slot, err: error });
  } catch (error) {
    logger.warn('upload_reminder_run_log_failed', { slot: run.slot, err: error });
  }
}

async function doRun(slot, {
  client, notify, now, trigger, emailOutcome, env,
}) {
  const run = {
    slot,
    date: todayManila(now),
    trigger,
    host: hostInfo(env),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    sent: null,
    duplicates: null,
    planned: null,
    emails: [],
    error: null,
  };
  lastRuns[slot] = run;
  let summary = null;
  try {
    summary = await sendUploadReminders(client, notify, { slot, now });
    const emails = await collectEmailOutcomes(summary.results, emailOutcome);
    Object.assign(run, {
      status: summary.modelExists ? 'succeeded' : 'skipped',
      finishedAt: new Date().toISOString(),
      sent: summary.sent,
      duplicates: summary.duplicates,
      planned: summary.planned,
      emails,
      error: summary.modelExists ? null : 'no trained model yet',
    });
    console.log(
      `[uploadReminder] ${slot} run done (${trigger}) — ${summary.planned.length} reminder(s) planned, `
      + `${summary.sent} sent, ${summary.duplicates} already sent before.`
    );
    logSkippedEmails(run);
  } catch (error) {
    Object.assign(run, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: String((error && error.message) || error || 'unknown error').slice(0, 300),
    });
    console.error(`[uploadReminder] ${slot} run failed (${trigger}):`, error);
    summary = null;
  }
  await recordRun(client, run);
  return summary;
}

// Runs one slot now. A run already in flight for the slot is shared, not
// started twice (the cron, the external call and the boot catch-up can
// land together on a cold start). Never throws; returns the summary, or
// null when the run failed.
function runUploadReminders(slot, {
  client = supabaseAdmin, notify = createNotification, now = new Date(),
  trigger = 'cron', emailOutcome = emailOutcomeOf, env = process.env,
} = {}) {
  if (!SLOTS.includes(slot)) return Promise.resolve(null);
  if (inFlight[slot]) return inFlight[slot];
  const t = TRIGGERS.includes(trigger) ? trigger : 'cron';
  const p = doRun(slot, { client, notify, now, trigger: t, emailOutcome, env })
    .finally(() => { inFlight[slot] = null; });
  inFlight[slot] = p;
  return p;
}

// Recent run-log rows, newest first, parsed. Rows whose details are not
// JSON are skipped.
async function loadRunLog(client, { limit = 50 } = {}) {
  const { data, error } = await client
    .from('audit_logs')
    .select('id, details, performed_at')
    .eq('action_type', RUN_ACTION_TYPE)
    .order('performed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const out = [];
  for (const row of data || []) {
    try {
      const d = JSON.parse(row.details);
      if (d && SLOTS.includes(d.slot)) out.push({ id: row.id, performedAt: row.performed_at, ...d });
    } catch (_) { /* not ours, or truncated by hand */ }
  }
  return out;
}

// For /api/status: the newest run-log row per slot (survives restarts).
async function getLastRunsFromLog(client = supabaseAdmin) {
  const rows = await loadRunLog(client);
  const out = { '0400': null, '0700': null };
  for (const r of rows) if (!out[r.slot]) out[r.slot] = r;
  return out;
}

// The one slot a boot catch-up may run at this Manila hour, or null.
function catchUpSlotFor(hour) {
  if (hour < 4) return null;
  if (hour < 7) return '0400';
  if (hour < 9) return '0700';
  return '0400';
}

/**
 * On startup: the latest applicable slot (catchUpSlotFor) runs once if it
 * has no run record for today (a failed run does not count). Same dedupe
 * as every other run. If the run log cannot be read, the slot runs anyway —
 * the dedupe still prevents a second notification. Returns the slots run.
 */
async function runBootCatchUp({
  client = supabaseAdmin, notify = createNotification, now = new Date(),
  emailOutcome = emailOutcomeOf, env = process.env,
} = {}) {
  const manila = dayjs(now).tz(PH_TZ);
  const today = manila.format('YYYY-MM-DD');
  const slot = catchUpSlotFor(manila.hour());
  const due = slot ? [slot] : [];
  if (due.length === 0) return [];

  let doneToday = new Set();
  try {
    const rows = await loadRunLog(client);
    doneToday = new Set(rows.filter((r) => r.date === today && r.status !== 'failed').map((r) => r.slot));
  } catch (error) {
    logger.warn('upload_reminder_catchup_log_unreadable', { err: error });
  }

  const ran = [];
  for (const slot of due) {
    if (doneToday.has(slot)) continue;
    console.log(`[uploadReminder] boot catch-up: ${slot} has no run today (${today}), running it now.`);
    await runUploadReminders(slot, { client, notify, now, trigger: 'boot', emailOutcome, env });
    ran.push(slot);
  }
  return ran;
}

function registerUploadReminderJobs() {
  for (const job of JOBS) {
    cron.schedule(job.cron, () => {
      runUploadReminders(job.slot, { trigger: 'cron' });
    }, { timezone: job.timezone });
  }
  console.log('[uploadReminder] Registered upload reminders — 4:00 AM and 7:00 AM (Asia/Manila).');
}

// For /api/status. Copies, so callers can't change them.
function getUploadReminderStatus() {
  return {
    name: 'uploadReminder',
    since: SINCE,
    jobs: JOBS.map(({ slot, cron: expression, timezone: tz }) => ({ slot, cron: expression, timezone: tz })),
    lastRuns: {
      '0400': lastRuns['0400'] ? { ...lastRuns['0400'] } : null,
      '0700': lastRuns['0700'] ? { ...lastRuns['0700'] } : null,
    },
  };
}

module.exports = {
  registerUploadReminderJobs,
  runUploadReminders,
  runBootCatchUp,
  catchUpSlotFor,
  getUploadReminderStatus,
  getLastRunsFromLog,
  hostInfo,
  JOBS,
  SLOTS,
  RUN_ACTION_TYPE,
};
