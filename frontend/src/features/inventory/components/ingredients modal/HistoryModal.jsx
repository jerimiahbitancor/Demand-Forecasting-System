import { useEffect, useState } from "react";
import { FaClock, FaTimes, FaBoxes, FaHistory, FaArrowLeft, FaArrowRight, FaTag, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/scale.css";
import InventoryModal from "../InventoryModal";
import "./HistoryModal.css";
import { formatStockQty } from "../../../../utils/formatStockQty.js";
import { currentStockBadge } from "../../../../utils/stockStatusBadge.js";
import { stockSourceLabel } from "../../../../utils/stockSourceLabel.js";
import { stockMovementDetail } from "../../../../utils/stockMovementDetail.js";
import { buildPageItems, ELLIPSIS } from "../../../../utils/pagination";

const PAGE_SIZE = 10;

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
          params: { page: currentPage, limit: PAGE_SIZE },
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

  // The Current Stock Level Status as the backend computed it (wet/dry
  // threshold of the ideal stock level). No second formula here.
  const status = currentStockBadge(item);

  return (
    <InventoryModal className="modal-lg inventory-history-modal" onClose={onClose}>
      {/* Header - Same as Restock Modal */}
      <div className="inventory-history-header">
        <div className="inventory-history-header-left">
          <div className="inventory-history-item-row">
            <span className="item-name">{item.name || "Unnamed"}</span>
           
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
                {formatStockQty(item.quantity ?? 0, item.unit)} {item.unit || "kg"}
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

            {/* The demand a sale could not cover. A delivery never pays it
                off, so it stays open until a stock count clears it. */}
            {Number(item.open_shortfall) > 0 && (
              <div
                className="info-card-inline status-card-inline"
                style={{
                  backgroundColor: '#fef3c7',
                  borderColor: '#f59e0b',
                }}
              >
                <span className="info-card-label-inline" style={{ color: '#b45309' }}>
                  <FaExclamationTriangle className="info-icon-inline" style={{ color: '#f59e0b' }} />
                  Open Short
                </span>
                <br />
                <span className="info-card-value-inline" style={{ color: '#b45309' }}>
                  {formatStockQty(item.open_shortfall, item.unit)} {item.unit || 'kg'}
                </span>
                <br />
                <span className="info-card-hint-inline">
                  from {Number(item.open_shortfall_sales) === 1 ? '1 sale' : `${Number(item.open_shortfall_sales) || 0} sales`} — a stock count clears it
                </span>
              </div>
            )}
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
                  <div><strong>Adjustment</strong> - A manual stock count that sets the balance to the counted amount.</div>
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
              <span className="legend-dot adjustment"></span> Adjustment
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
                    const detail = stockMovementDetail(transaction, item.unit);
                    return (
                    <tr key={transaction.id}>
                      <td>{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
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
                        {quantityChange >= 0 ? '+' : ''}{formatStockQty(quantityChange, item.unit)}
                        {detail && (
                          <div className="history-transaction-notes">{detail}</div>
                        )}
                      </td>
                      <td>{formatStockQty(transaction.new_quantity ?? 0, item.unit)} {item.unit || 'pcs'}</td>
                      <td>{stockSourceLabel(transaction)}</td>
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
                disabled={currentPage <= 1 || loading}
                aria-label="Previous page"
              >
                <FaArrowLeft /> Previous
              </button>
              <div className="page-numbers">
                {buildPageItems(currentPage, totalPages).map((item, index) =>
                  item === ELLIPSIS ? (
                    <span key={`ellipsis-${index}`} className="page-dots" aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      className={`page-number ${currentPage === item ? 'active' : ''}`}
                      onClick={() => setCurrentPage(item)}
                      disabled={loading}
                      aria-label={`Page ${item}`}
                      aria-current={currentPage === item ? 'page' : undefined}
                    >
                      {item}
                    </button>
                  )
                )}
              </div>
              <button
                className="page-btn"
                onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
                disabled={currentPage >= totalPages || loading}
                aria-label="Next page"
              >
                Next <FaArrowRight />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
    
    </InventoryModal>
  );
};

export default HistoryModal;