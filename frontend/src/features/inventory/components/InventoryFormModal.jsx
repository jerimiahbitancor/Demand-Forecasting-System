import { FaPlus, FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import InfoTip from "./InfoTip";
import { unitShortLabel } from "../../../utils/recipeUnits";
import { packPriceLabel, packQuantityKind, pricePerUnitFromPack, shouldShowPackFields } from "../../../utils/ingredientPackPrice";
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
    const next = { ...formData, [field]: value };
    if (field === "unit") {
      const kind = packQuantityKind(value);
      next.pieces_per_pack = kind === "pieces" ? next.pieces_per_pack : "";
      next.grams_per_pack = kind === "grams" ? next.grams_per_pack : "";
      if (kind === null) next.pack_price = "";
    }
    if (["unit", "pieces_per_pack", "grams_per_pack", "pack_price"].includes(field)) {
      const derived = pricePerUnitFromPack(next);
      if (derived !== null) next.price = String(derived);
    }
    onChange(next);
  };
  const close = () => {
    if (!isSubmitting) onClose();
  };
  const packKind = packQuantityKind(formData.unit);
  const showPiecesPerPack = packKind === "pieces";
  const showGramsPerPack = packKind === "grams";
  const showPackFields = shouldShowPackFields(formData);
  const derivedPrice = pricePerUnitFromPack(formData);
  const packQuantityLabel = showPiecesPerPack ? "pieces per pack" : "grams per pack";

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

          {showPackFields && (
            <>
              {showPiecesPerPack && (
                <div className="form-group">
                  <label className="form-label">
                    Pieces per Pack
                    <InfoTip>
                      How many pieces one purchase pack holds. Enter 30 if one pack
                      contains 30 pieces. Leave it empty when the ingredient is not
                      bought in packs.
                    </InfoTip>
                  </label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.pieces_per_pack ? "error" : ""}`}
                    value={formData.pieces_per_pack ?? ""}
                    onChange={(event) => update("pieces_per_pack", event.target.value)}
                    placeholder="e.g. 30"
                    min="1"
                    step="1"
                  />
                  {formErrors.pieces_per_pack && (
                    <span className="form-error">{formErrors.pieces_per_pack}</span>
                  )}
                  <span className="form-hint">
                    Optional. Shows as "pcs/pack" in the ingredient list.
                  </span>
                </div>
              )}

              {showGramsPerPack && (
                <div className="form-group">
                  <label className="form-label">
                    Grams per Pack
                    <InfoTip>
                      How many grams one purchase pack contains. Enter 250 for a
                      250 g bag. Leave it empty when the pack weight is unknown.
                    </InfoTip>
                  </label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.grams_per_pack ? "error" : ""}`}
                    value={formData.grams_per_pack ?? ""}
                    onChange={(event) => update("grams_per_pack", event.target.value)}
                    placeholder="e.g. 250"
                    min="0.01"
                    step="0.01"
                  />
                  {formErrors.grams_per_pack && (
                    <span className="form-error">{formErrors.grams_per_pack}</span>
                  )}
                  <span className="form-hint">
                    Optional. Shows as "g/pack" in the ingredient list.
                  </span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">
                  Pack Price
                  <InfoTip>
                    What one whole pack costs. With the pack quantity, the cost per
                    stock unit is calculated automatically. This field is optional.
                  </InfoTip>
                </label>
                <input
                  type="number"
                  className={`form-input ${formErrors.pack_price ? "error" : ""}`}
                  value={formData.pack_price ?? ""}
                  onChange={(event) => update("pack_price", event.target.value)}
                  placeholder="e.g. 255.00"
                  min="0.01"
                  step="0.01"
                />
                {formErrors.pack_price && (
                  <span className="form-error">{formErrors.pack_price}</span>
                )}
                <span className="form-hint">
                  {derivedPrice !== null
                    ? `₱${packPriceLabel(derivedPrice)} per ${unitShortLabel(formData.unit)} = pack price ÷ ${packQuantityLabel}.`
                    : `Optional. Fill in ${packQuantityLabel} to compute the cost per ${unitShortLabel(formData.unit)}.`}
                </span>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">
              Cost per {unitShortLabel(formData.unit)}
              <span className="required-star">*</span>
              <InfoTip>
                What one {unitShortLabel(formData.unit)} of this ingredient costs.
                {" "}Enter the cost per stock unit, or let the pack price and pack
                quantity calculate it.
              </InfoTip>
            </label>
            <input
              type="number"
              className={`form-input ${formErrors.price ? "error" : ""} ${derivedPrice !== null ? "readonly" : ""}`}
              value={formData.price}
              onChange={(event) => update("price", event.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              readOnly={derivedPrice !== null}
            />
            {formErrors.price && (
              <span className="form-error">{formErrors.price}</span>
            )}
            {derivedPrice !== null && (
              <span className="form-hint">
                Calculated from the pack price.
              </span>
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
