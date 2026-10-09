// states/TrainingInProgress.jsx
//
// State 4 of 7 — ml-service is actively training. Because ml-service's
// /train is a single blocking HTTP call (no job queue), there is no real
// incremental percentage or ETA to report: the bar below is an
// indeterminate shimmer, not a fabricated number. Dashboard.jsx's 5s poll
// of /upload/dashboard-state moves the owner on as soon as the in-flight
// flag clears, so this component never navigates by itself.
import { useState, useEffect } from "react";
import axios from "axios";
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/TrainingInProgress.css";
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCheckCircle, FaSpinner } from "react-icons/fa";
import trainingInProgressImage from "../../../assets/images/NoData.png";
import { useHelp } from "../../../hooks/useHelp";
import {
  StateShell,
  StateBanner,
  SetupStep,
  Illustration,
  ProgressMeter,
  Meter,
  ProductsDetected,
} from "../components/DashboardStateKit.jsx";
import apiClient from "../../../services/apiClient";
import usePolling from "../../../hooks/usePolling";

// One request at a time, paused while the tab is hidden (hooks/usePolling.js).
// Was 3 s (training status), 5 s (upload progress) and 10 s (products).
const TRAINING_STATUS_POLL_MS = 15000;
const UPLOAD_PROGRESS_POLL_MS = 60000;
const PRODUCTS_POLL_MS = 60000;

const TrainingInProgress = ({ initialState }) => {
const TrainingInProgress = ({ onRefreshState }) => {
  const navigate = useNavigate();
  const { openHelp } = useHelp();
  // Seeded from the Dashboard's dashboard-state response: `stats` is the same
  // getUploadStats() payload /upload/stats/summary returns, and `progress` the
  // same getUploadProgress() payload /upload/progress returns. Both used to be
  // re-requested on mount, so the bars sat at their defaults for a beat after
  // the screen appeared.
  const seedStats = initialState?.stats;
  const seedMonths = Math.min(seedStats?.months_uploaded || 0, 12);
  const [progressPercentage, setProgressPercentage] = useState(
    initialState?.progress?.progress ?? 50
  );
  const [dataProgress, setDataProgress] = useState(
    seedStats ? Math.min((seedMonths / 12) * 100, 100) : 100
  );
  const [uploadedMonths, setUploadedMonths] = useState(seedMonths || 12);
  const [totalMonthsNeeded] = useState(12);
  const [isTrainingComplete, setIsTrainingComplete] = useState(false);
  const [products, setProducts] = useState([]);
  const [totalProducts, setTotalProducts] = useState(0);
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
    (error) => Promise.reject(error),
  );
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
      const statusResponse = await apiClient.get("/upload/stats/summary");
      setIsLoading(true);

      const statusResponse = await apiClient.get("/upload/stats/summary", { signal });

      if (statusResponse.data.success) {
        const data = statusResponse.data.data;

        const totalRows = data.sales_records || data.total_rows || 0;
        const totalUploads = data.total_uploads || 0;
        let months = data.months_uploaded || 12;

        const monthsUploaded = data.months_uploaded || 12;

        let months = monthsUploaded;
        if (months === 0 && totalUploads > 0) {
          months = Math.min(totalUploads, totalMonthsNeeded);
        }

        if (totalRows > 0 && months === 0) {
          months = 1;
        }

        setUploadedMonths(months);
        setDataProgress(Math.min((months / totalMonthsNeeded) * 100, 100));
      }
    } catch (error) {
      console.error("Error fetching data status:", error);
      setUploadedMonths(12);
      setDataProgress(100);
    }
  };

  // Fetch upload progress
  const fetchUploadProgress = async () => {
    try {
      const response = await apiClient.get("/upload/progress");
      if (response.data.success) {
        setProgressPercentage(response.data.data.progress || 50);
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

  // Fetch training status. mlService.isTrainingInFlight() only knows "still
  // running" vs "finished" — see the note at the top of this file.
  const fetchTrainingStatus = async () => {
    try {
      const response = await apiClient.get("/ml/training-status");
      if (response.data.success) {
        setIsTrainingComplete(!response.data.data.isTraining);
      }
    } catch (error) {
      console.error("Error fetching training status:", error);
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
  const fetchProducts = async () => {
    try {
      const [activeResponse, inactiveResponse] = await Promise.all([
        apiClient.get("/mapping/products", { params: { status: "active", forceRefresh: "true" } }),
        apiClient.get("/mapping/products", { params: { status: "inactive", forceRefresh: "true" } }),
      ]);
      const activeProducts = activeResponse.data.success ? activeResponse.data.data || [] : [];
      const inactiveProducts = inactiveResponse.data.success ? inactiveResponse.data.data || [] : [];
      const productsData = [...activeProducts, ...inactiveProducts];
      setProducts(productsData);
      setTotalProducts(productsData.length);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  useEffect(() => {
    // Parallel, and only for what dashboard-state doesn't already carry. This
    // used to await four requests one after another before showing anything.
    async function load() {
      if (!seedStats) {
        // Unseeded (direct visit): no stats or progress to start from.
        fetchDataStatus();
        fetchUploadProgress();
      }
      fetchTrainingStatus();
      fetchProducts();
    }

    load();

    const uploadInterval = setInterval(fetchUploadProgress, 5000);
    const trainingInterval = setInterval(fetchTrainingStatus, 3000);
    const productsInterval = setInterval(fetchProducts, 10000);

    return () => {
      clearInterval(uploadInterval);
      clearInterval(trainingInterval);
      clearInterval(productsInterval);
    };
  }, []);
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

  const getMonths = () => Math.min(uploadedMonths, totalMonthsNeeded);
  const productsNeedingRecipes = products.filter((p) => !p.product_ingredients?.length);
  const productsWithoutRecipes = productsNeedingRecipes.length;

  return (
    <StateShell
      eyebrow="Step 2 of 2"
      eyebrowTone="info"
      title={<>Model training <em>in progress</em></>}
      lede="ChefDuo Forecast is analysing your historical sales patterns. Your forecasting dashboard unlocks automatically the moment training finishes."
      progress={{
        value: progressPercentage,
        tone: "info",
        caption: "Setup progress across the whole system",
      }}
      status={
        <StateBanner
          tone="info"
          icon={
            isTrainingComplete ? (
              <FaCheckCircle size={20} />
            ) : (
              <FaSpinner className="sk-spinner" size={20} />
            )
          }
          title={isTrainingComplete ? "Training complete" : "Model Training In Progress"}
          text={
            isTrainingComplete
              ? "Forecasts are ready — the dashboard will move to your results in a moment."
              : "This may take a few minutes. You can leave this page open or keep working — the dashboard switches over on its own once training is done."
          }
        />
      }
    >
      <Illustration
        src={trainingInProgressImage}
        alt="Model training illustration"
        copy={
          <div>
            <h2 className="sk-section-title">What's happening right now</h2>
            <p className="sk-section-sub">
              The forecasting engine is reading your sales history and learning the
              patterns behind it — weekday versus weekend, seasonal swings and
              payday-related demand changes.
            </p>
            <button
              type="button"
              className="sk-btn sk-btn--secondary sk-btn--sm"
              style={{ marginTop: 20 }}
              onClick={() => openHelp("how-it-works")}
            >
              Learn how ChefDuo Forecast works
            </button>
          </div>
        }
      />

      <section className="sk-section">
        <div className="sk-card sk-card--info">
          <div className="sk-card-head">
            <span className="sk-card-ico sk-card-ico--info">
              {isTrainingComplete ? (
                <FaCheckCircle size={20} />
              ) : (
                <FaSpinner className="sk-spinner" size={20} />
              )}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 className="sk-card-title">
                {isTrainingComplete ? "Training Complete" : "Still training…"}
              </h2>
              <p className="sk-card-text">
                {isTrainingComplete
                  ? "Ready to view forecasts."
                  : "Analysing the pattern. You can keep working — recipes and stock levels can be edited while this runs."}
              </p>

              <div className="sk-live" style={{ marginTop: 16 }}>
                <span className={`sk-dot${isTrainingComplete ? " sk-dot--done" : ""}`} />
                <span className={`sk-live-text${isTrainingComplete ? " sk-live-text--done" : ""}`}>
                  {isTrainingComplete ? "Training Complete" : "Still training..."}
                </span>
                <span className="sk-live-sub">
                  {isTrainingComplete
                    ? "Ready to view forecasts"
                    : "Analyzing the pattern..."}
                </span>
              </div>

              <div style={{ marginTop: 18 }}>
                <ProgressMeter
                  label="Model Training"
                  tone="info"
                  indeterminate={!isTrainingComplete}
                  caption={
                    isTrainingComplete
                      ? "Complete — your dashboard is updating now."
                      : "Training in progress — this can take a few minutes."
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sk-section">
        <div className="sk-section-head">
          <div>
            <h2 className="sk-section-title">While you wait</h2>
            <p className="sk-section-sub">
              Recipes and stock levels can be edited while training runs, so the
              shopping list is ready the moment forecasting does.
            </p>
          </div>
        </div>

        <div className="sk-grid-2">
          <SetupStep
            index={1}
            tone="ok"
            title="Upload Historical Sales Data"
            tag={<span className="sk-tag sk-tag--ok">Complete</span>}
            foot={
              <button type="button" className="sk-btn sk-btn--ghost" onClick={handleUploadData}>
                Upload More Data
                <FaArrowRight size={15} />
              </button>
            }
          >
            <div className="sk-note sk-note--ok">
              <FaCheckCircle size={16} style={{ color: "var(--sk-success)", marginRight: 8, verticalAlign: -3 }} />
              Historical data upload complete. All {getMonths()} months of data have been
              successfully uploaded and validated.
            </div>

            <div style={{ marginTop: 16 }}>
              <Meter
                tone="ok"
                label="Historical Data"
                value={`${getMonths()} / ${totalMonthsNeeded} months Complete`}
                percent={dataProgress}
              />
            </div>
          </SetupStep>

          <SetupStep
            index={2}
            title="Add Ingredient Recipes to Your Products"
            tag={
              products.length === 0 ? (
                <span className="sk-tag">Checking…</span>
              ) : productsWithoutRecipes > 0 ? (
                <span className="sk-tag sk-tag--warn">
                  {productsWithoutRecipes} need recipes
                </span>
              ) : (
                <span className="sk-tag sk-tag--ok">Complete</span>
              )
            }
            foot={
              <button
                type="button"
                className="sk-btn sk-btn--secondary"
                onClick={handleInventoryManagement}
              >
                Go to Inventory Management
                <FaArrowRight size={15} />
              </button>
            }
          >
            <p className="sk-card-text">
              Your menu products were automatically detected when you uploaded your sales
              data. Add the ingredient recipe for each product so the system can estimate
              how much of each ingredient you'll need to prepare.
            </p>

            <div className="sk-subcard" style={{ marginTop: 18 }}>
              <div className="sk-subcard-title">Products detected from your sales data</div>
              <p className="sk-subcard-text">
                {products.length === 0 ? (
                  "Looking for the products detected in your sales data…"
                ) : (
                  <>
                    <strong>{totalProducts}</strong> products were found in your sales data.{" "}
                    <strong>{productsWithoutRecipes}</strong> still need ingredient recipes
                    added.
                  </>
                )}
              </p>

              <div style={{ marginTop: 14 }}>
                <ProductsDetected products={products} onAddRecipe={handleAddRecipe} />
              </div>

              <p className="sk-subcard-foot">
                Products without recipes will still be forecasted, but will not appear
                in the ingredient demand shopping list.
              </p>
            </div>
          </SetupStep>
        </div>
      </section>
    </StateShell>
  );
};

export default TrainingInProgress;