// states/ForecastsReady.jsx
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
import { FaCheckCircle } from 'react-icons/fa';
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/ForecastsReady.css";

// The four cards below used to show invented numbers (P52,500, +8.5%,
// 12 items, a "94% confidence score" and 5 recommendations). None came from
// any data. They now say "Not available yet" until they are wired to real
// endpoints (e.g. /api/forecast/summary).
const NOT_YET = 'Not available yet';

const ForecastsReady = () => {
<<<<<<< HEAD
=======
=======
  return (
    <div className="dashboard-container">
      <Navbar />
      <main className="dashboard-main">
        <div className="dashboard-title-section">
          <h1 className="dashboard-title">Dashboard</h1>
          <div className="date-info">
            <span>{new Date().toLocaleTimeString()}</span>
            <span className="date-separator">{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span>
            <span className="date-separator">{new Date().toLocaleDateString()}</span>
          </div>
        </div>
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
//
// State 5 of 7 — the model is trained and forecast runs exist, but some
// active products still have no ingredient recipe, so the ingredient
// demand / shopping list can't be produced for them yet
// (backend/services/uploadService.js's getUnmappedActiveProductInfo()).
//
// Everything on this screen is read from the API: the counts come from
// /upload/dashboard-state's `mapping` block and the product list from
// /mapping/products. Nothing here is a placeholder number.
import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCheckCircle, FaClipboardList } from "react-icons/fa";
import {
  StateShell,
  StateBanner,
  ProgressMeter,
  SetupStep,
  ProductsDetected,
} from "../components/DashboardStateKit.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const ForecastsReady = ({ initialState }) => {
  const navigate = useNavigate();
  // Seeded from the Dashboard's dashboard-state response — its `mapping` block
  // is what the coverage numbers are built from, so those tiles are correct on
  // the first frame. The product list isn't in that response and is fetched
  // below; isLoading only tracks that, so the screen never blanks.
  const mapping = initialState?.mapping || null;
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        // Only the product list is missing; the mapping counts came with the
        // Dashboard's own request.
        const [activeRes, inactiveRes] = await Promise.all([
          apiClient.get("/mapping/products", { params: { status: "active", forceRefresh: "true" } }),
          apiClient.get("/mapping/products", { params: { status: "inactive", forceRefresh: "true" } }),
        ]);
        if (cancelled) return;

        const active = activeRes.data.success ? activeRes.data.data || [] : [];
        const inactive = inactiveRes.data.success ? inactiveRes.data.data || [] : [];
        setProducts([...active, ...inactive]);
        setLoadError(false);
      } catch (error) {
        console.error("Error loading forecast readiness:", error);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddRecipe = (productName) => {
    navigate("/inventory-management", { state: { product: productName } });
  };

  // Backend counts are authoritative; the fetched product list is the
  // fallback so the screen still shows something real if the state call
  // didn't include the mapping block.
  const unmapped = products.filter((p) => !p.product_ingredients?.length);
  const activeCount = mapping?.activeCount ?? products.length;
  const unmappedCount = mapping?.unmappedCount ?? unmapped.length;
  const recipeProgress = activeCount > 0 ? ((activeCount - unmappedCount) / activeCount) * 100 : 100;
  const allDone = unmappedCount === 0;

<<<<<<< HEAD
>>>>>>> 4c5708cc8ec29f389bce56fbd7a4bb2bca5093f6
=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
  return (
    <StateShell
      eyebrow="Forecasts ready"
      eyebrowTone={allDone ? "ok" : "warn"}
      title={<>Forecasts are ready, <em>recipes still pending</em></>}
      lede="Your model is trained and daily and weekly forecasts are available. Adding ingredient recipes is what turns those forecasts into a purchasing decision."
      progress={{
        value: isLoading ? 90 : 90 + (recipeProgress / 100) * 10,
        tone: allDone ? "ok" : "warn",
        caption: "Setup progress across the whole system",
      }}
      status={
        <StateBanner
          tone={allDone ? "ok" : "warn"}
          icon={allDone ? <FaCheckCircle size={20} /> : <FaClipboardList size={20} />}
          title={
            isLoading
              ? "Checking which products still need recipes…"
              : allDone
                ? "Everything is mapped"
                : `${unmappedCount} of ${activeCount} active products still need an ingredient recipe`
          }
          text={
            loadError
              ? "We couldn't load your product list. Refresh the page to try again."
              : allDone
                ? "Every active product has a recipe, so the ingredient demand list and shopping list are complete."
                : "Forecasts still cover these products, but they won't appear in the ingredient demand shopping list until a recipe is recorded."
          }
          actions={
            <button
              type="button"
              className="sk-btn sk-btn--primary"
              onClick={() => navigate("/forecasting")}
            >
              View Full Forecast
              <FaArrowRight size={15} />
            </button>
          }
        />
      }
    >
      <section className="sk-section">
        <div className="sk-section-head">
          <div>
            <h2 className="sk-section-title">Recipe coverage</h2>
            <p className="sk-section-sub">
              Product demand is already forecast for every product. Recipes decide which
              of those forecasts turn into ingredient quantities.
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="metrics-grid">
          <div className="metric-card border-green">
            <div className="card-header">
              <h3 className="card-title">Predicted Sales</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">—</span>
            </div>
            <p className="metric-subtext">{NOT_YET}</p>
        <div className="sk-stats">
          <div className="sk-stat">
            <div className="sk-stat-label">Active products</div>
            <div className="sk-stat-value sk-stat-value--ink">{activeCount}</div>
            <div className="sk-stat-note">Detected from your sales data</div>
          </div>
          <div className="sk-stat">
            <div className="sk-stat-label">With recipes</div>
            <div className="sk-stat-value sk-stat-value--ok">
              {Math.max(activeCount - unmappedCount, 0)}
            </div>
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
            <div className="metric-value-group">
              <span className="metric-value">—</span>
            </div>
            <p className="metric-subtext">{NOT_YET}</p>
          </div>
<<<<<<< HEAD
=======
=======

          <div className="metric-card border-purple">
            <div className="card-header">
              <h3 className="card-title">Confidence Score</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">—</span>
            </div>
            <p className="metric-subtext">{NOT_YET}</p>
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480
            <div className="sk-stat-note">Included in the shopping list</div>
          </div>
          <div className="sk-stat">
            <div className="sk-stat-label">Still missing</div>
            <div className={`sk-stat-value${allDone ? " sk-stat-value--ok" : " sk-stat-value--warn"}`}>
              {unmappedCount}
            </div>
            <div className="sk-stat-note">Need a recipe before they can be prepared</div>
          </div>
          <div className="sk-stat">
            <div className="sk-stat-label">Forecast status</div>
            <div className="sk-stat-value sk-stat-value--ok">Ready</div>
            <div className="sk-stat-note">Daily and weekly projections available</div>
          </div>
        </div>

          <div className="metric-card border-indigo">
            <div className="card-header">
              <h3 className="card-title">Recommendations</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">—</span>
            </div>
            <p className="metric-subtext">{NOT_YET}</p>
        <div style={{ marginTop: 22 }}>
          <ProgressMeter
            label="Ingredient recipe coverage"
            value={`${Math.round(recipeProgress)}%`}
            tone={allDone ? "ok" : "warn"}
            caption={
              allDone
                ? "Every active product maps to a recipe, so ingredient demand is complete."
                : `${unmappedCount} product${unmappedCount === 1 ? "" : "s"} still missing a recipe — ingredient demand is partial until they are added.`
            }
          />
        </div>
      </section>

      <section className="sk-section">
        <div className="sk-section-head">
          <div>
            <h2 className="sk-section-title">Finish the last step</h2>
            <p className="sk-section-sub">
              Record the ingredients each product needs, then head back to the forecast.
            </p>
          </div>
        </div>

        <div className="sk-grid-2">
          <SetupStep
            index={1}
            title="Add Ingredient Recipes"
            tag={
              allDone ? (
                <span className="sk-tag sk-tag--ok">Complete</span>
              ) : (
                <span className="sk-tag sk-tag--warn">{unmappedCount} remaining</span>
              )
            }
            foot={
              <button
                type="button"
                className="sk-btn sk-btn--primary"
                onClick={() => navigate("/inventory-management")}
              >
                Go to Inventory Management
                <FaArrowRight size={15} />
              </button>
            }
          >
            <p className="sk-card-text">
              Each product needs the quantities of ingredients it takes to make one
              serving. Ingredient demand then combines those recipes with the forecast,
              so you see what to prepare and what to reorder.
            </p>

            <div className="sk-subcard" style={{ marginTop: 18 }}>
              <div className="sk-subcard-title">Products still needing a recipe</div>
              <div style={{ marginTop: 14 }}>
                <ProductsDetected
                  products={products}
                  onAddRecipe={handleAddRecipe}
                  limit={5}
                />
              </div>
              <p className="sk-subcard-foot">
                Showing the first few — open Inventory Management for the full product
                list.
              </p>
            </div>
          </SetupStep>
<<<<<<< HEAD
>>>>>>> 4c5708cc8ec29f389bce56fbd7a4bb2bca5093f6
=======
>>>>>>> ec2d3d462b46e067e1942d6168838c81e4cd6480

          <SetupStep
            index={2}
            title="Review your forecasts"
            tag={<span className="sk-tag sk-tag--ok">Available now</span>}
            foot={
              <>
                <button
                  type="button"
                  className="sk-btn sk-btn--secondary"
                  onClick={() => navigate("/forecasting")}
                >
                  View Full Forecast
                  <FaArrowRight size={15} />
                </button>
                <button
                  type="button"
                  className="sk-btn sk-btn--ghost"
                  onClick={() => navigate("/product-performance")}
                >
                  Product Performance
                  <FaArrowRight size={15} />
                </button>
              </>
            }
          >
            <p className="sk-card-text">
              Forecasts are estimates, not guarantees — treat them as one input alongside
              your own operational judgment. Ingredient demand builds on top of them once
              recipes are in place.
            </p>
            <div className="sk-note" style={{ marginTop: 16 }}>
              <strong>Where to go next.</strong> Forecasting shows daily and weekly
              product demand, Analytics shows the breakdown by demand level, and
              Ingredient Demand turns recipes plus forecasts into preparation and reorder
              quantities.
            </div>
<<<<<<< HEAD
<<<<<<< HEAD
            <div className="metric-value-group">
              <span className="metric-value">—</span>
            </div>
            <p className="metric-subtext">{NOT_YET}</p>
          </div>

          <div className="metric-card border-purple">
            <div className="card-header">
              <h3 className="card-title">Confidence Score</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">—</span>
            </div>
            <p className="metric-subtext">{NOT_YET}</p>
          </div>

          <div className="metric-card border-indigo">
            <div className="card-header">
              <h3 className="card-title">Recommendations</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">—</span>
            </div>
            <p className="metric-subtext">{NOT_YET}</p>
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

export default ForecastsReady;