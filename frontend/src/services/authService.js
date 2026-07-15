// src/services/authService.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
import { supabase } from '../config/supabase';

export const authService = {
  // Get token from Supabase
  getToken: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  },

  // Get auth headers
  getAuthHeaders: async () => {
    try {
      const token = await authService.getToken();
      if (token) return { Authorization: `Bearer ${token}` };
    } catch (e) {
      // ignore and fallback to sessionStorage
    }

    // Fallback: some components set token in sessionStorage for legacy reasons
    const fallback = sessionStorage.getItem('access_token') || sessionStorage.getItem('token');
    return fallback ? { Authorization: `Bearer ${fallback}` } : {};
  },

  // STEP 1: Register (NO PASSWORD!)
  register: async (userData) => {
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: userData.fullName,
          email: userData.email,
          terms: userData.terms || true
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Registration failed');
      return { 
        success: true, 
        requiresVerification: data.requiresVerification || false,
        userId: data.userId,
        email: data.email || userData.email
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // STEP 2: Verify OTP
  verifyOTP: async (email, otp, userId) => {
    try {
      const response = await fetch(`${API_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, userId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Verification failed');
      return { success: true, userId: data.userId, email: data.email };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // STEP 3: Create Password
  createPassword: async (userId, email, password) => {
    try {
      const response = await fetch(`${API_URL}/auth/create-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create password');
      return { success: true, session: data.session, user: data.user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Resend OTP
  resendOTP: async (email, userId) => {
    try {
      const response = await fetch(`${API_URL}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, userId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to resend OTP');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Login
  login: async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { success: true, user: data.user, session: data.session };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Logout
  logout: async () => {
    try {
      await supabase.auth.signOut();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Get current user
  getCurrentUser: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Not authenticated');
      return { success: true, user: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Check if authenticated
  isAuthenticated: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
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

  // Sync user with custom table
  syncUser: async () => {
    try {
      const token = await authService.getToken();
      if (!token) return null;
      const response = await fetch(`${API_URL}/auth/sync-user`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.user;
    } catch (error) {
      return null;
    }
  }
};