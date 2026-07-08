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
const uploadsRoutes = require('./routes/uploads');
const mappingRoutes = require('./routes/mapping');

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
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

// ============= ROUTES =============
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/mapping', mappingRoutes);

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
    name: 'Sales Forecasting API',
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
  
  // Handle specific errors
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  // Don't expose internal errors in production
  const response = {
    success: false,
    error: status === 500 && process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : message
  };

  res.status(status).json(response);
});

// ============= START SERVER =============
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;