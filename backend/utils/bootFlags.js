// utils/bootFlags.js
//
// The effective on/off switches, for one log line at boot and for
// GET /api/status. Never includes a key or secret value: only whether one
// is set.

const { schedulersEnabled, emailRemindersEnabled } = require('./featureFlags');

function describeBootFlags(env = process.env) {
  return {
    schedulersEnabled: schedulersEnabled(env),
    emailRemindersEnabled: emailRemindersEnabled(env),
    brevoConfigured: Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL),
    jobTriggerConfigured: Boolean(String(env.JOB_TRIGGER_SECRET || '').trim()),
    service: env.RENDER_SERVICE_NAME || env.RAILWAY_SERVICE_NAME || null,
  };
}

// Warnings about the switches, in plain words. Shared by the boot log and
// /api/status so both say the same thing.
function bootFlagWarnings(flags) {
  const out = [];
  if (flags.schedulersEnabled && !flags.emailRemindersEnabled) {
    out.push('timed jobs are on but EMAIL_REMINDERS_ENABLED is off: reminders reach the bell only, no email');
  }
  if (flags.schedulersEnabled && flags.emailRemindersEnabled && !flags.brevoConfigured) {
    out.push('email reminders are on but Brevo is not configured (BREVO_API_KEY / BREVO_SENDER_EMAIL)');
  }
  if (flags.schedulersEnabled && !flags.jobTriggerConfigured) {
    out.push('JOB_TRIGGER_SECRET is not set: the 4:00 / 7:00 AM reminders depend on this server being awake');
  }
  return out;
}

const onOff = (v) => (v ? 'on' : 'off');

function bootFlagLine(flags) {
  return `SCHEDULERS_ENABLED=${onOff(flags.schedulersEnabled)} `
    + `EMAIL_REMINDERS_ENABLED=${onOff(flags.emailRemindersEnabled)} `
    + `brevo=${flags.brevoConfigured ? 'configured' : 'missing'} `
    + `JOB_TRIGGER_SECRET=${flags.jobTriggerConfigured ? 'set' : 'unset'} `
    + `service=${flags.service || 'unknown'}`;
}

module.exports = { describeBootFlags, bootFlagWarnings, bootFlagLine };
