// register.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { 
  FaUser, 
  FaEnvelope, 
  FaLock, 
  FaKey,
  FaEye,
  FaEyeSlash,
  FaSpinner,
  FaShieldAlt
} from 'react-icons/fa';
import { FiX } from 'react-icons/fi';
import { useAuth } from '../../../../context/AuthContext';  // ✅ 4 levels up
import './Register.css';
import { useSetupGuard } from '../../../../hooks/useSetupGuard';  // ✅ 4 levels up

const getPasswordRules = (password) => [
  { test: password.length >= 12, message: 'Minimum 12 characters' },
  { test: /[A-Z]/.test(password), message: 'One uppercase letter' },
  { test: /[a-z]/.test(password), message: 'One lowercase letter' },
  { test: /\d/.test(password), message: 'One number' },
  { test: /[^A-Za-z0-9]/.test(password), message: 'One special character' },
];

const Register = () => {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const checking = useSetupGuard('register'); 
  
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    terms: false,
  });

  const [focusedInput, setFocusedInput] = useState(null);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
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
    const password = formData.password;
    const passwordRules = getPasswordRules(password);
    const failedPasswordRules = passwordRules.filter((rule) => !rule.test);

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
    
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (failedPasswordRules.length > 0) {
      newErrors.password = 'Password must meet all requirements';
      newErrors.passwordRequirements = failedPasswordRules.map((rule) => rule.message);
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

  // Register.jsx - handleSubmit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (validateForm()) {
      Swal.fire({
        title: 'Creating account...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await register({
        fullName: formData.fullName,
        email: formData.email,
        password: formData.password,
      });

      console.log('Register result:', result); // ← ADD THIS

      Swal.close();
      
      if (result.success) {
        console.log('Requires verification?', result.requiresVerification); // ← ADD THIS
        
        if (result.requiresVerification) {
          console.log('Navigating to /verify-email with email:', formData.email); // ← ADD THIS
          navigate('/verify-email', { 
            state: { 
              email: formData.email 
            }
          });
        } else {
          // Fallback
          await Swal.fire({
            icon: 'success',
            title: 'Account created',
            text: 'Welcome to ChefDuo!',
            timer: 1200,
            showConfirmButton: false,
          });
          navigate('/landing');
        }
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

  const passwordRules = getPasswordRules(formData.password);
  const failedPasswordRules = passwordRules.filter((rule) => !rule.test);
  const passedPasswordRules = passwordRules.filter((rule) => rule.test).length;
  const passwordStrengthPercent = formData.password.length === 0 ? 0 : Math.min(100, Math.round((passedPasswordRules / passwordRules.length) * 100));
  const showPasswordRequirements = formData.password.length > 0 && failedPasswordRules.length > 0;
  const strengthLabel =
    passwordStrengthPercent === 0
      ? 'Very weak'
      : passwordStrengthPercent < 40
        ? 'Weak'
        : passwordStrengthPercent < 80
          ? 'Fair'
          : passwordStrengthPercent < 100
            ? 'Good'
            : 'Strong';

  const togglePasswordVisibility = (field) => {
    if (field === 'password') {
      setShowPassword((prev) => !prev);
    } else {
      setShowConfirmPassword((prev) => !prev);
    }
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
                    onClick={() => togglePasswordVisibility('password')}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={loading}
                  >
                    {showPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>
                {errors.password && <span className="error-message">{errors.password}</span>}
                {formData.password.length > 0 && (
                  <div className="password-strength-card">
                    <div className="password-strength-header">
                      <span className="strength-label">Password strength</span>
                      <span className={`strength-value ${passwordStrengthPercent >= 100 ? 'strong' : ''}`}>{strengthLabel}</span>
                    </div>
                    <div className="strength-bar-track" aria-hidden="true">
                      <div
                        className={`strength-bar-fill ${passwordStrengthPercent >= 100 ? 'strong' : passwordStrengthPercent >= 80 ? 'good' : passwordStrengthPercent >= 40 ? 'fair' : 'weak'}`}
                        style={{ width: `${passwordStrengthPercent}%` }}
                      />
                    </div>
                  </div>
                )}
                {showPasswordRequirements && (
                  <div className="password-requirements">
                    <p className="requirements-heading">Password must include:</p>
                    <ul className="requirements-list">
                      {passwordRules.map((rule) => (
                        <li key={rule.message} className={`requirement-item ${rule.test ? 'valid' : 'invalid'}`}>
                          <span className="requirement-icon">{rule.test ? '✓' : '•'}</span>
                          <span>{rule.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    onFocus={() => setFocusedInput('confirmPassword')}
                    onBlur={() => setFocusedInput(null)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => togglePasswordVisibility('confirmPassword')}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    disabled={loading}
                  >
                    {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
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
                I agree to the <button type="button" className="terms-link" onClick={openTerms}>Terms &amp; Conditions</button> and <button type="button" className="terms-link" onClick={openPrivacy}>Privacy Policy</button>.
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

        </div>
      </main>

      {showTerms && (
        <div className="modal-overlay" onClick={closeTerms}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-left">
                <FaLock className="modal-header-icon" />
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
              <div className="modal-section">
                <h3>3. Data Usage</h3>
                <p>
                  Your business and account information helps us provide forecasting insights and improve the experience. We do not sell your data for marketing purposes.
                </p>
              </div>
              <div className="modal-section">
                <h3>4. Limitation of Liability</h3>
                <p>
                  ChefDuo provides forecasting information for planning purposes and does not guarantee outcomes or business results.
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

      {showPrivacy && (
        <div className="modal-overlay" onClick={closePrivacy}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-left">
                <FaShieldAlt className="modal-header-icon" />
                <h2>Privacy Policy</h2>
              </div>
              <button type="button" className="modal-close" onClick={closePrivacy}>
                <FiX />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-section">
                <h3>1. Information We Collect</h3>
                <p>
                  We collect your name, email address, login credentials, and business data needed to generate forecasts and support your account.
                </p>
              </div>
              <div className="modal-section">
                <h3>2. How We Use Your Information</h3>
                <p>
                  Your information helps us operate the platform, improve forecasts, personalize your experience, and maintain account security.
                </p>
              </div>
              <div className="modal-section">
                <h3>3. Security</h3>
                <p>
                  We use industry-standard protections to safeguard your account and business information from unauthorized access.
                </p>
              </div>
              <div className="modal-section">
                <h3>4. Your Choices</h3>
                <p>
                  You may update your profile information or contact us if you want to review or delete personal data associated with your account.
                </p>
              </div>
              <div className="modal-footer-text">
                <p>Last updated: July 2026</p>
                <button type="button" className="modal-agree-btn" onClick={closePrivacy}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Register;