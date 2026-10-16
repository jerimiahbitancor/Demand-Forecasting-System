import { FaPlus, FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import InfoTip from "./InfoTip";
import { deriveUnitPrice } from "../../../utils/recipeUnits";
import "./InventoryFormModal.css";

const InventoryFormModal = ({
  isOpen,
  isSubmitting,
  isEdit,
  formData,
  formErrors,
  categories,
  units,
  onChange,
  onSubmit,
  onClose,
}) => {
  if (!isOpen) return null;

  // Pack edits also refresh the unit cost, so the saved cost always matches
  // "what one sachet costs spread over what it holds".
  const update = (field, value) => {
    const next = { ...formData, [field]: value };
    if (["pack_qty", "pack_unit", "pack_price", "unit", "grams_per_cup", "name"].includes(field)) {
      const derived = deriveUnitPrice({
        packQty: next.pack_qty,
        packUnit: next.pack_unit,
        packPrice: next.pack_price,
        stockUnit: next.unit,
        gramsPerCup: next.grams_per_cup,
        ingredientName: next.name,
      });
      if (derived != null) next.price = String(derived);
    }
    onChange(next);
  };
  const close = () => {
    if (!isSubmitting) onClose();
  };

  const derivedUnitCost = deriveUnitPrice({
    packQty: formData.pack_qty,
    packUnit: formData.pack_unit,
    packPrice: formData.pack_price,
    stockUnit: formData.unit,
    gramsPerCup: formData.grams_per_cup,
    ingredientName: formData.name,
  });

  return (
    <InventoryModal
      className="modal-lg inventory-form-modal"
      onClose={close}
      closeOnOverlay={false}
    >
      <div className="modal-header inventory-modal-header">
        <h3 className="modal-title">
          {isEdit ? "Edit Inventory Item" : "Add New Ingredient"}
        </h3>
        <button className="modal-close-btn" onClick={close}>
          <FaTimes />
        </button>
      </div>
      <div className="modal-body inventory-modal-body">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">
              Item Name <span className="required-star">*</span>
            </label>
            <input
              type="text"
              className={`form-input ${formErrors.name ? "error" : ""}`}
              value={formData.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Enter item name"
            />
            {formErrors.name && (
              <span className="form-error">{formErrors.name}</span>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              Category <span className="required-star">*</span>
            </label>
            <select
              className={`form-input ${formErrors.category ? "error" : ""}`}
              value={formData.category}
              onChange={(event) => update("category", event.target.value)}
            >
              <option value="">Select Category</option>
              {categories
                .filter((category) => category !== "All")
                .map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              <option value="Other">Other</option>
            </select>
            {formErrors.category && (
              <span className="form-error">{formErrors.category}</span>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              Stock Unit
              <InfoTip>
                How you count this ingredient in stock and how its unit cost is
                quoted (e.g. Kilograms (kg)).
              </InfoTip>
            </label>
            <select
              className="form-input"
              value={formData.unit}
              onChange={(event) => update("unit", event.target.value)}
            >
              {(units || []).map((unit) => (
                <option key={unit.id || unit.name} value={unit.name}>{unit.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              {isEdit ? "Quantity" : "Initial Quantity"}{" "}
              <span className="required-star">*</span>
            </label>
            <input
              type="text"
              inputMode="decimal"
              className={`form-input ${formErrors.quantity ? "error" : ""}`}
              value={formData.quantity}
              onChange={(event) => update("quantity", event.target.value)}
              placeholder="Qty (e.g. 1/2)"
            />
            {formErrors.quantity && (
              <span className="form-error">{formErrors.quantity}</span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              Pack Size (amount per pack)
              <InfoTip>
                How much one sachet / pack holds (e.g. 150 for a 150 g sachet).
              </InfoTip>
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="form-input"
              value={formData.pack_qty}
              onChange={(event) => update("pack_qty", event.target.value)}
              placeholder="e.g. 150"
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Pack Unit
              <InfoTip>
                The unit the pack size is measured in (e.g. Grams (g) for a 150 g sachet).
              </InfoTip>
            </label>
            <select
              className="form-input"
              value={formData.pack_unit}
              onChange={(event) => update("pack_unit", event.target.value)}
            >
              <option value="">Same as stock unit</option>
              {(units || []).map((unit) => (
                <option key={unit.id || unit.name} value={unit.name}>{unit.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Pack Price (₱ per pack)
              <InfoTip>What you pay for one pack / sachet (e.g. ₱200 for 150 g).</InfoTip>
            </label>
            <input
              type="number"
              className="form-input"
              value={formData.pack_price}
              onChange={(event) => update("pack_price", event.target.value)}
              placeholder="e.g. 200"
              min="0"
              step="0.01"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              {isEdit ? "Unit Cost" : "Unit Cost/Price Per Unit"}{" "}
              {derivedUnitCost == null && <span className="required-star">*</span>}
              {derivedUnitCost != null && (
                <InfoTip>
                  Derived from the pack: ₱{derivedUnitCost} per {formData.unit || "unit"}. The pack wins over a manually typed cost.
                </InfoTip>
              )}
            </label>
            <input
              type="number"
              className={`form-input ${formErrors.price ? "error" : ""}`}
              value={formData.price}
              onChange={(event) => update("price", event.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
            />
            {formErrors.price && (
              <span className="form-error">{formErrors.price}</span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              Grams per Cup (optional)
              <InfoTip>
                Weight of 1 cup of this ingredient in grams, so recipe cups/tbsp/tsp
                convert to the stock unit when pricing. Needed for powders and
                liquids used by spoon (e.g. blue lemonade powder).
              </InfoTip>
            </label>
            <input
              type="number"
              className="form-input"
              value={formData.grams_per_cup}
              onChange={(event) => update("grams_per_cup", event.target.value)}
              placeholder="e.g. 125 for all-purpose flour"
              min="0"
              step="0.1"
            />
          </div>

          {isEdit && (
            <div className="form-group">
              <label className="form-label">Market Price</label>
              <input
                type="number"
                className="form-input"
                value={formData.market_price}
                onChange={(event) => update("market_price", event.target.value)}
                min="0"
                step="0.01"
              />
            </div>
          )}
        </div>
      </div>
      <div className="modal-footer inventory-modal-footer">
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
            isEdit ? (
              "Updating..."
            ) : (
              "Adding..."
            )
          ) : (
            <>
              {isEdit ? <FaSave /> : <FaPlus />}{" "}
              {isEdit ? "Update Item" : "Add Item"}
            </>
          )}
        </button>
      </div>
    </InventoryModal>
  );
};

export default InventoryFormModal;
