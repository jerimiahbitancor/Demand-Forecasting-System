// login.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { 
  FaEnvelope, 
  FaLock, 
  FaEye,
  FaEyeSlash,
  FaSpinner
} from 'react-icons/fa';
import { useAuth } from '../../../../context/AuthContext';
import './Login.css';
import { useSetupGuard } from '../../../../hooks/useSetupGuard';

const Login = () => {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const checking = useSetupGuard('login');
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [focusedInput, setFocusedInput] = useState(null);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { id, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [id]: type === 'checkbox' ? checked : value,
    }));
    if (errors[id]) {
      setErrors((prev) => ({ ...prev, [id]: '' }));
    }
    setError('');
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // login.jsx - Update your handleSubmit function

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (validateForm()) {
      // Show loading
      Swal.fire({
        title: 'Logging in...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      try {
        const result = await login(formData.email, formData.password);
        
        Swal.close();
        
        if (result.success) {
          // IMPORTANT: Wait a moment for state to update
          await new Promise(resolve => setTimeout(resolve, 100));
          
          await Swal.fire({
            icon: 'success',
            title: 'Login successful',
            text: 'Welcome back!',
            timer: 1200,
            showConfirmButton: false,
          });
          
          // Navigate after everything is done
          navigate('/dashboard');
        } else {
          setError(result.error || 'Login failed. Please try again.');
          Swal.fire({
            icon: 'error',
            title: 'Login failed',
            text: result.error || 'Please try again.',
          });
        }
      } catch (error) {
        Swal.close();
        setError('An unexpected error occurred');
        Swal.fire({
          icon: 'error',
          title: 'Login failed',
          text: 'Please try again.',
        });
      }
    }
  };

  const getIconColor = (inputId) => {
    return focusedInput === inputId ? '#bb0114' : '#6c757d';
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  if (checking) {
    return (
      <div className="login-container">
        <main className="main-container">
          <p>Checking session...</p>
        </main>
      </div>
    );
  }
  
  return (
    <div className="login-container">
      <main className="main-container">
        <div className="background-effects">
          <div className="bg-effect-top"></div>
          <div className="bg-effect-bottom"></div>
        </div>
        
        <div className="login-card">
          <div className="brand-header">
            <img
              alt="Chef Duo Logo"
              className="logo"
              src="/public/logo.png"
            />
            <h1 className="brand-title">ChefDuo Sales Forecasting</h1>
            <p className="brand-subtitle">Welcome back! Log in to your account.</p>
          </div>

          {error && (
            <div className="alert alert-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="email">
                Email Address
              </label>
              <div className="input-with-icon">
                <FaEnvelope 
                  className="input-icon" 
                  style={{ color: getIconColor('email') }}
                />
                <input
                  className={`form-input ${errors.email ? 'input-error' : ''}`}
                  id="email"
                  placeholder="example@chefduo.com"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  onFocus={() => setFocusedInput('email')}
                  onBlur={() => setFocusedInput(null)}
                  disabled={loading}
                />
              </div>
              {errors.email && <span className="error-message">{errors.email}</span>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">
                Password
              </label>
              <div className="input-with-icon">
                <FaLock 
                  className="input-icon" 
                  style={{ color: getIconColor('password') }}
                />
                <input
                  className={`form-input ${errors.password ? 'input-error' : ''}`}
                  id="password"
                  placeholder="Enter your password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleChange}
                  onFocus={() => setFocusedInput('password')}
                  onBlur={() => setFocusedInput(null)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={togglePasswordVisibility}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={loading}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {errors.password && <span className="error-message">{errors.password}</span>}
            </div>

            <div className="login-options">
              <Link className="forgot-link" to="/forgot-password">
                Forgot Password?
              </Link>
            </div>

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <FaSpinner className="spinner" />
                  Logging in...
                </>
              ) : (
                'Log In'
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Login;