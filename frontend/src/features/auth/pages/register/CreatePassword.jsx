// frontend/src/features/auth/pages/register/CreatePassword.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import '../../../../utils/swalTheme.css';
import { 
  FaLock, 
  FaKey,
  FaEye,
  FaEyeSlash,
  FaSpinner,
  FaArrowLeft
} from 'react-icons/fa';
import { useAuth } from '../../../../context/AuthContext';
import { supabase } from '../../../../config/supabase';
import './CreatePassword.css';

const CreatePassword = () => {
  const navigate = useNavigate();
  const { createPassword, clearRegistrationData, registrationData, loading, user } = useAuth();
  
  // Get data from AuthContext
  const email = registrationData?.email;
  const userId = registrationData?.userId;
  const otpVerified = registrationData?.otpVerified;
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [focusedInput, setFocusedInput] = useState(null);

  useEffect(() => {
    if ((!email || !userId) && !isSubmitting) {
      if (user) {
        navigate('/landing', { replace: true });
        return;
      }

      Swal.fire({
        icon: 'error',
        title: 'Session Expired',
        text: 'Please register again.',
        timer: 1500,
        showConfirmButton: false,
      });
      navigate('/register');
      return;
    }
    
    // Check if OTP was verified
    if (!otpVerified && !isSubmitting) {
      if (user) {
        navigate('/landing', { replace: true });
        return;
      }

      Swal.fire({
        icon: 'error',
        title: 'OTP Not Verified',
        text: 'Please verify your email first.',
        timer: 1500,
        showConfirmButton: false,
      });
      navigate('/verify-email');
    }
  }, [email, userId, otpVerified, isSubmitting, user, navigate]);

  // Password strength checker
  const getPasswordRules = (password) => [
    { test: password.length >= 8, message: 'Minimum 8 characters' },
    { test: /[A-Z]/.test(password), message: 'One uppercase letter' },
    { test: /[a-z]/.test(password), message: 'One lowercase letter' },
    { test: /\d/.test(password), message: 'One number' },
    { test: /[^A-Za-z0-9]/.test(password), message: 'One special character' },
  ];

  const passwordRules = getPasswordRules(password);
  const passedRules = passwordRules.filter(rule => rule.test).length;
  const totalRules = passwordRules.length;
  const strengthPercent = password.length === 0 ? 0 : Math.round((passedRules / totalRules) * 100);

  const getStrengthLabel = () => {
    if (strengthPercent === 0) return 'Very weak';
    if (strengthPercent < 40) return 'Weak';
    if (strengthPercent < 80) return 'Fair';
    if (strengthPercent < 100) return 'Good';
    return 'Strong';
  };

  const getStrengthClass = () => {
    if (strengthPercent === 0) return '';
    if (strengthPercent < 40) return 'weak';
    if (strengthPercent < 80) return 'fair';
    if (strengthPercent < 100) return 'good';
    return 'strong';
  };

  const validateForm = () => {
    const newErrors = {};
    const rules = getPasswordRules(password);
    const failedRules = rules.filter(rule => !rule.test);

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (failedRules.length > 0) {
      newErrors.password = 'Password must meet all requirements';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
  e.preventDefault();
  
  if (validateForm()) {
    setIsSubmitting(true);
    Swal.fire({
      title: 'Creating your account...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    try {
      const result = await createPassword(userId, email, password);

      Swal.close();

      if (result.success) {
        if (result.requiresLogin) {
          await Swal.fire({
            icon: 'success',
            title: 'Account Created!',
            text: 'Please log in to continue.',
            timer: 1800,
            showConfirmButton: false,
          });
          navigate('/login', { replace: true });
          clearRegistrationData();
        } else {
          await Swal.fire({
            icon: 'success',
            title: 'Account Created!',
            text: 'Welcome to ChefDuo!',
            timer: 1500,
            showConfirmButton: false,
          });

          // Wait for session to be fully established
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Verify session exists before navigating
          const { data: { session } } = await supabase.auth.getSession();
          console.log('🔍 Session after creation:', !!session);
          
          if (session) {
            navigate('/landing', { replace: true });
          } else {
            // Fallback: go to login
            console.log('No session found, redirecting to login');
            navigate('/login', { replace: true });
          }
          clearRegistrationData();
        }
      }

    } catch (error) {
      Swal.close();
      Swal.fire({
        icon: 'error',
        title: 'Account Creation Failed',
        text: error.message || 'Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }
};

  const getIconColor = (inputId) => {
    return focusedInput === inputId ? '#bb0114' : '#6c757d';
  };

  return (
    <div className="create-password-container">
      <main className="main-container">
        <div className="background-effects">
          <div className="bg-effect-top"></div>
          <div className="bg-effect-bottom"></div>
        </div>
        
        <div className="create-password-card">
          <div className="brand-header">
            <img
              alt="Chef Duo Logo"
              className="logo"
              src="/public/logo.png"
            />
            <h1 className="brand-title">Create Your Password</h1>
            <p className="brand-subtitle">
              Almost there! Set a secure password for your account.
            </p>
            <p className="email-display">{email}</p>
          </div>

          <form onSubmit={handleSubmit} className="create-password-form">
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
                  placeholder="Create a strong password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedInput('password')}
                  onBlur={() => setFocusedInput(null)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={loading}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {errors.password && <span className="error-message">{errors.password}</span>}
              
              {password.length > 0 && (
                <div className="password-strength-card">
                  <div className="password-strength-header">
                    <span className="strength-label">Password strength</span>
                    <span className={`strength-value ${getStrengthClass()}`}>
                      {getStrengthLabel()}
                    </span>
                  </div>
                  <div className="strength-bar-track" aria-hidden="true">
                    <div
                      className={`strength-bar-fill ${getStrengthClass()}`}
                      style={{ width: `${strengthPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {password.length > 0 && (
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
                  placeholder="Re-enter your password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => setFocusedInput('confirmPassword')}
                  onBlur={() => setFocusedInput(null)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  disabled={loading}
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {errors.confirmPassword && <span className="error-message">{errors.confirmPassword}</span>}
            </div>

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <FaSpinner className="spinner" />
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </button>

            <div className="auth-links">
              <button
                type="button"
                className="back-link"
                onClick={() => navigate('/verify-email')}
              >
                <FaArrowLeft />
                Back to Verification
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

export default CreatePassword;