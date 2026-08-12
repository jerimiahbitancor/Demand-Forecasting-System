// frontend/src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';

const AuthContext = createContext();
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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

  // Registration flow state (stored in context + sessionStorage for refresh)
  const [registrationData, setRegistrationData] = useState(() => {
    const saved = sessionStorage.getItem('registration_data');
    return saved ? JSON.parse(saved) : {
      email: null,
      userId: null,
      otpVerified: false,
    };
  });

  // Sync user with custom table
  const syncUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) return null;

      const response = await fetch(`${API_URL}/auth/sync-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) return null;
      const data = await response.json();

      if (data.user) {
        setUser((prev) => ({
          ...prev,
          ...data.user,
        }));
        return data.user;
      }

      return null;
    } catch (error) {
      console.error('Sync user error:', error);
      return null;
    }
  };

  // Get current token
  const getToken = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  };

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setUser(session.user);
          // Persist token for other code paths that read sessionStorage
          try {
            if (session.access_token) {
              sessionStorage.setItem('access_token', session.access_token);
            }
            if (session.refresh_token) {
              sessionStorage.setItem('refresh_token', session.refresh_token);
            }
          } catch (e) {
            console.warn('Failed to persist session tokens to sessionStorage', e);
          }
          await syncUser();
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') return;
        console.log('Auth state changed:', event);
        
        if (session?.user) {
          setUser(session.user);
          try {
            if (session.access_token) sessionStorage.setItem('access_token', session.access_token);
            if (session.refresh_token) sessionStorage.setItem('refresh_token', session.refresh_token);
          } catch (e) {
            console.warn('Failed to persist session tokens on auth change', e);
          }
          await syncUser();
        } else {
          setUser(null);
          sessionStorage.removeItem('access_token');
          sessionStorage.removeItem('refresh_token');
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Update registration data (saves to sessionStorage too)
  const updateRegistrationData = (data) => {
    setRegistrationData((prev) => {
      const newData = { ...prev, ...data };
      sessionStorage.setItem('registration_data', JSON.stringify(newData));
      return newData;
    });
  };

  // Clear registration data
  const clearRegistrationData = () => {
    setRegistrationData({
      email: null,
      userId: null,
      otpVerified: false,
    });
    sessionStorage.removeItem('registration_data');
  };

  // ============================================
  // STEP 1: REGISTER (NO PASSWORD!)
  // ============================================
  const register = async (userData) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userData.email,
          fullName: userData.fullName,
          terms: userData.terms || true
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // Store registration data in context + sessionStorage
      updateRegistrationData({
        email: data.email,
        userId: data.userId,
        otpVerified: false,
      });

      return {
        success: true,
        requiresVerification: true,
        userId: data.userId,
        email: data.email
      };

    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // STEP 2: VERIFY OTP
  // ============================================
  const verifyOTP = async (email, otp, userId) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          otp,
          userId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      // Mark OTP as verified
      updateRegistrationData({
        otpVerified: true,
      });

      return {
        success: true,
        userId: data.userId,
        email: data.email
      };

    } catch (error) {
      console.error('OTP verification error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // STEP 3: CREATE PASSWORD
  // ============================================
  const createPassword = async (userId, email, password) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/auth/create-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email, password })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create password');

      if (data.session) {
        // Set session
        const { data: sessionData, error: setSessionError } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        
        if (!setSessionError && sessionData?.session?.user) {
          setUser(sessionData.session.user);
          try {
            if (sessionData.session.access_token) sessionStorage.setItem('access_token', sessionData.session.access_token);
            if (sessionData.session.refresh_token) sessionStorage.setItem('refresh_token', sessionData.session.refresh_token);
          } catch (e) {
            console.warn('Failed to persist session tokens after createPassword', e);
          }
          
          // Verify session was set
          const { data: verifySession } = await supabase.auth.getSession();
          console.log('Session verified:', !!verifySession.session);
          
          if (!verifySession.session) {
            console.warn('Session not found after setSession');
            return {
              success: true,
              session: data.session,
              user: data.user,
              requiresLogin: true,
            };
          }

          await syncUser();
        } else if (setSessionError) {
          console.error('Session error:', setSessionError);
          return {
            success: true,
            session: data.session,
            user: data.user,
            requiresLogin: true,
          };
        }
      }

      return {
        success: true,
        session: data.session,
        user: data.user,
        requiresLogin: !data.session,
      };

    } catch (error) {
      console.error('Create password error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // RESEND OTP
  // ============================================
  const resendOTP = async (email, userId) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/auth/resend-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          userId
        })
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
  // LOGIN
  // ============================================
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

  // ============================================
  // LOGOUT
  // ============================================
  const logout = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      clearRegistrationData();
      sessionStorage.removeItem('access_token');
      sessionStorage.removeItem('refresh_token');
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
  // CHECK UPLOAD STATUS
  // ============================================
  const checkUploadStatus = async () => {
    try {
      const token = await getToken();
      if (!token) return false;

      const res = await fetch(`${API_URL}/upload/status/check`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.status === 404 || res.status === 401) {
        return false;
      }
      
      const data = await res.json();
      return !!data.hasUploaded;
    } catch (err) {
      console.error('checkUploadStatus failed:', err);
      return false;
    }
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    registrationData,
    updateRegistrationData,
    clearRegistrationData,
    getToken, // <-- ADDED THIS
    checkUploadStatus, // <-- ADDED THIS
    register,
    verifyOTP,
    createPassword,
    resendOTP,
    login,
    logout,
    setUser,
    syncUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};