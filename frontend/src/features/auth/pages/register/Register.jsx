// register.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  FaUser, 
  FaEnvelope, 
  FaLock, 
  FaKey,
  FaSpinner
} from 'react-icons/fa';
import { useAuth } from '../../../../context/AuthContext';
import './Register.css';

const Register = () => {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    terms: false,
  });

  const [focusedInput, setFocusedInput] = useState(null);
  const [errors, setErrors] = useState({});
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
    
    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    } else if (formData.fullName.length < 2) {
      newErrors.fullName = 'Name must be at least 2 characters';
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    } else if (!/(?=.*[A-Z])/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one uppercase letter';
    }
    
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    
    if (!formData.terms) {
      newErrors.terms = 'You must agree to the terms and conditions';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (validateForm()) {
      const result = await register({
        fullName: formData.fullName,
        email: formData.email,
        password: formData.password,
      });
      
      if (result.success) {
        // Redirect to login or dashboard
        navigate('/login', { 
          state: { message: 'Registration successful! Please login.' } 
        });
      } else {
        setError(result.error || 'Registration failed. Please try again.');
      }
    }
  };

  const getIconColor = (inputId) => {
    return focusedInput === inputId ? '#bb0114' : '#6c757d';
  };

  return (
    <div className="register-container">
      <main className="main-container">
        <div className="background-effects">
          <div className="bg-effect-top"></div>
          <div className="bg-effect-bottom"></div>
        </div>
        
        <div className="registration-card">
          <div className="brand-header">
            <img
              alt="Chef Duo Logo"
              className="logo"
              src="/public/logo.png"
            />
            <h1 className="brand-title">ChefDuo Sales Forecasting</h1>
            <p className="brand-subtitle">Join our vibrant culinary community today.</p>
          </div>

          {error && (
            <div className="alert alert-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="registration-form">
            <div className="form-group">
              <label className="form-label" htmlFor="fullName">
                Full Name
              </label>
              <div className="input-with-icon">
                <FaUser 
                  className="input-icon" 
                  style={{ color: getIconColor('fullName') }}
                />
                <input
                  className={`form-input ${errors.fullName ? 'input-error' : ''}`}
                  id="fullName"
                  placeholder="Enter your full name"
                  type="text"
                  value={formData.fullName}
                  onChange={handleChange}
                  onFocus={() => setFocusedInput('fullName')}
                  onBlur={() => setFocusedInput(null)}
                  disabled={loading}
                />
              </div>
              {errors.fullName && <span className="error-message">{errors.fullName}</span>}
            </div>

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

            <div className="password-grid">
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
                    placeholder="Create a password"
                    type="password"
                    value={formData.password}
                    onChange={handleChange}
                    onFocus={() => setFocusedInput('password')}
                    onBlur={() => setFocusedInput(null)}
                    disabled={loading}
                  />
                </div>
                {errors.password && <span className="error-message">{errors.password}</span>}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="confirmPassword">
                  Confirm Password
                </label>
                <div className="input-with-icon">
                  <FaKey 
                    className="input-icon" 
                    style={{ color: getIconColor('confirmPassword') }}
                  />
                  <input
                    className={`form-input ${errors.confirmPassword ? 'input-error' : ''}`}
                    id="confirmPassword"
                    placeholder="Re-enter password"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    onFocus={() => setFocusedInput('confirmPassword')}
                    onBlur={() => setFocusedInput(null)}
                    disabled={loading}
                  />
                </div>
                {errors.confirmPassword && <span className="error-message">{errors.confirmPassword}</span>}
              </div>
            </div>

            <div className="terms-container">
              <div className="checkbox-wrapper">
                <input
                  className={`checkbox-input ${errors.terms ? 'checkbox-error' : ''}`}
                  id="terms"
                  type="checkbox"
                  checked={formData.terms}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>
              <label className="terms-label" htmlFor="terms">
                I agree to the <Link className="terms-link" to="/terms">Terms &amp; Conditions</Link> and <Link className="terms-link" to="/privacy">Privacy Policy</Link>.
              </label>
              {errors.terms && <span className="error-message">{errors.terms}</span>}
            </div>

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <FaSpinner className="spinner" />
                  Creating Account...
                </>
              ) : (
                'Sign Up'
              )}
            </button>
          </form>

          <div className="social-section">
            <div className="divider-container">
              <div className="divider-line"></div>
              <span className="divider-text">OR</span>
              <div className="divider-line"></div>
            </div>
            
            <p className="login-prompt">
              Already have an account? 
              <Link className="login-link" to="/login">Log in</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Register;