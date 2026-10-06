// states/UploadedInsufficient.jsx
//
// State 2 of 7 — data has been uploaded but the history doesn't clear the
// training gate yet (see backend/utils/historyGate.js):
//   'span'        — the sales history covers fewer than 365 days
//   'unconfirmed' — it is long enough, but some dates inside it have no
//                   sales and aren't marked closed
//   'both' / 'no_data'
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaInfoCircle } from "react-icons/fa";
import uploadedInsufficientImage from "../../../assets/images/NoData.png";
import HistoryGapReview from "../components/HistoryGapReview.jsx";
import { useHelp } from "../../../hooks/useHelp";
import {
  StateShell,
  StateBanner,
  SetupStep,
  Illustration,
  Meter,
  ProductsDetected,
} from "../components/DashboardStateKit.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const UploadedInsufficient = ({ onRefreshState, initialState }) => {
  const navigate = useNavigate();
  const { openHelp } = useHelp();
  // Seeded from the dashboard-state response the Dashboard already has in hand
  // (it contains this exact stats/progress/history shape — same service methods
  // as /upload/stats/summary and /upload/progress). Without this the screen
  // mounted with zeros and a loading flag, then visibly filled in a moment
  // later, which is the "loading finished, now it's still loading" effect.
  const seed = initialState || {};
  const seedMonths = seed.stats?.actual_months_uploaded || 0;
  const seedProgress = seed.history?.requiredSpanDays
    ? (seed.history.spanDays / seed.history.requiredSpanDays) * 100
    : (seedMonths / 12) * 100;

  const [progressPercentage, setProgressPercentage] = useState(20);
  const [dataProgress, setDataProgress] = useState(
    initialState ? Math.min(seedProgress, 100) : 0
  );
  const [uploadedMonths, setUploadedMonths] = useState(seedMonths);
  const [totalMonthsNeeded] = useState(12);
  const [isLoading, setIsLoading] = useState(!initialState);
  const [hasData, setHasData] = useState(
    initialState ? (seed.stats?.sales_records > 0 || seed.stats?.total_uploads > 0) : false
  );
  const [insufficientReason, setInsufficientReason] = useState(
    seed.insufficientReason || null
  );
  // { firstSaleDate, lastSaleDate, spanDays, spanMonths, requiredSpanDays,
  //   openDays, closedDays, unconfirmedDays } — closed days count toward
  // the span; today's date does not.
  const [history, setHistory] = useState(seed.history || null);
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

  // After the owner marks dates closed: refresh this screen's numbers, then
  // ask the Dashboard to re-check its state right away (if every date is
  // now accounted for, it moves on to "Ready to Train").
  const handleGapsSaved = async () => {
    await fetchDataStatus();
    if (onRefreshState) await onRefreshState();
  };

  // 'YYYY-MM-DD' -> 'Jul 10, 2025', built from parts so the browser's
  // timezone can't shift the day.
  const formatShortDate = (dateStr) => {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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

  // Fetch data status and upload progress
  const fetchDataStatus = async () => {
    try {
      setIsLoading(true);

      const statusResponse = await apiClient.get("/upload/dashboard-state");

      if (statusResponse.data.success) {
        const {
          state,
          stats: data,
          insufficientReason: reason,
          history: historyData,
        } = statusResponse.data.data;
        setProgressPercentage(20);
        setInsufficientReason(reason || null);
        setHistory(historyData || null);

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
        const months = data.actual_months_uploaded || 0;

        setUploadedMonths(months);
        setHasData(totalRows > 0 || totalUploads > 0);

        // Progress tracks the history SPAN (first to last sale date, closed
        // days included) against the 365-day rule — the thing that
        // actually gates training.
        const progressPercent = historyData?.requiredSpanDays
          ? (historyData.spanDays / historyData.requiredSpanDays) * 100
          : (months / totalMonthsNeeded) * 100;
        setDataProgress(Math.min(progressPercent, 100));

        if (isMountedRef.current && state !== "uploaded-insufficient") {
          navigate("/dashboard", { replace: true });
        }
      }
    } catch (error) {
      console.error("Error fetching data status:", error);
      try {
        const uploadsResponse = await apiClient.get("/upload?limit=1");
        const totalUploads =
          uploadsResponse.data.count || uploadsResponse.data.data?.length || 0;
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

        if (state === "fully-operational") {
          await fetchDataStatus();
        }
      }
    } catch (error) {
      console.error("Error fetching upload progress:", error);
      try {
        const uploadsResponse = await apiClient.get("/upload?limit=1");
        const totalUploads =
          uploadsResponse.data.count || uploadsResponse.data.data?.length || 0;
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

    // Parallel, not sequential: these used to be awaited one after another, so
    // three round trips stacked up before anything was on screen.
    async function load() {
      // Only re-check the state itself when there was nothing to seed from (a
      // direct visit to /dashboard/uploaded-insufficient). The seeded values
      // are from the same endpoint moments earlier.
      if (!initialState) fetchDataStatus();
      fetchProducts();
    }

    load();

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

  const getMonths = () => Math.min(uploadedMonths, totalMonthsNeeded);

  const isDataSufficient = uploadedMonths >= totalMonthsNeeded;
  const productsNeedingRecipes = products.filter(
    (product) => !product.product_ingredients?.length,
  );

  // The one-paragraph explanation of WHY training is still blocked, derived
  // from the reason backend/utils/historyGate.js reported.
  const blockerText = (() => {
    if (isLoading) return "Loading data status…";
    if (!hasData || !history || insufficientReason === "no_data") {
      return "Upload your sales data to get started with forecasting.";
    }
    if (insufficientReason === "unconfirmed") {
      return (
        <>
          Your sales history is long enough ({history.spanMonths} months). But{" "}
          {history.unconfirmedDays} date{history.unconfirmedDays === 1 ? "" : "s"} in it{" "}
          {history.unconfirmedDays === 1 ? "has" : "have"} no sales and{" "}
          {history.unconfirmedDays === 1 ? "is" : "are"} not marked as closed. Please
          check those dates below before training can start.
        </>
      );
    }
    if (insufficientReason === "both") {
      return (
        <>
          You need at least {totalMonthsNeeded} months of sales history. You have{" "}
          {history.spanMonths} months so far. Also, {history.unconfirmedDays} date
          {history.unconfirmedDays === 1 ? "" : "s"} with no sales still need checking
          (see below).
        </>
      );
    }
    return (
      <>
        You need at least {totalMonthsNeeded} months of sales history before
        forecasting can start. You have {history.spanMonths} months so far (
        {history.spanDays} of {history.requiredSpanDays} days). Days your store was
        closed count too.
      </>
    );
  })();

  return (
    <StateShell
      eyebrow="Step 1 in progress"
      eyebrowTone="warn"
      title={<>Sales data uploaded, <em>history not complete</em></>}
      lede="Your files are in and your menu products have been detected. Training starts once the history covers 12 months and every day inside it is accounted for."
      progress={{
        value: progressPercentage,
        tone: "warn",
        caption: "Setup progress across the whole system",
      }}
      status={
        <StateBanner
          tone="warn"
          icon={<FaInfoCircle size={20} />}
          title="Forecasting starts once your history clears the 12-month rule"
          text={blockerText}
        />
      }
    >
      <Illustration
        src={uploadedInsufficientImage}
        alt="ChefDuo Forecast illustration"
        copy={
          <div>
            <h2 className="sk-section-title">Let's get your dashboard ready</h2>
            <p className="sk-section-sub">
              Once your history is complete this page turns into live demand
              forecasts, sales trends, product performance, ingredient requirements and
              replenishment insights. Two things are left to do below.
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
        <div className="sk-section-head">
          <div>
            <h2 className="sk-section-title">Finish setting up</h2>
            <p className="sk-section-sub">
              Days your store was closed count toward the 12 months, so mark them as
              closed rather than leaving them blank.
            </p>
          </div>
        </div>

        <div className="sk-grid-2">
          <SetupStep
            index={1}
            title="Upload Historical Sales Data"
            tag={<span className="sk-tag sk-tag--warn">In progress</span>}
            foot={
              <button
                type="button"
                className="sk-btn sk-btn--secondary"
                onClick={handleUploadData}
              >
                {hasData ? "Upload More Data" : "Upload Sales Data"}
                <FaArrowRight size={15} />
              </button>
            }
          >
            <p className="sk-card-text">
              Upload at least 1 year of historical sales data exported from your POS
              system. This is what the forecasting model uses to learn your business's
              demand patterns and generate reliable forecasts.
            </p>

            <div style={{ marginTop: 18 }}>
              <Meter
                label={`Sales history${
                  history?.firstSaleDate
                    ? ` (${formatShortDate(history.firstSaleDate)} – ${formatShortDate(
                        history.lastSaleDate,
                      )})`
                    : ""
                }`}
                value={
                  history
                    ? `${Math.min(history.spanMonths, totalMonthsNeeded)} / ${totalMonthsNeeded} months`
                    : `${getMonths()} / ${totalMonthsNeeded} months`
                }
                percent={dataProgress}
                tone={isDataSufficient || dataProgress >= 100 ? "ok" : ""}
              />
            </div>

            {history && history.spanDays > 0 ? (
              <div className="sk-counts" style={{ marginTop: 14 }}>
                <div className="sk-count">
                  <div className="sk-count-label">Days in history</div>
                  <div className="sk-count-value">{history.spanDays}</div>
                </div>
                <div className="sk-count">
                  <div className="sk-count-label">Open, with sales</div>
                  <div className="sk-count-value">{history.openDays}</div>
                </div>
                <div className="sk-count sk-count--ok">
                  <div className="sk-count-label">Marked closed</div>
                  <div className="sk-count-value">{history.closedDays}</div>
                </div>
                <div
                  className={`sk-count${history.unconfirmedDays > 0 ? " sk-count--warn" : ""}`}
                >
                  <div className="sk-count-label">Not yet checked</div>
                  <div className="sk-count-value">{history.unconfirmedDays}</div>
                </div>
              </div>
            ) : null}

            {history && history.unconfirmedDays > 0 ? (
              <div style={{ marginTop: 16 }}>
                <HistoryGapReview onSaved={handleGapsSaved} />
              </div>
            ) : null}
          </SetupStep>

          <SetupStep
            index={2}
            title="Add Ingredient Recipes to Your Products"
            tag={
              products.length === 0 ? (
                <span className="sk-tag">Checking…</span>
              ) : productsNeedingRecipes.length > 0 ? (
                <span className="sk-tag sk-tag--warn">
                  {productsNeedingRecipes.length} need recipes
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
              Your menu products were automatically detected when you uploaded your
              sales data. Add the ingredient recipe for each product so the system can
              estimate how much of each ingredient you'll need to prepare.
            </p>

            <div className="sk-subcard" style={{ marginTop: 18 }}>
              <div className="sk-subcard-title">Products detected from your sales data</div>
              <p className="sk-subcard-text">
                {products.length === 0 ? (
                  "Looking for the products detected in your sales data…"
                ) : (
                  <>
                    <strong>{products.length}</strong> products were found.{" "}
                    <strong>{productsNeedingRecipes.length}</strong> still need ingredient
                    recipes added.
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

export default UploadedInsufficient;