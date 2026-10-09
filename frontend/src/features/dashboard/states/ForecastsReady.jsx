// states/ForecastsReady.jsx
//
// State 5 of 7 — the model is trained and forecast runs exist, but some
// active products still have no ingredient recipe, so the ingredient
// demand / shopping list can't be produced for them yet
// (backend/services/uploadService.js's getUnmappedActiveProductInfo()).
//
// Everything on this screen is read from the API: the counts come from
// /upload/dashboard-state's `mapping` block and the product list from
// /mapping/products. Nothing here is a placeholder number: when a count isn't
// known (the product list failed and the state call had no mapping block)
// the screen shows "—", never 0 or "Everything is mapped".
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../../../services/apiClient";
import { FaArrowRight, FaCheckCircle, FaClipboardList } from "react-icons/fa";
import {
  StateShell,
  StateBanner,
  ProgressMeter,
  SetupStep,
  ProductsDetected,
} from "../components/DashboardStateKit.jsx";

const UNKNOWN = "—";

const ForecastsReady = ({ initialState }) => {
  const navigate = useNavigate();
  // Seeded from the Dashboard's dashboard-state response — its `mapping` block
  // is what the coverage numbers are built from, so those tiles are correct on
  // the first frame. The product list isn't in that response and is fetched
  // below; isLoading only tracks that, so the screen never blanks.
  const mapping = initialState?.mapping || null;
  const [products, setProducts] = useState([]);
  const [activeProducts, setActiveProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      try {
        // Only the product list is missing; the mapping counts came with the
        // Dashboard's own request.
        const [activeRes, inactiveRes] = await Promise.all([
          apiClient.get("/mapping/products", {
            params: { status: "active", forceRefresh: "true" },
            signal: controller.signal,
          }),
          apiClient.get("/mapping/products", {
            params: { status: "inactive", forceRefresh: "true" },
            signal: controller.signal,
          }),
        ]);

        const active = activeRes.data.success ? activeRes.data.data || [] : [];
        const inactive = inactiveRes.data.success ? inactiveRes.data.data || [] : [];
        setActiveProducts(active);
        setProducts([...active, ...inactive]);
        setLoadError(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Error loading forecast readiness:", error);
        setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, []);

  const handleAddRecipe = (productName) => {
    navigate("/inventory-management", { state: { product: productName } });
  };

  // Backend counts are authoritative; the fetched ACTIVE product list is the
  // fallback if the state call didn't include the mapping block. With neither
  // (still loading, or the list failed) the counts are unknown.
  const countsKnown = mapping != null || (!isLoading && !loadError);
  const activeCount = mapping?.activeCount ?? activeProducts.length;
  const unmappedCount =
    mapping?.unmappedCount ?? activeProducts.filter((p) => !p.product_ingredients?.length).length;
  const recipeProgress = activeCount > 0 ? ((activeCount - unmappedCount) / activeCount) * 100 : 100;
  const allDone = countsKnown && unmappedCount === 0;
  const show = (n) => (countsKnown ? n : UNKNOWN);

  return (
    <StateShell
      eyebrow="Forecasts ready"
      eyebrowTone={allDone ? "ok" : "warn"}
      title={<>Forecasts are ready, <em>recipes still pending</em></>}
      lede="Your model is trained and daily and weekly forecasts are available. Adding ingredient recipes is what turns those forecasts into a purchasing decision."
      progress={{
        value: countsKnown ? 90 + (recipeProgress / 100) * 10 : 90,
        tone: allDone ? "ok" : "warn",
        caption: "Setup progress across the whole system",
      }}
      status={
        <StateBanner
          tone={allDone ? "ok" : "warn"}
          icon={allDone ? <FaCheckCircle size={20} /> : <FaClipboardList size={20} />}
          title={
            !countsKnown
              ? loadError
                ? "We couldn't check which products still need recipes"
                : "Checking which products still need recipes…"
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

        <div className="sk-stats">
          <div className="sk-stat">
            <div className="sk-stat-label">Active products</div>
            <div className="sk-stat-value sk-stat-value--ink">{show(activeCount)}</div>
            <div className="sk-stat-note">Detected from your sales data</div>
          </div>
          <div className="sk-stat">
            <div className="sk-stat-label">With recipes</div>
            <div className="sk-stat-value sk-stat-value--ok">
              {show(Math.max(activeCount - unmappedCount, 0))}
            </div>
            <div className="sk-stat-note">Included in the shopping list</div>
          </div>
          <div className="sk-stat">
            <div className="sk-stat-label">Still missing</div>
            <div className={`sk-stat-value${allDone ? " sk-stat-value--ok" : " sk-stat-value--warn"}`}>
              {show(unmappedCount)}
            </div>
            <div className="sk-stat-note">Need a recipe before they can be prepared</div>
          </div>
          <div className="sk-stat">
            <div className="sk-stat-label">Forecast status</div>
            <div className="sk-stat-value sk-stat-value--ok">Ready</div>
            <div className="sk-stat-note">Daily and weekly projections available</div>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <ProgressMeter
            label="Ingredient recipe coverage"
            value={countsKnown ? recipeProgress : null}
            tone={allDone ? "ok" : "warn"}
            caption={
              !countsKnown
                ? "Recipe coverage can't be checked right now."
                : allDone
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
              !countsKnown ? (
                <span className="sk-tag">{UNKNOWN}</span>
              ) : allDone ? (
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
          </SetupStep>
        </div>
      </section>
    </StateShell>
  );
};

export default ForecastsReady;