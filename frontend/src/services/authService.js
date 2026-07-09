// src/services/authService.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const authService = {
  // Helper to get token
  getToken: () => {
    const session = sessionStorage.getItem('supabase_session');
    if (!session) return null;
    try {
      const parsed = JSON.parse(session);
      return parsed.access_token || null;
    } catch {
      return null;
    }
  },

  // Helper to get auth headers
  getAuthHeaders: () => {
    const token = authService.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  register: async (userData) => {
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: userData.fullName,
          email: userData.email,
          password: userData.password,
        }),
      });
      const data = await response.json();

      console.log('Register response:', data); // Debug log

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      
      // Store session and user data
      if (data.session) {
        sessionStorage.setItem('supabase_session', JSON.stringify(data.session));
        sessionStorage.setItem('user', JSON.stringify(data.user));
        console.log('Session stored successfully:', data.session);
      }
      
      return { success: true, data };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  },

  login: async (email, password) => {
    try {
      console.log('Attempting login for:', email);
      
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await response.json();
      console.log('Login response received:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }
      
      // CRITICAL: Check if session exists and store it
      const session = data.session || (data.token ? { access_token: data.token, expires_at: data.expires_at } : null);

      if (session) {
        console.log('Session data:', session);
        console.log('Access token:', session.access_token);
        
        // Store the session
        sessionStorage.setItem('supabase_session', JSON.stringify(session));
        sessionStorage.setItem('user', JSON.stringify(data.user));
        
        // Verify it was stored
        const stored = sessionStorage.getItem('supabase_session');
        console.log('Stored session:', stored);
        
        return { success: true, data: { ...data, session } };
      } else {
        console.error('No session in response:', data);
        return { success: false, error: 'No session received from server' };
      }
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  },

  getCurrentUser: async () => {
    try {
      const token = authService.getToken();
      console.log('Current token for /me request:', token);
      
      if (!token) {
        throw new Error('No token found');
      }

      const response = await fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      
      const data = await response.json();
      console.log('Get current user response:', data);
      
      if (!response.ok) {
        throw new Error(data.error || 'Not authenticated');
      }
      
      return { success: true, user: data };
    } catch (error) {
      console.error('Get current user error:', error);
      return { success: false, error: error.message };
    }
  },

  logout: async () => {
    try {
      const token = authService.getToken();
      
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });
      
      // Clear storage regardless of response
      sessionStorage.removeItem('supabase_session');
      sessionStorage.removeItem('user');
      
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear storage even if API call fails
      sessionStorage.removeItem('supabase_session');
      sessionStorage.removeItem('user');
      return { success: false, error: error.message };
    }
  },

  isAuthenticated: () => {
    const session = sessionStorage.getItem('supabase_session');
    const user = sessionStorage.getItem('user');
    console.log('Checking auth - session exists:', !!session, 'user exists:', !!user);
    return !!session && !!user;
  },

  hasUser: async () => {
  try {
    const response = await fetch(`${API_URL}/auth/setup`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Setup check failed');
    }
    return { success: true, data };
  } catch (error) {
    console.error('hasUser check failed:', error);
    return { success: false, error: error.message };
  }
},

  getStoredUser: () => {
    const user = sessionStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },

  // authService.js
  validateToken: async () => {
    try {
      const token = authService.getToken();
      if (!token) return { valid: false, reason: 'no_token' };

      const response = await fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        return { valid: false, reason: 'unauthorized' };
      }
      if (!response.ok) {
        console.warn(`/auth/me returned ${response.status}, treating as network issue, not logging out`);
        return { valid: true, reason: 'network_error' };
      }

      return { valid: true, reason: 'ok' };
    } catch {
      return { valid: true, reason: 'network_error' };
    }
  }
};