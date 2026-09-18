// states/ReadyToTrain.jsx
//
// State 3 of the 7-state Dashboard spec: >=12 months uploaded, products
// detected, but the owner hasn't clicked Start Training yet (no model
// exists). Distinct from State 4 (TrainingInProgress.jsx) — that one
// only renders once mlService.isTrainingInFlight() is actually true.
import { useState, useEffect } from "react";
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/TrainingInProgress.css";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import toast from "react-hot-toast";
import Swal from 'sweetalert2';
import '../../../utils/swalTheme.css';
import trainingImage from "../../../assets/images/Rene.png";
import { FaCheckCircle } from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const ReadyToTrain = () => {
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
  const [uploadedMonths, setUploadedMonths] = useState(0);
  const [uploadedDays, setUploadedDays] = useState(0);
  const [totalMonthsNeeded] = useState(12);
  const [products, setProducts] = useState([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [productsWithoutRecipes, setProductsWithoutRecipes] = useState(0);
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

  const formatDate = (date) => {
    const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    return `${months[date.getMonth()]}-${String(date.getDate()).padStart(2, "0")}-${date.getFullYear()}`;
  };
  const formatDay = (date) => ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][date.getDay()];
  const formatTime = (date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  };
  const now = new Date();

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
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
    return () => { cancelled = true; };
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

  const productsNeedingRecipes = products
    .filter((p) => !p.product_ingredients?.length)
    .slice(0, 3);

  return (
    <div className="training-container">
      <Navbar />
      <main className="training-main">
        <div className="training-header">
          <div className="training-date-info">
            <span>{formatDate(now)}</span>
            <span className="training-date-separator">|</span>
            <span>{formatDay(now)}</span>
            <span className="training-date-separator">|</span>
            <span>{formatTime(now)}</span>
          </div>
          <div className="training-progress-container">
            <div className="training-progress-bar-wrapper">
              <div
                className="training-progress-fill"
                style={{ width: "50%", backgroundColor: "rgba(122, 1, 1, 0.5)" }}
              />
              <div className="training-progress-text">
                <span>System Status Progress</span>
                <span>50%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="training-content">
          <div className="training-welcome-wrapper">
            <div className="training-welcome-section">
              <h3 className="training-welcome-title">Your data is ready</h3>
              <p className="training-welcome-description">
                Start training your forecasting model whenever you're ready.
                <br />
                While you're reviewing, you can also start adding ingredient recipes
                to your products so the shopping list is ready once forecasting completes.
              </p>
            </div>
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
                        Requirement met — it's been over {totalMonthsNeeded} months since your
                        earliest uploaded sale date, and real sales data covers enough of that
                        span, so training is available.
                      </p>
                    </div>

                    <div className="training-data-progress-wrapper">
                      <div className="training-data-progress-label">
                        <span>Sales data actually uploaded ({uploadedDays} day{uploadedDays === 1 ? '' : 's'})</span>
                        <span className="training-data-progress-text-complete">
                          {uploadedMonths} / {totalMonthsNeeded} months
                        </span>
                      </div>
                      <div className="training-data-progress-bar">
                        <div
                          className="training-data-progress-fill-complete"
                          style={{ width: `${Math.min((uploadedMonths / totalMonthsNeeded) * 100, 100)}%` }}
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

                <div className="training-products-detected">
                  <div className="training-products-header">
                    <h5 className="training-products-title">Products Detected from Your Sales Data</h5>
                    <div className="training-products-summary">
                      <p className="training-products-total">{totalProducts} products were found in your uploaded sales data.</p>
                      <p className="training-products-missing">{productsWithoutRecipes} products need ingredient recipes added.</p>
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

                <button
                  className="training-step-btn training-step-btn-secondary"
                  onClick={() => navigate("/inventory-management")}
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

export default ReadyToTrain;
