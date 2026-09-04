import { FaPlus, FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
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

  const update = (field, value) => onChange({ ...formData, [field]: value });
  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <InventoryModal className="modal-lg inventory-form-modal" onClose={close}>
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
            <label className="form-label">Unit</label>
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
              type="number"
              className={`form-input ${formErrors.quantity ? "error" : ""}`}
              value={formData.quantity}
              onChange={(event) => update("quantity", event.target.value)}
              placeholder="0"
              min="0"
              step="0.01"
            />
            {formErrors.quantity && (
              <span className="form-error">{formErrors.quantity}</span>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              {isEdit ? "Unit Cost" : "Unit Cost/Price Per Unit"}{" "}
              <span className="required-star">*</span>
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
          {isEdit && (
            <>
              <div className="form-group">
                <label className="form-label">Market Price</label>
                <input
                  type="number"
                  className="form-input"
                  value={formData.market_price}
                  onChange={(event) =>
                    update("market_price", event.target.value)
                  }
                  min="0"
                  step="0.01"
                />
              </div>
             
            </>
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
