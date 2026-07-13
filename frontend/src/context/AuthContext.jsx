// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasUploadedData, setHasUploadedData] = useState(false);
  const [checkingUpload, setCheckingUpload] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

  const checkUploadStatus = async () => {
    setCheckingUpload(true);
    try {
      // ✅ Get token from Supabase session (localStorage)
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        setHasUploadedData(false);
        return false;
      }
      
      const res = await fetch(`${API_URL}/uploads/status/check`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      const hasUploaded = !!data.hasUploaded;
      setHasUploadedData(hasUploaded);
      return hasUploaded;
    } catch (err) {
      console.error('checkUploadStatus failed:', err);
      setHasUploadedData(false);
      return false;
    } finally {
      setCheckingUpload(false);
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      console.log('Checking authentication on app load...');

      try {
        // ✅ Supabase automatically reads from localStorage
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          // ✅ Get user from Supabase Auth
          const userData = session.user;
          
          // ✅ Try to get additional user data from custom users table
          const { data: customUser } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', userData.id)
            .single();
          
          // ✅ Combine Supabase user with custom data
          const finalUser = customUser || userData;
          setUser(finalUser);
          console.log('User authenticated:', finalUser);
          
          await checkUploadStatus();
        } else {
          console.log('No stored session found');
          setUser(null);
          setHasUploadedData(false);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        setUser(null);
        setHasUploadedData(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // ✅ Listen for auth changes from Supabase
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event);
        
        if (session?.user) {
          const userData = session.user;
          const { data: customUser } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', userData.id)
            .single();
          
          setUser(customUser || userData);
          await checkUploadStatus();
        } else {
          setUser(null);
          setHasUploadedData(false);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ============================================
  // REGISTER (Custom OTP flow)
  // ============================================
  const register = async (userData) => {
    setLoading(true);
    setError(null);
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
      console.log('Register response:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      if (data.requiresVerification) {
        return {
          success: true,
          requiresVerification: true,
          email: data.email || userData.email
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // VERIFY EMAIL (Custom OTP)
  // ============================================
  const verifyEmail = async (email, otp) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      
      const data = await response.json();
      console.log('Verify email response:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      // ✅ Supabase automatically stores session in localStorage
      // No need to manually store anything!
      
      setUser(data.user);
      return { success: true, user: data.user };
    } catch (error) {
      console.error('Verify email error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // RESEND OTP
  // ============================================
  const resendOTP = async (email) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend OTP');
      }

      return { success: true };
    } catch (error) {
      console.error('Resend OTP error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // LOGIN (Supabase Auth)
  // ============================================
  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      // ✅ Use Supabase Auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          return {
            success: false,
            error: 'Please verify your email before logging in',
            requiresVerification: true,
            email: email
          };
        }
        throw error;
      }

      // ✅ Supabase automatically stores session in localStorage
      // No manual storage needed!

      // Get custom user data
      const { data: customUser } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', data.user.id)
        .single();

      const finalUser = customUser || data.user;
      setUser(finalUser);
      
      await checkUploadStatus();
      
      return { 
        success: true, 
        user: finalUser,
        session: data.session
      };
    } catch (error) {
      console.error('Login error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // LOGOUT (Supabase Auth)
  // ============================================
  const logout = async () => {
    setLoading(true);
    try {
      // ✅ Supabase automatically clears localStorage
      await supabase.auth.signOut();
      
      setUser(null);
      setHasUploadedData(false);
      console.log('User logged out');
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // HELPER: Get current token
  // ============================================
  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  };

  // ============================================
  // VALUE
  // ============================================
  const value = {
    user,
    loading,
    error,
    login,
    register,
    verifyEmail,
    resendOTP,
    logout,
    getToken,
    setUser,
    isAuthenticated: !!user,
    hasUploadedData,
    checkingUpload,
    checkUploadStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};