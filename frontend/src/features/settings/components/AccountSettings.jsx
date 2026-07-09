import { useState, useEffect } from 'react';
import { FiCheckCircle } from "react-icons/fi";
import { useAuth } from '../../../context/AuthContext';
import Swal from 'sweetalert2';
import "./AccountSettings.css";

function AccountSettings() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // When user data is available from context, set the email
    if (user) {
      setEmail(user.email || '');
      setIsLoading(false);
    } else if (!loading) {
      // If loading is complete and no user, user is not authenticated
      setIsLoading(false);
    }
  }, [user, loading]);

  // Handle change password functionality
  const handleChangePassword = async () => {
    // You'll implement this later
    Swal.fire({
      title: 'Change Password',
      text: 'This feature will be implemented soon',
      icon: 'info',
      confirmButtonColor: '#bb0114',
    });
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
            <p>{user.last_password_change || 'Not set'}</p>
          </div>
        </div>

        <div>
          <p className="form-label">Password Requirements:</p>
          <ul className="requirements-list">
            <li>Minimum 12 characters</li>
            <li>One uppercase letter</li>
            <li>One lowercase letter</li>
            <li>One number</li>
            <li>One special character</li>
          </ul>
        </div>

        <button 
          className="password-button" 
          onClick={handleChangePassword}
        >
          CHANGE PASSWORD
        </button>
      </section>
    </div>
  );
}

export default AccountSettings;