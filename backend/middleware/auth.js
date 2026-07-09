// middleware/auth.js
const jwt = require('jsonwebtoken');
const { supabase, isConfigured } = require('../config/supabase');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('⚠️ No token provided');
      return res.status(401).json({ 
        success: false,
        error: 'No token provided. Please login first.' 
      });
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
      
      // Set user from token (ensure id is a number)
      req.user = {
        id: parseInt(decoded.id) || decoded.id,
        email: decoded.email
      };

      // If Supabase is configured, get full user data
      if (isConfigured && supabase) {
        const { data: user, error } = await supabase
          .from('users')
          .select('id, email, name, created_at')
          .eq('id', req.user.id)
          .single();

        if (!error && user) {
          req.user = user;
        }
      }

      console.log('✅ User authenticated:', req.user.id, req.user.email);
      next();
      
    } catch (jwtError) {
      if (jwtError.name === 'JsonWebTokenError') {
        console.warn('⚠️ Invalid token:', jwtError.message);
        return res.status(401).json({ 
          success: false,
          error: 'Invalid token. Please login again.' 
        });
      }
      if (jwtError.name === 'TokenExpiredError') {
        console.warn('⚠️ Token expired');
        return res.status(401).json({ 
          success: false,
          error: 'Token expired. Please login again.' 
        });
      }
      throw jwtError;
    }
  } catch (error) {
    console.error('❌ Auth error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Authentication failed' 
    });
  }
};

module.exports = authenticate;