// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

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

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/mapping', mappingRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Test Supabase connection
app.get('/api/test-supabase', async (req, res) => {
  try {
    const { supabase, isConfigured } = require('./config/supabase');
    
    if (!isConfigured) {
      return res.status(500).json({ 
        success: false,
        error: 'Supabase not configured',
        details: 'Missing credentials in .env file'
      });
    }

    // Test uploads table
    const { data: uploadsData, error: uploadsError } = await supabase
      .from('uploads')
      .select('*', { count: 'exact', head: true });
    
    if (uploadsError) throw uploadsError;

    // Test products table
    const { data: productsData, error: productsError } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });
    
    if (productsError) throw productsError;

    // Test ingredients table
    const { data: ingredientsData, error: ingredientsError } = await supabase
      .from('ingredients')
      .select('*', { count: 'exact', head: true });
    
    if (ingredientsError) throw ingredientsError;
    
    res.json({ 
      success: true,
      message: '✅ Supabase connection successful',
      data: {
        uploadsCount: uploadsData?.length || 0,
        productsCount: productsData?.length || 0,
        ingredientsCount: ingredientsData?.length || 0,
        isConfigured: true
      }
    });
  } catch (error) {
    console.error('Supabase test error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Supabase connection failed',
      details: error.message
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Sales Forecasting API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        update: 'PUT /api/auth/update/:id',
        changePassword: 'PUT /api/auth/change-password/:id'
      },
      users: {
        getAll: 'GET /api/users',
        getOne: 'GET /api/users/:id'
      },
      uploads: {
        upload: 'POST /api/upload (multipart/form-data)',
        getAll: 'GET /api/uploads',
        getOne: 'GET /api/uploads/:id',
        updateStatus: 'PATCH /api/uploads/:id/status',
        delete: 'DELETE /api/uploads/:id',
        stats: 'GET /api/uploads/stats/summary'
      },
      mapping: {
        getProducts: 'GET /api/mapping/products',
        getProduct: 'GET /api/mapping/products/:id',
        createProduct: 'POST /api/mapping/products',
        updateProduct: 'PUT /api/mapping/products/:id',
        deleteProduct: 'DELETE /api/mapping/products/:id',
        getCategories: 'GET /api/mapping/categories'
      },
      health: 'GET /api/health',
      testSupabase: 'GET /api/test-supabase'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  
  // Handle specific error types
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ 
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({ 
      success: false,
      error: 'Validation Error',
      message: err.message,
      details: err.details || null
    });
  }

  // Multer errors
  if (err.name === 'MulterError') {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        message: 'File size exceeds the 20MB limit'
      });
    }
    return res.status(400).json({
      success: false,
      error: 'Upload Error',
      message: err.message
    });
  }

  // Default error response
  res.status(err.status || 500).json({ 
    success: false,
    error: err.message || 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.stack : 'Something went wrong'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  app.close(() => {
    console.log('HTTP server closed');
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

});

module.exports = app;