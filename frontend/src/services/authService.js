// src/services/authService.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const authService = {
  // Register user
  register: async (userData) => {
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: userData.fullName,
          email: userData.email,
          password: userData.password,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // Store session data if login after registration
      if (data.session) {
        localStorage.setItem('supabase_session', JSON.stringify(data.session));
        localStorage.setItem('user', JSON.stringify(data.user));
      }

      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Login user
  login: async (email, password, rememberMe = false) => {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Store session
      if (data.session) {
        if (rememberMe) {
          localStorage.setItem('supabase_session', JSON.stringify(data.session));
        } else {
          sessionStorage.setItem('supabase_session', JSON.stringify(data.session));
        }
        localStorage.setItem('user', JSON.stringify(data.user));
      }

      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  logout: async () => {
    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Logout failed');
      }

      localStorage.removeItem('supabase_session');
      localStorage.removeItem('user');
      sessionStorage.removeItem('supabase_session');

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getCurrentUser: async () => {
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Not authenticated');
      }

      return { success: true, user: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  isAuthenticated: () => {
    const session = localStorage.getItem('supabase_session') || 
                   sessionStorage.getItem('supabase_session');
    return !!session;
  },

  getStoredUser: () => {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },
};