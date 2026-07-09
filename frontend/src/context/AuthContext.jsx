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
        // ✅ Use sessionStorage
        const token = sessionStorage.getItem('token');
        const storedUser = sessionStorage.getItem('user');
        
        console.log('Stored token:', token ? 'exists' : 'none');
        console.log('Stored user:', storedUser ? 'exists' : 'none');
        
        if (token && storedUser) {
          const userData = JSON.parse(storedUser);
          setUser(userData);
          console.log('User authenticated:', userData);
        } else {
          console.log('No stored session found');
          setUser(null);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        sessionStorage.removeItem('token');
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
        const userData = result.data.user;
        const token = result.data.access_token || result.data.session?.access_token;
        
        // ✅ Store in sessionStorage
        if (token) {
          sessionStorage.setItem('token', token);
          console.log('✅ Token stored in sessionStorage');
        }
        if (userData) {
          sessionStorage.setItem('user', JSON.stringify(userData));
        }
        
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
        const user = result.data.user;
        const token = result.data.access_token || result.data.session?.access_token;
        
        // ✅ Store in sessionStorage
        if (token) {
          sessionStorage.setItem('token', token);
        }
        if (user) {
          sessionStorage.setItem('user', JSON.stringify(user));
        }
        
        setUser(user);
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
      // ✅ Clear sessionStorage
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('token_expiry');
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
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};