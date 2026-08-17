// InventoryManagement.jsx
import { useState } from "react";
import "./InventoryManagement.css";
import Navbar from "../../components/Navbar/Navbar";
import { FaBoxes, FaClipboardList } from 'react-icons/fa';
import Inventory from "./Inventory";
import Mapping from "../../datamanagement/components/MappingData";

const InventoryManagement = () => {
  const [activeTab, setActiveTab] = useState("inventory");

  const tabs = [
    { id: "inventory", label: "Ingredient Management", icon: FaBoxes },
    { id: "mapping", label: "Product Management", icon: FaClipboardList },
  ];

  return (
    <div className="inventory-management-wrapper">
      <Navbar />

      <main className="inventory-management-main">
        <div className="inventory-management-header">
          <div>
            <h1 className="page-title">Inventory Management</h1>
            <p className="page-subtitle">
              Manage your inventory items and product catalog
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
              {activeTab === "inventory" && <Inventory />}
              {activeTab === "mapping" && <Mapping />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default InventoryManagement;