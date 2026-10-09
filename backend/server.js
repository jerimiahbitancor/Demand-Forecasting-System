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
const mlRoutes = require('./routes/ml');
const analyticsRoutes = require('./routes/analytics');
const forecastSummaryRoutes = require('./routes/forecastSummary');
const marketPriceRoutes = require('./routes/marketPrice');
// Receipt-OCR routes live separately from marketPrice.js (the manual-only
// module) but share the same URL prefix — Express falls through the first
// router when no route matches.
const marketPricesReceiptRoutes = require('./routes/marketPrices');
const auditRoutes = require('./routes/audit');

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
app.use('/api/ml', mlRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/forecast', forecastSummaryRoutes);
app.use('/api/market-prices', marketPriceRoutes);
app.use('/api/market-prices', marketPricesReceiptRoutes);
app.use('/api/audit', auditRoutes);

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
const { refreshLowStockNotifications } = require('./services/notificationService');

// Keep the notification bell in sync with inventory levels: refresh shortly
// after boot, then every 6 hours. New low-stock ingredients get alerts and
// recovered ingredients get their alerts retired automatically.
const LOW_STOCK_REFRESH_MS = 6 * 60 * 60 * 1000;
setTimeout(() => refreshLowStockNotifications().catch(() => {}), 15000);
setInterval(() => refreshLowStockNotifications().catch(() => {}), LOW_STOCK_REFRESH_MS);

// Warm recipe-unit conversion metadata (family, base factor, piece weights)
// from the ingredient_units table so COGS, demand, and stock-deduction math
// uses database-driven units instead of only the hardcoded fallbacks.
const { supabaseAdmin } = require('./config/supabase');
const { loadUnitMetadataFromDb } = require('./utils/recipeUnits');
setTimeout(() => loadUnitMetadataFromDb(supabaseAdmin).catch(() => {}), 1000);

// Real scheduled forecast refresh (daily 9:00 AM, weekly Monday 9:00 AM,
// both Asia/Manila) — see jobs/forecastScheduler.js for why this calls
// mlService.forecast() directly instead of training auto-triggering it.
const { registerForecastJobs } = require('./jobs/forecastScheduler');
registerForecastJobs();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;