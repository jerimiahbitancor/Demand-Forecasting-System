import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  FaLock,
  FaEye,
  FaEyeSlash,
  FaArrowLeft,
  FaSpinner,
} from 'react-icons/fa';
import './forgotpass2.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const getPasswordRules = (password) => [
  { test: password.length >= 12, message: 'Minimum 12 characters' },
  { test: /[A-Z]/.test(password), message: 'One uppercase letter' },
  { test: /[a-z]/.test(password), message: 'One lowercase letter' },
  { test: /\d/.test(password), message: 'One number' },
  { test: /[^A-Za-z0-9]/.test(password), message: 'One special character' },
];

const ForgotPassword2 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || 'your email';
  const code = location.state?.code;

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors((prev) => ({ ...prev, [id]: '' }));
    }
    setSuccessMessage('');
  };

  const validateForm = () => {
    const newErrors = {};
    const passwordRules = getPasswordRules(formData.password);
    const failedRequirements = passwordRules.filter((rule) => !rule.test);

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (failedRequirements.length) {
      newErrors.password = 'Password must meet all requirements';
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (!code) {
      Swal.fire({
        icon: 'error',
        title: 'Invalid Request',
        text: 'Verification code is missing. Please start the process again.',
      });
      navigate('/forgot-password');
      return;
    }

    Swal.fire({
      title: 'Updating password...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/forgot-password/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          code: code,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setLoading(false);
      Swal.close();
      await Swal.fire({
        icon: 'success',
        title: 'Password updated',
        text: `Your password for ${email} has been updated successfully.`,
        timer: 1400,
        showConfirmButton: false,
      });
      navigate('/login');
    } catch (error) {
      setLoading(false);
      Swal.close();
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to reset password. Please try again.',
      });
      console.error('Reset password error:', error);
    }
  };

  const passwordRules = getPasswordRules(formData.password);
  const failedPasswordRules = passwordRules.filter((rule) => !rule.test);
  const passedPasswordRules = passwordRules.filter((rule) => rule.test).length;
  const passwordStrengthPercent =
    formData.password.length === 0
      ? 0
      : Math.min(100, Math.round((passedPasswordRules / passwordRules.length) * 100));
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

  return (
    <div className="forgot-password2-container">
      <main className="forgot-password2-main">
        <div className="background-effects">
          <div className="bg-effect-top"></div>
          <div className="bg-effect-bottom"></div>
        </div>

        <div className="forgot-password2-card">
          <div className="brand-header">
            <img
              alt="Chef Duo Logo"
              className="logo"
              src="/public/logo.png"
            />
            <h1 className="brand-title">Set New Password</h1>
            <p className="brand-subtitle">
              Create a new password for {email} below.
            </p>
          </div>

          {successMessage && (
            <div className="success-message">{successMessage}</div>
          )}

          <form onSubmit={handleSubmit} className="forgot-password2-form">
            <div className="form-group">
              <label className="form-label" htmlFor="password">
                New Password
              </label>
              <div className="input-with-icon">
                <FaLock className="input-icon" />
                <input
                  className={`form-input ${errors.password ? 'input-error' : ''}`}
                  id="password"
                  placeholder="Enter new password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleChange}
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
              {errors.password && (
                <div className="error-message">{errors.password}</div>
              )}
              {formData.password.length > 0 && (
                <div className="password-strength-card">
                  <div className="password-strength-header">
                    <span className="strength-label">Password strength</span>
                    <span className={`strength-value ${passwordStrengthPercent >= 100 ? 'strong' : ''}`}>
                      {strengthLabel}
                    </span>
                  </div>
                  <div className="strength-bar-track" aria-hidden="true">
                    <div
                      className={`strength-bar-fill ${
                        passwordStrengthPercent >= 100
                          ? 'strong'
                          : passwordStrengthPercent >= 80
                            ? 'good'
                            : passwordStrengthPercent >= 40
                              ? 'fair'
                              : 'weak'
                      }`}
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
                Confirm New Password
              </label>
              <div className="input-with-icon">
                <FaLock className="input-icon" />
                <input
                  className={`form-input ${errors.confirmPassword ? 'input-error' : ''}`}
                  id="confirmPassword"
                  placeholder="Confirm your password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  disabled={loading}
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {errors.confirmPassword && (
                <span className="error-message">{errors.confirmPassword}</span>
              )}
            </div>

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <FaSpinner className="spinner" />
                  Updating Password...
                </>
              ) : (
                'Reset Password'
              )}
            </button>
          </form>

          <div className="auth-links">
            <Link className="back-link" to="/login">
              <FaArrowLeft />
              Back to Login
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ForgotPassword2;