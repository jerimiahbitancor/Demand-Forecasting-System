import {
  FaShoppingCart,
  FaTimes,
  FaBoxes,
  FaExclamationTriangle,
} from "react-icons/fa";
import InventoryModal from "../InventoryModal";
import "./RestockModal.css";
import { formatStockQty } from "../../../../utils/formatStockQty.js";
import { parseRecipeQuantity, convertRecipeQuantity, unitShortLabel } from "../../../../utils/recipeUnits";

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
  const isPackEntry = data.mode === "packs";

  // What one purchase pack holds, turned into the stock unit so the owner can
  // see it. The pack details live in pack_qty / pack_unit (the old pack_size
  // column is no longer sent by the API).
  const packQtyAmount = parseRecipeQuantity(item.pack_qty);
  const packUnit = item.pack_unit || item.unit;
  const packSizeInStockUnit = packQtyAmount > 0
    ? convertRecipeQuantity(packQtyAmount, packUnit, item.unit, {
      gramsPerCup: item.grams_per_cup,
      ingredientName: item.name,
      packQty: item.pack_qty,
      packUnit: item.pack_unit,
    })
    : null;
  const hasPackSize = Number(packSizeInStockUnit) > 0;

  // How much stock this entry adds, so the owner sees the new balance
  // before saving. The amount itself is never rounded, only the display.
  const enteredAmount = parseRecipeQuantity(data.quantity);
  const addedAmount = isPackEntry
    ? (Number.isFinite(enteredAmount) && Number.isFinite(packSizeInStockUnit)
        ? enteredAmount * packSizeInStockUnit
        : NaN)
    : enteredAmount;
  const currentAmount = parseRecipeQuantity(item.quantity);
  const hasPreview =
    Number.isFinite(addedAmount) && addedAmount > 0 && Number.isFinite(currentAmount);
  const balanceAfter = hasPreview ? currentAmount + addedAmount : null;

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
              Add Stock
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
            {hasPackSize && (
              <>
                <label className="form-label">How do you want to add it?</label>
                <select
                  className="form-input"
                  value={data.mode || "stock"}
                  onChange={(event) => onChange({ ...data, quantity: "", mode: event.target.value })}
                >
                  <option value="stock">By {unitShortLabel(item.unit)} (amount)</option>
                  <option value="packs">By purchase pack</option>
                </select>
              </>
            )}
            <label className="form-label">
              {isPackEntry ? "Number of packs to add" : `How much to add (${unitShortLabel(item.unit || "stock unit")})`}
              {" "}<span className="required-star">*</span>
            </label>
            <div className="quantity-input-wrapper">
              <input
                type="text"
                inputMode="decimal"
                className="form-input"
                value={data.quantity}
                onChange={(event) =>
                  onChange({ ...data, quantity: event.target.value })
                }
                placeholder={isPackEntry ? "e.g. 1" : "e.g. 0.5"}
              />
            </div>
            {isPackEntry && (
              <small>
                1 pack holds {formatStockQty(packSizeInStockUnit, item.unit)} {item.unit}.
              </small>
            )}
            {hasPreview && (
              <small>
                Stock after adding: {formatStockQty(balanceAfter, item.unit)}{" "}
                {item.unit || "stock unit"}.
              </small>
            )}
            <small>
              The amount you add is added to the current stock. Sales that were
              short earlier stay on record until a stock count clears them.
            </small>
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
              <FaShoppingCart /> Add Stock
            </>
          )}
        </button>
      </div>
    </InventoryModal>
  );
};

export default RestockModal;