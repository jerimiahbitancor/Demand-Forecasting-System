// src/services/authService.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
import { supabase } from '../config/supabase';

export const authService = {
  // ✅ Get token from Supabase (localStorage)
  getToken: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  },

  // ✅ Get auth headers
  getAuthHeaders: async () => {
    const token = await authService.getToken();
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
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      return { 
        success: true, 
        requiresVerification: data.requiresVerification || false,
        email: data.email || userData.email,
        data 
      };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  },

  // ✅ Login - USE SUPABASE DIRECTLY (no backend call needed!)
  login: async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (error) throw error;
      // ✅ Supabase auto-stores in localStorage
      return { success: true, user: data.user, session: data.session };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  },

  getCurrentUser: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No session found');
      }
      const response = await fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      const data = await response.json();
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
      await supabase.auth.signOut();
      // ✅ Supabase auto-clears localStorage
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: error.message };
    }
  },

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

  getStoredUser: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user || null;
  },

  validateToken: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { valid: false, reason: 'no_token' };
      
      const response = await fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (response.status === 401) {
        return { valid: false, reason: 'unauthorized' };
      }
      if (!response.ok) {
        return { valid: true, reason: 'network_error' };
      }
      return { valid: true, reason: 'ok' };
    } catch {
      return { valid: true, reason: 'network_error' };
    }
  }
};