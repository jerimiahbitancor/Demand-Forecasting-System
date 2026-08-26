import { FaClock, FaTimes, FaBoxes, FaHistory, FaArrowLeft, FaArrowRight, FaTag, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/scale.css";
import InventoryModal from "./InventoryModal";
import "./HistoryModal.css";

const HistoryModal = ({ item, onClose }) => {
  if (!item) return null;

  // Get stock status
  const getStockStatus = (item) => {
    if (!item) return { label: "Unknown", color: "#9ca3af", bgColor: "#f3f4f6" };
    if (item.quantity === 0) {
      return { label: "Critical", color: "#dc2626", bgColor: "#fee2e2" };
    } else if (item.quantity <= (item.min_stock || 0) * 0.5) {
      return { label: "Critical", color: "#dc2626", bgColor: "#fee2e2" };
    } else if (item.quantity <= (item.min_stock || 0)) {
      return { label: "Low", color: "#f59e0b", bgColor: "#fef3c7" };
    } else if (item.quantity >= (item.min_stock || 0) * 3) {
      return { label: "Excess", color: "#3b82f6", bgColor: "#dbeafe" };
    } else {
      return { label: "Normal", color: "#16a34a", bgColor: "#dcfce7" };
    }
  };

  const status = getStockStatus(item);

  // Sample transaction data - replace with actual data from API
  const transactions = [
    {
      id: 1,
      date: "2026-08-15",
      time: "14:30",
      transaction: "Restock",
      quantityChange: "+10",
      newBalance: "12.0 kg",
      source: "Purchase",
      type: "restock"
    },
    {
      id: 2,
      date: "YYYY-MM-DD",
      time: "10:15",
      transaction: "Sale",
      quantityChange: "-14",
      newBalance: "2.0 kg",
      source: "Sales Data Upload",
      type: "sale"
    }
  ];

  return (
    <InventoryModal className="modal-lg inventory-history-modal" onClose={onClose}>
      {/* Header - Same as Restock Modal */}
      <div className="inventory-history-header">
        <div className="inventory-history-header-left">
          <div className="inventory-history-item-row">
            <span className="item-name">{item.name || "Unnamed"}</span>
            <div className="btn-history" disabled>
             History
            </div>
          </div>
          {/* Info Cards inline */}
          <div className="inventory-history-info-cards-inline">
            <div className="info-card-inline">
              <span className="info-card-label-inline">
                <FaTag className="info-icon-inline" />
                Category
              </span>
              <br />
              <span className="info-card-value-inline">
                {item.category || "N/A"}
              </span>
            </div>

            <div className="info-card-inline">
              <span className="info-card-label-inline">
                <FaBoxes className="info-icon-inline" />
                Current Stock
              </span>
              <br />
              <span className="info-card-value-inline">
                {item.quantity || 0} {item.unit || "kg"}
              </span>
            </div>

            <div
              className="info-card-inline status-card-inline"
              style={{
                backgroundColor: status.bgColor,
                borderColor: status.color,
              }}
            >
              <span
                className="info-card-label-inline"
                style={{ color: status.color }}
              >
                <FaExclamationTriangle
                  className="info-icon-inline"
                  style={{ color: status.color }}
                />
                Stock Level Status
              </span>
              <br />
              <span
                className="status-badge-inline"
                style={{ backgroundColor: status.color }}
              >
                {status.label}
              </span>
            </div>
          </div>
        </div>

        <button className="modal-close-btn" onClick={onClose}>
          <FaTimes />
        </button>
      </div>

      {/* Body */}
      <div className="inventory-history-body">
        <h4 className="history-title">
          <FaHistory className="history-title-icon" />
          Stock Movement History
        </h4>

        {/* Transaction Types Legend */}
        <div className="transaction-legend">
          <span className="legend-label transaction-types-label">
            Transaction Types:
            <Tippy
              content={(
                <div className="transaction-types-tooltip">
                  <div><strong>Sale (auto)</strong> - Automatic deduction triggered by a sales data upload.</div>
                  <div><strong>Restock</strong> - Manual stock addition by the owner.</div>
                  <div><strong>Return</strong> - Returned or recovered stock.</div>
                </div>
              )}
              placement="top"
              animation="scale"
              duration={200}
              theme="dark"
              arrow
              delay={[100, 0]}
              maxWidth={360}
              interactive
              trigger="mouseenter focus click"
            >
              <span className="transaction-types-info" tabIndex={0} aria-label="Transaction type definitions">
                <FaInfoCircle />
              </span>
            </Tippy>
          </span>
          <div className="legend-items">
            <span className="legend-item">
              <span className="legend-dot sale"></span> Sale <span className="legend-sub">(auto)</span>
            </span>
            <span className="legend-item">
              <span className="legend-dot restock"></span> Restock
            </span>
          
            <span className="legend-item">
              <span className="legend-dot return"></span> Return
            </span>
          </div>
        </div>

        {/* Empty State or Table */}
        {(!item.transactions || item.transactions.length === 0) && (
          <div className="history-empty-state">
            <FaClock size={48} />
            <p className="empty-sub-text">
              No stock movements recorded yet. Movements will appear here after sales data is uploaded or stock is manually updated.
            </p>
          </div>
        )}

        {item.transactions && item.transactions.length > 0 && (
          <>
            {/* Table */}
            <div className="history-table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Date / Time</th>
                    <th>Transaction</th>
                    <th>Quantity Change</th>
                    <th>New Balance</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t, index) => (
                    <tr key={t.id}>
                      <td>{index + 1}</td>
                      <td>
                        {t.date} <br />
                        <span className="time-text">{t.time}</span>
                      </td>
                      <td>
                        <span className={`transaction-badge ${t.type}`}>
                          {t.transaction}
                        </span>
                      </td>
                      <td className={t.quantityChange.startsWith('+') ? 'positive-change' : 'negative-change'}>
                        {t.quantityChange}
                      </td>
                      <td>{t.newBalance}</td>
                      <td>{t.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="history-pagination">
              <button className="page-btn" disabled>
                <FaArrowLeft /> Previous
              </button>
              <div className="page-numbers">
                <button className="page-number active">1</button>
                <button className="page-number">2</button>
                <button className="page-number">3</button>
                <span className="page-dots">...</span>
                <button className="page-number">67</button>
                <button className="page-number">68</button>
              </div>
              <button className="page-btn">
                Next <FaArrowRight />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="inventory-history-footer">
        <button className="btn-close" onClick={onClose}>
          Close
        </button>
      </div>
    </InventoryModal>
  );
};

export default HistoryModal;