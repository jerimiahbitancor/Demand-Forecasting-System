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

// Asia/Manila is UTC+8 with no DST, so the local date is a fixed offset away.
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

// One every-day cron, since the importer only ever fetches the newest sheet.
// Env can rescope it (e.g. "0 20 * * 1-5" for weekdays only).
const DEFAULT_CRON = '0 16 * * *';

// On boot, wait this long before the catch-up attempt so the daily schedule
// and startup work (DB warm-up, etc.) settle first. The catch-up itself is the
// reliability backstop: a redeploy/restart that lands on or after the cron
// time would otherwise silently skip the whole day, since the scheduler only
// fires while the process is alive.
const STARTUP_CATCHUP_DELAY_MS = 20 * 1000;

// Philippine calendar date (YYYY-MM-DD) for a given instant.
const phDateStr = (date = new Date()) => new Date(date.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);

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

// Any automated da_reference row already recorded for the given PH date means
// that day's import has happened (the importer stores the sheet's date in
// scraped_at). Used only by the startup catch-up to decide whether there is
// anything to do, so a healthy restart never re-fetches the DA page.
async function importedForPhDate(dateStr) {
  const { data, error } = await supabaseAdmin
    .from('market_price')
    .select('id')
    .eq('source', 'da_reference')
    .eq('is_manual_entry', false)
    .gte('scraped_at', `${dateStr}T00:00:00`)
    .lte('scraped_at', `${dateStr}T23:59:59`)
    .limit(1);
  if (error) {
    // Fail open: if we cannot tell, still attempt the import — the service is
    // idempotent per sheet date, so the worst case is a redundant fetch.
    console.error('[dailyPriceImport] Catch-up guard query failed:', error);
    return false;
  }
  return Boolean(data && data.length);
}

// Runs once at startup, after a short delay, to recover the day's import when
// the process was down at the scheduled cron time (typical with redeploys).
// Skips when the current PH day is already imported; the service's own
// per-sheet-date guard makes a redundant run harmless.
async function runDailyPriceJobIfMissed() {
  if (!isEnabled()) return { status: 'disabled' };

  const today = phDateStr();
  if (await importedForPhDate(today)) {
    console.log(`[dailyPriceImport] Catch-up skipped — already imported for ${today}.`);
    return { status: 'skipped', reason: `already imported for ${today}` };
  }

  console.log(`[dailyPriceImport] Catch-up run for ${today} (scheduled run may have been missed).`);
  return runDailyPriceJob();
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
  // Startup catch-up: recover a day whose scheduled run was missed because the
  // process was not running at the cron time.
  setTimeout(() => {
    runDailyPriceJobIfMissed().catch((error) => {
      console.error('[dailyPriceImport] Startup catch-up failed:', error);
    });
  }, STARTUP_CATCHUP_DELAY_MS).unref?.();
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

module.exports = { registerDailyPriceImportJob, runDailyPriceJob, runDailyPriceJobIfMissed, getDailyPriceImportStatus, JOBS };