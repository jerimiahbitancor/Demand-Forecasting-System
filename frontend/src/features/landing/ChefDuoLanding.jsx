// ChefDuoLanding.jsx
import { useEffect, useRef, useState } from "react";
import Navbar from "../components/Navbar/Navbar";
import "./ChefDuoLanding.css";
import { FiUploadCloud, FiX } from "react-icons/fi";
import { FaShieldAlt, FaLock } from "react-icons/fa";
import { Link } from "react-router-dom";
// Import your images
import card1Img from "../../assets/landing/card1.png";
import card2Img from "../../assets/landing/card2.png";
import card3Img from "../../assets/landing/card3.png";
import Footer from "../components/Footer/Footer";

const ChefDuoLanding = () => {
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  
  const dashboardRef = useRef(null);
  const card1Ref = useRef(null);
  const card2Ref = useRef(null);
  const card3Ref = useRef(null);
  const fileInputRef = useRef(null);

  const dashCard1Ref = useRef(null);
  const dashCard2Ref = useRef(null);
  const dashCard3Ref = useRef(null);
  const dashCard4Ref = useRef(null);

  const analyticsCard1Ref = useRef(null);
  const analyticsCard2Ref = useRef(null);
  const analyticsCard3Ref = useRef(null);
  const analyticsCard4Ref = useRef(null);

  // Parallax effect for dashboard and floating cards
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dashboardRef.current) return;

      const mouseX = e.clientX / window.innerWidth;
      const mouseY = e.clientY / window.innerHeight;

      // Main dashboard rotation
      const rotX = 8 + (mouseY - 0.5) * 4;
      const rotY = -8 + (mouseX - 0.5) * 4;
      dashboardRef.current.style.transform = `rotateY(${rotY}deg) rotateX(${rotX}deg)`;

      // Floating card 1 - moves more in X direction
      if (card1Ref.current) {
        const x1 = (mouseX - 0.5) * 60;
        const y1 = (mouseY - 0.5) * 30;
        card1Ref.current.style.transform = `translate(${x1}px, ${y1}px) rotate(${x1 * 0.1}deg)`;
      }

      // Floating card 2 - moves more in Y direction
      if (card2Ref.current) {
        const x2 = (mouseX - 0.5) * 60;
        const y2 = (mouseY - 0.5) * 30;
        card2Ref.current.style.transform = `translate(${x2}px, ${y2}px) rotate(${x2 * 0.1}deg)`;
      }

      // Floating card 3 - moves the most
      if (card3Ref.current) {
        const x3 = (mouseX - 0.5) * 60;
        const y3 = (mouseY - 0.5) * 30;
        card3Ref.current.style.transform = `translate(${x3}px, ${y3}px) rotate(${x3 * 0.1}deg)`;
      }

      if (dashCard1Ref.current) {
        const dx1 = (mouseX - 0.5) * 25;
        const dy1 = (mouseY - 0.5) * 20;
        dashCard1Ref.current.style.transform = `translate(${dx1}px, ${dy1}px)`;
      }

      if (dashCard2Ref.current) {
        const dx2 = (mouseX - 0.5) * 25;
        const dy2 = (mouseY - 0.5) * 20;
        dashCard2Ref.current.style.transform = `translate(${dx2}px, ${dy2}px)`;
      }

      if (dashCard3Ref.current) {
        const dx3 = (mouseX - 0.5) * 25;
        const dy3 = (mouseY - 0.5) * 20;
        dashCard3Ref.current.style.transform = `translate(${dx3}px, ${dy3}px)`;
      }

      if (dashCard4Ref.current) {
        const dx4 = (mouseX - 0.5) * 25;
        const dy4 = (mouseY - 0.5) * 20;
        dashCard4Ref.current.style.transform = `translate(${dx4}px, ${dy4}px)`;
      }
    

     if (analyticsCard1Ref.current) {
        const dx1 = (mouseX - 0.5) * 25;
        const dy1 = (mouseY - 0.5) * 20;
        analyticsCard1Ref.current.style.transform = `translate(${dx1}px, ${dy1}px)`;
      }

      if (analyticsCard2Ref.current) {
        const dx2 = (mouseX - 0.5) * 25;
        const dy2 = (mouseY - 0.5) * 20;
        analyticsCard2Ref.current.style.transform = `translate(${dx2}px, ${dy2}px)`;
      }

      if (analyticsCard3Ref.current) {
        const dx3 = (mouseX - 0.5) * 25;
        const dy3 = (mouseY - 0.5) * 20;
        analyticsCard3Ref.current.style.transform = `translate(${dx3}px, ${dy3}px)`;
      }

      if (analyticsCard4Ref.current) {
        const dx4 = (mouseX - 0.5) * 25;
        const dy4 = (mouseY - 0.5) * 20;
        analyticsCard4Ref.current.style.transform = `translate(${dx4}px, ${dy4}px)`;
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Handle file upload
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      console.log("File selected:", file.name);
      alert(`File "${file.name}" selected for upload!`);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current.click();
  };

  // Modal Handlers
  const openTerms = (e) => {
    e.preventDefault();
    setShowTerms(true);
    document.body.style.overflow = 'hidden';
  };

  const closeTerms = () => {
    setShowTerms(false);
    document.body.style.overflow = 'auto';
  };

  const openPrivacy = (e) => {
    e.preventDefault();
    setShowPrivacy(true);
    document.body.style.overflow = 'hidden';
  };

  const closePrivacy = () => {
    setShowPrivacy(false);
    document.body.style.overflow = 'auto';
  };

  return (
    <div className="landing-container">
      <Navbar />
      <main className="landing-main">
        <div className="hero-section">
          <div className="hero-content">
            <div className="hero-text">
              <h1 className="hero-title">
                Get Started with <br />
                <span className="hero-title-highlight">
                  Chef Duo Demand<br />
                  Forecast
                </span>
              </h1>

              <div className="hero-description">
                <h2 className="hero-subtitle">What this system does?</h2>
                <p className="hero-paragraph">
                  ChefDuo forecast looks at your past sales to predict how much
                  you'll likely sell each day, and how much of each ingredient
                  you'll need to prepare it.
                </p>
              </div>

              {/* Terms and Privacy Policy */}
              <div className="legal-links">
                <p className="legal-text">
                  By using ChefDuo Forecast, you agree to our{' '}
                  <button onClick={openTerms} className="legal-link-btn">
                    Terms and Conditions
                  </button>
                  {' '}and{' '}
                  <button onClick={openPrivacy} className="legal-link-btn">
                    Privacy Policy
                  </button>
                  .
                </p>
                <p className="legal-note">
                  <FaShieldAlt className="legal-icon-shield" />
                  We respect your privacy and are committed to protecting your data.
                </p>
              </div>
            </div>

            {/* Right Column - Dashboard with Floating Cards */}
            <div className="hero-visual">
              <div className="dashboard-wrapper">
                <div ref={dashboardRef} className="dashboard-card">
                  <img
                    src="../src/assets/landing/Rectangle.png"
                    alt="Chef Duo Demand Forecasting Dashboard"
                    className="dashboard-image"
                  />
                </div>

                {/* Floating Card 1 - Top Left - Image */}
                <div ref={card1Ref} className="floating-card card-1">
                  <img
                    src={card1Img}
                    alt="Sales Analytics"
                    className="floating-image"
                  />
                </div>

                {/* Floating Card 2 - Top Right - Image */}
                <div ref={card2Ref} className="floating-card card-2">
                  <img
                    src={card2Img}
                    alt="Forecast Trends"
                    className="floating-image"
                  />
                </div>

                {/* Floating Card 3 - Bottom Right - Image */}
                <div ref={card3Ref} className="floating-card card-3">
                  <img
                    src={card3Img}
                    alt="Inventory Planning"
                    className="floating-image"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <section className="upload-section">
        <div className="upload-container">
          <div className="upload-header-landing">
            <h2 className="upload-main-title">
              Step 1: Upload your Sales Data
            </h2>
          </div>

          <div className="upload-grid">
            {/* Column 1: Steps */}
            <div className="upload-column upload-column-steps">
              <h3 className="column-title">
                The system needs your sales history to learn your demand
                patterns.
              </h3>
              <ul className="upload-steps">
                <li>Export your sales data from POS as CSV or Excel</li>
                <li>Go to the Data Management tab (top navigation bar)</li>
                <li>Drag and drop or browse to upload your file</li>
              </ul>
              <div className="column-file-format">
                <p>
                  Your file should have:{" "}
                  <strong>Date, Item, Quantity, Revenue</strong>
                </p>
              </div>
            </div>

            <div className="upload-column upload-column-data">
              <div className="data-content">
                <Link
                  to="/data-management"
                  className="upload-to-datamanagement"
                >
                  Go to Data Management
                </Link>
                <div className="data-image-wrapper" onClick={handleUploadClick}>
                  <img
                    src="../src/assets/landing/Upload.png"
                    alt="Upload Excel file"
                    className="data-image"
                  />

                  {/* Upload Overlay Content */}
                  <div className="upload-overlay">
                    <FiUploadCloud className="upload-icon-big" />
                    <p className="upload-overlay-title">
                      Upload your Excel file
                    </p>
                    <p className="upload-overlay-subtitle">
                      CSV, XLSX, or XLS format
                    </p>
                    <div className="upload-formats">
                      <span className="format-tag">.csv</span>
                      <span className="format-tag">.xlsx</span>
                      <span className="format-tag">.xls</span>
                    </div>
                  </div>

                  {/* Hidden file input */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".csv,.xlsx,.xls"
                    style={{ display: "none" }}
                  />
                </div>

                {/* Mascot */}
                <div className="image-person">
                  <img
                    src="../src/assets/landing/UploadMascot.png"
                    alt="Mascot"
                    className="data-image-person"
                  />
                </div>
              </div>
            </div>

            <div className="upload-column upload-column-data">
              <h3 className="column-title">How much data should you upload?</h3>
              <div className="upload-1">
                For best results, upload at least <strong>6 months</strong> of
                sales history or more. This gives the system enough data to
                detect weekly demand patterns and payday cycles (15th and 30th
                of each month).
              </div>
              <br />
              <div className="upload-2">
                Upload everything — more history means more accurate forecasts.
                The system will continue improving as you add new data.
              </div>
              <br />
              <div className="upload-3">
                <em>
                  "After your first upload, the system will take a few moments
                  to train your forecast model. You'll be notified when your
                  dashboard is ready."
                </em>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="upload-section">
        <div className="upload-container">
          <div className="upload-header-landing">
            <h2 className="upload-main-title">Step 2: View your Dashboard</h2>
            <p className="upload-subtitle">
              Once you've uploaded data, the system will start generating
              forecasts. The Dashboard is your command center.
            </p>

            {/* Dashboard Image with Absolute Cards */}
            <div className="landing-dashboard-wrapper">
              <div className="landing-dashboard-image">
                <img
                  src="../src/assets/landing/Dashboard.png"
                  alt="Dashboard Overview"
                  className="dashboard-overview-image"
                />
              </div>

              {/* Floating Cards - Positioned Absolutely on Dashboard */}
              <div className="dashboard-cards-absolute">
                {/* Card 1 - Top Left */}
                <div
                  ref={dashCard1Ref}
                  className="dashboard-card-absolute card-pos-1"
                >
                  <img
                    src="../src/assets/landing/landing-dashcard1.png"
                    alt="Sales Overview"
                    className="dashboard-card-absolute-image"
                  />
                </div>

                {/* Card 2 - Top Right */}
                <div
                  ref={dashCard2Ref}
                  className="dashboard-card-absolute card-pos-2"
                >
                  <img
                    src="../src/assets/landing/landing-dashcard2.png"
                    alt="Forecast Trends"
                    className="dashboard-card-absolute-image"
                  />
                </div>

                {/* Card 3 - Bottom Left */}
                <div
                  ref={dashCard3Ref}
                  className="dashboard-card-absolute card-pos-3"
                >
                  <img
                    src="../src/assets/landing/landing-dashcard3.png"
                    alt="Inventory Planning"
                    className="dashboard-card-absolute-image"
                  />
                </div>

                {/* Card 4 - Bottom Right */}
                <div
                  ref={dashCard4Ref}
                  className="dashboard-card-absolute card-pos-4"
                >
                  <img
                    src="../src/assets/landing/landing-dashcard4.png"
                    alt="Performance Metrics"
                    className="dashboard-card-absolute-image"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="upload-section">
        <div className="upload-container">
          <div className="upload-header-landing">
            <h2 className="upload-main-title">Step 3: Explore Analytics</h2>
            <p className="upload-subtitle">
              Once you've uploaded data, the system will start generating forecasts. The Dashboard is your command center.
            </p>

            <div className="landing-dashboard-wrapper">
              <div className="landing-dashboard-image">
                <img
                  src="../src/assets/landing/Analytics.png"
                  alt="Dashboard Overview"
                  className="dashboard-overview-image"
                />
              </div>

              <div className="dashboard-cards-absolute">
                {/* Card 1 - Top Left */}
                <div
                  ref={analyticsCard1Ref}
                  className="dashboard-card-absolute analytics-card-pos-1"
                >
                  <img
                    src="../src/assets/landing/landing-analytics1.png"
                    alt="Sales Overview"
                    className="dashboard-card-absolute-image"
                  />
                </div>

                {/* Card 2 - Top Right */}
                <div
                  ref={analyticsCard2Ref}
                  className="dashboard-card-absolute analytics-card-pos-2"
                >
                  <img
                    src="../src/assets/landing/landing-analytics2.png"
                    alt="Forecast Trends"
                    className="dashboard-card-absolute-image"
                  />
                </div>

                {/* Card 3 - Bottom Left */}
                <div
                  ref={analyticsCard3Ref}
                  className="dashboard-card-absolute analytics-card-pos-3"
                >
                  <img
                    src="../src/assets/landing/landing-analytics3.png"
                    alt="Inventory Planning"
                    className="dashboard-card-absolute-image"
                  />
                </div>

                {/* Card 4 - Bottom Right */}
                <div
                  ref={analyticsCard4Ref}
                  className="dashboard-card-absolute analytics-card-pos-4"
                >
                  <img
                    src="../src/assets/landing/landing-analytics4.png"
                    alt="Performance Metrics"
                    className="dashboard-card-absolute-image"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
{/**
      <section className="upload-section">
        <div className="upload-container">
          <div className="upload-header-landing">
            <h2 className="upload-main-title">Step 4: Set-up in Settings</h2>
            <p className="upload-subtitle">
              Before you start using the system, here are a few things you might want to set up:
            </p>

            <div className="landing-dashboard-wrapper">
              <div className="landing-dashboard-image">
                <img
                  src="../src/assets/landing/Analytics.png"
                  alt="Dashboard Overview"
                  className="dashboard-overview-image"
                />
              </div>
            </div>
          </div>  
        </div>
      </section>

       */}
      

      {/* Terms and Conditions Modal */}
    {/* Terms and Conditions Modal */}
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

export default ChefDuoLanding;