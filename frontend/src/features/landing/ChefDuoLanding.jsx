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
                  Chef Duo Sales <br />
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
                    alt="Chef Duo Sales Forecasting Dashboard"
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
          <h3>1. Acceptance of Terms</h3>
          <p>
            By accessing and using ChefDuo Forecast ("the Service"), you agree to be bound by these Terms and Conditions. 
            If you do not agree with any part of these terms, you must not use our services. These terms constitute a legally 
            binding agreement between you ("User", "You", "Your") and ChefDuo ("Company", "We", "Us", "Our").
          </p>
          <p style={{ marginTop: '8px' }}>
            We reserve the right to update, change, or replace any part of these Terms and Conditions by posting updates 
            on our platform. It is your responsibility to check this page periodically for changes. Your continued use of 
            the Service following the posting of any changes constitutes acceptance of those changes.
          </p>
        </div>

        <div className="modal-section">
          <h3>2. Data Usage and Privacy</h3>
          <p>
            <strong>2.1 Data Collection:</strong> ChefDuo collects sales data, inventory data, and user preferences to provide 
            accurate sales forecasting and ingredient prediction services. This includes but is not limited to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Product names and descriptions</li>
            <li>Quantities sold and revenue generated</li>
            <li>Timestamps of sales transactions</li>
            <li>Inventory levels and usage patterns</li>
            <li>User account information</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>2.2 Data Usage:</strong> Your data is used solely for the purpose of generating accurate forecasts, 
            improving prediction models, and providing personalized insights. We do not sell, rent, or share your data 
            with third parties for marketing purposes.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>2.3 Data Security:</strong> We implement industry-standard security measures including encryption, 
            secure servers, and regular security audits to protect your data from unauthorized access, alteration, 
            disclosure, or destruction.
          </p>
        </div>

        <div className="modal-section">
          <h3>3. Service Description and Accuracy</h3>
          <p>
            <strong>3.1 Service Overview:</strong> ChefDuo Forecast is a sales forecasting tool that analyzes historical 
            sales data to predict future sales volumes and ingredient requirements. The Service uses machine learning 
            algorithms to identify patterns and generate forecasts.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>3.2 Accuracy Disclaimer:</strong> While we employ advanced algorithms and continuously improve our 
            models, all forecasts are estimates based on available historical data. Actual results may differ due to 
            various factors including but not limited to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Unforeseen market conditions</li>
            <li>Changes in customer preferences</li>
            <li>Economic fluctuations</li>
            <li>Weather and seasonal variations</li>
            <li>Supply chain disruptions</li>
            <li>Competitor actions</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>3.3 No Guarantee:</strong> ChefDuo makes no warranties or guarantees regarding the accuracy, 
            completeness, or reliability of any forecast. The Service is provided "as is" and "as available" for 
            informational and planning purposes only.
          </p>
        </div>

        <div className="modal-section">
          <h3>4. User Responsibilities and Obligations</h3>
          <p>
            <strong>4.1 Data Accuracy:</strong> You are solely responsible for providing accurate, complete, and 
            up-to-date data. The quality and accuracy of forecasts depend directly on the quality of data provided. 
            ChefDuo is not responsible for inaccuracies resulting from incomplete or incorrect data.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>4.2 Account Security:</strong> You are responsible for maintaining the confidentiality of your 
            account credentials and for all activities that occur under your account. You agree to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Use a strong, unique password</li>
            <li>Not share your account credentials</li>
            <li>Immediately notify us of any unauthorized access</li>
            <li>Log out of your account after each session</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>4.3 Acceptable Use:</strong> You agree to use the Service responsibly and in compliance with all 
            applicable laws and regulations. You shall not:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Use the Service for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to the system</li>
            <li>Interfere with the functionality of the Service</li>
            <li>Upload malicious code or harmful content</li>
            <li>Share or distribute forecasts without authorization</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>5. Intellectual Property Rights</h3>
          <p>
            <strong>5.1 Ownership:</strong> All content, features, algorithms, and functionality of ChefDuo Forecast, 
            including but not limited to the software, code, data models, and user interface, are the exclusive property 
            of ChefDuo and are protected by intellectual property laws including copyright, trademark, and trade secret laws.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>5.2 Restrictions:</strong> You may not, without our express written permission:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Copy, modify, or create derivative works of the Service</li>
            <li>Reverse engineer, decompile, or disassemble any part of the system</li>
            <li>Remove or alter any proprietary notices</li>
            <li>Use the Service for any commercial purpose without authorization</li>
            <li>Resell or redistribute the Service</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>5.3 Data Ownership:</strong> While we own the Service, you retain ownership of your data. However, 
            by using the Service, you grant us a license to use your data to provide and improve the Service.
          </p>
        </div>

        <div className="modal-section">
          <h3>6. Limitation of Liability</h3>
          <p>
            <strong>6.1 Disclaimer of Warranties:</strong> THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT 
            ANY WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES 
            OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>6.2 Limitation of Liability:</strong> IN NO EVENT SHALL CHEFDUO BE LIABLE FOR ANY INDIRECT, INCIDENTAL, 
            SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION, LOSS OF PROFITS, LOSS OF DATA, 
            OR BUSINESS INTERRUPTION, ARISING OUT OF THE USE OR INABILITY TO USE THE SERVICE.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>6.3 Maximum Liability:</strong> Our total liability to you shall not exceed the amount paid by you 
            for the Service in the twelve (12) months preceding the claim.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>6.4 Business Decisions:</strong> You acknowledge that all business decisions made based on forecasts 
            or other information provided by the Service are your sole responsibility. ChefDuo is not liable for any 
            losses or damages resulting from such decisions.
          </p>
        </div>

        <div className="modal-section">
          <h3>7. Service Availability and Termination</h3>
          <p>
            <strong>7.1 Service Availability:</strong> We strive to maintain high availability of the Service. However, 
            we do not guarantee uninterrupted access and may need to perform maintenance or updates that could temporarily 
            affect availability.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>7.2 Termination by ChefDuo:</strong> We reserve the right to suspend or terminate your access to the 
            Service at any time, without prior notice, for any reason including but not limited to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Violation of these Terms and Conditions</li>
            <li>Fraudulent or illegal activity</li>
            <li>Non-payment of fees</li>
            <li>Extended period of inactivity</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>7.3 Termination by User:</strong> You may cancel your account at any time through your account settings 
            or by contacting our support team. Upon termination, we will delete your data within a reasonable timeframe 
            unless retention is required by law.
          </p>
        </div>

        <div className="modal-section">
          <h3>8. Changes to Terms and Conditions</h3>
          <p>
            We reserve the right to modify these Terms and Conditions at any time. Changes will be effective immediately 
            upon posting on our platform. We will make reasonable efforts to notify you of significant changes through 
            email or in-app notifications. Your continued use of the Service after any changes constitutes acceptance 
            of the updated terms.
          </p>
          <p style={{ marginTop: '8px' }}>
            It is your responsibility to review these Terms and Conditions periodically. The date of the latest revision 
            will be indicated at the bottom of this page.
          </p>
        </div>

        <div className="modal-section">
          <h3>9. Governing Law and Dispute Resolution</h3>
          <p>
            <strong>9.1 Governing Law:</strong> These Terms and Conditions shall be governed by and construed in accordance 
            with the laws of the Republic of the Philippines, without regard to its conflict of law provisions.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>9.2 Dispute Resolution:</strong> Any dispute arising out of or relating to these Terms and Conditions 
            shall be resolved through good faith negotiations. If such negotiations fail, disputes shall be submitted to 
            the exclusive jurisdiction of the courts of Quezon City, Philippines.
          </p>
        </div>

        <div className="modal-footer-text">
          <p>Last updated: January 2026</p>
          <button className="modal-agree-btn" onClick={closeTerms}>
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
          <h3>1. Information We Collect</h3>
          <p>
            <strong>1.1 Personal Information:</strong> When you create an account, we collect information that identifies 
            you, including:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Business name and contact details</li>
            <li>Email address and phone number</li>
            <li>Business location and address</li>
            <li>Account login credentials</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>1.2 Business Data:</strong> To provide forecasting services, we collect and process your business data 
            including:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Sales transaction data (date, item, quantity, revenue)</li>
            <li>Product and menu information</li>
            <li>Inventory levels and usage patterns</li>
            <li>Recipe and ingredient details</li>
            <li>Customer purchase patterns</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>1.3 Technical Data:</strong> We automatically collect certain technical information when you use our 
            Service:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>IP address and device information</li>
            <li>Browser type and version</li>
            <li>Usage patterns and page interactions</li>
            <li>Cookies and session data</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>2. How We Use Your Information</h3>
          <p>
            <strong>2.1 Core Service Delivery:</strong> Your data is used primarily to provide accurate sales forecasting 
            and ingredient prediction services:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Generate daily and weekly sales forecasts</li>
            <li>Predict ingredient requirements based on forecasted demand</li>
            <li>Identify demand patterns and trends</li>
            <li>Calculate forecast accuracy metrics (MAPE, MAE, RMSE)</li>
            <li>Provide product performance insights</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>2.2 Service Improvement:</strong> We analyze aggregated data to improve our algorithms:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Train and refine machine learning models</li>
            <li>Enhance forecast accuracy</li>
            <li>Develop new features and capabilities</li>
            <li>Identify and fix system issues</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>2.3 Communication:</strong> We may use your contact information to:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Send important service updates and notifications</li>
            <li>Provide customer support and respond to inquiries</li>
            <li>Send educational content and tips</li>
            <li>Request feedback and user research</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>3. Data Protection and Security</h3>
          <p>
            <strong>3.1 Security Measures:</strong> We implement and maintain comprehensive security measures to protect 
            your data:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>End-to-end encryption for data transmission (TLS/SSL)</li>
            <li>Secure servers with firewall protection</li>
            <li>Regular security audits and penetration testing</li>
            <li>Access controls and authentication protocols</li>
            <li>Encrypted data storage (AES-256)</li>
            <li>24/7 monitoring and threat detection</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>3.2 Data Retention:</strong> We retain your data for as long as you maintain an active account with us. 
            If you close your account, we will delete or anonymize your data within 30 days, unless retention is required 
            for legal or regulatory compliance.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>3.3 Data Backup:</strong> We perform regular automated backups to prevent data loss. Backup data is 
            stored in secure, separate locations with the same level of encryption and security.
          </p>
        </div>

        <div className="modal-section">
          <h3>4. Third-Party Sharing and Disclosure</h3>
          <p>
            <strong>4.1 No Selling or Renting:</strong> We do not sell, rent, or lease your personal or business data to 
            third parties. Your data is used exclusively for your benefit and to improve our Service.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>4.2 Service Providers:</strong> We may engage trusted third-party service providers to support our 
            operations:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Cloud hosting and infrastructure services</li>
            <li>Data processing and analytics</li>
            <li>Customer support and communication tools</li>
            <li>Security monitoring and threat detection</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>4.3 Legal Requirements:</strong> We may disclose your data if required by law or in response to valid 
            legal processes, including:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Court orders or subpoenas</li>
            <li>Regulatory compliance requirements</li>
            <li>Law enforcement requests</li>
            <li>Protection of our legal rights</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>4.4 Aggregated Data:</strong> We may share anonymized, aggregated data that does not identify you or 
            your business for research, benchmarking, or industry analysis purposes.
          </p>
        </div>

        <div className="modal-section">
          <h3>5. Your Rights and Choices</h3>
          <p>
            <strong>5.1 Right to Access:</strong> You have the right to access and review all personal and business data 
            we hold about you at any time through your account dashboard.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>5.2 Right to Correct:</strong> You may update, correct, or modify your data through your account settings 
            or by contacting our support team.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>5.3 Right to Delete:</strong> You have the right to request deletion of your data by closing your 
            account. We will delete your data within 30 days of your request, subject to legal retention requirements.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>5.4 Right to Export:</strong> You can export your data at any time in standard formats (CSV, Excel) 
            through your account settings.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>5.5 Marketing Preferences:</strong> You can opt out of marketing communications by clicking the 
            "unsubscribe" link in emails or by adjusting your account preferences.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>5.6 Cookie Controls:</strong> You can manage cookie preferences through your browser settings. 
            However, please note that some features may not function properly without cookies.
          </p>
        </div>

        <div className="modal-section">
          <h3>6. Cookies and Tracking Technologies</h3>
          <p>
            <strong>6.1 What Are Cookies:</strong> Cookies are small text files placed on your device that help us 
            understand how you interact with our Service and improve your experience.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>6.2 Types of Cookies We Use:</strong>
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li><strong>Essential Cookies:</strong> Required for basic functionality (session management, authentication)</li>
            <li><strong>Preference Cookies:</strong> Remember your preferences and settings</li>
            <li><strong>Analytics Cookies:</strong> Help us understand usage patterns and improve the Service</li>
            <li><strong>Performance Cookies:</strong> Monitor and improve system performance</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            <strong>6.3 Third-Party Cookies:</strong> We may allow trusted third-party services to place cookies for 
            analytics and performance monitoring. These providers adhere to strict privacy standards.
          </p>
          <p style={{ marginTop: '8px' }}>
            <strong>6.4 Cookie Management:</strong> You can manage cookie settings through your browser preferences. 
            However, disabling cookies may affect Service functionality:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>You may need to log in more frequently</li>
            <li>Some preferences may not be saved</li>
            <li>Certain features may not work optimally</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>7. Children's Privacy</h3>
          <p>
            ChefDuo Forecast is not intended for use by individuals under the age of 18. We do not knowingly collect 
            personal information from children. If you are a parent or guardian and believe we have inadvertently 
            collected information about a child, please contact us immediately so we can delete the data.
          </p>
        </div>

        <div className="modal-section">
          <h3>8. International Data Transfers</h3>
          <p>
            Your data may be stored and processed in servers located in different countries. We ensure that all 
            data transfers comply with applicable data protection laws and that appropriate safeguards are in place 
            to protect your data.
          </p>
        </div>

        <div className="modal-section">
          <h3>9. Data Breach Notification</h3>
          <p>
            In the event of a data breach that may affect your data, we will:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Notify you promptly through email or in-app notification</li>
            <li>Provide details about the nature of the breach</li>
            <li>Recommend steps to mitigate potential risks</li>
            <li>Report to relevant regulatory authorities as required by law</li>
          </ul>
        </div>

        <div className="modal-section">
          <h3>10. Changes to Privacy Policy</h3>
          <p>
            We reserve the right to update this Privacy Policy from time to time. Significant changes will be 
            communicated through:
          </p>
          <ul style={{ color: 'rgba(237, 233, 222, 0.6)', fontSize: '13px', lineHeight: '1.7', paddingLeft: '20px', margin: '6px 0' }}>
            <li>Email notification to registered users</li>
            <li>In-app notifications</li>
            <li>Updated posting on our website</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            We encourage you to review this Privacy Policy periodically. Your continued use of the Service after 
            changes constitutes acceptance of the updated policy.
          </p>
        </div>

        <div className="modal-section">
          <h3>11. Contact Information</h3>
          <p>
            If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, 
            please contact us:
          </p>
          <div style={{ 
            background: 'rgba(254, 177, 97, 0.05)', 
            padding: '12px 16px', 
            borderRadius: '8px', 
            marginTop: '8px',
            border: '1px solid rgba(254, 177, 97, 0.1)'
          }}>
            <p style={{ margin: '4px 0', fontSize: '13px' }}>
              <strong>Email:</strong> BCF@gmail.com
            </p>
            <p style={{ margin: '4px 0', fontSize: '13px' }}>
              <strong>Phone:</strong> 09123456789
            </p>
            <p style={{ margin: '4px 0', fontSize: '13px' }}>
              <strong>Address:</strong> Pasig City, Metro Manila, Philippines
            </p>
            <p style={{ margin: '4px 0', fontSize: '13px' }}>
              <strong>Response Time:</strong> We aim to respond to all inquiries within 24-48 hours.
            </p>
          </div>
        </div>

        <div className="modal-footer-text">
          <p>Last updated: January 2026</p>
          <button className="modal-agree-btn" onClick={closePrivacy}>
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