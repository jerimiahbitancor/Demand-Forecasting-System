import { useEffect, useState } from "react";
import { FaClock, FaTimes, FaBoxes, FaHistory, FaArrowLeft, FaArrowRight, FaTag, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/scale.css";
import InventoryModal from "./InventoryModal";
import "./HistoryModal.css";

const HistoryModal = ({ item, apiClient, onClose }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const itemId = item?.id;

  useEffect(() => {
    if (!item) return undefined;
    let active = true;

    const fetchTransactions = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get(`/inventory/items/${itemId}/transactions`, {
          params: { page: currentPage, limit: 10 },
        });
        if (active) {
          setTransactions(response.data.data || []);
          setTotalPages(response.data.totalPages || 0);
        }
      } catch (error) {
        if (active) setTransactions([]);
        console.error('Error fetching transaction history:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchTransactions();
    return () => {
      active = false;
    };
  }, [apiClient, item, itemId, currentPage]);

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
        {loading && (
          <div className="history-empty-state">
            <FaClock size={48} />
            <p className="empty-sub-text">Loading stock movements...</p>
          </div>
        )}

        {!loading && transactions.length === 0 && (
          <div className="history-empty-state">
            <FaClock size={48} />
            <p className="empty-sub-text">
              No stock movements recorded yet. Movements will appear here after sales data is uploaded or stock is manually updated.
            </p>
          </div>
        )}

        {!loading && transactions.length > 0 && (
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
                  {transactions.map((transaction, index) => {
                    const transactionDate = transaction.created_at ? new Date(transaction.created_at) : null;
                    const quantityChange = Number(transaction.quantity) || 0;
                    const transactionType = transaction.transaction_type || 'adjustment';
                    return (
                    <tr key={transaction.id}>
                      <td>{index + 1}</td>
                      <td>
                        {transactionDate ? transactionDate.toLocaleDateString() : 'N/A'} <br />
                        <span className="time-text">{transactionDate ? transactionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      </td>
                      <td>
                        <span className={`transaction-badge ${transactionType}`}>
                          {transactionType.charAt(0).toUpperCase() + transactionType.slice(1)}
                        </span>
                      </td>
                      <td className={quantityChange >= 0 ? 'positive-change' : 'negative-change'}>
                        {quantityChange >= 0 ? '+' : ''}{quantityChange}
                      </td>
                      <td>{transaction.new_quantity ?? 0} {item.unit || 'pcs'}</td>
                      <td>{transaction.reason || transaction.notes || 'Inventory update'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="history-pagination">
              <button
                className="page-btn"
                onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
                disabled={currentPage === 1 || loading}
              >
                <FaArrowLeft /> Previous
              </button>
              <div className="page-numbers">
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <button
                    key={page}
                    className={`page-number ${currentPage === page ? 'active' : ''}`}
                    onClick={() => setCurrentPage(page)}
                    disabled={loading}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                className="page-btn"
                onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
                disabled={currentPage === totalPages || totalPages === 0 || loading}
              >
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