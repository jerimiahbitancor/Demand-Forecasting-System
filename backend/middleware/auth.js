const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      req.user = { id: 'local-user' };
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    
    if (!supabase) {
      req.user = { id: decoded.id };
      return next();
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = authenticate;