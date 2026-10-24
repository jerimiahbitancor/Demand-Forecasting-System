import { FaPlus, FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import InfoTip from "./InfoTip";
import { unitShortLabel } from "../../../utils/recipeUnits";
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

  const update = (field, value) => {
    onChange({ ...formData, [field]: value });
  };
  const close = () => {
    if (!isSubmitting) onClose();
  };

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
              <InfoTip>The unit used for current stock, recipe deductions, and unit cost. Use grams for powders/meat, mL for liquids, and pieces for discrete items.</InfoTip>
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
              Current Stock{" "}
              <span className="required-star">*</span>
              <InfoTip>
                {isEdit
                  ? "The amount of this ingredient on hand right now, in the Stock Unit. Change it to the counted amount and the new number is saved as the stock balance; the change is kept in the stock history as a count."
                  : `How much of this ingredient you have on hand right now, in ${unitShortLabel(formData.unit)}.`}
                Fractions like 1/2 work too.
              </InfoTip>
            </label>
            <input
              type="text"
              inputMode="decimal"
              className={`form-input ${formErrors.quantity ? "error" : ""}`}
              value={formData.quantity}
              onChange={(event) => update("quantity", event.target.value)}
              placeholder="e.g. 50"
            />
            {formErrors.quantity && (
              <span className="form-error">{formErrors.quantity}</span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              Cost per {unitShortLabel(formData.unit)}
              <span className="required-star">*</span>
              <InfoTip>
                What one {unitShortLabel(formData.unit)} of this ingredient costs.
                {" "}Enter the cost per stock unit.
              </InfoTip>
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
            <label className="form-label">Material Type</label>
            <select
              className="form-input"
              value={formData.material_type || 'dry'}
              onChange={(event) => update("material_type", event.target.value)}
            >
              <option value="wet">Wet Raw Materials</option>
              <option value="dry">Dry Raw Materials</option>
            </select>
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
