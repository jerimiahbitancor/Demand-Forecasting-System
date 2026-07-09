// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/authService';

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

  useEffect(() => {
    const checkAuth = async () => {
      console.log('Checking authentication on app load...');
      
      try {
        // Check if we have a stored session
        const session = sessionStorage.getItem('supabase_session');
        const storedUser = sessionStorage.getItem('user');
        
        console.log('Stored session:', session ? 'exists' : 'none');
        console.log('Stored user:', storedUser ? 'exists' : 'none');
        
        // AuthContext.jsx, inside checkAuth()
        if (session && storedUser) {
          const result = await authService.validateToken();
          console.log('Token validation result:', result);

          if (result.reason === 'unauthorized') {
            console.warn('Token invalid, clearing session');
            sessionStorage.removeItem('supabase_session');
            sessionStorage.removeItem('user');
            setUser(null);
          } else {
            const userData = JSON.parse(storedUser);
            setUser(userData);
            console.log('User authenticated:', userData);
          }
        } else {
          console.log('No stored session found');
          setUser(null);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        // Clear potentially corrupted data
        sessionStorage.removeItem('supabase_session');
        sessionStorage.removeItem('user');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      console.log('AuthContext: Attempting login for:', email);
      
      const result = await authService.login(email, password);
      console.log('AuthContext: Login result:', result);
      
      if (result.success) {
        // The user data should be in result.data.user
        const userData = result.data.user;
        setUser(userData);
        console.log('AuthContext: User set:', userData);
        return { success: true };
      } else {
        setError(result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('AuthContext: Login error:', error);
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData) => {
    setLoading(true);
    setError(null);
    try {
      const result = await authService.register(userData);
      if (result.success) {
        setUser(result.data.user);
        return { success: true };
      } else {
        setError(result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await authService.logout();
      setUser(null);
      console.log('User logged out');
      return { success: true };
    } catch (error) {
      setError(error.message);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const value = {
    user,
    loading,
    error,
    login,
    register,
    logout,
    isAuthenticated: authService.isAuthenticated,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};