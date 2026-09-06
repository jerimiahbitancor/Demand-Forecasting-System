// states/UploadedInsufficient.jsx
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/UploadedInsufficient.css";
import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import uploadedInsufficientImage from "../../../assets/images/NoData.png";
import { FaInfoCircle } from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const UploadedInsufficient = () => {
  const navigate = useNavigate();
  const [progressPercentage, setProgressPercentage] = useState(20); // Set to 20%
  const [dataProgress, setDataProgress] = useState(0);
  const [uploadedMonths, setUploadedMonths] = useState(0);
  const [totalMonthsNeeded] = useState(12);
  const [isLoading, setIsLoading] = useState(true);
  const [hasData, setHasData] = useState(false);

  // Navigation handlers
  const handleUploadData = () => {
    navigate("/data-management");
  };

  const handleInventoryManagement = () => {
    navigate("/inventory-management");
  };

  const formatDate = (date) => {
    const months = [
      "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
      "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
    ];
    const month = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
  };

  const formatDay = (date) => {
    const days = [
      "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
    ];
    return days[date.getDay()];
  };

  const formatTime = (date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  const now = new Date();
  const formattedDate = formatDate(now);
  const formattedDay = formatDay(now);
  const formattedTime = formatTime(now);

  const getAuthToken = () => sessionStorage.getItem("access_token") || localStorage.getItem("token");

  const apiClient = axios.create({
    baseURL: API_URL,
    headers: { "Content-Type": "application/json" },
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Fetch data status and upload progress
  const fetchDataStatus = async () => {
    try {
      setIsLoading(true);
      
      const statusResponse = await apiClient.get("/upload/dashboard-state");
      
      if (statusResponse.data.success) {
        const { state, stats: data } = statusResponse.data.data;
        console.log("Data status response:", data);
        setProgressPercentage(20);
        
        const totalRows = data.sales_records || data.total_rows || 0;
        const totalUploads = data.total_uploads || 0;
        const monthsUploaded = data.months_uploaded || 0;
        
        let months = monthsUploaded;
        if (months === 0 && totalUploads > 0) {
          months = Math.min(totalUploads, totalMonthsNeeded);
        }
        
        if (totalRows > 0 && months === 0) {
          months = 1;
        }
        
        setUploadedMonths(months);
        setHasData(totalRows > 0 || totalUploads > 0);
        
        const progressPercent = (months / totalMonthsNeeded) * 100;
        setDataProgress(Math.min(progressPercent, 100));

        if (state !== 'uploaded-insufficient') {
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (error) {
      console.error("Error fetching data status:", error);
      try {
        const uploadsResponse = await apiClient.get('/upload?limit=1');
        const totalUploads = uploadsResponse.data.count
          || uploadsResponse.data.data?.length
          || 0;
        const months = Math.min(totalUploads, totalMonthsNeeded);
        setProgressPercentage(totalUploads > 0 ? 20 : 0);
        setUploadedMonths(months);
        setDataProgress(Math.min((months / totalMonthsNeeded) * 100, 100));
        setHasData(totalUploads > 0);
      } catch (fallbackError) {
        console.error("Error fetching upload fallback:", fallbackError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUploadProgress = async () => {
    try {
      const response = await apiClient.get("/upload/dashboard-state");
      if (response.data.success) {
        const { state } = response.data.data;
        setProgressPercentage(20);
        
        if (state === 'fully-operational') {
          await fetchDataStatus();
        }
      }
    } catch (error) {
      console.error("Error fetching upload progress:", error);
      try {
        const uploadsResponse = await apiClient.get('/upload?limit=1');
        const totalUploads = uploadsResponse.data.count
          || uploadsResponse.data.data?.length
          || 0;
        setProgressPercentage(totalUploads > 0 ? 20 : 0);
      } catch (fallbackError) {
        console.error("Error fetching upload progress fallback:", fallbackError);
        setProgressPercentage(20);
      }
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    const loadData = async () => {
      await fetchDataStatus();
      await fetchUploadProgress();
    };
    
    loadData();

    const interval = setInterval(() => {
      fetchUploadProgress();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Calculate months to display
  const getMonths = () => {
    return Math.min(uploadedMonths, totalMonthsNeeded);
  };

  // Determine if data is sufficient
  const isDataSufficient = uploadedMonths >= totalMonthsNeeded;

  return (
    <div className="insufficient-container">
    <Navbar />
      <main className="insufficient-main">
        {/* Header Section */}
        <div className="insufficient-header">
          <div className="insufficient-date-info">
            <span>{formattedDate}</span>
            <span className="insufficient-date-separator">|</span>
            <span>{formattedDay}</span>
            <span className="insufficient-date-separator">|</span>
            <span>{formattedTime}</span>
          </div>

          {/* Progress Bar - Now shows 20% */}
          <div className="insufficient-progress-container">
            <div className="insufficient-progress-bar-wrapper">
              <div
                className="insufficient-progress-fill"
                style={{
                  width: `${Math.min(progressPercentage, 100)}%`,
                  backgroundColor: "rgba(122, 1, 1, 0.5)",
                }}
              />
              <div className="insufficient-progress-text">
                <span>System Status Progress</span>
                <span>{Math.round(progressPercentage)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="insufficient-content">
          <div className="insufficient-welcome-wrapper">
            {/* Left Side - Text Content */}
            <div className="insufficient-welcome-section">
              <h3 className="insufficient-welcome-title">
                Welcome to ChefDuo Forecast
              </h3>
              <p className="insufficient-welcome-description">
                Let's get your dashboard ready.
                <br />
                Your dashboard will display demand forecasts, sales trends,
                product performance, ingredient requirements, and replenishment
                insights once you upload your historical sales data.
              </p>
              <p className="insufficient-welcome-note">
                Your dashboard will become available once you have completed the
                steps requirements.
              </p>
              <a href="#" className="insufficient-welcome-link">
                Learn How ChefDuo Forecast Works →
              </a>
            </div>

            {/* Right Side - Image */}
            <div className="insufficient-welcome-image">
              <img
                src={uploadedInsufficientImage}
                alt="ChefDuo Forecast Illustration"
                className="insufficient-welcome-img"
              />
            </div>
          </div>

          {/* Step Cards */}
          <div className="insufficient-step-cards">
            {/* Step 1 */}
            <div className="insufficient-step-card">
              <div className="insufficient-step-number">1</div>
              <div className="insufficient-step-content">
                <h4 className="insufficient-step-title">
                  Upload Historical Sales Data
                </h4>
                <p className="insufficient-step-description">
                  Upload at least 1 year of historical sales data exported from
                  your POS system. This is what the forecasting model uses to
                  learn your business's demand patterns and generate reliable
                  forecasts.
                </p>

                {/* Data Progress */}
                <div className="insufficient-data-progress-wrapper1">
                  <div className="insufficient-data-progress-wrapper2">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                      }}
                    >
                      <FaInfoCircle
                        style={{
                          color: "#6B000B",
                          fontSize: "18px",
                          marginTop: "2px",
                          flexShrink: 0,
                        }}
                      />
                      <p className="insufficient-step-description1">
                        {isLoading ? (
                          "Loading data status..."
                        ) : hasData ? (
                          <>
                            You've uploaded sales data, but the system needs at
                            least {totalMonthsNeeded} months of history before
                            demand forecasting can activate.
                          </>
                        ) : (
                          "Upload your sales data to get started with forecasting."
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="insufficient-data-progress-wrapper">
                    <div className="insufficient-data-progress-label">
                      <span>Historical Data</span>
                      <span className="insufficient-data-progress-text">
                        {getMonths()} / {totalMonthsNeeded} months
                      </span>
                    </div>
                    <div className="insufficient-data-progress-bar">
                      <div
                        className="insufficient-data-progress-fill"
                        style={{
                          width: `${Math.min(dataProgress, 100)}%`,
                          backgroundColor:
                            isDataSufficient || dataProgress >= 100
                              ? "#22c55e"
                              : "rgba(122, 1, 1, 0.5)",
                        }}
                      />
                    </div>
                  </div>
                </div>

                <button
                  className="insufficient-step-btn insufficient-step-btn-secondary"
                  onClick={handleUploadData}
                >
                  {hasData ? "Upload More Data" : "Upload Sales Data"}
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="insufficient-step-card">
              <div className="insufficient-step-number">2</div>
              <div className="insufficient-step-content">
                <h4 className="insufficient-step-title">
                  Add Ingredient Recipes to Your Products
                </h4>
                <p className="insufficient-step-description">
                  Your menu products will be automatically detected when you
                  upload your sales data. After uploading, add the ingredient
                  recipe for each product so the system can estimate how much of
                  each ingredient you'll need to prepare.
                </p>
                <button
                  className="insufficient-step-btn insufficient-step-btn-secondary"
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

export default UploadedInsufficient;