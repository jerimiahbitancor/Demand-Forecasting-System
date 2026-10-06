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
// daily refresh every day 9:00 AM (horizon 1 day, today only), weekly refresh
// every Monday 9:00 AM (horizon 7 days, Mon-Sun). An earlier 8:00 AM figure
// in some comments/docs was a documented mistake — 9:00 AM is correct and is
// the only schedule wired up here.
//
// Calls mlService.forecast() directly (the same function routes/ml.js's
// POST /forecast handler calls) rather than making an HTTP request back into
// this same Express process — there is no reason to round-trip over the
// network to reach code already running in-process.
const cron = require('node-cron');
const mlService = require('../services/mlService');
const { createNotification } = require('../services/notificationService');
const { supabaseAdmin } = require('../config/supabase');

const PH_TZ = 'Asia/Manila';

// The two cron jobs, in one list so getSchedulerStatus() reports exactly
// what registerForecastJobs() schedules.
const JOBS = [
  { name: 'daily', cron: '0 9 * * *', timezone: PH_TZ, horizonDays: 1 },
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

async function runScheduledForecast({ horizonDays, runType }) {
  const label = runType === 'weekly' ? 'Weekly (7-day)' : 'Daily (1-day)';
  console.log(`[forecastScheduler] ${label} forecast run starting…`);
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
    const result = await mlService.forecast({ horizonDays, runType });
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

    await notifyAllUsers({
      type: 'success',
      title: `${label} forecast completed`,
      message: `The scheduled ${runType} forecast run finished — ${forecastedCount} product(s) forecasted.`,
      metadata: { kind: 'forecast', status: 'completed', run_type: runType, horizon_days: horizonDays, scheduled: true, forecasted_count: forecastedCount },
    });
  } catch (error) {
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
  }
}

function registerForecastJobs() {
  // Daily refresh — every day at 9:00 AM Asia/Manila (JOBS[0]).
  // Weekly 7-day refresh — Monday at 9:00 AM Asia/Manila (JOBS[1]).
  for (const job of JOBS) {
    cron.schedule(job.cron, () => {
      runScheduledForecast({ horizonDays: job.horizonDays, runType: job.name });
    }, { timezone: job.timezone });
  }

  console.log('[forecastScheduler] Registered forecast jobs — daily 9:00 AM and weekly Monday 9:00 AM (Asia/Manila).');
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

module.exports = { registerForecastJobs, runScheduledForecast, getSchedulerStatus };
