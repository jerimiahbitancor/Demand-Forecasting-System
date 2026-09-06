// states/TrainingInProgress.jsx
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/TrainingInProgress.css";
import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import trainingInProgressImage from "../../../assets/images/Rene.png";
import { FaInfoCircle, FaCheckCircle, FaSpinner } from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const TrainingInProgress = () => {
  const navigate = useNavigate();
  const [progressPercentage, setProgressPercentage] = useState(50);
  const [dataProgress, setDataProgress] = useState(100);
  const [uploadedMonths, setUploadedMonths] = useState(12);
  const [totalMonthsNeeded] = useState(12);
  const [isLoading, setIsLoading] = useState(false);
  const [hasData, setHasData] = useState(true);
  const [trainingProgress, setTrainingProgress] = useState(60);
  const [estimatedTime, setEstimatedTime] = useState("30 minutes");
  const [isTrainingComplete, setIsTrainingComplete] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsWithRecipes, setProductsWithRecipes] = useState(3);
  const [totalProducts, setTotalProducts] = useState(12);

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

  // Fetch data status
  const fetchDataStatus = async () => {
    try {
      setIsLoading(true);
      
      const statusResponse = await apiClient.get("/upload/stats/summary");
      
      if (statusResponse.data.success) {
        const data = statusResponse.data.data;
        console.log("Data status response:", data);
        
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
      }
    } catch (error) {
      console.error("Error fetching data status:", error);
      setUploadedMonths(12);
      setDataProgress(100);
      setHasData(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch upload progress
  const fetchUploadProgress = async () => {
    try {
      const response = await apiClient.get("/upload/progress");
      if (response.data.success) {
        const progress = response.data.data.progress || 50;
        setProgressPercentage(progress);
        
        if (progress >= 100) {
          await fetchDataStatus();
        }
      }
    } catch (error) {
      console.error("Error fetching upload progress:", error);
      setProgressPercentage(50);
    }
  };

  // Fetch training status
  const fetchTrainingStatus = async () => {
    try {
      const response = await apiClient.get("/training/status");
      if (response.data.success) {
        const data = response.data.data;
        setTrainingProgress(data.progress || 60);
        setEstimatedTime(data.estimatedTime || "30 minutes");
        setIsTrainingComplete(data.isComplete || false);
        
        if (data.isComplete) {
          navigate('/forecasts-ready', { replace: true });
        }
      }
    } catch (error) {
      console.error("Error fetching training status:", error);
      // Keep default values
    }
  };

  // Fetch products data
  const fetchProducts = async () => {
    try {
      const response = await apiClient.get("/mapping/products");
      if (response.data.success) {
        const productsData = response.data.data || [];
        setProducts(productsData);
        setTotalProducts(productsData.length);
        
        const withRecipes = productsData.filter(p => p.hasRecipe).length;
        setProductsWithRecipes(withRecipes);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
      // Use fallback data
      setProducts([
        { name: "Coated Tonkatsu", hasRecipe: false },
        { name: "Breaded Porkchop", hasRecipe: false },
        { name: "Sisig", hasRecipe: false },
        { name: "Poppers Series", hasRecipe: true },
        { name: "Cheesy Spicy Tocino", hasRecipe: false },
        { name: "OG Tapsilog", hasRecipe: true },
        { name: "Lechon Kawali", hasRecipe: false },
        { name: "Chicken Sriracha", hasRecipe: true },
        { name: "Sizzling Sisig", hasRecipe: false },
        { name: "Herb Chicken", hasRecipe: false },
        { name: "Breaded Porkchop", hasRecipe: false },
        { name: "Tocino", hasRecipe: false },
      ]);
      setTotalProducts(12);
      setProductsWithRecipes(3);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      await fetchDataStatus();
      await fetchUploadProgress();
      await fetchTrainingStatus();
      await fetchProducts();
    };
    
    loadData();

    const uploadInterval = setInterval(fetchUploadProgress, 5000);
    const trainingInterval = setInterval(fetchTrainingStatus, 3000);
    const productsInterval = setInterval(fetchProducts, 10000);

    return () => {
      clearInterval(uploadInterval);
      clearInterval(trainingInterval);
      clearInterval(productsInterval);
    };
  }, []);

  const getMonths = () => {
    return Math.min(uploadedMonths, totalMonthsNeeded);
  };

  const isDataSufficient = uploadedMonths >= totalMonthsNeeded;

  const getProductsNeedingRecipes = () => {
    const needsRecipe = products.filter(p => !p.hasRecipe);
    return needsRecipe.slice(0, 3);
  };

  const productsNeedingRecipes = getProductsNeedingRecipes();
  const productsWithoutRecipes = products.filter(p => !p.hasRecipe).length;

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
              <a href="#" className="training-welcome-link">
                Learn How ChefDuo Forecast Works →
              </a>
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
                    <div 
                      className="training-model-progress-fill"
                      style={{ width: `${Math.min(trainingProgress, 100)}%` }}
                    />
                  </div>
                  <div className="training-model-progress-info">
                    <span className="training-model-progress-percent">{Math.round(trainingProgress)}%</span>
                    <span className="training-model-progress-time">
                      {isTrainingComplete ? "Complete" : `Estimated Time: ${estimatedTime}`}
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