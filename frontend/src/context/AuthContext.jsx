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
  const [session, setSession] = useState(null);

  // Registration flow state
  const [registrationData, setRegistrationData] = useState(() => {
    const saved = sessionStorage.getItem('registration_data');
    return saved ? JSON.parse(saved) : {
      email: null,
      userId: null,
      otpVerified: false,
    };
  });

  // ============================================
  // GET TOKEN
  // ============================================
  const getToken = async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (currentSession?.access_token) {
        sessionStorage.setItem('access_token', currentSession.access_token);
        return currentSession.access_token;
      }

      const storedToken = sessionStorage.getItem('access_token');
      if (storedToken) {
        try {
          const { data: { user } } = await supabase.auth.getUser(storedToken);
          if (user) {
            return storedToken;
          }
        } catch (e) {
          console.warn('Stored token invalid');
          sessionStorage.removeItem('access_token');
        }
      }

      const refreshToken = sessionStorage.getItem('refresh_token');
      if (refreshToken) {
        const { data: { session: refreshedSession }, error: refreshError } = 
          await supabase.auth.refreshSession();
        
        if (!refreshError && refreshedSession?.access_token) {
          sessionStorage.setItem('access_token', refreshedSession.access_token);
          sessionStorage.setItem('refresh_token', refreshedSession.refresh_token);
          return refreshedSession.access_token;
        }
      }

      console.warn('No valid token found');
      return null;
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  };

  // ============================================
  // SYNC USER WITH CUSTOM TABLE - FIXED
  // ============================================
  const syncUser = async () => {
    try {
      const token = await getToken();
      if (!token) {
        console.warn('No token available for sync');
        return null;
      }

      console.log('Syncing user with token:', token.substring(0, 20) + '...');

      const response = await fetch(`${API_URL}/auth/sync-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error('Token expired or invalid during sync');
          sessionStorage.removeItem('access_token');
          sessionStorage.removeItem('refresh_token');
          return null;
        }
        throw new Error(`Sync failed: ${response.status}`);
      }

      const data = await response.json();

      // Only update user if we got a valid user object
      if (data.user && typeof data.user === 'object') {
        console.log('✅ User synced:', data.user);
        setUser((prev) => ({
          ...prev,
          ...data.user,
        }));
        return data.user;
      } else if (data.user && typeof data.user === 'number') {
        // If the backend returns just the ID, we need to keep the existing user
        console.log('⚠️ Backend returned numeric user ID, keeping existing user');
        return user;
      }

      return null;
    } catch (error) {
      console.error('Sync user error:', error);
      return null;
    }
  };

  // ============================================
  // SET SESSION HELPER
  // ============================================
  const setUserSession = async (sessionData) => {
    if (!sessionData) return null;

    try {
      const { data: sessionDataResult, error: setSessionError } = 
        await supabase.auth.setSession({
          access_token: sessionData.access_token,
          refresh_token: sessionData.refresh_token,
        });

      if (setSessionError) {
        console.error('Session error:', setSessionError);
        return null;
      }

      if (sessionDataResult?.session?.user) {
        setUser(sessionDataResult.session.user);
        setSession(sessionDataResult.session);
        
        sessionStorage.setItem('access_token', sessionDataResult.session.access_token);
        sessionStorage.setItem('refresh_token', sessionDataResult.session.refresh_token);
        
        await syncUser();
        
        return sessionDataResult.session;
      }

      return null;
    } catch (error) {
      console.error('Error setting session:', error);
      return null;
    }
  };

  // ============================================
  // CHECK AUTH ON MOUNT
  // ============================================
  useEffect(() => {
    const checkAuth = async () => {
      try {
        setLoading(true);
        
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        
        if (currentSession?.user) {
          console.log('Session found for user:', currentSession.user.email);
          setUser(currentSession.user);
          setSession(currentSession);
          
          if (currentSession.access_token) {
            sessionStorage.setItem('access_token', currentSession.access_token);
          }
          if (currentSession.refresh_token) {
            sessionStorage.setItem('refresh_token', currentSession.refresh_token);
          }
          
          await syncUser();
        } else {
          const storedToken = sessionStorage.getItem('access_token');
          if (storedToken) {
            try {
              const { data: { user } } = await supabase.auth.getUser(storedToken);
              if (user) {
                console.log('Restored user from stored token:', user.email);
                setUser(user);
                
                const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
                if (refreshedSession) {
                  setSession(refreshedSession);
                  sessionStorage.setItem('access_token', refreshedSession.access_token);
                  sessionStorage.setItem('refresh_token', refreshedSession.refresh_token);
                }
              }
            } catch (e) {
              console.warn('Stored token invalid, removing');
              sessionStorage.removeItem('access_token');
              sessionStorage.removeItem('refresh_token');
            }
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        setUser(null);
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') return;
        console.log('Auth state changed:', event);

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (newSession?.user) {
            setUser(newSession.user);
            setSession(newSession);

            if (newSession.access_token) {
              sessionStorage.setItem('access_token', newSession.access_token);
            }
            if (newSession.refresh_token) {
              sessionStorage.setItem('refresh_token', newSession.refresh_token);
            }

            await syncUser();
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setSession(null);
          sessionStorage.removeItem('access_token');
          sessionStorage.removeItem('refresh_token');
        }

        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ============================================
  // REGISTER
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
  // VERIFY OTP
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
  // CREATE PASSWORD
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
        const sessionResult = await setUserSession(data.session);
        
        if (sessionResult) {
          return {
            success: true,
            session: sessionResult,
            user: data.user,
            requiresLogin: false,
          };
        }
        
        return {
          success: true,
          session: data.session,
          user: data.user,
          requiresLogin: true,
        };
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

      if (data.user) {
        setUser(data.user);
        setSession(data.session);
        
        if (data.session?.access_token) {
          sessionStorage.setItem('access_token', data.session.access_token);
        }
        if (data.session?.refresh_token) {
          sessionStorage.setItem('refresh_token', data.session.refresh_token);
        }
        
        await syncUser();
        
        return { 
          success: true, 
          user: data.user,
          session: data.session
        };
      }

      return { success: false, error: 'Login failed' };

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
      setSession(null);
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

  // ============================================
  // UPDATE REGISTRATION DATA
  // ============================================
  const updateRegistrationData = (data) => {
    setRegistrationData((prev) => {
      const newData = { ...prev, ...data };
      sessionStorage.setItem('registration_data', JSON.stringify(newData));
      return newData;
    });
  };

  // ============================================
  // CLEAR REGISTRATION DATA
  // ============================================
  const clearRegistrationData = () => {
    setRegistrationData({
      email: null,
      userId: null,
      otpVerified: false,
    });
    sessionStorage.removeItem('registration_data');
  };

  const value = {
    user,
    session,
    loading,
    error,
    isAuthenticated: !!user,
    registrationData,
    updateRegistrationData,
    clearRegistrationData,
    getToken,
    checkUploadStatus,
    setUserSession,
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