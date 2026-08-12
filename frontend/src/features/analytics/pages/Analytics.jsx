// pages/Analytics.jsx
import { useState } from "react";
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

const Analytics = () => {
  const [activeTab, setActiveTab] = useState("forecasting");

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

        {/* Tab bar */}
        <div className="analytics-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`analytics-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
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