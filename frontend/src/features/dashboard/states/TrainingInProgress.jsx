// states/TrainingInProgress.jsx
//
// State 4 of 7 — ml-service is actively training. Because ml-service's
// /train is a single blocking HTTP call (no job queue), there is no real
// incremental percentage or ETA to report: the training bar below is an
// indeterminate shimmer, not a fabricated number.
//
// Layout: the shared state kit (components/DashboardStateKit.jsx).
// Data: services/apiClient + hooks/usePolling — one request at a time per
// poll, paused while the tab is hidden, stopped on a login problem.
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCheckCircle, FaSpinner } from "react-icons/fa";
import trainingInProgressImage from "../../../assets/images/Rene.png";
import { useHelp } from "../../../hooks/useHelp";
import apiClient from "../../../services/apiClient";
import usePolling from "../../../hooks/usePolling";
import {
  StateShell,
  StateBanner,
  Illustration,
  ProgressMeter,
  Meter,
  SetupStep,
  ProductsDetected,
} from "../components/DashboardStateKit.jsx";

// Was 3 s (training status), 5 s (upload progress) and 10 s (products).
const TRAINING_STATUS_POLL_MS = 15000;
const UPLOAD_PROGRESS_POLL_MS = 60000;
const PRODUCTS_POLL_MS = 60000;

const TrainingInProgress = ({ onRefreshState, initialState }) => {
  const navigate = useNavigate();
  const { openHelp } = useHelp();

  // Seeded from the Dashboard's dashboard-state response: `stats` is the same
  // getUploadStats() payload /upload/stats/summary returns, and `progress`
  // the same getUploadProgress() payload /upload/progress returns — real
  // values, so the screen is right on the first frame. Without a seed
  // everything starts as null and shows "—", never an invented number
  // (these used to start at 50%, 100% and 12/12 months).
  const seedStats = initialState?.stats || null;
  const seedProgress = initialState?.progress?.progress;
  const seedMonths = seedStats ? Number(seedStats.months_uploaded) || 0 : null;

  const [progressPercentage, setProgressPercentage] = useState(
    seedProgress != null ? Number(seedProgress) || 0 : null
  );
  const [uploadedMonths, setUploadedMonths] = useState(seedMonths);
  const [dataProgress, setDataProgress] = useState(
    seedMonths != null ? Math.min((seedMonths / 12) * 100, 100) : null
  );
  const [totalMonthsNeeded] = useState(12);
  const [isTrainingComplete, setIsTrainingComplete] = useState(false);
  const [products, setProducts] = useState([]);
  const [totalProducts, setTotalProducts] = useState(null);

  // Last known "training running?" answer, to spot the true -> false change.
  const wasTrainingRef = useRef(null);
  const dataStatusLoadedRef = useRef(Boolean(seedStats));
  // Upload progress and stats came with the Dashboard's request moments ago.
  const skipFirstProgressPollRef = useRef(Boolean(seedStats) && seedProgress != null);

  const handleUploadData = () => {
    navigate("/data-management");
  };

  const handleInventoryManagement = () => {
    navigate("/inventory-management");
  };

  const handleAddRecipe = (productName) => {
    navigate("/inventory-management", { state: { product: productName } });
  };

  // A failed request throws: the screen keeps its last values (usePolling
  // records the error). The old catch blocks filled in invented values
  // (12/12 months, 50% progress, and a hardcoded list of 12 product names),
  // which looked like real data.

  const fetchDataStatus = async (signal) => {
    const statusResponse = await apiClient.get("/upload/stats/summary", { signal });
    if (statusResponse.data.success) {
      const data = statusResponse.data.data;
      // The server's own number, as is. This used to turn 0 into 12
      // (`|| 12`), then count uploads as months, then round 0 up to 1.
      const months = Number(data.months_uploaded) || 0;
      setUploadedMonths(months);
      setDataProgress(Math.min((months / totalMonthsNeeded) * 100, 100));
      dataStatusLoadedRef.current = true;
    }
  };

  // Upload progress. The data status is loaded on the first run (unless it
  // was seeded) and whenever processing is complete.
  const fetchUploadProgress = async (signal) => {
    if (skipFirstProgressPollRef.current) {
      skipFirstProgressPollRef.current = false;
      return;
    }
    const response = await apiClient.get("/upload/progress", { signal });
    if (response.data.success) {
      // The real upload progress (was `|| 50`, an invented fallback).
      const progress = Number(response.data.data.progress) || 0;
      setProgressPercentage(progress);

      if (progress >= 100 || !dataStatusLoadedRef.current) {
        await fetchDataStatus(signal);
      }
    }
  };

  // Training status. mlService.isTrainingInFlight() only knows "still
  // running" vs "finished". When isTraining flips from true to false, this
  // asks the Dashboard to re-check its state right away (onRefreshState)
  // instead of waiting for its next poll, so the owner moves on to whichever
  // state follows (forecasts-ready-recipes-pending, fully-operational, or
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
  };

  usePolling(fetchUploadProgress, UPLOAD_PROGRESS_POLL_MS);
  usePolling(fetchTrainingStatus, TRAINING_STATUS_POLL_MS);
  usePolling(fetchProducts, PRODUCTS_POLL_MS);

  const getMonths = () =>
    uploadedMonths == null ? null : Math.min(uploadedMonths, totalMonthsNeeded);
  const productsWithoutRecipes = products.filter((p) => !p.product_ingredients?.length).length;

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
                  {isTrainingComplete ? "Ready to view forecasts" : "Analyzing the pattern..."}
                </span>
              </div>

              <div style={{ marginTop: 18 }}>
                <ProgressMeter
                  label="Model Training"
                  tone="info"
                  value={isTrainingComplete ? 100 : null}
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
              {getMonths() == null
                ? "Checking your uploaded sales data…"
                : `Historical data upload complete. All ${getMonths()} months of data have been successfully uploaded and validated.`}
            </div>

            <div style={{ marginTop: 16 }}>
              <Meter
                tone="ok"
                label="Historical Data"
                value={getMonths() == null ? "—" : `${getMonths()} / ${totalMonthsNeeded} months Complete`}
                percent={dataProgress ?? 0}
              />
            </div>
          </SetupStep>

          <SetupStep
            index={2}
            title="Add Ingredient Recipes to Your Products"
            tag={
              totalProducts == null ? (
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
                {totalProducts == null ? (
                  "Checking your products…"
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
