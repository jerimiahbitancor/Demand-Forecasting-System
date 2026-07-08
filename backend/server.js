// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

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
    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    
    res.json({ 
      message: 'Supabase connection successful',
      userCount: count || 0
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
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      users: 'GET /api/users',
      user: 'GET /api/users/:id',
      update: 'PUT /api/auth/update/:id',
      changePassword: 'PUT /api/auth/change-password/:id',
      health: 'GET /api/health',
      test: 'GET /api/test-supabase'
    }
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});