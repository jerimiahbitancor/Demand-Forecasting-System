// InventoryManagement.jsx
import { useState } from "react";
import "./InventoryManagement.css";
import Navbar from "../../components/Navbar/Navbar";
import { FaBoxes, FaClipboardList, FaTags } from 'react-icons/fa';
import Ingredient from "./IngredientManagement";
import Product from "./ProductManagement";
import MarketPrice from "./MarketPriceManagement";

const InventoryManagement = () => {
  const [activeTab, setActiveTab] = useState("ingredient");

  const tabs = [
  { id: "ingredient", label: "Ingredient Management", icon: FaBoxes },
    { id: "product", label: "Product Management", icon: FaClipboardList },
    { id: "market", label: "Market Price", icon: FaTags },
   
  ];

  return (
    <div className="inventory-management-wrapper">
      <Navbar />

      <main className="inventory-management-main">
        <div className="inventory-management-header">
          <div>
            <h1 className="page-title">Inventory Management</h1>
            <p className="page-subtitle">
              Manage your inventory items and product list, and keep track of market prices for your ingredients.
            </p>
          </div>
        </div>

        <div className="content-grid">
          <div className="tabbed-container">
            <div className="tabs-header">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <tab.icon className="tab-icon" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="tab-content">
              {activeTab === "ingredient" && <Ingredient />}
              {activeTab === "product" && <Product />}
              {activeTab === "market" && <MarketPrice />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default InventoryManagement;