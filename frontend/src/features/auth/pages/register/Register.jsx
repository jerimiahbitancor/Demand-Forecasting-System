// frontend/src/features/auth/pages/register/Register.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { 
  FaUser, 
  FaEnvelope, 
  FaSpinner,
  FaShieldAlt,
  FaLock
} from 'react-icons/fa';
import { FiX } from 'react-icons/fi';
import { useAuth } from '../../../../context/AuthContext';
import './Register.css';
import { useSetupGuard } from '../../../../hooks/useSetupGuard'; 

const Register = () => {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const checking = useSetupGuard('register');
  
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    terms: false,
  });

  const [focusedInput, setFocusedInput] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

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
    
    if (!formData.terms) {
      newErrors.terms = 'You must agree to the terms and conditions';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (validateForm()) {
      Swal.fire({
        title: 'Sending verification code...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      const result = await register({
        fullName: formData.fullName,
        email: formData.email,
        terms: formData.terms
      });

      Swal.close();
      
      if (result.success) {
        await Swal.fire({
          icon: 'success',
          title: 'OTP Sent',
          text: 'A verification code has been sent to your email.',
          timer: 1800,
          showConfirmButton: false,
        });

        navigate('/verify-email');
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
            {/* Full Name */}
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

            {/* Email */}
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

            {/* Terms */}
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

            {/* Submit Button */}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <FaSpinner className="spinner" />
                  Sending Code...
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
        <button className="modal-close" onClick={closeTerms}>
          <FiX />
        </button>
      </div>
      <div className="modal-body">
        <div className="modal-section">
          <h3>Welcome to ChefDuo Forecast</h3>
          <p>
            These Terms and Conditions govern your access to and use of the system. By accessing or using ChefDuo Forecast, 
            you acknowledge that you have read, understood, and agreed to comply with these Terms. If you do not agree, 
            you must discontinue use of the system.
          </p>
        </div>

        <div className="modal-section">
          <h3>1. Acceptance of Terms</h3>
          <p>
            By accessing or using ChefDuo Forecast, you acknowledge that you have read, understood, and agree to be bound 
            by these Terms and Conditions. If you do not agree with any part of these Terms, you must discontinue use of 
            the system.
          </p>
          <p style={{ marginTop: '8px' }}>
            ChefDuo reserves the right to update or modify these Terms and Conditions at any time. Any changes will take 
            effect upon publication within the system. Your continued use of ChefDuo Forecast after such changes constitutes 
            your acceptance of the revised Terms.
          </p>
        </div>

        <div className="modal-section">
          <h3>2. Data Collection and Privacy</h3>
          <p>
            ChefDuo Forecast collects and processes information necessary for system functionality, including:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>User account information</li>
            <li>Sales and transaction records</li>
            <li>Product and inventory data</li>
            <li>Ingredient usage data</li>
            <li>System usage information</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            The collected information is used solely to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Generate sales forecasts and demand predictions</li>
            <li>Produce inventory and ingredient recommendations</li>
            <li>Improve forecasting accuracy and system performance</li>
            <li>Generate reports and analytics</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            ChefDuo does not sell, rent, or disclose user information to third parties except when required by law.
          </p>
          <p style={{ marginTop: '8px' }}>
            All personal information is collected, processed, stored, and protected in accordance with the 
            <strong> Data Privacy Act of 2012 (Republic Act No. 10173)</strong> and its Implementing Rules and Regulations.
          </p>
          <p style={{ marginTop: '8px' }}>
            Reasonable administrative, technical, and organizational safeguards are implemented to protect user information 
            from unauthorized access, alteration, disclosure, or loss.
          </p>
        </div>

        <div className="modal-section">
          <h3>3. System Usage</h3>
          <p>
            ChefDuo Forecast is designed to assist businesses in forecasting sales demand and estimating ingredient 
            requirements using historical sales data.
          </p>
          <p style={{ marginTop: '8px' }}>
            The forecasts and recommendations generated by the system are intended to support business planning and 
            decision-making. While predictive analytics are used to improve forecasting accuracy, all results are estimates 
            and should not be considered guarantees of future performance.
          </p>
          <p style={{ marginTop: '8px' }}>
            Actual sales and inventory requirements may vary due to market conditions, customer demand, seasonal factors, 
            supplier availability, and other circumstances beyond the system's control.
          </p>
        </div>

        <div className="modal-section">
          <h3>4. User Responsibilities</h3>
          <p>
            Users are responsible for:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Providing accurate, complete, and up-to-date information</li>
            <li>Maintaining the confidentiality of their account credentials</li>
            <li>Using the system only for lawful and authorized purposes</li>
            <li>Ensuring that uploaded sales and inventory data are accurate to produce reliable forecasting results</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            Users shall not:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Attempt to gain unauthorized access to the system or its database</li>
            <li>Upload malicious software, viruses, or harmful content</li>
            <li>Interfere with the operation or security of the system</li>
            <li>Use the system in violation of applicable laws and regulations</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>5. Disclaimer</h3>
          <p>
            ChefDuo Forecast is provided as a decision-support tool. Although reasonable efforts are made to produce 
            accurate forecasts and recommendations, the system does not guarantee the accuracy, completeness, or reliability 
            of its predictions.
          </p>
          <p style={{ marginTop: '8px' }}>
            Users acknowledge that forecasting results should be used alongside professional judgment and other relevant 
            business considerations. The developers are not responsible for business decisions or losses resulting from 
            reliance on the system's forecasts or recommendations.
          </p>
        </div>

        <div className="modal-section">
          <h3>6. Governing Law</h3>
          <p>
            These Terms and Conditions shall be governed by and interpreted in accordance with the laws of the 
            Republic of the Philippines, including but not limited to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li><strong>Republic Act No. 10173</strong> – Data Privacy Act of 2012</li>
            <li><strong>Republic Act No. 8792</strong> – Electronic Commerce Act of 2000</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            Any dispute arising from the use of ChefDuo Forecast shall first be resolved through good-faith discussion. 
            If no resolution is reached, the matter shall be subject to the jurisdiction of the appropriate courts of the 
            Republic of the Philippines.
          </p>
        </div>

        <div className="modal-section">
          <h3>7. Contact Information</h3>
          <p>
            For questions or concerns regarding these Terms and Conditions or the use of ChefDuo Forecast, users may 
            contact the system developers through the contact information provided by the institution or organization 
            responsible for the system.
          </p>
        </div>

        <div className="modal-footer-text">
          <button type="button" className="modal-agree-btn" onClick={closeTerms}>
            I Agree
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{/* Privacy Policy Modal */}
{showPrivacy && (
  <div className="modal-overlay" onClick={closePrivacy}>
    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-header-left">
          <FaShieldAlt className="modal-header-icon" />
          <h2>Privacy Policy</h2>
        </div>
        <button className="modal-close" onClick={closePrivacy}>
          <FiX />
        </button>
      </div>
      <div className="modal-body">
        <div className="modal-section">
          <h3>Welcome to ChefDuo Forecast</h3>
          <p>
            ChefDuo Forecast ("System") respects your privacy and is committed to protecting the personal information 
            you provide. This Privacy Policy explains how your information is collected, used, stored, and protected in 
            accordance with the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong> and its Implementing 
            Rules and Regulations.
          </p>
          <p style={{ marginTop: '8px' }}>
            By using ChefDuo Forecast, you acknowledge that you have read and understood this Privacy Policy.
          </p>
        </div>

        <div className="modal-section">
          <h3>1. Information We Collect</h3>
          <p>
            ChefDuo Forecast collects only the information necessary to provide forecasting and analytics services.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>Personal Information</strong>
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Name</li>
            <li>Email address</li>
            <li>Contact number</li>
            <li>Account credentials</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>Business Information</strong>
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Product and menu information</li>
            <li>Sales transaction records</li>
            <li>Inventory and ingredient data</li>
            <li>Historical sales records used for forecasting</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>System Information</strong>
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>IP address</li>
            <li>Browser or device information</li>
            <li>Login activity and system logs</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>2. How We Use Your Information</h3>
          <p>
            The information collected is used solely to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Generate sales forecasts and ingredient demand predictions</li>
            <li>Produce reports and analytics</li>
            <li>Improve forecasting accuracy and system performance</li>
            <li>Maintain the security and functionality of the system</li>
            <li>Provide technical support when necessary</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            ChefDuo Forecast does not sell, rent, or share personal information with third parties for advertising or 
            marketing purposes.
          </p>
        </div>

        <div className="modal-section">
          <h3>3. Data Protection</h3>
          <p>
            Reasonable administrative, technical, and organizational measures are implemented to safeguard personal 
            information against unauthorized access, disclosure, alteration, or loss.
          </p>
          <p style={{ marginTop: '8px' }}>
            Access to personal information is limited to authorized users and system administrators.
          </p>
        </div>

        <div className="modal-section">
          <h3>4. Data Retention</h3>
          <p>
            Personal information will be retained only for as long as necessary to fulfill the purposes of the system 
            or as required by applicable laws and institutional policies.
          </p>
          <p style={{ marginTop: '8px' }}>
            When no longer required, the information will be securely deleted or disposed of.
          </p>
        </div>

        <div className="modal-section">
          <h3>5. Disclosure of Information</h3>
          <p>
            Personal information will not be disclosed to third parties except:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>When required by law</li>
            <li>With the user's consent</li>
            <li>To protect the security and integrity of the system</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>6. Your Rights</h3>
          <p>
            In accordance with the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>, users have the 
            right to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Access their personal information</li>
            <li>Request correction of inaccurate or incomplete information</li>
            <li>Request deletion of personal information, subject to applicable legal requirements</li>
            <li>File a complaint with the National Privacy Commission (NPC) if they believe their privacy rights have been violated</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>7. Cookies</h3>
          <p>
            ChefDuo Forecast may use cookies or similar technologies to maintain user sessions and improve system 
            functionality. These cookies are used solely for operational purposes and not for advertising or marketing.
          </p>
          <p style={{ marginTop: '8px' }}>
            Users may manage cookie settings through their web browser. Disabling cookies may affect certain system 
            features.
          </p>
        </div>

        <div className="modal-section">
          <h3>8. Data Breach Notification</h3>
          <p>
            In the event of a data breach involving personal information, ChefDuo Forecast will take appropriate measures 
            to contain the incident and notify affected users and the National Privacy Commission (NPC) when required 
            under the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>.
          </p>
        </div>

        <div className="modal-section">
          <h3>9. Changes to this Privacy Policy</h3>
          <p>
            ChefDuo Forecast may update this Privacy Policy from time to time to reflect changes in the system or 
            applicable laws. Any updates will be posted within the system and will take effect upon publication.
          </p>
          <p style={{ marginTop: '8px' }}>
            Continued use of the system after such updates signifies acknowledgment of the revised Privacy Policy.
          </p>
        </div>

        <div className="modal-section">
          <h3>10. Contact Information</h3>
          <p>
            For questions or concerns regarding this Privacy Policy, please contact:
          </p>
          <div style={{ 
            background: 'rgba(254, 177, 97, 0.05)', 
            padding: '12px 16px', 
            borderRadius: '8px', 
            marginTop: '8px',
            border: '1px solid rgba(254, 177, 97, 0.1)'
          }}>
            <p style={{ margin: '4px 0', fontSize: '13px' }}>
              <strong>ChefDuo Forecast Support</strong>
            </p>
            <p style={{ margin: '4px 0', fontSize: '13px' }}>
              <strong>Email:</strong> BCF@gmail.com
            </p>
          
            <p style={{ margin: '4px 0', fontSize: '13px' }}>
              <strong>Address:</strong> Pasig City, Metro Manila, Philippines
            </p>
          </div>
        </div>

        <div className="modal-footer-text">
          <button type="button" className="modal-agree-btn" onClick={closePrivacy}>
            I Understand
          </button>
        </div>
      </div>
    </div>
  </div>
)}
    </div>
  );
};

export default Register;