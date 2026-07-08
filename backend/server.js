const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const uploadsRoutes = require('./routes/uploads');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/uploads', uploadsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Test Supabase connection
app.get('/api/test-supabase', async (req, res) => {
  try {
    const supabase = require('./config/supabase');
    const { data, error } = await supabase
      .from('uploads')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    
    res.json({ 
      message: 'Supabase connection successful',
      uploadsCount: data?.length || 0
    });
  } catch (error) {
    res.status(500).json({ 
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
        upload: 'POST /api/upload',
        getAll: 'GET /api/uploads',
        getOne: 'GET /api/uploads/:id',
        updateStatus: 'PATCH /api/uploads/:id/status',
        delete: 'DELETE /api/uploads/:id',
        stats: 'GET /api/uploads/stats/summary'
      },
      health: 'GET /api/health',
      testSupabase: 'GET /api/test-supabase'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Upload directory: ${path.join(__dirname, 'uploads')}`);
});

module.exports = app;