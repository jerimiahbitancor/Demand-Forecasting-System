import {
  FaShoppingCart,
  FaTimes,
  FaBoxes,
  FaExclamationTriangle,
} from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import "./RestockModal.css";

const RestockModal = ({
  item,
  data,
  isSubmitting,
  onChange,
  onSubmit,
  onClose,
}) => {
  if (!item) return null;

  const close = () => {
    if (!isSubmitting) onClose();
  };

  // Get stock status
  const getStockStatus = (item) => {
    if (!item)
      return { label: "Unknown", color: "#9ca3af", bgColor: "#f3f4f6" };
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
    <InventoryModal
      className="modal-md inventory-restock-modal"
      onClose={close}
    >
      {/* Header */}
      <div className="inventory-restock-header">
        <div className="inventory-restock-header-left">
          <div className="inventory-restock-item-row">
            <span className="item-name">{item.name || "Unnamed"}</span>
            <div className="btn-update-stock" disabled>
              Update Stock
            </div>
          </div>
          {/* Info Cards inline */}
          <div className="inventory-restock-info-cards-inline">
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

        <button className="modal-close-btn" onClick={close}>
          <FaTimes />
        </button>
      </div>

      {/* Body */}
      <div className="inventory-restock-body">
        {/* Form */}
        <div className="inventory-restock-form">
          <div className="form-group">
            <label className="form-label">
              Quantity to Add <span className="required-star">*</span>
            </label>
            <div className="quantity-input-wrapper">
              <input
                type="number"
                className="form-input"
                value={data.quantity}
                onChange={(event) =>
                  onChange({ ...data, quantity: event.target.value })
                }
                placeholder=""
                min="0.01"
                step="0.01"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Reason (optional)</label>
            <select
              className="form-input"
              value={data.reason}
              onChange={(event) =>
                onChange({ ...data, reason: event.target.value })
              }
            >
              <option value=""></option>
              <option value="purchase_order">Purchase Order</option>
              <option value="production">Production</option>
              <option value="return">Return</option>
              <option value="adjustment">Stock Adjustment</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Note (optional)</label>
            <textarea
              className="form-input"
              value={data.notes}
              onChange={(event) =>
                onChange({ ...data, notes: event.target.value })
              }
              placeholder=""
              rows={2}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="inventory-restock-footer">
        <button
          className="btn-secondary"
          onClick={close}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={onSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            "Processing..."
          ) : (
            <>
              <FaShoppingCart /> Update Stock
            </>
          )}
        </button>
      </div>
    </InventoryModal>
  );
};

export default RestockModal;