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

  const syncUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        console.log('No token available for sync');
        return null;
      }

      const response = await fetch(`${API_URL}/auth/sync-user`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.error('Sync user failed:', response.status);
        return null;
      }

      const data = await response.json();
      if (data.success) {
        return data.user;
      }
      return null;
    } catch (error) {
      console.error('Sync user error:', error);
      return null;
    }
  };

  const checkUploadStatus = async () => {
    setCheckingUpload(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        setHasUploadedData(false);
        return false;
      }
      
      let res = await fetch(`${API_URL}/upload/status/check`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.status === 404) {
        res = await fetch(`${API_URL}/uploads/status/check`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      
      if (res.status === 404 || res.status === 401) {
        setHasUploadedData(false);
        return false;
      }
      
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
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          const userData = session.user;
          setUser(userData);
          console.log('User authenticated:', userData.email);
          
          // Sync user with custom table
          await syncUser();
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event);
        
        if (session?.user) {
          const userData = session.user;
          setUser(userData);
          if (event === 'SIGNED_IN') {
            await syncUser();
            await checkUploadStatus();
          }
        } else {
          setUser(null);
          setHasUploadedData(false);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const register = async (userData) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: userData.email,
        password: userData.password,
        options: {
          data: {
            full_name: userData.fullName,
          },
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      console.log('Register response:', data);

      if (data.user && !data.session) {
        return {
          success: true,
          requiresVerification: true,
          email: userData.email
        };
      }

      setUser(data.user);
      await syncUser();
      return { 
        success: true, 
        user: data.user,
        session: data.session
      };
    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const verifyEmail = async (email, otp) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'signup',
      });

      if (error) {
        throw new Error(error.message);
      }

      setUser(data.user);
      await syncUser();
      return { success: true, user: data.user };
    } catch (error) {
      console.error('Verify email error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const resendOTP = async (email) => {
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
      });

      if (error) {
        throw new Error(error.message);
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

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
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

      setUser(data.user);
      await syncUser();
      await checkUploadStatus();
      
      return { 
        success: true, 
        user: data.user,
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

  const logout = async () => {
    setLoading(true);
    try {
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

  const resetPassword = async (email) => {
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        throw new Error(error.message);
      }

      return { success: true };
    } catch (error) {
      console.error('Reset password error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async (newPassword) => {
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        throw new Error(error.message);
      }

      return { success: true };
    } catch (error) {
      console.error('Update password error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const getToken = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  };

  const getCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  };

  const value = {
    user,
    loading,
    error,
    login,
    register,
    verifyEmail,
    resendOTP,
    logout,
    resetPassword,
    updatePassword,
    getToken,
    getCurrentUser,
    setUser,
    syncUser,
    isAuthenticated: !!user,
    hasUploadedData,
    checkingUpload,
    checkUploadStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};