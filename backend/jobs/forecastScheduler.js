// jobs/forecastScheduler.js
//
// Real cron-driven forecast refresh — closes the gap where POST /api/ml/forecast
// and Flask's /forecast were both correct but nothing running in the system ever
// called them (only POST /api/ml/train was wired to a UI button). Training and
// forecasting stay deliberately separate pipelines: this file only ever calls
// mlService.forecast(), never mlService.train(), and finishing a training run
// never auto-triggers a forecast run here.
//
// Both jobs run in Asia/Manila time, per CLAUDE.md's confirmed schedule:
// daily refresh every day except Monday, 9:00 AM (horizon 1 day, today only);
// Monday runs the weekly forecast only, 9:00 AM (horizon 7 days, Mon-Sun,
// which already covers Monday itself). Daily skips Monday so the two jobs
// never fire at the same minute and send two /forecast calls to the ML
// service at once (there is no lock between them). An earlier 8:00 AM figure
// in some comments/docs was a documented mistake — 9:00 AM is correct and is
// the only schedule wired up here.
//
// Calls mlService.forecast() directly (the same function routes/ml.js's
// POST /forecast handler calls) rather than making an HTTP request back into
// this same Express process — there is no reason to round-trip over the
// network to reach code already running in-process.
//
// Oct 17 2026 — a Render free instance sleeps, so the 9:00 AM cron can be
// missed. Two more ways start the same run (runTriggeredForecast):
//   external  POST /api/jobs/forecast (routes/jobs.js), called by cron-job.org
//   boot      runForecastBootCatchUp(), on startup after 9:00 AM Manila
// Both use forecast_runs as the record: a run_at at/after today's 9:00 AM
// Manila means today's slot is done. Before calling, they wake the ML
// service (/health); a cold-start failure is retried once (every run type).
// After a successful forecast the stock alerts are refreshed.
const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const mlService = require('../services/mlService');
const { createNotification, queueStockRefresh } = require('../services/notificationService');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TZ = 'Asia/Manila';
const FORECAST_HOUR = 9;
const COLD_RETRY_WAIT_MS = 30 * 1000;
const COLD_STATUSES = new Set([429, 502, 503, 504]);
const TRIGGER_ACTION_TYPE = 'forecast_trigger_run';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A failure that a cold (sleeping) ML service causes: the host's 429/502/
// 503/504, or the network giving up (Node fetch: TypeError "fetch failed").
// A plain Error from Flask (bad data, no model) is not cold: no retry.
function isColdStartError(error) {
  if (!error) return false;
  const status = error.status ?? (error.details && error.details.status);
  if (COLD_STATUSES.has(Number(status))) return true;
  if (error.name === 'TypeError' && /fetch failed/i.test(String(error.message))) return true;
  const code = error.cause && error.cause.code;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code);
}

// The two cron jobs, in one list so getSchedulerStatus() reports exactly
// what registerForecastJobs() schedules.
const JOBS = [
  { name: 'daily', cron: '0 9 * * 0,2-6', timezone: PH_TZ, horizonDays: 1 }, // not Monday
  { name: 'weekly', cron: '0 9 * * 1', timezone: PH_TZ, horizonDays: 7 },
];

// Last run per run type, in memory (for /api/status). Resets when the
// process restarts; `since` says when that was.
const SCHEDULER_SINCE = new Date(Date.now() - process.uptime() * 1000).toISOString();
const lastRuns = { daily: null, weekly: null };

// Single-owner system today (see notificationService.js's
// refreshLowStockNotifications for the same "notify every row in `user`"
// pattern) — in practice this is exactly one account, but this loop makes
// no assumption about that beyond what that existing pattern already does.
async function notifyAllUsers({ type, title, message, metadata }) {
  const { data: users, error } = await supabaseAdmin.from('user').select('id');
  if (error) {
    console.error('[forecastScheduler] Could not load users to notify:', error);
    return;
  }
  for (const user of users || []) {
    await createNotification({ userId: user.id, type, title, message, link: '/analytics', metadata });
  }
}

async function runScheduledForecast({
  horizonDays, runType, trigger = 'cron', ml = mlService, wait = sleep, coldRetryWaitMs = COLD_RETRY_WAIT_MS,
}) {
  const label = runType === 'weekly' ? 'Weekly (7-day)' : 'Daily (1-day)';
  const skipRun = () => {
    const at = new Date().toISOString();
    lastRuns[runType] = {
      startedAt: at,
      finishedAt: at,
      status: 'skipped',
      forecastedCount: null,
      skippedCount: null,
      error: mlService.FORECAST_IN_FLIGHT_MESSAGE,
    };
    console.warn(`[forecastScheduler] ${label} forecast run skipped — ${mlService.FORECAST_IN_FLIGHT_MESSAGE}.`);
  };
  // Another forecast (usually a manual "Generate Forecast") is still
  // running. Skip this run rather than send a second /forecast; no
  // notification, because nothing failed.
  if (typeof ml.isForecastInFlight === 'function' && ml.isForecastInFlight()) {
    skipRun();
    return { status: 'skipped' };
  }
  console.log(`[forecastScheduler] ${label} forecast run starting (${trigger})…`);
  const run = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    forecastedCount: null,
    skippedCount: null,
    error: null,
  };
  lastRuns[runType] = run;

  try {
    let result;
    try {
      result = await ml.forecast({ horizonDays, runType });
    } catch (firstError) {
      if (!isColdStartError(firstError)) throw firstError;
      // The ML service was asleep: wake it and try once more.
      console.warn(`[forecastScheduler] ${label} forecast: ML service looks cold `
        + `(${firstError.status || firstError.message}); retrying once in ${coldRetryWaitMs / 1000}s.`);
      await wait(coldRetryWaitMs);
      if (typeof ml.checkHealth === 'function') await ml.checkHealth();
      result = await ml.forecast({ horizonDays, runType });
    }
    const forecastedCount = (result?.results || []).filter((r) => r.status === 'forecasted').length;
    const skippedCount = (result?.results || []).filter((r) => r.status === 'skipped').length;
    // The forecast itself succeeded; a later notification failure must not
    // relabel it as failed.
    Object.assign(run, { status: 'succeeded', finishedAt: new Date().toISOString(), forecastedCount, skippedCount });

    console.log(
      `[forecastScheduler] ${label} forecast run completed — ${forecastedCount} product(s) forecasted` +
      (skippedCount ? `, ${skippedCount} skipped` : '') +
      (result?.stale_days ? ` (data ${result.stale_days} day(s) stale)` : '') +
      '.'
    );

    // New forecast -> new needs -> refresh stock alerts (and maybe the
    // restock email). Fire-and-forget; off where the timed jobs are off.
    queueStockRefresh('forecast');

    await notifyAllUsers({
      type: 'success',
      title: `${label} forecast completed`,
      message: `The scheduled ${runType} forecast run finished — ${forecastedCount} product(s) forecasted.`,
      metadata: { kind: 'forecast', status: 'completed', run_type: runType, horizon_days: horizonDays, scheduled: true, forecasted_count: forecastedCount },
    });
    return { status: 'succeeded', forecastedCount };
  } catch (error) {
    // Lost the race to a run that started between the check above and
    // the call: same outcome as the check.
    if (error && error.code === 'FORECAST_IN_FLIGHT') {
      skipRun();
      return { status: 'skipped' };
    }
    if (run.status === 'running') {
      Object.assign(run, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: String((error && error.message) || error || 'unknown error').slice(0, 300),
      });
    }
    console.error(`[forecastScheduler] ${label} forecast run failed:`, error);
    await notifyAllUsers({
      type: 'error',
      title: `${label} forecast failed`,
      message: `The scheduled ${runType} forecast run failed — ${(error && error.message) || 'check ml-service logs.'}`,
      metadata: { kind: 'forecast', status: 'failed', run_type: runType, horizon_days: horizonDays, scheduled: true },
    });
    return { status: 'failed', error: run.error };
  }
}

// Monday runs the weekly 7-day forecast; every other day the daily one
// (same as the two crons below).
function forecastSlotFor(now = new Date()) {
  const manila = dayjs(now).tz(PH_TZ);
  const isMonday = manila.day() === 1;
  return {
    today: manila.format('YYYY-MM-DD'),
    runType: isMonday ? 'weekly' : 'daily',
    horizonDays: isMonday ? 7 : 1,
    // Today's 9:00 AM Manila as an ISO instant (UTC).
    slotStart: dayjs.tz(`${manila.format('YYYY-MM-DD')} 09:00`, PH_TZ).toISOString(),
    pastSlot: manila.hour() >= FORECAST_HOUR,
  };
}

// forecast_runs is the record: a run at/after today's 9:00 AM means done.
async function forecastRanSince(client, slotStart) {
  const { data, error } = await client
    .from('forecast_runs')
    .select('id, run_at, run_type')
    .gte('run_at', slotStart)
    .order('run_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function hasTrainedModel(client) {
  const { data, error } = await client.from('model_metrics').select('id').limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

// One audit_logs row per external/boot attempt, so a failing ML service is
// not retried on every wake-up (and the attempts are visible).
async function recordTriggerAttempt(client, row) {
  try {
    const { error } = await client.from('audit_logs').insert({
      action_type: TRIGGER_ACTION_TYPE,
      details: JSON.stringify(row).slice(0, 2000),
      performed_by: `system:${row.trigger}`,
    });
    if (error) logger.warn('forecast_trigger_log_failed', { err: error });
  } catch (error) {
    logger.warn('forecast_trigger_log_failed', { err: error });
  }
}

async function failedAttemptToday(client, today) {
  const { data, error } = await client
    .from('audit_logs')
    .select('id, details')
    .eq('action_type', TRIGGER_ACTION_TYPE)
    .order('id', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []).some((r) => {
    try {
      const d = JSON.parse(r.details);
      return d.date === today && d.status === 'failed';
    } catch (_) {
      return false;
    }
  });
}

/**
 * Today's 9:00 AM forecast, started from outside the cron (external or
 * boot). Skips when it is before 9:00, no model is trained, or
 * forecast_runs already has a run since 9:00 today. Wakes the ML service
 * first. Never throws. Returns { status, reason? }.
 */
async function runTriggeredForecast({
  trigger = 'external', client = supabaseAdmin, now = new Date(), ml = mlService,
  wait = sleep, coldRetryWaitMs = COLD_RETRY_WAIT_MS,
} = {}) {
  const slot = forecastSlotFor(now);
  const done = (status, reason, extra = {}) => {
    console.log(`[forecastScheduler] ${trigger} forecast ${status}${reason ? ` — ${reason}` : ''}.`);
    return { status, reason, ...extra };
  };
  try {
    if (!slot.pastSlot) return done('skipped', 'before 9:00 AM Manila');
    if (typeof ml.isForecastInFlight === 'function' && ml.isForecastInFlight()) {
      return done('skipped', 'a forecast is already running');
    }
    const ran = await forecastRanSince(client, slot.slotStart);
    if (ran) return done('skipped', `already ran today (forecast_runs #${ran.id})`);
    if (!(await hasTrainedModel(client))) return done('skipped', 'no trained model yet');
  } catch (error) {
    logger.error('forecast_trigger_check_failed', { trigger, err: error });
    return { status: 'failed', reason: 'could not read forecast_runs' };
  }

  // Wake the ML service before the real call (Render free sleeps too).
  if (typeof ml.checkHealth === 'function') {
    try { await ml.checkHealth(); } catch (_) { /* the forecast call retries */ }
  }
  const outcome = await runScheduledForecast({
    horizonDays: slot.horizonDays, runType: slot.runType, trigger, ml, wait, coldRetryWaitMs,
  });
  await recordTriggerAttempt(client, {
    date: slot.today, trigger, run_type: slot.runType, status: outcome.status, error: outcome.error || null,
    at: new Date().toISOString(),
  });
  return { ...outcome, runType: slot.runType };
}

/**
 * On startup: after 9:00 AM Manila, if today's forecast has not run, run it
 * once. Not when an external/boot attempt already failed today: a broken
 * ML service must not mean one failure notification per wake-up (the 9:00
 * cron-job.org call and a manual "Generate Forecast" still work).
 */
async function runForecastBootCatchUp({ client = supabaseAdmin, now = new Date(), ml = mlService, wait, coldRetryWaitMs } = {}) {
  const slot = forecastSlotFor(now);
  if (!slot.pastSlot) return { status: 'skipped', reason: 'before 9:00 AM Manila' };
  try {
    if (await failedAttemptToday(client, slot.today)) {
      console.log('[forecastScheduler] boot catch-up skipped — a triggered forecast already failed today.');
      return { status: 'skipped', reason: 'failed earlier today' };
    }
  } catch (error) {
    logger.warn('forecast_catchup_log_unreadable', { err: error });
  }
  return runTriggeredForecast({ trigger: 'boot', client, now, ml, wait, coldRetryWaitMs });
}

function registerForecastJobs() {
  // Daily refresh — every day except Monday at 9:00 AM Asia/Manila (JOBS[0]).
  // Weekly 7-day refresh — Monday at 9:00 AM Asia/Manila (JOBS[1]); Monday
  // runs the weekly forecast only.
  for (const job of JOBS) {
    cron.schedule(job.cron, () => {
      runScheduledForecast({ horizonDays: job.horizonDays, runType: job.name });
    }, { timezone: job.timezone });
  }

  console.log('[forecastScheduler] Registered forecast jobs — daily 9:00 AM except Monday, weekly Monday 9:00 AM (Asia/Manila).');
}

// For /api/status. `lastRuns` holds copies, so callers can't change them.
function getSchedulerStatus() {
  return {
    since: SCHEDULER_SINCE,
    jobs: JOBS.map(({ name, cron: expression, timezone }) => ({ name, cron: expression, timezone })),
    lastRuns: {
      daily: lastRuns.daily ? { ...lastRuns.daily } : null,
      weekly: lastRuns.weekly ? { ...lastRuns.weekly } : null,
    },
  };
}

module.exports = {
  registerForecastJobs,
  runScheduledForecast,
  runTriggeredForecast,
  runForecastBootCatchUp,
  forecastSlotFor,
  isColdStartError,
  getSchedulerStatus,
  TRIGGER_ACTION_TYPE,
};
