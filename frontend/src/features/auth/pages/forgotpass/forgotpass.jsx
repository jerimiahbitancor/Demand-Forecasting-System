import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  FaEnvelope,
  FaKey,
  FaArrowLeft,
  FaSpinner,
  FaRedo,
} from 'react-icons/fa';
import './forgotpass.css';

const API_URL = import.meta.env.VITE_API_URL;

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '' });
  const [code, setCode] = useState('');
  const [focusedInput, setFocusedInput] = useState(null);
  const [errors, setErrors] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  
  // Timer for resend button
  const [timer, setTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);

  // Timer effect
  useEffect(() => {
    if (codeSent && timer > 0) {
      const interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    } else if (timer === 0) {
      setCanResend(true);
    }
  }, [codeSent, timer]);

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

  const handleSendCode = async (e) => {
    e.preventDefault();
    if (!validateEmail()) return;

    Swal.fire({
      title: 'Sending code...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/forgot-password/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: formData.email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send code');
      }

      setLoading(false);
      Swal.close();
      
      // Reset timer
      setTimer(60);
      setCanResend(false);
      
      Swal.fire({
        icon: 'success',
        title: 'Code sent',
        text: `A 6-digit verification code was sent to ${formData.email}.`,
        timer: 1600,
        showConfirmButton: false,
      });
      setCodeSent(true);
      setStatusMessage(`A 6-digit verification code was sent to ${formData.email}.`);
    } catch (error) {
      setLoading(false);
      Swal.close();
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to send verification code. Please try again.',
      });
      console.error('Send code error:', error);
    }
  };

  // ✅ New: Resend Code function
  const handleResendCode = async () => {
    setResendLoading(true);
    setErrors({});

    try {
      const response = await fetch(`${API_URL}/auth/forgot-password/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: formData.email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend code');
      }

      // Reset timer
      setTimer(60);
      setCanResend(false);
      setCode(''); // Clear the old code

      Swal.fire({
        icon: 'success',
        title: 'Code Resent',
        text: `A new verification code was sent to ${formData.email}.`,
        timer: 1600,
        showConfirmButton: false,
      });
      
      setStatusMessage(`A new verification code was sent to ${formData.email}.`);
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to resend code. Please try again.',
      });
      console.error('Resend code error:', error);
    } finally {
      setResendLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    const newErrors = {};

    if (!code.trim()) {
      newErrors.code = 'Please enter the verification code';
    } else if (code.length < 6) {
      newErrors.code = 'Code must be 6 digits';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      Swal.fire({
        title: 'Verifying code...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      setLoading(true);
      try {
        const response = await fetch(`${API_URL}/auth/forgot-password/verify-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: formData.email,
            code: code,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Code verification failed');
        }

        setLoading(false);
        Swal.close();
        Swal.fire({
          icon: 'success',
          title: 'Code verified',
          text: 'Please create your new password.',
          timer: 1300,
          showConfirmButton: false,
        });
        
        // Navigate to reset password page with email and code
        navigate('/forgot-password/reset', { 
          state: { 
            email: formData.email,
            code: code 
          } 
        });
      } catch (error) {
        setLoading(false);
        Swal.close();
        Swal.fire({
          icon: 'error',
          title: 'Verification Failed',
          text: error.message || 'Invalid or expired code. Please try again.',
        });
        console.error('Verify code error:', error);
      }
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

              {/* ✅ NEW: Resend Code Section */}
              <div className="resend-section">
                {canResend ? (
                  <button
                    type="button"
                    className="resend-btn"
                    onClick={handleResendCode}
                    disabled={resendLoading}
                  >
                    <FaRedo className="resend-icon" />
                    {resendLoading ? (
                      <>
                        <FaSpinner className="spinner" />
                        Sending...
                      </>
                    ) : (
                      'Resend Code'
                    )}
                  </button>
                ) : (
                  <p className="timer-text">
                    Resend available in {timer} seconds
                  </p>
                )}
              </div>

              {/* Info text */}
              <div className="info-text">
                <FaEnvelope className="info-icon" />
                <p>
                  Didn't receive the code? Check your spam folder or 
                  <button 
                    type="button" 
                    className="resend-link"
                    onClick={handleResendCode}
                    disabled={resendLoading || !canResend}
                  >
                    request a new one
                  </button>
                </p>
              </div>
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