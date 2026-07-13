// frontend/src/features/auth/pages/register/VerifyEmail.jsx
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Swal from 'sweetalert2';
import { FaEnvelope, FaKey, FaSpinner, FaArrowLeft } from 'react-icons/fa';
import { useAuth } from '../../../../context/AuthContext';
import './VerifyEmail.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const VerifyEmail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [timer, setTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [errors, setErrors] = useState({});
  const [focusedInput, setFocusedInput] = useState(null);

  // Get email from navigation state
  useEffect(() => {
    const state = location.state;
    if (state && state.email) {
      setEmail(state.email);
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Session Expired',
        text: 'Please register again.',
        timer: 1500,
        showConfirmButton: false,
      });
      navigate('/register');
    }
  }, [location, navigate]);

  // Timer for resend button
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setCanResend(true);
    }
  }, [timer]);

  const handleOtpChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setOtp(value);
    if (errors.otp) {
      setErrors((prev) => ({ ...prev, otp: '' }));
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    
    if (!otp.trim() || otp.length < 6) {
      setErrors({ otp: 'Please enter the complete 6-digit code' });
      return;
    }

    Swal.fire({
      title: 'Verifying code...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/verify-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          otp: otp
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      setLoading(false);
      Swal.close();

      // ✅ Supabase auto-stores session in localStorage!
      // No need for manual sessionStorage.setItem()
      
      // ✅ Just update auth context user state
      if (data.user && setUser) {
        setUser(data.user);
      }

      await Swal.fire({
        icon: 'success',
        title: 'Email Verified! 🎉',
        text: 'Your account has been successfully verified.',
        timer: 1500,
        showConfirmButton: false,
      });

      navigate('/landing', { replace: true });

    } catch (error) {
      setLoading(false);
      Swal.close();
      Swal.fire({
        icon: 'error',
        title: 'Verification Failed',
        text: error.message || 'Invalid or expired code. Please try again.',
      });
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    setErrors({});

    try {
      const response = await fetch(`${API_URL}/auth/resend-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend OTP');
      }

      setTimer(60);
      setCanResend(false);
      setOtp('');
      
      await Swal.fire({
        icon: 'info',
        title: 'OTP Resent',
        text: 'A new verification code has been sent to your email.',
        timer: 2000,
        showConfirmButton: false,
      });

    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to resend OTP. Please try again.',
      });
    } finally {
      setResendLoading(false);
    }
  };

  const getIconColor = (inputId) => {
    return focusedInput === inputId ? '#bb0114' : '#6c757d';
  };

  return (
    <div className="verify-email-container">
      <div className="verify-email-card">
        <div className="brand-header">
          <img
            alt="Chef Duo Logo"
            className="logo"
            src="/public/logo.png"
          />
          <h1 className="brand-title">Verify Your Email</h1>
          <p className="brand-subtitle">
            We've sent a 6-digit verification code to
          </p>
          <p className="email-display">{email}</p>
        </div>

        <form onSubmit={handleVerify} className="verify-email-form">
          <div className="form-group">
            <label className="form-label" htmlFor="otp">
              Verification Code
            </label>
            <div className="input-with-icon">
              <FaKey
                className="input-icon"
                style={{ color: getIconColor('otp') }}
              />
              <input
                className={`form-input ${errors.otp ? 'input-error' : ''}`}
                id="otp"
                placeholder="Enter 6-digit code"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={handleOtpChange}
                onFocus={() => setFocusedInput('otp')}
                onBlur={() => setFocusedInput(null)}
                disabled={loading}
              />
            </div>
            {errors.otp && <span className="error-message">{errors.otp}</span>}
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

          <div className="resend-section">
            {canResend ? (
              <button
                type="button"
                className="resend-btn"
                onClick={handleResend}
                disabled={resendLoading}
              >
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

          <div className="auth-links">
            <button
              type="button"
              className="back-link"
              onClick={() => navigate('/register')}
            >
              <FaArrowLeft />
              Back to Registration
            </button>
          </div>

          <div className="info-text">
            <FaEnvelope className="info-icon" />
            <p>
              Didn't receive the code? Check your spam folder or 
              <button 
                type="button" 
                className="resend-link"
                onClick={handleResend}
                disabled={resendLoading || !canResend}
              >
                request a new one
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VerifyEmail;