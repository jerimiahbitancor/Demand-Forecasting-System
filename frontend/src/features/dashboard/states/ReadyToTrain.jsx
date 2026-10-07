// states/ReadyToTrain.jsx
//
// State 3 of 7 — >=12 months uploaded, products detected, but the owner
// hasn't clicked Start Training yet (no model exists). Distinct from
// State 4 (TrainingInProgress.jsx) — that one only renders once
// mlService.isTrainingInFlight() is actually true.
import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { FaArrowRight, FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import trainingImage from "../../../assets/images/Rene.png";
import Swal from "../../../utils/swal";
import {
  StateShell,
  StateBanner,
  SetupStep,
  Illustration,
  Meter,
  ProductsDetected,
} from "../components/DashboardStateKit.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const ReadyToTrain = ({ initialState }) => {
  const navigate = useNavigate();
  // actual_months_uploaded/actual_days_uploaded count real distinct
  // calendar days that have a sales row (see uploadService.js's
  // getUploadStats) — the honest "how much sales data have I uploaded"
  // number. This state is reached once months_uploaded/days_of_history
  // (elapsed calendar time since the earliest sale date, matching
  // ml-service's actual training gate) clears 12 months — which can
  // happen well before 12 real months of data exist if the earliest
  // upload is old relative to today. Tracking the real count here too
  // means the owner isn't shown a bare "12/12 months" that doesn't match
  // what they actually uploaded.
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
  // null = not loaded yet (shown as "—"), so a slow or failed load never
  // reads as "0 days / 0 products".
  const [uploadedMonths, setUploadedMonths] = useState(null);
  const [uploadedDays, setUploadedDays] = useState(null);
<<<<<<< HEAD
=======
=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
  // Seeded from the Dashboard's dashboard-state response, whose `stats` block
  // is the same getUploadStats() payload /upload/stats/summary returns — so the
  // month/day counters are correct on the first frame rather than counting up
  // from zero a moment later.
  const seedStats = initialState?.stats;
  const [uploadedMonths, setUploadedMonths] = useState(
    Math.min(seedStats?.actual_months_uploaded || 0, 12)
  );
  const [uploadedDays, setUploadedDays] = useState(seedStats?.actual_days_uploaded || 0);
<<<<<<< HEAD
>>>>>>> 4c5708cc8ec29f389bce56fbd7a4bb2bca5093f6
=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
  const [totalMonthsNeeded] = useState(12);
  const [products, setProducts] = useState([]);
  const [totalProducts, setTotalProducts] = useState(null);
  const [productsWithoutRecipes, setProductsWithoutRecipes] = useState(null);
  const [isStarting, setIsStarting] = useState(false);

  const getAuthToken = () => sessionStorage.getItem("access_token") || localStorage.getItem("token");

  const apiClient = axios.create({
    baseURL: API_URL,
    headers: { "Content-Type": "application/json" },
  });
  apiClient.interceptors.request.use((config) => {
    const token = getAuthToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      // The stats are already seeded from the Dashboard's own request, so only
      // the product list — which dashboard-state doesn't carry — is fetched
      // here, and it's the only thing the first frame was ever missing.
      if (!seedStats) {
        try {
          const statsRes = await apiClient.get("/upload/stats/summary");
          if (!cancelled && statsRes.data.success) {
            const months = statsRes.data.data.actual_months_uploaded || 0;
            const days = statsRes.data.data.actual_days_uploaded || 0;
            setUploadedMonths(Math.min(months, totalMonthsNeeded));
            setUploadedDays(days);
          }
        } catch (err) {
          console.error("Error fetching upload stats:", err);
        }
      }

      try {
        const [activeRes, inactiveRes] = await Promise.all([
          apiClient.get("/mapping/products", { params: { status: "active", forceRefresh: "true" } }),
          apiClient.get("/mapping/products", { params: { status: "inactive", forceRefresh: "true" } }),
        ]);
        if (cancelled) return;
        const active = activeRes.data.success ? activeRes.data.data || [] : [];
        const inactive = inactiveRes.data.success ? inactiveRes.data.data || [] : [];
        const all = [...active, ...inactive];
        setProducts(all);
        setTotalProducts(all.length);
        setProductsWithoutRecipes(all.filter((p) => !p.product_ingredients?.length).length);
      } catch (err) {
        console.error("Error fetching products:", err);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStartTraining = async () => {
    // Fires on every click — first-time training and every retrain alike.
    // No "seen it once" / session-storage skip: the owner must
    // acknowledge reviewing their product list before every run, not
    // just the first.
    const formatConfirmTimestamp = (date) => {
      const dd = String(date.getDate()).padStart(2, "0");
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const yyyy = date.getFullYear();
      const hh = String(date.getHours()).padStart(2, "0");
      const min = String(date.getMinutes()).padStart(2, "0");
      return `${dd}/${mm}/${yyyy} | ${hh}:${min}`;
    };

    const confirmation = await Swal.fire({
      title: "Confirm training start",
      text: `Training will start now (${formatConfirmTimestamp(new Date())}). ` +
            "Make sure every product in Inventory Management is something you " +
            "actually sell. Anything else should be archived — archived " +
            "products are excluded from training and forecasting.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Confirm and start training",
      cancelButtonText: "Let me check first",
      confirmButtonColor: "#7A0101",
    });

    if (!confirmation.isConfirmed) {
      navigate("/inventory-management");
      return;
    }

    setIsStarting(true);
    // This POST doesn't resolve until training finishes server-side —
    // don't wait on it to navigate. Dashboard.jsx polls
    // /upload/dashboard-state every 5s and will pick up
    // 'training-in-progress' as soon as the in-flight flag flips, well
    // before this promise itself settles.
    //
    // The toast used to be unconditional: "Training started" fired
    // immediately, before the request even reached the server, so a
    // same-instant rejection (e.g. the upload-not-finished 409) showed
    // its own error toast stacked right on top of a "started" toast that
    // was never true. Using one toast id for the whole lifecycle means
    // there's only ever one message on screen, and it only ever claims
    // "started" once the server has actually accepted the request.
    const toastId = toast.loading("Starting training…");
    try {
      await axios.post(`${API_URL}/ml/train`, {}, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      toast.success("Training completed successfully.", { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.error || "Training failed to start", { id: toastId });
    } finally {
      setIsStarting(false);
    }
  };

  const handleAddRecipe = (productName) => {
    navigate("/inventory-management", { state: { product: productName } });
  };

  return (
    <StateShell
      eyebrow="Step 1 complete"
      eyebrowTone="ok"
      title={<>Your data is <em>ready to train</em></>}
      lede="Start training whenever you're ready. Training runs in the background, so you can keep adding ingredient recipes while it finishes."
      progress={{ value: 50, tone: "ok", caption: "Setup progress across the whole system" }}
      status={
        <StateBanner
          tone="ok"
          icon={<FaCheckCircle size={20} />}
          title="Sales history requirement met"
          text={`Your sales history covers at least ${totalMonthsNeeded} months and every day in it is accounted for — open with sales, or marked closed. Training is available${
            uploadedDays ? ` across ${uploadedDays} uploaded sales day${uploadedDays === 1 ? "" : "s"}` : ""
          }.`}
          actions={
            <button
              type="button"
              className="sk-btn sk-btn--success"
              onClick={handleStartTraining}
              disabled={isStarting}
            >
              {isStarting ? "Starting…" : "Start Training"}
              <FaArrowRight size={15} />
            </button>
          }
        />
      }
    >
      <Illustration
        src={trainingImage}
        alt="Model ready to train illustration"
        copy={
          <div>
            <h2 className="sk-section-title">One click from live forecasts</h2>
            <p className="sk-section-sub">
              ChefDuo Forecast reads your historical sales patterns, learns weekday,
              weekend, seasonal and payday behaviour, then turns that into daily and
              weekly product demand projections.
            </p>
            <div className="sk-tags" style={{ marginTop: 20 }}>
              <span className="sk-tag sk-tag--brand">Takes a few minutes</span>
              <span className="sk-tag">Runs in the background</span>
              <span className="sk-tag">Daily + weekly forecasts</span>
            </div>
          </div>
        }
      />

      <section className="sk-section">
        <div className="sk-section-head">
          <div>
            <h2 className="sk-section-title">Where you are in the setup</h2>
            <p className="sk-section-sub">
              Training is unlocked. Adding recipes is optional but is what produces the
              ingredient shopping list later on.
            </p>
          </div>
        </div>

          <div className="training-step-cards">
            <div className="training-step-card training-step-card-complete">
              <div className="training-step-number training-step-number-complete">1</div>
              <div className="training-step-content">
                <h4 className="training-step-title training-step-title-complete">
                  Upload Historical Sales Data
                </h4>
                <div className="training-data-progress-wrapper1">
                  <div className="training-data-progress-wrapper2-complete">
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      <FaCheckCircle style={{ color: "#0F9918", fontSize: "18px", marginTop: "2px", flexShrink: 0 }} />
                      <p className="training-step-description1">
                        Requirement met — your sales history covers at least {totalMonthsNeeded} months,
                        and every day in it is accounted for (open with sales, or marked
                        closed). Training is available.
                      </p>
                    </div>

                    <div className="training-data-progress-wrapper">
                      <div className="training-data-progress-label">
                        <span>
                          {uploadedDays == null
                            ? "Sales data actually uploaded (—)"
                            : `Sales data actually uploaded (${uploadedDays} day${uploadedDays === 1 ? '' : 's'})`}
                        </span>
                        <span className="training-data-progress-text-complete">
                          {uploadedMonths == null ? "—" : `${uploadedMonths} / ${totalMonthsNeeded} months`}
                        </span>
                      </div>
                      <div className="training-data-progress-bar">
                        <div
                          className="training-data-progress-fill-complete"
                          style={{ width: `${Math.min(((uploadedMonths ?? 0) / totalMonthsNeeded) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
        <div className="sk-grid-2">
          <SetupStep
            index={1}
            tone="ok"
            title="Upload Historical Sales Data"
            tag={<span className="sk-tag sk-tag--ok">Complete</span>}
            foot={
              <button
                type="button"
                className="sk-btn sk-btn--primary"
                onClick={handleStartTraining}
                disabled={isStarting}
              >
                {isStarting ? "Starting…" : "Start Training"}
                <FaArrowRight size={15} />
              </button>
            }
          >
            <div className="sk-note sk-note--ok">
              <FaCheckCircle size={16} style={{ color: "var(--sk-success)", marginRight: 8, verticalAlign: -3 }} />
              Requirement met — your sales history covers at least {totalMonthsNeeded}{" "}
              months, and every day in it is accounted for (open with sales, or marked
              closed). Training is available.
            </div>

            <div style={{ marginTop: 16 }}>
              <Meter
                tone="ok"
                label={`Sales data actually uploaded (${uploadedDays} day${uploadedDays === 1 ? "" : "s"})`}
                value={`${uploadedMonths} / ${totalMonthsNeeded} months`}
                percent={(uploadedMonths / totalMonthsNeeded) * 100}
              />
            </div>

            <div className="sk-note sk-note--warn" style={{ marginTop: 16 }}>
              <FaExclamationTriangle size={16} style={{ color: "var(--sk-amber-ink)", marginRight: 8, verticalAlign: -3 }} />
              <strong>Before you train.</strong> Make sure the products in{" "}
              <button
                type="button"
                className="sk-linkbtn"
                onClick={() => navigate("/inventory-management")}
              >
                Inventory Management
              </button>{" "}
              are the menu items you actually sell. Sales data uploads can include rows
              that aren't real menu items — archive anything that doesn't belong before
              starting, since archived products are excluded from training and
              forecasting.
            </div>
          </SetupStep>

<<<<<<< HEAD
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
                onClick={() => navigate("/inventory-management")}
              >
                Go to Inventory Management
                <FaArrowRight size={15} />
              </button>
            }
          >
            <p className="sk-card-text">
              Your menu products have been automatically detected from your sales data.
              You can start adding ingredient recipes now, or while training runs.
            </p>

            <div className="sk-subcard" style={{ marginTop: 18 }}>
              <div className="sk-subcard-title">Products detected from your sales data</div>
              <p className="sk-subcard-text">
                {products.length === 0 ? (
                  "Looking for the products detected in your sales data…"
                ) : (
                  <>
                    <strong>{totalProducts}</strong> products were found in your uploaded
                    sales data. <strong>{productsWithoutRecipes}</strong> need ingredient
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
<<<<<<< HEAD
            <div className="training-welcome-image">
              <img src={trainingImage} alt="Ready to Train Illustration" className="training-welcome-img" />
            </div>
          </div>

          <div className="training-step-cards">
            <div className="training-step-card training-step-card-complete">
              <div className="training-step-number training-step-number-complete">1</div>
              <div className="training-step-content">
                <h4 className="training-step-title training-step-title-complete">
                  Upload Historical Sales Data
                </h4>
                <div className="training-data-progress-wrapper1">
                  <div className="training-data-progress-wrapper2-complete">
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      <FaCheckCircle style={{ color: "#0F9918", fontSize: "18px", marginTop: "2px", flexShrink: 0 }} />
                      <p className="training-step-description1">
                        Requirement met — your sales history covers at least {totalMonthsNeeded} months,
                        and every day in it is accounted for (open with sales, or marked
                        closed). Training is available.
                      </p>
                    </div>

                    <div className="training-data-progress-wrapper">
                      <div className="training-data-progress-label">
                        <span>
                          {uploadedDays == null
                            ? "Sales data actually uploaded (—)"
                            : `Sales data actually uploaded (${uploadedDays} day${uploadedDays === 1 ? '' : 's'})`}
                        </span>
                        <span className="training-data-progress-text-complete">
                          {uploadedMonths == null ? "—" : `${uploadedMonths} / ${totalMonthsNeeded} months`}
                        </span>
                      </div>
                      <div className="training-data-progress-bar">
                        <div
                          className="training-data-progress-fill-complete"
                          style={{ width: `${Math.min(((uploadedMonths ?? 0) / totalMonthsNeeded) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ready-to-train-panel">
                  <p className="ready-to-train-title">✅ Ready to Train</p>
                  <p className="ready-to-train-body">
                    You've uploaded enough sales history to train your demand forecasting
                    model. Training takes a few minutes and can run in the background —
                    you can keep working while it completes.
                  </p>
                  <p
                    className="ready-to-train-body"
                    style={{ color: "#92400e", fontWeight: 500 }}
                  >
                    ⚠️ Before you train: Make sure the products in{" "}
                    <button
                      type="button"
                      onClick={() => navigate("/inventory-management")}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        font: "inherit",
                        fontWeight: 700,
                        color: "#7A0101",
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                    >
                      Inventory Management
                    </button>{" "}
                    are the menu items you actually sell. Sales data uploads can include
                    rows that aren't real menu items — archive anything that doesn't
                    belong before starting, since archived products are excluded from
                    training and forecasting.
                  </p>
                  <button
                    type="button"
                    className="training-step-btn"
                    onClick={handleStartTraining}
                    disabled={isStarting}
                  >
                    {isStarting ? "Starting…" : "Start Training"}
                  </button>
                </div>
              </div>
            </div>

            <div className="training-step-card">
              <div className="training-step-number">2</div>
              <div className="training-step-content">
                <h4 className="training-step-title">Add Ingredient Recipes to Your Products</h4>
                <p className="training-step-description">
                  Your menu products have been automatically detected from your sales data.
                  You can start adding ingredient recipes now, or while training runs.
                </p>

=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
                <div className="training-products-detected">
                  <div className="training-products-header">
                    <h5 className="training-products-title">Products Detected from Your Sales Data</h5>
                    <div className="training-products-summary">
                      <p className="training-products-total">
                        {totalProducts == null ? "Checking your products…" : `${totalProducts} products were found in your uploaded sales data.`}
                      </p>
                      {totalProducts != null && (
                        <p className="training-products-missing">{productsWithoutRecipes} products need ingredient recipes added.</p>
                      )}
                    </div>
                    <p className="training-products-note">
                      Products without recipes will still be forecasted, but will not
                      appear in the ingredient demand shopping list.
                    </p>
                  </div>

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
                            onClick={() => navigate("/inventory-management", { state: { product: product.name } })}
                          >
                            Add Recipe
                          </button>
                        </div>
                      ))
                    ) : totalProducts == null ? (
                      <div className="training-products-table-row">
                        <span style={{ color: "#6b7280" }}>Checking your products…</span>
                        <span></span>
                      </div>
                    ) : (
                      <div className="training-products-table-row">
                        <span style={{ color: "#0F9918", fontWeight: 600 }}>All products have recipes added</span>
                        <span style={{ color: "#0F9918" }}>Complete</span>
                      </div>
                    )}
                    {productsWithoutRecipes > 3 && (
                      <div className="training-products-table-row" style={{ fontStyle: "italic", color: "#6b7280" }}>
                        <span>+ {productsWithoutRecipes - 3} more products needing recipes</span>
                        <span></span>
                      </div>
                    )}
                  </div>
                </div>
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
                onClick={() => navigate("/inventory-management")}
              >
                Go to Inventory Management
                <FaArrowRight size={15} />
              </button>
            }
          >
            <p className="sk-card-text">
              Your menu products have been automatically detected from your sales data.
              You can start adding ingredient recipes now, or while training runs.
            </p>

            <div className="sk-subcard" style={{ marginTop: 18 }}>
              <div className="sk-subcard-title">Products detected from your sales data</div>
              <p className="sk-subcard-text">
                {products.length === 0 ? (
                  "Looking for the products detected in your sales data…"
                ) : (
                  <>
                    <strong>{totalProducts}</strong> products were found in your uploaded
                    sales data. <strong>{productsWithoutRecipes}</strong> need ingredient
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
<<<<<<< HEAD
          </div>
=======
          </SetupStep>
>>>>>>> 4c5708cc8ec29f389bce56fbd7a4bb2bca5093f6
=======
          </SetupStep>
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
        </div>
      </section>
    </StateShell>
  );
};

export default ReadyToTrain;