import { useState, useEffect } from 'react';
import { FiCheckCircle } from "react-icons/fi";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../config/supabase';
import "./AccountSettings.css";

function AccountSettings() {
  const { user, loading, getToken, logout, syncUser } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [loadingAction, setLoadingAction] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [timer, setTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalStage, setModalStage] = useState('verify');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [lastChanged, setLastChanged] = useState('Not set');
  const [modalMessage, setModalMessage] = useState('');
  const [newPasswordPending, setNewPasswordPending] = useState('');

  const formatDateTime = (dateValue) => {
    if (!dateValue) return 'Not set';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return dateValue;
    return date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
      setIsLoading(false);
    } else if (!loading) {
      setIsLoading(false);
    }
  }, [user, loading]);

  useEffect(() => {
    const timestamp = user?.last_password_change || user?.updated_at;
    if (timestamp) {
      setLastChanged(formatDateTime(timestamp));
    } else {
      setLastChanged('Not set');
    }
  }, [user?.last_password_change, user?.updated_at]);

  useEffect(() => {
    if (!modalVisible) return;

    if (timer > 0 && !canResend) {
      const interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
    if (timer === 0 && !canResend) {
      setCanResend(true);
    }
  }, [timer, canResend, modalVisible]);

  const fetchWithTimeout = async (url, opts = {}, timeout = 10000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      clearTimeout(id);
      return { res, data };
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  };

  const handleSendCode = async () => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const token = await getToken();

    if (!token) {
      toast.error('Not authenticated. Please log in again.');
      return;
    }

    setErrors({});
    setLoadingAction(true);

    try {
      const { res, data } = await fetchWithTimeout(`${API_URL}/settings/account/change-password/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }, 10000);

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send verification code');
      }

      setTimer(60);
      setCanResend(false);
      setCode('');
      setPassword('');
      setConfirmPassword('');
      setModalStage('verify');
      setModalMessage('Enter the 6-digit verification code sent to your email.');
      toast.success('Verification code sent to your email.');
      setModalVisible(true);
    } catch (err) {
      toast.error(err.message || 'Failed to send verification code');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleResendCode = async () => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const token = await getToken();

    if (!token) {
      toast.error('Not authenticated. Please log in again.');
      return;
    }

    setErrors({});
    setResendLoading(true);

    try {
      const { res, data } = await fetchWithTimeout(`${API_URL}/settings/account/change-password/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }, 10000);

      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend verification code');
      }

      setTimer(60);
      setCanResend(false);
      setCode('');
      setModalMessage('A new verification code has been sent to your email.');
    } catch (err) {
      toast.error(err.message || 'Failed to resend verification code');
    } finally {
      setResendLoading(false);
    }
  };

  const verifyCodeRequest = async (inputCode) => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const token = await getToken();

    if (!token) {
      return { success: false, error: 'Not authenticated. Please log in again.' };
    }

    try {
      const { res, data } = await fetchWithTimeout(`${API_URL}/settings/account/change-password/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: inputCode })
      }, 10000);

      if (!res.ok) {
        return { success: false, error: data.error || 'Verification failed' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || 'Verification failed' };
    }
  };

  const changePasswordRequest = async (codeValue, passwordValue) => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    const token = await getToken();

    if (!token) {
      return { success: false, error: 'Not authenticated. Please log in again.' };
    }

    try {
      const { res, data } = await fetchWithTimeout(`${API_URL}/settings/account/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: codeValue, password: passwordValue })
      }, 10000);

      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to change password' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || 'Failed to change password' };
    }
  };

  const getPasswordRules = (value) => [
    { test: value.length >= 8, message: 'Minimum 8 characters' },
    { test: /[A-Z]/.test(value), message: 'One uppercase letter' },
    { test: /[a-z]/.test(value), message: 'One lowercase letter' },
    { test: /\d/.test(value), message: 'One number' },
    { test: /[^A-Za-z0-9]/.test(value), message: 'One special character' },
  ];

  const handleModalConfirm = async () => {
    if (modalStage === 'verify') {
      if (!code.trim()) {
        toast.error('Please enter the 6-digit verification code.');
        setErrors({ code: 'Please enter the verification code' });
        return;
      }
      if (code.length < 6) {
        toast.error('Code must be 6 digits.');
        setErrors({ code: 'Code must be 6 digits' });
        return;
      }

      const result = await verifyCodeRequest(code);
      if (!result.success) {
        toast.error(result.error || 'Verification failed');
        setErrors({ code: result.error });
        return;
      }

      setModalStage('password');
      setErrors({});
      setModalMessage('Create your new password below.');
      toast.success('OTP verified successfully.');
      return;
    }

    if (modalStage === 'password') {
      const newErrors = {};
      const rules = getPasswordRules(password);
      const failedRules = rules.filter((rule) => !rule.test);

      if (!password.trim()) {
        newErrors.password = 'Please enter your new password';
      } else if (failedRules.length) {
        newErrors.password = 'Password must meet all requirements';
      }
      if (!confirmPassword.trim()) {
        newErrors.confirmPassword = 'Please confirm your new password';
      } else if (password !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        toast.error(newErrors.password || newErrors.confirmPassword);
        return;
      }
      if (!code) {
        setErrors({ code: 'Code is required to change password' });
        setModalStage('verify');
        toast.error('Verification code is required to change your password.');
        return;
      }

      const result = await changePasswordRequest(code, password);
      if (!result.success) {
        toast.error(result.error || 'Update failed');
        setErrors({ password: result.error });
        return;
      }

      setNewPasswordPending(password);
      setLastChanged(formatDateTime(new Date()));
      setModalStage('success');
      setModalMessage('Your password was updated successfully.');
      toast.success('Password changed successfully.');
      return;
    }
  };

  const closeModal = () => {
    setModalVisible(false);
    setModalStage('sent');
    setModalMessage('');
    setCode('');
    setPassword('');
    setConfirmPassword('');
    setErrors({});
    setTimer(60);
    setCanResend(false);
  };

  const handleStayLoggedIn = async () => {
    const reauth = await reauthenticateUser(newPasswordPending);
    closeModal();
    if (!reauth.success) {
      await logout();
      toast.error('Your password was changed. Please log in again.');
      return;
    }
    toast.success('You are still logged in after changing your password.');
  };

  const handleLogout = async () => {
    await logout();
    closeModal();
    toast.success('You have been signed out successfully.');
  };

  const reauthenticateUser = async (passwordValue) => {
    if (!user?.email) {
      return { success: false, error: 'User email is not available.' };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: passwordValue,
    });

    if (error || !data?.session) {
      return { success: false, error: error?.message || 'Unable to refresh session. Please log in again.' };
    }

    await syncUser();
    return { success: true };
  };

  const renderModalContent = () => {
    if (!modalVisible) return null;

    if (modalStage === 'verify') {
      return (
        <div className="account-modal-card">
          <h2 className="modal-title">Verify Code</h2>
          <p className="modal-text">{modalMessage}</p>
          <div className="forgot-password-form">
            <div className="form-group">
              <label htmlFor="account-otp" className="form-label">Verification Code</label>
              <input
                id="account-otp"
                type="text"
                className="form-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                autoComplete="one-time-code"
              />
              {errors.code && <div className="error-message">{errors.code}</div>}
            </div>
            <div className="resend-section">
              <button
                type="button"
                className="resend-btn"
                disabled={!canResend || resendLoading}
                onClick={handleResendCode}
              >
                Resend Code
              </button>
              <div className="timer-text">{canResend ? 'You can resend now.' : `Resend in ${timer}s`}</div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={closeModal}>
              Cancel
            </button>
            <button className="btn-primary" type="button" onClick={handleModalConfirm}>
              Verify Code
            </button>
          </div>
        </div>
      );
    }

    if (modalStage === 'password') {
      const rules = getPasswordRules(password);
      return (
        <div className="account-modal-card">
          <h2 className="modal-title">Create New Password</h2>
          <p className="modal-text">{modalMessage}</p>
          <div className="forgot-password-form">
            <div className="form-group">
              <label htmlFor="account-password" className="form-label">New Password</label>
              <div className="input-with-icon">
                <input
                  id="account-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {errors.password && <div className="error-message">{errors.password}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="account-confirm-password" className="form-label">Confirm Password</label>
              <div className="input-with-icon">
                <input
                  id="account-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {errors.confirmPassword && <div className="error-message">{errors.confirmPassword}</div>}
            </div>
            {password.length > 0 && (
              <div className="password-requirements">
                <p className="requirements-heading">Password must include:</p>
                <ul className="requirements-list">
                  {rules.map((rule) => (
                    <li key={rule.message} className={rule.test ? 'valid' : 'invalid'}>
                      <span className="requirement-icon">{rule.test ? '✓' : '•'}</span>
                      {rule.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={closeModal}>
              Cancel
            </button>
            <button className="btn-primary" type="button" onClick={handleModalConfirm}>
              Change Password
            </button>
          </div>
        </div>
      );
    }

    if (modalStage === 'success') {
      return (
        <div className="account-modal-card">
          <h2 className="modal-title">Password Updated</h2>
          <p className="modal-text">{modalMessage}</p>
          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={handleLogout}>
              Log Out
            </button>
            <button className="btn-primary" type="button" onClick={handleStayLoggedIn}>
              Stay Logged In
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  if (isLoading || loading) {
    return (
      <div className="account-settings-container">
        <div className="loading-spinner">Loading account information...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="account-settings-container">
        <div className="error-message">Please log in to view account settings.</div>
      </div>
    );
  }

  return (
    <div className="account-settings-container">
      <section className="account-panel">
        <h2 className="account-heading">Account Information</h2>

        <div className="account-form">
          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="Enter your email address"
              value={email}
              readOnly
              disabled
            />
          </div>

          <div className="form-group">
            <p className="form-label">Email Status</p>
            <div className="status-row">
              <FiCheckCircle size={18} color="#0f8725" />
              <span className="status-badge">Verified</span>
            </div>
          </div>

          <div className="info-box">
            <p>
              <strong>INFO:</strong> This email is used for account login,
              password recovery, and security verification.
            </p>
          </div>
        </div>
      </section>

      <section className="account-panel password-panel">
        <div>
          <h3 className="account-subheading">Password Security</h3>
          <div className="password-meta">
            <p>
              <strong>Last Changed:</strong>
            </p>
            <p>{lastChanged}</p>
          </div>
        </div>

        <div>
          <p className="form-label">Password Requirements:</p>
          <ul className="requirements-list">
            <li>Minimum 8 characters</li>
            <li>One uppercase letter</li>
            <li>One lowercase letter</li>
            <li>One number</li>
            <li>One special character</li>
          </ul>
        </div>

        <button
          className="password-button"
          type="button"
          onClick={handleSendCode}
          disabled={loadingAction}
        >
          {loadingAction ? 'Sending code...' : 'CHANGE PASSWORD'}
        </button>
      </section>

      {modalVisible && (
        <div className="account-modal-overlay" role="dialog" aria-modal="true">
          {renderModalContent()}
        </div>
      )}
    </div>
  );
}

export default AccountSettings;
