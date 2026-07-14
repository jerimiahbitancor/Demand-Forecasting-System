// frontend/src/features/auth/pages/register/VerifyEmail.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { FaEnvelope, FaKey, FaSpinner, FaArrowLeft } from 'react-icons/fa';
import { useAuth } from '../../../../context/AuthContext';
import './VerifyEmail.css';

const VerifyEmail = () => {
  const navigate = useNavigate();
  const { verifyOTP, resendOTP, registrationData, user } = useAuth();
  
  // ✅ Get data from AuthContext
  const email = registrationData?.email;
  const userId = registrationData?.userId;
  
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [timer, setTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [errors, setErrors] = useState({});
  const [focusedInput, setFocusedInput] = useState(null);

  useEffect(() => {
    if (!email || !userId) {
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
  }, [email, userId, navigate]);

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
      const result = await verifyOTP(email, otp, userId);

      setLoading(false);
      Swal.close();

      if (result.success) {
        await Swal.fire({
          icon: 'success',
          title: 'Verified!',
          text: 'Your email has been verified. Continue to create your password.',
          timer: 1700,
          showConfirmButton: false,
        });

        // ✅ No state needed! AuthContext has the data
        navigate('/create-password');
      } else {
        throw new Error(result.error);
      }

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
      const result = await resendOTP(email, userId);

      if (result.success) {
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
      } else {
        throw new Error(result.error);
      }

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
              'Verify Code'
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
        </form>
      </div>
    </div>
  );
};

export default VerifyEmail;