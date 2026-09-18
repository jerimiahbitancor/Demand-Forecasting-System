// states/UploadedInsufficient.jsx
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/UploadedInsufficient.css";
import { useState, useEffect, useRef } from "react";
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
  // Actual distinct calendar days with real sales data — a plain, honest
  // count of what's actually been uploaded (see uploadService.js's
  // getUploadStats: actual_days_uploaded), shown alongside the months
  // figure so "0 months" doesn't read as "nothing happened" when a few
  // real days of data do exist.
  const [uploadedDays, setUploadedDays] = useState(0);
  const [totalMonthsNeeded] = useState(12);
  const [isLoading, setIsLoading] = useState(true);
  const [hasData, setHasData] = useState(false);
  // Why this screen is still showing — 'elapsed' (fewer than 12 calendar
  // months have passed since the earliest sale date), 'coverage' (12
  // months have passed, but real sales rows don't cover enough of that
  // span — too many gap days), or 'both'. See uploadService.js's
  // getDashboardState() — this used to be a single elapsed-time check, so
  // "why am I still here" couldn't be answered accurately once coverage
  // became its own requirement.
  const [insufficientReason, setInsufficientReason] = useState(null);
  // A full real year of sale-day rows (365, or 366 across a leap day) —
  // see uploadService.js's MIN_ACTUAL_SALE_DAYS. Deliberately a hard row
  // count, not a percentage, so the message can say exactly how many more
  // real days are needed.
  const [requiredActualDays, setRequiredActualDays] = useState(365);
  const [products, setProducts] = useState([]);
  const isMountedRef = useRef(true);

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
        const { state, stats: data, insufficientReason: reason } = statusResponse.data.data;
        console.log("Data status response:", data);
        setProgressPercentage(20);
        setInsufficientReason(reason || null);
        setRequiredActualDays(data.required_actual_days || 365);

        const totalRows = data.sales_records || data.total_rows || 0;
        const totalUploads = data.total_uploads || 0;
        // actual_months_uploaded/actual_days_uploaded count real distinct
        // calendar days that have an actual sales row (see
        // uploadService.js's getUploadStats) — the honest "how much have
        // I uploaded" number. This is deliberately NOT months_uploaded/
        // days_of_history, which measure elapsed calendar time since the
        // earliest sale date purely to match ml-service's training gate;
        // that number can read "12/12 months" from a handful of rows
        // dated over a year ago, which is accurate for "would training
        // be allowed" but not for "how much data did I actually upload."
        // No "at least 1 month" or "1 month per upload" fallback: a
        // single day of data is genuinely 0/12 months, not 1.
        const months = data.actual_months_uploaded || 0;
        const days = data.actual_days_uploaded || 0;

        setUploadedMonths(months);
        setUploadedDays(days);
        setHasData(totalRows > 0 || totalUploads > 0);

        const progressPercent = (months / totalMonthsNeeded) * 100;
        setDataProgress(Math.min(progressPercent, 100));

        if (isMountedRef.current && state !== 'uploaded-insufficient') {
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

  const fetchProducts = async () => {
    try {
      const [activeResponse, inactiveResponse] = await Promise.all([
        apiClient.get("/mapping/products", { params: { status: "active", forceRefresh: "true" } }),
        apiClient.get("/mapping/products", { params: { status: "inactive", forceRefresh: "true" } }),
      ]);

      const activeProducts = activeResponse.data.success ? activeResponse.data.data || [] : [];
      const inactiveProducts = inactiveResponse.data.success ? inactiveResponse.data.data || [] : [];
      setProducts([...activeProducts, ...inactiveProducts]);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    isMountedRef.current = true;
    const loadData = async () => {
      await fetchDataStatus();
      await fetchUploadProgress();
      await fetchProducts();
    };
    
    loadData();

    const interval = setInterval(() => {
      fetchUploadProgress();
    }, 5000);
    const productsInterval = setInterval(fetchProducts, 10000);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      clearInterval(productsInterval);
    };
  }, []);

  // Calculate months to display
  const getMonths = () => {
    return Math.min(uploadedMonths, totalMonthsNeeded);
  };

  // Determine if data is sufficient
  const isDataSufficient = uploadedMonths >= totalMonthsNeeded;
  const productsNeedingRecipes = products.filter(
    (product) => !product.product_ingredients?.length
  );
  const visibleProductsNeedingRecipes = productsNeedingRecipes.slice(0, 3);

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
                          insufficientReason === 'coverage' ? (
                            <>
                              It's been over {totalMonthsNeeded} months since your earliest
                              uploaded sale date, but the system requires {requiredActualDays} real
                              days of sales data, not just elapsed time — you're missing{" "}
                              {Math.max(requiredActualDays - uploadedDays, 0)} more day{Math.max(requiredActualDays - uploadedDays, 0) === 1 ? "" : "s"}.
                              Upload the missing dates to close the gap.
                            </>
                          ) : insufficientReason === 'both' ? (
                            <>
                              You've uploaded sales data, but the system needs at least{" "}
                              {requiredActualDays} real days of sales data spanning at
                              least {totalMonthsNeeded} months before demand forecasting
                              can activate.
                            </>
                          ) : (
                            <>
                              You've uploaded sales data, but the system needs at
                              least {totalMonthsNeeded} months of history before
                              demand forecasting can activate.
                            </>
                          )
                        ) : (
                          "Upload your sales data to get started with forecasting."
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="insufficient-data-progress-wrapper">
                    <div className="insufficient-data-progress-label">
                      <span>Historical Data{hasData ? ` (${uploadedDays} day${uploadedDays === 1 ? '' : 's'} of sales data uploaded)` : ''}</span>
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
                <div className="insufficient-products-detected">
                  <div className="insufficient-products-header">
                    <h5 className="insufficient-products-title">Products Detected from Your Sales Data</h5>
                    <div className="insufficient-products-summary">
                      <p className="insufficient-products-total">
                        {products.length} products were found in your sales data.
                      </p>
                      <p className="insufficient-products-missing">
                        {productsNeedingRecipes.length} still need ingredient recipes added.
                      </p>
                    </div>
                    <p className="insufficient-products-note">
                      Products without recipes will still be forecasted, but will not appear in the ingredient demand shopping list.
                    </p>
                  </div>

                  <div className="insufficient-products-table">
                    <div className="insufficient-products-table-header">
                      <span>Product Name</span>
                      <span>Action</span>
                    </div>
                    {visibleProductsNeedingRecipes.length > 0 ? (
                      visibleProductsNeedingRecipes.map((product, index) => (
                        <div className="insufficient-products-table-row" key={product.id || `${product.name}-${index}`}>
                          <span>{product.name}</span>
                          <button
                            className="insufficient-products-add-btn"
                            onClick={() => handleAddRecipe(product.name)}
                          >
                            Add Recipe
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="insufficient-products-table-row">
                        <span className="insufficient-products-complete">All products have recipes added</span>
                        <span className="insufficient-products-complete">Complete</span>
                      </div>
                    )}
                    {productsNeedingRecipes.length > 3 && (
                      <div className="insufficient-products-table-row insufficient-products-more">
                        <span>+ {productsNeedingRecipes.length - 3} more products needing recipes</span>
                        <span></span>
                      </div>
                    )}
                  </div>
                </div>
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