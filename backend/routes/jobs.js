// routes/jobs.js
//
// POST /api/jobs/upload-reminders?slot=0400|0700 — lets an outside clock
// (cron-job.org) start the 4:00 / 7:00 AM upload reminder run. A Render
// free instance sleeps after ~15 min idle, so the in-process cron alone
// misses those times; this call wakes the server and runs the slot.
//
// - No JWT: the caller is a cron service, not the owner. Auth is the
//   X-Job-Secret header, compared with JOB_TRIGGER_SECRET in constant time.
// - JOB_TRIGGER_SECRET unset -> 404 (the endpoint does not exist).
// - SCHEDULERS_ENABLED off -> 409, so a local run against the LIVE
//   database can never send reminders.
// - Answers 202 at once and runs in the background, so a cold start never
//   hits the caller's timeout. The run log (audit_logs, action_type
//   'upload_reminder_run') records the result.
// - Safe to call more than once: the DB dedupe (metadata.key) means one
//   notification and one email per reminder.
// See docs/deployment.md for the cron-job.org setup.

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const SLOTS = ['0400', '0700'];
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10; // per IP per 15 min; cron-job.org needs 2 a day

// Hash both sides first so timingSafeEqual always gets equal lengths and
// the comparison time does not reveal the secret's length.
function secretMatches(given, expected) {
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function createJobsRouter({
  env = process.env,
  schedulersEnabled = () => require('../utils/featureFlags').schedulersEnabled(),
  runUploadReminders = (slot) => require('../jobs/uploadReminderJob').runUploadReminders(slot, { trigger: 'external' }),
  rateLimitMax = RATE_MAX,
} = {}) {
  const router = express.Router();

  const limiter = rateLimit({
    windowMs: RATE_WINDOW_MS,
    limit: rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' },
  });

  router.post('/upload-reminders', limiter, (req, res) => {
    const expected = String(env.JOB_TRIGGER_SECRET || '').trim();
    if (!expected) return res.status(404).json({ success: false, error: 'Not found' });

    if (!secretMatches(req.get('X-Job-Secret'), expected)) {
      logger.warn('job_trigger_unauthorized', { job: 'uploadReminder', ip: req.ip });
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!schedulersEnabled()) {
      return res.status(409).json({
        success: false,
        error: 'Timed jobs are off on this server (SCHEDULERS_ENABLED=false)',
      });
    }

    const slot = String(req.query.slot || '');
    if (!SLOTS.includes(slot)) {
      return res.status(400).json({ success: false, error: 'slot must be 0400 or 0700' });
    }

    res.status(202).json({ success: true, accepted: true, slot });

    // After the response: runUploadReminders never throws, but guard anyway.
    Promise.resolve()
      .then(() => runUploadReminders(slot))
      .catch((error) => logger.error('job_trigger_run_failed', { job: 'uploadReminder', slot, err: error }));
    return undefined;
  });

  return router;
}

module.exports = createJobsRouter();
module.exports.createJobsRouter = createJobsRouter;
module.exports.secretMatches = secretMatches;
