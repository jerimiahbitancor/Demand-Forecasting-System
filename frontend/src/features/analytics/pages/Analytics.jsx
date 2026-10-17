// pages/Analytics.jsx
import { useSearchParams } from "react-router-dom";
import Navbar from "../../components/Navbar/Navbar.jsx";
import Forecasting from "../components/Forecasting.jsx";
import ProductPerformance from "../components/ProductPerformance.jsx";
import IngredientDemand from "../components/IngredientDemand.jsx";
import "./Analytics.css";

// Single source of truth for the three tabs: id, the label shown in the
// breadcrumb/tab bar, and the component that renders when it's active.
// Adding a 4th tab later is a one-line change here instead of touching
// the breadcrumb, the tab bar, AND a switch statement separately.
const TABS = [
  { id: "forecasting", label: "Forecasting", component: Forecasting },
  { id: "product-performance", label: "Product Performance", component: ProductPerformance },
  { id: "ingredient-demand", label: "Ingredient Demand", component: IngredientDemand },
];

const DEFAULT_TAB = TABS[0].id;
const TAB_IDS = TABS.map((tab) => tab.id);

const Analytics = () => {
  // The URL is the source of truth for the active tab so a notification (or
  // a shared link) can open a specific one: /analytics?tab=ingredient-demand.
  // Selecting a tab keeps the URL in step, which also makes back/forward work.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = TAB_IDS.includes(tabParam) ? tabParam : DEFAULT_TAB;

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    setSearchParams(next, { replace: true });
  };

  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const ActiveComponent = activeTabMeta.component;

  return (
    <div className="analytics-wrapper">
      <Navbar />

      <main className="analytics-main">
        {/* Breadcrumb header */}
        <div className="analytics-header">
          <h1 className="page-title">Analytics</h1>
         
        
          <span className="breadcrumb-separator">&gt;</span>
          <span className="breadcrumb-current">{activeTabMeta.label}</span>
          
        </div>
        <div className="analytics-subtitle">
          <p className="page-subtitle">
            Explore your sales data and gain insights into your business performance. Use the tabs below to navigate between different analytics views.
          </p>
        </div>

        {/* Tab bar */}
        <div className="analytics-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`analytics-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => selectTab(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active tab content */}
        <div className="analytics-content">
          <ActiveComponent />
        </div>
      </main>
    </div>
  );
};

export default Analytics;