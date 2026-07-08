import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FaEnvelope,
  FaKey,
  FaArrowLeft,
  FaSpinner,
} from 'react-icons/fa';
import './forgotpass.css';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '' });
  const [code, setCode] = useState('');
  const [focusedInput, setFocusedInput] = useState(null);
  const [errors, setErrors] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { value } = e.target;
    setFormData((prev) => ({ ...prev, email: value }));
    if (errors.email) {
      setErrors((prev) => ({ ...prev, email: '' }));
    }
    setStatusMessage('');
  };

  const handleCodeChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
    if (errors.code) {
      setErrors((prev) => ({ ...prev, code: '' }));
    }
  };

  const validateEmail = () => {
    const newErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSendCode = (e) => {
    e.preventDefault();
    if (!validateEmail()) return;

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setCodeSent(true);
      setStatusMessage(`A 6-digit verification code was sent to ${formData.email}.`);
    }, 600);
  };

  const handleVerifyCode = (e) => {
    e.preventDefault();
    const newErrors = {};

    if (!code.trim()) {
      newErrors.code = 'Please enter the verification code';
    } else if (code.length < 6) {
      newErrors.code = 'Code must be 6 digits';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        navigate('/forgot-password/reset', { state: { email: formData.email } });
      }, 500);
    }
  };

  const getIconColor = (inputId) => {
    return focusedInput === inputId ? '#bb0114' : '#6c757d';
  };

  return (
    <div className="forgot-password-container">
      <main className="forgot-password-main">
        <div className="background-effects">
          <div className="bg-effect-top"></div>
          <div className="bg-effect-bottom"></div>
        </div>

        <div className="forgot-password-card">
          <div className="brand-header">
            <img
              alt="Chef Duo Logo"
              className="logo"
              src="/public/logo.png"
            />
            <h1 className="brand-title">Forgot Password</h1>
            <p className="brand-subtitle">
              {codeSent
                ? 'Enter the verification code we sent to your email. Once it is confirmed, you will continue to the next step to create a new password.'
                : 'Enter your email address and we will send you a code to reset your password.'}
            </p>
          </div>

          {statusMessage && (
            <div className="status-message">{statusMessage}</div>
          )}

          {!codeSent ? (
            <form onSubmit={handleSendCode} className="forgot-password-form">
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

              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <FaSpinner className="spinner" />
                    Sending...
                  </>
                ) : (
                  'Send Code'
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="forgot-password-form">
              <div className="form-group">
                <label className="form-label" htmlFor="code">
                  Verification Code
                </label>
                <div className="input-with-icon">
                  <FaKey
                    className="input-icon"
                    style={{ color: getIconColor('code') }}
                  />
                  <input
                    className={`form-input ${errors.code ? 'input-error' : ''}`}
                    id="code"
                    placeholder="Enter 6-digit code"
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={handleCodeChange}
                    onFocus={() => setFocusedInput('code')}
                    onBlur={() => setFocusedInput(null)}
                    disabled={loading}
                  />
                </div>
                {errors.code && <span className="error-message">{errors.code}</span>}
              </div>

              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <FaSpinner className="spinner" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Continue'
                )}
              </button>
            </form>
          )}

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

export default ForgotPassword;
