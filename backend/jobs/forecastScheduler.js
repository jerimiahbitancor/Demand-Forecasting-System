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

  try {
    const result = await mlService.forecast({ horizonDays, runType });
    const forecastedCount = (result?.results || []).filter((r) => r.status === 'forecasted').length;
    const skippedCount = (result?.results || []).filter((r) => r.status === 'skipped').length;

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
  // Daily refresh — every day at 9:00 AM Asia/Manila.
  cron.schedule('0 9 * * *', () => {
    runScheduledForecast({ horizonDays: 1, runType: 'daily' });
  }, { timezone: PH_TZ });

  // Weekly 7-day refresh — Monday at 9:00 AM Asia/Manila.
  cron.schedule('0 9 * * 1', () => {
    runScheduledForecast({ horizonDays: 7, runType: 'weekly' });
  }, { timezone: PH_TZ });

  console.log('[forecastScheduler] Registered forecast jobs — daily 9:00 AM and weekly Monday 9:00 AM (Asia/Manila).');
}

module.exports = { registerForecastJobs, runScheduledForecast };
