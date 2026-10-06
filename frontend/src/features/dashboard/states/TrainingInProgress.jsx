// states/TrainingInProgress.jsx
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/TrainingInProgress.css";
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import trainingInProgressImage from "../../../assets/images/Rene.png";
import { FaInfoCircle, FaCheckCircle, FaSpinner } from "react-icons/fa";
import { useHelp } from "../../../hooks/useHelp";
import apiClient from "../../../services/apiClient";
import usePolling from "../../../hooks/usePolling";

// One request at a time, paused while the tab is hidden (hooks/usePolling.js).
// Was 3 s (training status), 5 s (upload progress) and 10 s (products).
const TRAINING_STATUS_POLL_MS = 15000;
const UPLOAD_PROGRESS_POLL_MS = 60000;
const PRODUCTS_POLL_MS = 60000;

const TrainingInProgress = ({ onRefreshState }) => {
  const navigate = useNavigate();
  const { openHelp } = useHelp();
  const [progressPercentage, setProgressPercentage] = useState(50);
  const [dataProgress, setDataProgress] = useState(100);
  const [uploadedMonths, setUploadedMonths] = useState(12);
  const [totalMonthsNeeded] = useState(12);
  const [isLoading, setIsLoading] = useState(false);
  const [hasData, setHasData] = useState(true);
  const [isTrainingComplete, setIsTrainingComplete] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsWithRecipes, setProductsWithRecipes] = useState(3);
  const [totalProducts, setTotalProducts] = useState(12);
  // Last known "training running?" answer, to spot the true -> false change.
  const wasTrainingRef = useRef(null);
  const dataStatusLoadedRef = useRef(false);

  // Navigation handlers
  const handleUploadData = () => {
    navigate("/data-management");
  };

  const handleInventoryManagement = () => {
    navigate("/inventory-management");
  };

  const handleAddRecipe = (productName) => {
    navigate("/inventory-management", { state: { product: productName } });
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

  // A failed request throws: the screen keeps its last values (usePolling
  // records the error). The old catch blocks filled in invented values
  // (12/12 months, 50% progress, and a hardcoded list of 12 product names),
  // which looked like real data.

  // Fetch data status
  const fetchDataStatus = async (signal) => {
    try {
      setIsLoading(true);

      const statusResponse = await apiClient.get("/upload/stats/summary", { signal });

      if (statusResponse.data.success) {
        const data = statusResponse.data.data;

        const totalRows = data.sales_records || data.total_rows || 0;
        const totalUploads = data.total_uploads || 0;
        const monthsUploaded = data.months_uploaded || 12;

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
        dataStatusLoadedRef.current = true;
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch upload progress. The data status is loaded on the first run (as
  // the old mount sequence did) and whenever processing is complete.
  const fetchUploadProgress = async (signal) => {
    const response = await apiClient.get("/upload/progress", { signal });
    if (response.data.success) {
      const progress = response.data.data.progress || 50;
      setProgressPercentage(progress);

      if (progress >= 100 || !dataStatusLoadedRef.current) {
        await fetchDataStatus(signal);
      }
    }
  };

  // Fetch training status. ml-service's /train is a single blocking HTTP
  // call (no job queue), so there's no real incremental percentage or ETA
  // to report — mlService.isTrainingInFlight() only knows "still running"
  // vs "finished". The percentage bar below is intentionally left as a
  // generic in-progress indicator, not a fabricated number. When
  // isTraining flips from true to false, this asks the Dashboard to
  // re-check its state right away (onRefreshState) instead of waiting for
  // its next poll, so the owner moves on to whichever state follows
  // (forecasts-ready-recipes-pending, fully-operational, or
  // data-needs-attention).
  const fetchTrainingStatus = async (signal) => {
    const response = await apiClient.get("/ml/training-status", { signal });
    if (response.data.success) {
      const isTraining = Boolean(response.data.data.isTraining);
      setIsTrainingComplete(!isTraining);
      if (wasTrainingRef.current === true && !isTraining && onRefreshState) {
        onRefreshState();
      }
      wasTrainingRef.current = isTraining;
    }
  };

  // Fetch products data
  const fetchProducts = async (signal) => {
    const [activeResponse, inactiveResponse] = await Promise.all([
      apiClient.get("/mapping/products", { params: { status: "active", forceRefresh: "true" }, signal }),
      apiClient.get("/mapping/products", { params: { status: "inactive", forceRefresh: "true" }, signal }),
    ]);
    const activeProducts = activeResponse.data.success ? activeResponse.data.data || [] : [];
    const inactiveProducts = inactiveResponse.data.success ? inactiveResponse.data.data || [] : [];
    const productsData = [...activeProducts, ...inactiveProducts];
    setProducts(productsData);
    setTotalProducts(productsData.length);

    const withRecipes = productsData.filter(p => p.product_ingredients?.length).length;
    setProductsWithRecipes(withRecipes);
  };

  usePolling(fetchUploadProgress, UPLOAD_PROGRESS_POLL_MS);
  usePolling(fetchTrainingStatus, TRAINING_STATUS_POLL_MS);
  usePolling(fetchProducts, PRODUCTS_POLL_MS);

  const getMonths = () => {
    return Math.min(uploadedMonths, totalMonthsNeeded);
  };

  const isDataSufficient = uploadedMonths >= totalMonthsNeeded;

  const getProductsNeedingRecipes = () => {
    const needsRecipe = products.filter(p => !p.product_ingredients?.length && !p.hasRecipe);
    return needsRecipe.slice(0, 3);
  };

  const productsNeedingRecipes = getProductsNeedingRecipes();
  const productsWithoutRecipes = products.filter(
    p => !p.product_ingredients?.length && !p.hasRecipe
  ).length;

  return (
    <div className="training-container">
      <Navbar />
      <main className="training-main">
        {/* Header Section */}
        <div className="training-header">
          <div className="training-date-info">
            <span>{formattedDate}</span>
            <span className="training-date-separator">|</span>
            <span>{formattedDay}</span>
            <span className="training-date-separator">|</span>
            <span>{formattedTime}</span>
          </div>

          {/* Progress Bar */}
          <div className="training-progress-container">
            <div className="training-progress-bar-wrapper">
              <div
                className="training-progress-fill"
                style={{
                  width: `${Math.min(progressPercentage, 100)}%`,
                  backgroundColor: "rgba(122, 1, 1, 0.5)",
                }}
              />
              <div className="training-progress-text">
                <span>System Status Progress</span>
                <span>{Math.round(progressPercentage)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="training-content">
          <div className="training-welcome-wrapper">
            {/* Left Side - Text Content */}
            <div className="training-welcome-section">
              <h3 className="training-welcome-title">
                Welcome to ChefDuo Forecast
              </h3>
              <p className="training-welcome-description">
                Let's get your dashboard ready.
                <br />
                Your dashboard will display demand forecasts, sales trends,
                product performance, ingredient requirements, and replenishment
                insights once you upload your historical sales data.
              </p>
              <p className="training-welcome-note">
                Your dashboard will become available once you have completed the
                steps requirements.
              </p>
              <button
                type="button"
                className="training-welcome-link"
                onClick={() => openHelp('how-it-works')}
              >
                Learn How ChefDuo Forecast Works →
              </button>
            </div>

            {/* Right Side - Image */}
            <div className="training-welcome-image">
              <img
                src={trainingInProgressImage}
                alt="Training In Progress Illustration"
                className="training-welcome-img"
              />
            </div>
          </div>

          {/* Model Training In Progress Section */}
          <div className="training-model-section">
            <div className="training-model-left">
              <div className="training-model-image">
                <img 
                  src={trainingInProgressImage} 
                  alt="Model Training Illustration" 
                  className="training-model-img"
                />
              </div>
              <div className="training-model-content">
                <h3 className="training-model-title">Model Training In Progress</h3>
                <p className="training-model-description">
                  ChefDuo Forecast is analyzing your historical sales patterns and training your demand forecasting model. 
                  This may take a few minutes. Your forecasting dashboard will unlock automatically when training is complete.
                </p>
                <div className="training-model-status">
                  <div className="training-model-status-item">
                    <span className="training-model-status-dot"></span>
                    <span className="training-model-status-text">
                      {isTrainingComplete ? "Training Complete" : "Still training..."}
                    </span>
                    <span className="training-model-status-sub">
                      {isTrainingComplete ? "Ready to view forecasts" : "Analyzing the pattern..."}
                    </span>
                  </div>
                </div>
                <div className="training-model-progress">
                  <div className="training-model-progress-bar">
                    {/* ml-service's /train is one blocking call with no
                        incremental progress to report, so this is an
                        indeterminate indicator, not a real percentage. */}
                    <div
                      className={`training-model-progress-fill${isTrainingComplete ? "" : " training-model-progress-fill--indeterminate"}`}
                      style={{ width: isTrainingComplete ? "100%" : "100%" }}
                    />
                  </div>
                  <div className="training-model-progress-info">
                    <span className="training-model-progress-time">
                      {isTrainingComplete ? "Complete" : "Training in progress — this can take a few minutes"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step Cards */}
          <div className="training-step-cards">
            {/* Step 1 - Green Card */}
            <div className="training-step-card training-step-card-complete">
              <div className="training-step-number training-step-number-complete">1</div>
              <div className="training-step-content">
                <h4 className="training-step-title training-step-title-complete">
                  Upload Historical Sales Data
                </h4>
                <p className="training-step-description">
                  Upload at least 1 year of historical sales data exported from
                  your POS system. This is what the forecasting model uses to
                  learn your business's demand patterns and generate reliable
                  forecasts.
                </p>

                {/* Data Progress - Complete */}
                <div className="training-data-progress-wrapper1">
                  <div className="training-data-progress-wrapper2-complete">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                      }}
                    >
                      <FaCheckCircle
                        style={{
                          color: "#0F9918",
                          fontSize: "18px",
                          marginTop: "2px",
                          flexShrink: 0,
                        }}
                      />
                      <p className="training-step-description1">
                        Historical data upload complete. All {getMonths()} months of data
                        have been successfully uploaded and validated.
                      </p>
                    </div>
                  </div>

                  <div className="training-data-progress-wrapper">
                    <div className="training-data-progress-label">
                      <span>Historical Data</span>
                      <span className="training-data-progress-text-complete">
                        {getMonths()} / {totalMonthsNeeded} months Complete
                      </span>
                    </div>
                    <div className="training-data-progress-bar">
                      <div
                        className="training-data-progress-fill-complete"
                        style={{
                          width: `${Math.min(dataProgress, 100)}%`,
                          backgroundColor: "#0F9918",
                        }}
                      />
                    </div>
                  </div>
                </div>

                <button
                  className="training-step-btn training-step-btn-complete"
                  onClick={handleUploadData}
                >
                  Upload Complete
                </button>
              </div>
            </div>

            {/* Step 2 - Products Detected */}
            <div className="training-step-card">
              <div className="training-step-number">2</div>
              <div className="training-step-content">
                <h4 className="training-step-title">
                  Add Ingredient Recipes to Your Products
                </h4>
                <p className="training-step-description">
                  Your menu products will be automatically detected when you
                  upload your sales data. After uploading, add the ingredient
                  recipe for each product so the system can estimate how much of
                  each ingredient you'll need to prepare.
                </p>

                {/* Products Detected Section */}
                <div className="training-products-detected">
                  <div className="training-products-header">
                    <h5 className="training-products-title">Products Detected from Your Sales Data</h5>
                    <div className="training-products-summary">
                      <p className="training-products-total">{totalProducts} products were found in your sales data.</p>
                      <p className="training-products-missing">{productsWithoutRecipes} still need ingredient recipes added.</p>
                    </div>
                    <p className="training-products-note">
                      Products without recipes will still be forecasted, but will not appear in the ingredient demand shopping list.
                    </p>
                  </div>

                  {/* Product Table */}
                  <div className="training-products-table">
                    <div className="training-products-table-header">
                      <span>Product Name</span>
                      <span>Action</span>
                    </div>
                    {productsNeedingRecipes.length > 0 ? (
                      productsNeedingRecipes.map((product, index) => (
                        <div className="training-products-table-row" key={index}>
                          <span>{product.name}</span>
                          <button 
                            className="training-products-add-btn"
                            onClick={() => handleAddRecipe(product.name)}
                          >
                            Add Recipe
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="training-products-table-row">
                        <span style={{ color: '#0F9918', fontWeight: 600 }}>
                          All products have recipes added
                        </span>
                        <span style={{ color: '#0F9918' }}>Complete</span>
                      </div>
                    )}
                    {productsWithoutRecipes > 3 && (
                      <div className="training-products-table-row" style={{ fontStyle: 'italic', color: '#6b7280' }}>
                        <span>+ {productsWithoutRecipes - 3} more products needing recipes</span>
                        <span></span>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  className="training-step-btn training-step-btn-secondary"
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

export default TrainingInProgress;