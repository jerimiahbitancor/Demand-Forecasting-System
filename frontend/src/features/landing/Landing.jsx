// frontend/src/features/landing/Landing.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Landing.css";
import bgImage from "../../assets/landing/bg.png";
import worksImage from "../../assets/landing/works.png";
import { FaCheck, FaTimes } from "react-icons/fa";
import ctaImage from "../../assets/landing/client.png"; 

const Landing = () => {
  const navigate = useNavigate();
  const [hasUser, setHasUser] = useState(null);

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
    {/* Client Image */}
    <div className="cta-image">
      <img 
        src={ctaImage} 
        alt="ChefDuo Forecast Dashboard" 
        className="cta-img"
      />
    </div>
    
    {/* CTA Text */}
    <div className="cta-text">
      <h2 className="req-title">Ready to Make Better Demand Decisions?</h2>
      <p className="req-description">
        Start using ChefDuo Forecast to transform your historical sales data into forecasts, ingredient requirements, inventory insights, and replenishment decision support.
      </p>
      <div className="cta-buttons">
        <button className="cta-btn" onClick={handleGetStarted}>
          Get Started
        </button>
      </div>
    </div>
  </div>
</section>
    </div>
  );
};

export default Landing;
