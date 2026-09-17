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

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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
const auditRoutes = require('./routes/audit');

const app = express();
const PORT = process.env.PORT || 5000;

// Render (and most PaaS hosts) sit behind a reverse proxy, so req.ip would
// otherwise resolve to the proxy's address, not the real client — this
// breaks express-rate-limit's per-IP keying. Trust exactly one hop.
app.set('trust proxy', 1);

// ============= SECURITY MIDDLEWARE =============+++++

// Helmet - Secure HTTP headers
app.use(helmet());

// CORS - Configured for security
// ALLOWED_ORIGINS is a comma-separated list of exact origins (the prod
// domain, local dev). Falls back to the local Vite dev server.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Vercel gives every preview deployment its own unique hashed subdomain
// (e.g. demand-forecasting-system-<hash>-<team>.vercel.app), so a static
// ALLOWED_ORIGINS entry can never match them. Allow any preview URL for
// THIS project specifically, rather than any *.vercel.app site.
const vercelPreviewPattern = /^https:\/\/demand-forecasting-system-[a-z0-9]+-[a-z0-9]+\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    // Same-origin / non-browser requests (curl, server-to-server) send no origin.
    if (!origin || allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate Limiting - Prevent brute force attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  }
});
app.use('/api', limiter);

// Body parsers with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============= LOGGING =============
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

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
// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  const response = {
    success: false,
    error: status === 500 && process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : message
  };

  res.status(status).json(response);
});

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
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Promise Rejection:', reason);
});

// uncaughtException: a thrown error outside any promise/async context is a
// different, more dangerous situation — Node's own docs say the process's
// internal state can no longer be trusted at that point, so the safe move
// is to log it and exit (not "keep serving requests from a possibly-corrupt
// process"). In production this needs a process manager (pm2, systemd,
// Docker's restart policy) to bring it back up; in local dev, nodemon will
// pick this up as an exit and restart on the next file save same as before.
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;