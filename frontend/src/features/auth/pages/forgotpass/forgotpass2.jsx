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

const ForgotPassword2 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || 'your email';

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

  const validatePassword = (password) => {
    const requirements = [
      { test: password.length >= 12, message: 'Minimum 12 characters' },
      { test: /[A-Z]/.test(password), message: 'One uppercase letter' },
      { test: /[a-z]/.test(password), message: 'One lowercase letter' },
      { test: /\d/.test(password), message: 'One number' },
      { test: /[^A-Za-z0-9]/.test(password), message: 'One special character' },
    ];

    return requirements.filter((rule) => !rule.test);
  };

  const validateForm = () => {
    const newErrors = {};

    const failedRequirements = validatePassword(formData.password);
    if (failedRequirements.length) {
      newErrors.password = 'Password must include:';
      newErrors.passwordRequirements = failedRequirements.map((rule) => rule.message);
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

    Swal.fire({
      title: 'Updating password...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    setLoading(true);
    setTimeout(async () => {
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
    }, 800);
  };

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
              {errors.passwordRequirements && (
                <ul className="requirements-list">
                  {errors.passwordRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
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
