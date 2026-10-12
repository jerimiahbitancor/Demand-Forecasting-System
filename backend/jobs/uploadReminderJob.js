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

const cron = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');
const { createNotification } = require('../services/notificationService');
const { sendUploadReminders, PH_TZ } = require('../services/uploadReminderService');

const JOBS = [
  { name: 'uploadReminder', slot: '0400', cron: '0 4 * * *', timezone: PH_TZ },
  { name: 'uploadReminder', slot: '0700', cron: '0 7 * * *', timezone: PH_TZ },
];

// Last run per slot, in memory (for /api/status). Resets on restart.
const SINCE = new Date(Date.now() - process.uptime() * 1000).toISOString();
const lastRuns = { '0400': null, '0700': null };

async function runUploadReminders(slot, {
  client = supabaseAdmin, notify = createNotification, now = new Date(),
} = {}) {
  const run = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    sent: null,
    duplicates: null,
    planned: null,
    error: null,
  };
  lastRuns[slot] = run;
  try {
    const summary = await sendUploadReminders(client, notify, { slot, now });
    Object.assign(run, {
      status: summary.modelExists ? 'succeeded' : 'skipped',
      finishedAt: new Date().toISOString(),
      sent: summary.sent,
      duplicates: summary.duplicates,
      planned: summary.planned,
      error: summary.modelExists ? null : 'no trained model yet',
    });
    console.log(
      `[uploadReminder] ${slot} run done — ${summary.planned.length} reminder(s) planned, `
      + `${summary.sent} sent, ${summary.duplicates} already sent before.`
    );
    return summary;
  } catch (error) {
    Object.assign(run, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: String((error && error.message) || error || 'unknown error').slice(0, 300),
    });
    console.error(`[uploadReminder] ${slot} run failed:`, error);
    return null;
  }
}

function registerUploadReminderJobs() {
  for (const job of JOBS) {
    cron.schedule(job.cron, () => {
      runUploadReminders(job.slot);
    }, { timezone: job.timezone });
  }
  console.log('[uploadReminder] Registered upload reminders — 4:00 AM and 7:00 AM (Asia/Manila).');
}

// For /api/status. Copies, so callers can't change them.
function getUploadReminderStatus() {
  return {
    name: 'uploadReminder',
    since: SINCE,
    jobs: JOBS.map(({ slot, cron: expression, timezone }) => ({ slot, cron: expression, timezone })),
    lastRuns: {
      '0400': lastRuns['0400'] ? { ...lastRuns['0400'] } : null,
      '0700': lastRuns['0700'] ? { ...lastRuns['0700'] } : null,
    },
  };
}

module.exports = { registerUploadReminderJobs, runUploadReminders, getUploadReminderStatus, JOBS };
