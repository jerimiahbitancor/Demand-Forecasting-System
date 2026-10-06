// states/NoData.jsx
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/NoData.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom"; // Import useNavigate
import noDataImage from "../../../assets/images/NoData.png";
import { useHelp } from "../../../hooks/useHelp";
import apiClient from "../../../services/apiClient";
import usePolling from "../../../hooks/usePolling";

// One check at a time, paused while the tab is hidden (hooks/usePolling.js).
const NO_DATA_POLL_MS = 60000;

const NoData = () => {
  const navigate = useNavigate(); // Initialize navigate
  const { openHelp } = useHelp();
  const [progressPercentage, setProgressPercentage] = useState(0);

  // Navigation handlers
  const handleUploadData = () => {
    navigate('/data-management'); // Navigate to data management page
  };

  const handleInventoryManagement = () => {
    navigate('/inventory-management'); // Navigate to inventory management
  };

  const formatDate = (date) => {
    const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 
                    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const month = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
  };

  const formatDay = (date) => {
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    return days[date.getDay()];
  };

  const formatTime = (date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  const now = new Date();
  const formattedDate = formatDate(now);
  const formattedDay = formatDay(now);
  const formattedTime = formatTime(now);

  // A failed check throws (usePolling keeps the last values and records the
  // error). It no longer guesses a progress value from the upload count.
  const fetchDataStatus = async (signal) => {
    const stateResult = await apiClient.get('/upload/dashboard-state', { signal });

    if (!stateResult.data.success) return;

    const { state, progress } = stateResult.data.data;
    setProgressPercentage(progress?.progress || 0);

    if (state !== 'no-data') {
      navigate('/dashboard', { replace: true });
    }
  };

  usePolling(fetchDataStatus, NO_DATA_POLL_MS);

  return (
    <div className="no-data-container">
      <Navbar />
      <main className="no-data-main">
        {/* Header Section */}
        <div className="no-data-header">
          <div className="no-data-date-info">
            <span>{formattedDate}</span>
            <span className="no-data-date-separator">|</span>
            <span>{formattedDay}</span>
            <span className="no-data-date-separator">|</span>
            <span>{formattedTime}</span>
          </div>

          {/* Progress Bar */}
          <div className="no-data-progress-container">
            <div className="no-data-progress-bar-wrapper">
              <div 
                className="no-data-progress-fill" 
                style={{ 
                  width: `${Math.min(progressPercentage, 100)}%`,
                  backgroundColor: 'rgba(122, 1, 1, 0.5)'
                }}
              />
              <div className="no-data-progress-text">
                <span>System Status Progress</span>
                <span>{Math.round(progressPercentage)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content - Welcome Section with Image */}
        <div className="no-data-content">
          <div className="no-data-welcome-wrapper">
            {/* Left Side - Text Content */}
            <div className="no-data-welcome-section">
              <h3 className="no-data-welcome-title">Welcome to ChefDuo Forecast</h3>
              <p className="no-data-welcome-description">
                Let's get your dashboard ready.
                <br />
                Your dashboard will display demand forecasts, sales trends, product performance, 
                ingredient requirements, and replenishment insights once you upload your historical sales data.
              </p>
              <p className="no-data-welcome-note">
                Your dashboard will become available once you have completed the steps requirements.
              </p>
              <button
                type="button"
                className="no-data-welcome-link"
                onClick={() => openHelp('how-it-works')}
              >
                Learn How ChefDuo Forecast Works →
              </button>
            </div>

            {/* Right Side - Image */}
            <div className="no-data-welcome-image">
              <img 
                src={noDataImage}
                alt="ChefDuo Forecast Illustration"
                className="no-data-welcome-img"
              />
            </div>
          </div>

          {/* Step Cards */}
          <div className="no-data-step-cards">
            {/* Step 1 */}
            <div className="no-data-step-card">
              <div className="no-data-step-number">1</div>
              <div className="no-data-step-content">
                <h4 className="no-data-step-title">Upload Historical Sales Data</h4>
                <p className="no-data-step-description">
                  Upload at least 1 year of historical sales data exported from your POS system. 
                  This is what the forecasting model uses to learn your business's demand patterns 
                  and generate reliable forecasts.
                </p>
                <button 
                  className="no-data-step-btn no-data-step-btn-secondary"
                  onClick={handleUploadData}
                >
                  Upload Sales Data
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="no-data-step-card">
              <div className="no-data-step-number">2</div>
              <div className="no-data-step-content">
                <h4 className="no-data-step-title">Add Ingredient Recipes to Your Products</h4>
                <p className="no-data-step-description">
                  Your menu products will be automatically detected when you upload your sales data. 
                  After uploading, add the ingredient recipe for each product so the system can estimate 
                  how much of each ingredient you'll need to prepare.
                </p>
                <button 
                  className="no-data-step-btn no-data-step-btn-secondary"
                  onClick={handleInventoryManagement}
                >
                  Go to Inventory Management
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default NoData;