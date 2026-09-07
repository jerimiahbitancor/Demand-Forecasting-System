// states/NoData.jsx
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/NoData.css";
import { useState, useEffect, useRef } from "react";
import axios from 'axios';
import { useNavigate } from "react-router-dom"; // Import useNavigate
import noDataImage from "../../../assets/images/NoData.png";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const NoData = () => {
  const navigate = useNavigate(); // Initialize navigate
  const [progressPercentage, setProgressPercentage] = useState(0);
  const isMountedRef = useRef(true);

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

  const getAuthToken = () => sessionStorage.getItem('access_token') || localStorage.getItem('token');

  const apiClient = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' }
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error)
  );

  const fetchDataStatus = async () => {
    try {
      const stateResult = await apiClient.get('/upload/dashboard-state');

      if (!stateResult.data.success) return;

      const { state, progress } = stateResult.data.data;
      if (!isMountedRef.current) return;
      setProgressPercentage(progress?.progress || 0);

      if (isMountedRef.current && state !== 'no-data') {
        navigate('/dashboard', { replace: true });
      }
    } catch (error) {
      console.error('Error fetching upload progress:', error);
      try {
        const uploadsResponse = await apiClient.get('/upload?limit=1');
        const uploadCount = uploadsResponse.data.count
          || uploadsResponse.data.data?.length
          || 0;

        if (uploadCount > 0) {
          if (!isMountedRef.current) return;
          setProgressPercentage(Math.min((uploadCount / 12) * 100, 100));
          navigate('/dashboard', { replace: true });
        } else {
          if (!isMountedRef.current) return;
          setProgressPercentage(0);
        }
      } catch (fallbackError) {
        console.error('Error fetching upload fallback:', fallbackError);
        if (isMountedRef.current) setProgressPercentage(0);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    const initialFetch = setTimeout(fetchDataStatus, 0);
    const interval = setInterval(() => {
      fetchDataStatus();
    }, 3000);

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [navigate]);

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
              <a href="#" className="no-data-welcome-link">
                Learn How ChefDuo Forecast Works →
              </a>
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