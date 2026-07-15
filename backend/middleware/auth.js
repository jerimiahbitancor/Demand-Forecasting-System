// backend/middleware/auth.js
const { supabase } = require('../config/supabase');

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

    let customUser = null;
    let customUserId = null;
    
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (!userError && userData) {
        customUser = userData;
        customUserId = userData.id;
        console.log('Custom user found:', customUserId);
      } else {
        console.log('No custom user found for auth_id:', user.id);
      }
    } catch (err) {
      console.error('Error fetching custom user:', err);
    }

    req.user = {
      ...user,
      ...customUser,
      id: customUserId || user.id,
      auth_id: user.id,
      user_id: customUserId
    };
    req.authUser = user;
    // Attach the raw access token so downstream handlers can create
    // a user-scoped Supabase client (so RLS policies run in user context)
    req.accessToken = token;

    console.log('User authenticated:', req.user.email);
    console.log('User ID:', req.user.id);
    console.log('User user_id:', req.user.user_id);
    next();

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

module.exports = authenticate;