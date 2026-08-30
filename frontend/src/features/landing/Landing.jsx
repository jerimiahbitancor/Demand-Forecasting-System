// frontend/src/features/landing/Landing.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Landing.css";
import bgImage from "../../assets/landing/bg.png";
import worksImage from "../../assets/landing/works.png";
import { FaCheck, FaTimes, FaLock, FaShieldAlt } from "react-icons/fa";
import { FiX } from "react-icons/fi";
import ctaImage from "../../assets/landing/client.png";

const Landing = () => {
  const navigate = useNavigate();
  const [hasUser, setHasUser] = useState(null);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    const checkUserExists = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || "http://localhost:5000/api"}/auth/setup`,
          {
            cache: "no-store",
          },
        );
        const result = await response.json();

        if (result?.success === true && typeof result.hasUser === "boolean") {
          setHasUser(result.hasUser);
        }
      } catch (error) {
        console.error("Error checking user:", error);
      }
    };

    checkUserExists();
  }, []);

  const handleGetStarted = () => {
    if (hasUser === true) {
      navigate("/login");
    } else {
      navigate("/register");
    }
  };

  const openTerms = (e) => {
    e.preventDefault();
    setShowTerms(true);
    document.body.style.overflow = "hidden";
  };

  const closeTerms = () => {
    setShowTerms(false);
    document.body.style.overflow = "unset";
  };

  const openPrivacy = (e) => {
    e.preventDefault();
    setShowPrivacy(true);
    document.body.style.overflow = "hidden";
  };

  const closePrivacy = () => {
    setShowPrivacy(false);
    document.body.style.overflow = "unset";
  };

  return (
    <div
      className="landing-wrapper"
      style={{ backgroundImage: `url(${bgImage})` }}
    >
      {/* Hero Section */}
      <header className="hero-wrapper">
        <h1 className="hero-heading">
          Smarter Demand Planning <br /> for Better Supply Decisions
        </h1>
        <p className="hero-text">
          ChefDuo Forecast uses historical sales data to predict future product
          demand, estimate ingredient needs, and provide data-driven insights to
          support inventory and replenishment decisions.
        </p>
        <p className="hero-highlight">
          <em>
            Turn historical sales data into actionable demand insights for your
            food service operations.
          </em>
        </p>
        <button className="btn-landing" onClick={handleGetStarted}>
          Get Started
        </button>
        <p className="scroll-indicator">Scroll to see how it works</p>
      </header>

      {/* Features Section */}
      <section className="features-wrapper">
        <div className="features-header">
          <h2 className="features-label">WHAT THE SYSTEM DOES</h2>
          <h3 className="features-title">What ChefDuo Forecast Can Do</h3>
          <p className="features-description">
            ChefDuo Forecast combines demand forecasting, product analysis,
            ingredient demand estimation, and inventory information to provide
            decision-support insights for daily food service operations.
          </p>
        </div>

        <div className="features-grid">
          <div className="feature-item">
            <h4 className="feature-name">Demand Forecasting</h4>
            <p className="feature-info">
              Analyze historical sales data and generate daily and weekly
              forecasts for product demand using XGBoost.
            </p>
          </div>

          <div className="feature-item">
            <h4 className="feature-name">Product Performance</h4>
            <p className="feature-info">
              Classify products by demand level and evaluate performance against
              store-level sales patterns.
            </p>
          </div>

          <div className="feature-item">
            <h4 className="feature-name">Ingredient Demand</h4>
            <p className="feature-info">
              Estimate future ingredient needs by combining predicted product
              demand with recipe quantities.
            </p>
          </div>

          <div className="feature-item">
            <h4 className="feature-name">Inventory Management</h4>
            <p className="feature-info">
              Record and monitor ingredient stock information to help compare
              available inventory with forecasted ingredient needs.
            </p>
          </div>

          <div className="feature-item">
            <h4 className="feature-name">Replenishment Support</h4>
            <p className="feature-info">
              Compare forecasted ingredient needs with available stock to
              identify ingredients that may require replenishment.
            </p>
          </div>

          <div className="feature-item">
            <h4 className="feature-name">Decision Support</h4>
            <p className="feature-info">
              Bring forecasts, product performance, ingredient needs, and
              inventory information together to support data-driven operational
              decisions.
            </p>
          </div>
        </div>
      </section>

      <section className="works-section">
        <div className="works-content">
          <h2 className="works-label">HOW IT WORKS</h2>
          <h3 className="works-title">How ChefDuo Forecast Works</h3>
          <p className="works-description">
            ChefDuo Forecast transforms historical sales information into demand
            forecasts and supply-chain decision-support insights through a
            series of data-driven steps.
          </p>
          <div className="works-features">
            <div className="works-features-image">
              <img
                src={worksImage}
                alt="ChefDuo Forecast Dashboard"
                className="works-features-img"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="explore-section">
        <div className="explore-content">
          <h2 className="explore-label">EXPLORE THE SYSTEM</h2>
          <h3 className="explore-title">Explore ChefDuo Forecast</h3>
          <p className="explore-description">
            Explore the system's modules for managing sales data, monitoring
            inventory, analyzing demand, and configuring forecasting and
            operational parameters.
          </p>
        </div>

        {/* Top Row - 2 items */}
        <div className="explore-top-row">
          <div className="explore-item">
            <h4 className="explore-name">Dashboard</h4>
            <p className="explore-info">
              Analyze historical sales data and generate daily and weekly
              forecasts for product demand using XGBoost.
            </p>
          </div>

          <div className="explore-item">
            <h4 className="explore-name">Data Management</h4>
            <p className="explore-info">
              Classify products by demand level and evaluate performance against
              store-level sales patterns.
            </p>
          </div>
        </div>

        {/* Bottom Row - 3 items */}
        <div className="explore-bottom-row">
          <div className="explore-item">
            <h4 className="explore-name">Inventory Management</h4>
            <p className="explore-info">
              Record and monitor ingredient stock information to help compare
              available inventory with forecasted ingredient needs.
            </p>
          </div>

          <div className="explore-item">
            <h4 className="explore-name">Analytics</h4>
            <p className="explore-info">
              Compare forecasted ingredient needs with available stock to
              identify ingredients that may require replenishment.
            </p>
          </div>

          <div className="explore-item">
            <h4 className="explore-name">Decision Support</h4>
            <p className="explore-info">
              Bring forecasts, product performance, ingredient needs, and
              inventory information together to support data-driven operational
              decisions.
            </p>
          </div>
        </div>
      </section>

      <section className="built-section">
        <div className="built-content">
          <h2 className="built-label">System Scope and Limitation</h2>
          <h3 className="built-title">Built for Decision Support</h3>
          <p className="built-description">
            ChefDuo Forecast provides information to support planning and
            inventory decisions. It does not automatically purchase ingredients,
            manage suppliers, or arrange deliveries.
          </p>

          <div className="built-supports">
            <div className="built-supports-column">
              <h4 className="built-supports-title">The system supports</h4>
              <ul className="built-supports-list">
                <li className="built-supports-item support-yes">
                  <span className="built-supports-icon">
                    <FaCheck />
                  </span>
                  Demand forecasting
                </li>
                <li className="built-supports-item support-yes">
                  <span className="built-supports-icon">
                    <FaCheck />
                  </span>
                  Product performance analysis
                </li>
                <li className="built-supports-item support-yes">
                  <span className="built-supports-icon">
                    <FaCheck />
                  </span>
                  Ingredient demand estimation
                </li>
                <li className="built-supports-item support-yes">
                  <span className="built-supports-icon">
                    <FaCheck />
                  </span>
                  Inventory monitoring
                </li>
                <li className="built-supports-item support-yes">
                  <span className="built-supports-icon">
                    <FaCheck />
                  </span>
                  Replenishment decision support
                </li>
              </ul>
            </div>

            <div className="built-supports-column">
              <h4 className="built-supports-title">
                The system does not support
              </h4>
              <ul className="built-supports-list">
                <li className="built-supports-item support-no">
                  <span className="built-supports-icon">
                    <FaTimes />
                  </span>
                  Automatically purchase ingredients
                </li>
                <li className="built-supports-item support-no">
                  <span className="built-supports-icon">
                    <FaTimes />
                  </span>
                  Manage suppliers
                </li>
                <li className="built-supports-item support-no">
                  <span className="built-supports-icon">
                    <FaTimes />
                  </span>
                  Process purchase orders
                </li>
                <li className="built-supports-item support-no">
                  <span className="built-supports-icon">
                    <FaTimes />
                  </span>
                  Manage deliveries or logistics
                </li>
                <li className="built-supports-item support-no">
                  <span className="built-supports-icon">
                    <FaTimes />
                  </span>
                  Replace business-owner decisions
                </li>
              </ul>
            </div>
          </div>
          <div className="built-disclaimer">
            <p className="built-disclaimer-text">
              <span className="bold">Your data, your decisions</span>. ChefDuo
              Forecast uses your provided business data to generate forecasting
              and decision-support information. Forecast results are estimates
              and should be interpreted together with actual business conditions
              and the owner's operational judgment.
            </p>
          </div>
        </div>
      </section>

      <section className="req-section">
        <div className="req-content">
          <h2 className="req-label">DATA REQUIREMENTS</h2>
          <h3 className="req-title">What Data Do You Need</h3>
          <p className="req-description">
            ChefDuo Forecast uses historical sales information to identify
            demand patterns and generate forecasts.
          </p>

          <div className="req-data-grid">
            <div className="req-data-card">
              <h4 className="req-data-title">Supported Formats</h4>
              <div className="req-data-formats">
                <span className="req-data-format">CSV</span>
                <span className="req-data-format">XLSX</span>
              </div>
              <h4 className="req-data-title">Required Fields</h4>
              <ul className="req-data-list">
                <span className="req-data-format">Item Name</span>
                <span className="req-data-format">Category</span>
                <span className="req-data-format">Item Sold</span>
                <span className="req-data-format">Gross Sales</span>
                <span className="req-data-format">Refunds</span>
                <span className="req-data-format">Net Sales</span>
              </ul>
            </div>

            <div className="req-note">
              <p className="req-note-text">
                <strong>Product Performance</strong>
                <br />
                Upload at least 12 months of sales history for reliable
                forecasts. If you have 12 months or more, upload everything.
              </p>
              <p className="req-note-subtext">
                More historical data can help the system identify recurring
                patterns such as weekday and weekend behavior, seasonal
                patterns, and payday-related demand variations.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="cta-content">
          <div className="cta-image">
            <img
              src={ctaImage}
              alt="ChefDuo Forecast Dashboard"
              className="cta-img"
            />
          </div>

          <div className="cta-text">
            <h2 className="req-title">
              Ready to Make Better Demand Decisions?
            </h2>
            <p className="req-description">
              Start using ChefDuo Forecast to transform your historical sales
              data into forecasts, ingredient requirements, inventory insights,
              and replenishment decision support.
            </p>
            <div className="cta-buttons">
              <button className="cta-btn" onClick={handleGetStarted}>
                Let's Dive In!
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer-section">
        <div className="footer-content">
          <p className="footer-text">
            © 2026 ChefDuo Forecast · Demand Forecasting and Supply Chain Decision Support System
          </p>
          <div className="footer-links">
            <a href="#" className="footer-link" onClick={openPrivacy}>
              Privacy Policy
            </a>
            <span className="footer-divider">·</span>
            <a href="#" className="footer-link" onClick={openTerms}>
              Terms and Conditions
            </a>
          </div>
        </div>
      </footer>

      {/* Terms and Conditions Modal */}
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

export default Landing;