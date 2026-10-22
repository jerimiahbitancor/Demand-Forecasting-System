// server.js
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables FIRST, before any route/service module is
// required below — several of those modules read process.env at their own
// top level (e.g. config/supabase.js). This worked by accident before
// because config/supabase.js happened to call its own dotenv.config()
// early enough in the require chain, but any module that reads env vars
// without going through that file first would have silently gotten
// undefined values. Loading env here removes that ordering dependency.
dotenv.config({ path: path.join(__dirname, '.env') });

// NETWORK: give each Supabase address enough time to connect.
//
// Node 20+ tries every address a hostname resolves to ("happy eyeballs") and
// gives each one only 250 ms before moving on. Measured on the dev network
// (Oct 1 2026): Supabase's IPv4 addresses took 0.9-2.7 s to connect and its
// IPv6 addresses were unreachable. So every attempt failed, and requests died
// with "TypeError: fetch failed ... AggregateError [ETIMEDOUT]" — first in the
// auth middleware (fetching Supabase's signing keys), then anywhere else.
// In a 12-fetch test: 5 of 6 failed at 250 ms, 6 of 6 succeeded at 5000 ms.
//
// This only changes how long ONE address may take before Node tries the
// next. It does not slow down a healthy network: a fast connect still
// returns as soon as it succeeds. Must run before anything opens a socket,
// which is why it sits right after env loading. Override with
// NETWORK_ATTEMPT_TIMEOUT_MS if a slower network ever needs more.
const net = require('net');
net.setDefaultAutoSelectFamilyAttemptTimeout(
  Number(process.env.NETWORK_ATTEMPT_TIMEOUT_MS) || 5000
);

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const mappingRoutes = require('./routes/mapping');
const settingsRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const inventoryRoutes = require('./routes/inventory');
const categoriesRoutes = require('./routes/categories');
const unitsRoutes = require('./routes/units');
const productCategoriesRoutes = require('./routes/productCategories');
const businessDaysRoutes = require('./routes/businessDays');
const productsRoutes = require('./routes/products');
const mlRoutes = require('./routes/ml');
const analyticsRoutes = require('./routes/analytics');
const forecastSummaryRoutes = require('./routes/forecastSummary');
const marketPriceRoutes = require('./routes/marketPrice');
// Receipt-OCR routes live separately from marketPrice.js (the comparison/
// manual-entry module) but share the same URL prefix — Express falls through
// the first router when no route matches.
const marketPricesReceiptRoutes = require('./routes/marketPrices');
const auditRoutes = require('./routes/audit');
const statusRoutes = require('./routes/status');
const jobsRoutes = require('./routes/jobs');

const app = express();
const PORT = process.env.PORT || 5000;

// Render (and most PaaS hosts) sit behind a reverse proxy, so req.ip would
// otherwise resolve to the proxy's address, not the real client — this
// breaks express-rate-limit's per-IP keying. Trust exactly one hop.
app.set('trust proxy', 1);

// Request ID + one JSON access-log line per request. First, so every later
// middleware (and any error it raises) runs with the ID available.
const requestContext = require('./middleware/requestContext');
app.use(requestContext);

// ============= SECURITY MIDDLEWARE =============+++++

// Helmet - Secure HTTP headers
app.use(helmet());

// CORS - Configured for security. Origins, the Vercel preview pattern and
// the allowed headers live in middleware/corsConfig.js.
const { createCorsOptions } = require('./middleware/corsConfig');
app.use(cors(createCorsOptions()));

// Rate Limiting - a strict limit on the OTP/password endpoints (brute-force
// targets) and a generous one for all other /api traffic, so normal use
// (dashboard polling) can't lock the owner out. See middleware/rateLimits.js.
const { createAuthLimiter, createApiLimiter } = require('./middleware/rateLimits');
app.use('/api', createAuthLimiter());
app.use('/api', createApiLimiter());

// Body parsers with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global audit trail — logs every non-GET request (except routes that
// already write their own detailed audit entries).
const auditTrail = require('./middleware/auditTrail');
app.use('/api', auditTrail);

// ============= ROUTES =============
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/mapping', mappingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/units', unitsRoutes);
app.use('/api/product-categories', productCategoriesRoutes);
app.use('/api/business-days', businessDaysRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/forecast', forecastSummaryRoutes);
app.use('/api/market-prices', marketPriceRoutes);
app.use('/api/market-prices', marketPricesReceiptRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/status', statusRoutes);
// Outside clock (cron-job.org) for the 4:00 / 7:00 AM reminders. Secret
// header, no JWT; 404 unless JOB_TRIGGER_SECRET is set. See routes/jobs.js.
app.use('/api/jobs', jobsRoutes);

// ============= HEALTH CHECK =============
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// ============= ROOT =============
app.get('/', (req, res) => {
  res.json({ 
    name: 'Demand Forecasting API',
    version: '1.0.0',
    status: 'running'
  });
});

// ============= ERROR HANDLING =============
// 404 handler + global error handler (see middleware/errorHandlers.js).
// Both include the request ID in the response body.
const { notFoundHandler, errorHandler } = require('./middleware/errorHandlers');
app.use(notFoundHandler);
app.use(errorHandler);

// ============= CRASH SAFETY NET =============
// Express 4 does NOT catch a rejected promise returned from an async route
// handler or from any "fire and forget" call (one not awaited and without
// its own .catch()) — Node then treats it as an unhandled rejection, and
// Node's default behavior (since v15) is to crash the ENTIRE process. With
// no handler here, that means one bad request, anywhere across every
// route/controller/service in this app, takes the whole server down for
// every user — not just the request that triggered it. And since nodemon
// does not auto-restart after a crash (it waits for a file save), the
// server then stays dead until someone notices and restarts it by hand,
// which is what made unrelated failures (notifications, dashboard, stats)
// look like they were "spreading" — they were really just victims of one
// unrelated promise crashing the process out from under them.
//
// unhandledRejection: log and keep running. The failed request/operation
// is already broken either way; killing every OTHER in-flight request too
// is strictly worse. This is a safety net for bugs we haven't found yet —
// it is not a substitute for fixing a missing try/catch or .catch() once
// the log below points at one.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { err: reason });
});

// uncaughtException: a thrown error outside any promise/async context is a
// different, more dangerous situation — Node's own docs say the process's
// internal state can no longer be trusted at that point, so the safe move
// is to log it and exit (not "keep serving requests from a possibly-corrupt
// process"). In production this needs a process manager (pm2, systemd,
// Docker's restart policy) to bring it back up; in local dev, nodemon will
// pick this up as an exit and restart on the next file save same as before.
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { err });
  process.exit(1);
});

// ============= START SERVER =============
// Warm recipe-unit conversion metadata (family, base factor, piece weights)
// from the ingredient_units table so COGS, demand, and stock-deduction math
// uses database-driven units instead of only the hardcoded fallbacks.
const { supabaseAdmin } = require('./config/supabase');
const { loadUnitMetadataFromDb } = require('./utils/recipeUnits');
setTimeout(() => loadUnitMetadataFromDb(supabaseAdmin).catch(() => {}), 1000);

// Timed jobs. SCHEDULERS_ENABLED (utils/featureFlags.js) defaults to on only
// when NODE_ENV=production: a local "npm run dev" points at the LIVE
// database and must never send reminders or run forecasts by itself.
const { schedulersEnabled } = require('./utils/featureFlags');
const { describeBootFlags, bootFlagWarnings, bootFlagLine } = require('./utils/bootFlags');

// One line with the effective switches (never a key). A warning when this
// server runs the timed jobs, so a second server doing the same (an old
// Railway service next to Render) is easy to spot in both logs.
const bootFlags = describeBootFlags();
if (bootFlags.schedulersEnabled) {
  logger.warn('boot_flags', { line: bootFlagLine(bootFlags), ...bootFlags, warnings: bootFlagWarnings(bootFlags),
    note: 'This server runs the timed jobs. Only ONE server may have SCHEDULERS_ENABLED=true.' });
} else {
  logger.info('boot_flags', { line: bootFlagLine(bootFlags), ...bootFlags });
}

if (schedulersEnabled()) {
  const { refreshLowStockNotifications } = require('./services/notificationService');

  // Keep the notification bell in sync with inventory levels: refresh shortly
  // after boot, then every 6 hours. New low-stock ingredients get alerts and
  // recovered ingredients get their alerts retired automatically.
  const LOW_STOCK_REFRESH_MS = 6 * 60 * 60 * 1000;
  // Also runs after every forecast and upload (queueStockRefresh); this
  // timer is the fallback.
  setTimeout(() => refreshLowStockNotifications({ trigger: 'boot' }).catch(() => {}), 15000);
  setInterval(() => refreshLowStockNotifications({ trigger: 'timer' }).catch(() => {}), LOW_STOCK_REFRESH_MS);

  // Real scheduled forecast refresh (daily 9:00 AM except Monday, weekly
  // Monday 9:00 AM — Monday runs the weekly forecast only — both Asia/Manila) — see jobs/forecastScheduler.js for why this calls
  // mlService.forecast() directly instead of training auto-triggering it.
  const { registerForecastJobs, runForecastBootCatchUp } = require('./jobs/forecastScheduler');
  registerForecastJobs();
  // Boot catch-up: after 9:00 AM Manila, if forecast_runs has no run since
  // 9:00 today, run today's forecast once (see jobs/forecastScheduler.js).
  setTimeout(() => {
    runForecastBootCatchUp().catch((err) => logger.error('forecast_catchup_failed', { err }));
  }, 25000);

  // Daily automated DA "Daily Price Index" import (default 4:00 PM Asia/Manila;
  // see jobs/dailyPriceImportJob.js). Writes matched prices for current
  // inventory ingredients under the da_reference source. Disable entirely with
  // DA_PRICE_IMPORT_ENABLED=false.
  const { registerDailyPriceImportJob } = require('./jobs/dailyPriceImportJob');
  registerDailyPriceImportJob();

  // Upload reminders, 4:00 AM and 7:00 AM Asia/Manila: yesterday's sales not
  // uploaded and not marked closed -> notification (see jobs/uploadReminderJob.js).
  const { registerUploadReminderJobs, runBootCatchUp } = require('./jobs/uploadReminderJob');
  registerUploadReminderJobs();

  // Boot catch-up: a sleeping instance misses its cron. If 04:00 / 07:00
  // has passed today and that slot has no run record, run it once now.
  setTimeout(() => {
    runBootCatchUp().catch((err) => logger.error('upload_reminder_catchup_failed', { err }));
  }, 20000);

  // Is a business email saved? Masked; read-only.
  setTimeout(async () => {
    try {
      const { isValidEmail, maskEmail } = require('./services/emailService');
      const { data } = await supabaseAdmin.from('business_profile').select('business_email').limit(1);
      const email = data && data[0] && typeof data[0].business_email === 'string' ? data[0].business_email.trim() : '';
      if (isValidEmail(email)) logger.info('boot_business_email', { saved: true, to: maskEmail(email) });
      else logger.warn('boot_business_email', { saved: false, reason: email ? 'invalid' : 'missing' });
    } catch (err) {
      logger.warn('boot_business_email', { saved: null, err });
    }
  }, 5000);
} else {
  console.log('[schedulers] SCHEDULERS_ENABLED is off: forecast, upload reminder, DA price import and low-stock jobs are NOT registered.');
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;