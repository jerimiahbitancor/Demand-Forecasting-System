const { supabase } = require('../config/supabase');

/**
 * Middleware to authenticate requests using Supabase JWT
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Please login first.'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      if (error?.message?.includes('expired')) {
        return res.status(401).json({
          success: false,
          error: 'Token expired. Please login again.'
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid token. Please login again.'
      });
    }

    // Get user from custom users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('Error fetching user data:', userError);
    }

    // Attach user to request
    req.user = userData || user;
    req.authUser = user;
    req.token = token;

    console.log('✅ User authenticated:', req.user.email || req.user.id);
    next();

  } catch (error) {
    console.error('❌ Auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

module.exports = authenticate;