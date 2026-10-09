// backend/jobs/dailyPriceImportJob.js
//
// Cron-driven daily import of the DA "Daily Price Index" sheet (Bantay
// Presyo) into the market_price table via services/daPriceImportService.js.
//
// Schedule: every day 4:00 PM Asia/Manila by default — after the DA's
// afternoon release, and safely past the forecast job's 9:00 AM slot
// (jobs/forecastScheduler.js). Override with the DA_PRICE_IMPORT_CRON env var
// (a standard node-cron expression); disable entirely with
// DA_PRICE_IMPORT_ENABLED=false.
//
// The run is deliberately self-limiting: it imports one sheet per day and
// skips outright when that sheet's date is already in market_price (see
// alreadyImportedForDate), so a restart or a late release can never append
// the same day's prices twice.
const cron = require('node-cron');
const { runDailyPriceImport } = require('../services/daPriceImportService');
const { createNotification } = require('../services/notificationService');
const { supabaseAdmin } = require('../config/supabase');

const PH_TZ = 'Asia/Manila';

// One every-day cron, since the importer only ever fetches the newest sheet.
// Env can rescope it (e.g. "0 20 * * 1-5" for weekdays only).
const DEFAULT_CRON = '0 16 * * *';

// Behave exactly like forecastScheduler's jobs list: this is what
// getDailyPriceImportStatus() reports as "scheduled", so callers can see the
// real schedule in one place.
const JOBS = [{ name: 'daily', cron: process.env.DA_PRICE_IMPORT_CRON || DEFAULT_CRON, timezone: PH_TZ }];

const MAX_KEPT_RUNS = 20;
// Runs are appended over the process lifetime; the oldest fall off so /api/status
// never grows without bound.
const lastRuns = [];

const isEnabled = () => process.env.DA_PRICE_IMPORT_ENABLED !== 'false';

// Mirror the forecastScheduler "notify every row in `user`" pattern — a
// single-owner system today, but the loop makes no assumption about that.
async function notifyAllUsers({ type, title, message, metadata }) {
  const { data: users, error } = await supabaseAdmin.from('user').select('id');
  if (error) {
    console.error('[dailyPriceImport] Could not load users to notify:', error);
    return;
  }
  for (const user of users || []) {
    await createNotification({ userId: user.id, type, title, message, link: '/inventory-management', metadata });
  }
}

async function runDailyPriceJob() {
  const now = () => new Date().toISOString();
  const run = { startedAt: now(), status: 'running' };

  if (!isEnabled()) {
    Object.assign(run, { status: 'disabled', finishedAt: now(), reason: 'DA_PRICE_IMPORT_ENABLED=false' });
    lastRuns.push(run);
    return run;
  }

  try {
    const report = await runDailyPriceImport();
    Object.assign(run, report, { finishedAt: now() });
    lastRuns.push(run);
    if (lastRuns.length > MAX_KEPT_RUNS) lastRuns.shift();

    const prefix = report.sheetDate ? `DA price import ${report.sheetDate}` : 'DA price import';

    switch (report.status) {
      case 'succeeded':
        console.log(`[dailyPriceImport] ${prefix} — ${report.saved} price(s) saved for ${report.matched} ingredient(s) from ${report.matchedCommodities} matched commodity(ies), ${report.lowConfidenceCount} below-confidence skipped, ${report.unavailable} n/a.`);
        await notifyAllUsers({
          type: 'success',
          title: 'Daily DA price index imported',
          message: `Matched ${report.matchedCommodities} commodity(ies) from the DA sheet (${report.sheetDate}) — ${report.saved} ingredient price(s) recorded for the day-over-day trend.`,
          metadata: { kind: 'market_price', source: 'da_reference', status: 'completed', sheet_date: report.sheetDate, saved: report.saved, matched: report.matched, matched_commodities: report.matchedCommodities },
        });
        break;
      case 'skipped':
        console.log(`[dailyPriceImport] ${prefix} — ${report.reason || 'nothing new to import'}.`);
        break;
      case 'no_match':
        console.log(`[dailyPriceImport] ${prefix} — parsed ${report.recordsParsed} commodity(ies), none cleared the confidence bar for the current inventory.`);
        break;
      default:
        console.log(`[dailyPriceImport] ${prefix} — ${report.error || report.status}.`);
    }
  } catch (error) {
    Object.assign(run, {
      status: 'failed',
      finishedAt: now(),
      error: String((error && error.message) || error || 'unknown error').slice(0, 300),
    });
    lastRuns.push(run);
    if (lastRuns.length > MAX_KEPT_RUNS) lastRuns.shift();
    console.error('[dailyPriceImport] Job failed:', error);
    await notifyAllUsers({
      type: 'error',
      title: 'Daily DA price import failed',
      message: `The scheduled DA price import failed — ${(error && error.message) || 'check backend logs.'}`,
      metadata: { kind: 'market_price', source: 'da_reference', status: 'failed', scheduled: true },
    });
  }

  return run;
}

let registered = false;
function registerDailyPriceImportJob() {
  if (registered) return;
  cron.schedule(
    JOBS[0].cron,
    () => {
      runDailyPriceJob();
    },
    { timezone: JOBS[0].timezone }
  );
  registered = true;
  console.log(
    `[dailyPriceImport] Registered DA price import job — ${JOBS[0].cron} (${JOBS[0].timezone})` +
      (isEnabled() ? '.' : ' but disabled (DA_PRICE_IMPORT_ENABLED=false).')
  );
}

// For /api/status — workhorse mirrors forecastScheduler.getSchedulerStatus().
function getDailyPriceImportStatus() {
  return {
    enabled: isEnabled(),
    cron: JOBS[0].cron,
    timezone: JOBS[0].timezone,
    lastRuns: lastRuns.map((run) => ({ ...run })),
  };
}

module.exports = { registerDailyPriceImportJob, runDailyPriceJob, getDailyPriceImportStatus, JOBS };