// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
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
const marketPriceRoutes = require('./routes/marketPrice');
const auditRoutes = require('./routes/audit');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// ============= SECURITY MIDDLEWARE =============

// Helmet - Secure HTTP headers
app.use(helmet());

// CORS - Configured for security
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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