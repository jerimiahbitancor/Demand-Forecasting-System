// frontend/src/features/auth/pages/register/Register.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { 
  FaUser, 
  FaEnvelope, 
  FaSpinner,
  FaShieldAlt
} from 'react-icons/fa';
import { FiX } from 'react-icons/fi';
import { useAuth } from '../../../../context/AuthContext';
import './Register.css';
import { useSetupGuard } from '../../../../hooks/useSetupGuard'; 

const Register = () => {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const checking = useSetupGuard('register');
  
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    terms: false,
  });

  const [focusedInput, setFocusedInput] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

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
      Swal.fire({
        title: 'Sending verification code...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await register({
        fullName: formData.fullName,
        email: formData.email,
        terms: formData.terms
      });

      Swal.close();
      
      if (result.success) {
        await Swal.fire({
          icon: 'success',
          title: 'OTP Sent',
          text: 'A verification code has been sent to your email.',
          timer: 1800,
          showConfirmButton: false,
        });

        // ✅ No state needed! AuthContext has the data
        navigate('/verify-email');
      } else {
        setError(result.error || 'Registration failed. Please try again.');
        Swal.fire({
          icon: 'error',
          title: 'Registration failed',
          text: result.error || 'Please try again.',
        });
      }
    }
  };

  const getIconColor = (inputId) => {
    return focusedInput === inputId ? '#bb0114' : '#6c757d';
  };

  const openTerms = () => setShowTerms(true);
  const closeTerms = () => setShowTerms(false);
  const openPrivacy = () => setShowPrivacy(true);
  const closePrivacy = () => setShowPrivacy(false);

  if (checking) {
    return (
      <div className="register-container">
        <main className="main-container">
          <p>Checking session...</p>
        </main>
      </div>
    );
  }
  
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
            {/* Full Name */}
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

            {/* Email */}
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

            {/* Terms */}
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
                I agree to the <button type="button" className="terms-link" onClick={openTerms}>Terms &amp; Conditions</button> and <button type="button" className="terms-link" onClick={openPrivacy}>Privacy Policy</button>.
              </label>
              {errors.terms && <span className="error-message">{errors.terms}</span>}
            </div>

            {/* Submit Button */}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <FaSpinner className="spinner" />
                  Sending Code...
                </>
              ) : (
                'Sign Up'
              )}
            </button>
          </form>
        </div>
      </main>

      {/* Terms Modal */}
      {showTerms && (
        <div className="modal-overlay" onClick={closeTerms}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-left">
                <FaShieldAlt className="modal-header-icon" />
                <h2>Terms and Conditions</h2>
              </div>
              <button type="button" className="modal-close" onClick={closeTerms}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-section">
                <h3>1. Acceptance of Terms</h3>
                <p>
                  By creating an account with ChefDuo Forecast, you agree to use the service responsibly and to comply with our platform rules.
                </p>
              </div>
              <div className="modal-section">
                <h3>2. Account Responsibilities</h3>
                <p>
                  You are responsible for maintaining the confidentiality of your password, using a strong password, and notifying us of any unauthorized access.
                </p>
              </div>
              <div className="modal-footer-text">
                <p>Last updated: July 2026</p>
                <button type="button" className="modal-agree-btn" onClick={closeTerms}>I Agree</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Register;