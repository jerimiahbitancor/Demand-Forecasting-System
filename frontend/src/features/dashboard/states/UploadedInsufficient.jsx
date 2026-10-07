// states/UploadedInsufficient.jsx
//
// State 2 of 7 — data has been uploaded but the history doesn't clear the
// training gate yet (see backend/utils/historyGate.js):
//   'span'        — the sales history covers fewer than 365 days
//   'unconfirmed' — it is long enough, but some dates inside it have no
//                   sales and aren't marked closed
//   'both' / 'no_data'
//
// Layout: the shared state kit (components/DashboardStateKit.jsx).
// Data: services/apiClient + hooks/usePolling — one check at a time, paused
// while the tab is hidden, stopped on a login problem.
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaInfoCircle } from "react-icons/fa";
import uploadedInsufficientImage from "../../../assets/images/NoData.png";
import HistoryGapReview from "../components/HistoryGapReview.jsx";
import { useHelp } from "../../../hooks/useHelp";
import apiClient from "../../../services/apiClient";
import usePolling from "../../../hooks/usePolling";
import {
  StateShell,
  StateBanner,
  SetupStep,
  Illustration,
  Meter,
  ProductsDetected,
} from "../components/DashboardStateKit.jsx";

// Was 5 s (state) and 10 s (products).
const STATE_POLL_MS = 60000;
const PRODUCTS_POLL_MS = 60000;

const UploadedInsufficient = ({ onRefreshState, initialState }) => {
  const navigate = useNavigate();
  const { openHelp } = useHelp();

  // Seeded from the dashboard-state response the Dashboard already has in
  // hand (same stats/history shape this screen asks for), so the numbers are
  // right on the first frame. Without a seed nothing is known yet, and the
  // screen says so ("—", "Checking…") instead of showing 0 / 12 months.
  const seed = initialState || null;
  const seedMonths = seed?.stats?.actual_months_uploaded || 0;
  const seedProgress = seed?.history?.requiredSpanDays
    ? (seed.history.spanDays / seed.history.requiredSpanDays) * 100
    : (seedMonths / 12) * 100;

  const [progressPercentage, setProgressPercentage] = useState(20);
  const [dataProgress, setDataProgress] = useState(seed ? Math.min(seedProgress, 100) : 0);
  const [uploadedMonths, setUploadedMonths] = useState(seedMonths);
  const [totalMonthsNeeded] = useState(12);
  const [isLoading, setIsLoading] = useState(!seed);
  const [hasData, setHasData] = useState(
    seed ? (seed.stats?.sales_records > 0 || seed.stats?.total_uploads > 0) : false
  );
  const [insufficientReason, setInsufficientReason] = useState(seed?.insufficientReason || null);
  // { firstSaleDate, lastSaleDate, spanDays, spanMonths, requiredSpanDays,
  //   openDays, closedDays, unconfirmedDays } — closed days count toward
  // the span; today's date does not.
  const [history, setHistory] = useState(seed?.history || null);
  const [products, setProducts] = useState([]);
  // null until the product list has loaded once.
  const [productsLoaded, setProductsLoaded] = useState(false);
  // True after the first successful status load (or a seed). Until then the
  // months label shows "—", not "0 / 12 months".
  const [statusLoaded, setStatusLoaded] = useState(Boolean(seed));
  // The first successful status load fills this screen's numbers; later
  // polls only watch for the state changing.
  const statusLoadedRef = useRef(Boolean(seed));
  // The Dashboard asked /upload/dashboard-state moments ago; skip the first poll.
  const skipFirstStatePollRef = useRef(Boolean(seed));

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

  // Fetch data status and upload progress.
  // A failed request throws: the screen keeps its last numbers (usePolling
  // records the error). It no longer invents "months uploaded" from the
  // upload count, which on a failed check could read 12/12.
  const loadDataStatus = async (signal) => {
    try {
      setIsLoading(true);

      const statusResponse = await apiClient.get("/upload/dashboard-state", { signal });

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
        // earliest sale date purely to match ml-service's training gate.
        // No "at least 1 month" or "1 month per upload" fallback: a
        // single day of data is genuinely 0/12 months, not 1.
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
        statusLoadedRef.current = true;
        setStatusLoaded(true);

        if (state !== "uploaded-insufficient") {
          navigate("/dashboard", { replace: true });
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Used after the owner marks dates closed; never throws.
  const fetchDataStatus = () =>
    loadDataStatus().catch((error) => {
      console.error("Error fetching data status:", error);
    });

  const fetchUploadProgress = async (signal) => {
    const response = await apiClient.get("/upload/dashboard-state", { signal });
    if (response.data.success) {
      const { state } = response.data.data;
      setProgressPercentage(20);

      if (state === "fully-operational") {
        await loadDataStatus(signal);
      }
    }
  };

  const fetchProducts = async (signal) => {
    const [activeResponse, inactiveResponse] = await Promise.all([
      apiClient.get("/mapping/products", { params: { status: "active", forceRefresh: "true" }, signal }),
      apiClient.get("/mapping/products", { params: { status: "inactive", forceRefresh: "true" }, signal }),
    ]);

    const activeProducts = activeResponse.data.success ? activeResponse.data.data || [] : [];
    const inactiveProducts = inactiveResponse.data.success ? inactiveResponse.data.data || [] : [];
    setProducts([...activeProducts, ...inactiveProducts]);
    setProductsLoaded(true);
  };

  // 60 s each, never overlapping. This screen still checks
  // /upload/dashboard-state itself, on top of Dashboard.jsx (it is also
  // mounted on its own route); merging the two is left for later.
  usePolling((signal) => {
    if (skipFirstStatePollRef.current) {
      skipFirstStatePollRef.current = false;
      return undefined;
    }
    return statusLoadedRef.current ? fetchUploadProgress(signal) : loadDataStatus(signal);
  }, STATE_POLL_MS);
  usePolling(fetchProducts, PRODUCTS_POLL_MS);

  const getMonths = () => Math.min(uploadedMonths, totalMonthsNeeded);

  const isDataSufficient = uploadedMonths >= totalMonthsNeeded;
  const productsNeedingRecipes = products.filter(
    (product) => !product.product_ingredients?.length,
  );

  // The one-paragraph explanation of WHY training is still blocked, derived
  // from the reason backend/utils/historyGate.js reported.
  const blockerText = (() => {
    // Not loaded yet, or the first check failed: say so, never claim there
    // is no data.
    if (!statusLoaded) return isLoading ? "Loading data status…" : "Checking your sales history…";
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
                    : statusLoaded
                      ? `${getMonths()} / ${totalMonthsNeeded} months`
                      : `— / ${totalMonthsNeeded} months`
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
              !productsLoaded ? (
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
                {!productsLoaded ? (
                  "Checking your products…"
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