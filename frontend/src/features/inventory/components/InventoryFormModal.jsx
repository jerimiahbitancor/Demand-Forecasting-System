import { FaPlus, FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import InfoTip from "./InfoTip";
import { deriveUnitPrice, unitShortLabel } from "../../../utils/recipeUnits";
import {
	purchasePackSummary,
	shouldShowCupField,
	packSizeHelp,
	packUnitHelp,
	packPriceHelp,
	cupFieldNotNeededNote,
} from "../../../utils/ingredientPurchase";
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
        packUnit: next.pack_unit || next.unit,
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
    packUnit: formData.pack_unit || formData.unit,
    packPrice: formData.pack_price,
    stockUnit: formData.unit,
    gramsPerCup: formData.grams_per_cup,
    ingredientName: formData.name,
  });

  // Plain English summary of the purchase pack:
  //   "1 purchase pack = 50 g, and it costs ₱125.00 → ₱2.50 per g (₱2,500.00 per kg)."
  const packSummary = purchasePackSummary({
    packQty: formData.pack_qty,
    packUnit: formData.pack_unit || formData.unit,
    packPrice: formData.pack_price,
    stockUnit: formData.unit,
    derivedUnitCost,
  });

  // "One cup weighs" only makes sense for items that are measured with cups.
  const showCupField = shouldShowCupField({
    category: formData.category,
    stockUnit: formData.unit,
    packUnit: formData.pack_unit,
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
                  : "How much of this ingredient you have on hand right now, in the Stock Unit. One 50 g pack means 50 when the stock unit is grams."}
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
              How much is in one purchase pack?
              <InfoTip>
                What one delivery holds, and what you pay for it. This is the
                purchase, not the recipe: a 250 g portion belongs in the Menu
                Builder, on the dish that uses this item.
              </InfoTip>
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="form-input"
              value={formData.pack_qty}
              onChange={(event) => update("pack_qty", event.target.value)}
              placeholder="e.g. 1"
            />
            <span className="form-hint">{packSizeHelp(formData.unit)}</span>
          </div>
          <div className="form-group">
            <label className="form-label">
              Purchase pack is measured in
              <InfoTip>{packUnitHelp}</InfoTip>
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
            <span className="form-hint">{packUnitHelp}</span>
          </div>
          <div className="form-group">
            <label className="form-label">
              Cost of one purchase pack (₱)
              <InfoTip>{packPriceHelp}</InfoTip>
            </label>
            <input
              type="number"
              className="form-input"
              value={formData.pack_price}
              onChange={(event) => update("pack_price", event.target.value)}
              placeholder="e.g. 300"
              min="0"
              step="0.01"
            />
            <span className="form-hint">{packPriceHelp}</span>
          </div>

          <div className="form-group">
            <label className="form-label">
              Cost per {unitShortLabel(formData.unit)}
              {derivedUnitCost == null && <span className="required-star">*</span>}
              <InfoTip>
                What one {unitShortLabel(formData.unit)} of this ingredient costs.
                {derivedUnitCost != null
                  ? " Worked out from the purchase pack, so it is locked while the pack details are filled in."
                  : " Fill in the purchase pack above and this is worked out for you, or type the cost yourself."}
              </InfoTip>
            </label>
            <input
              type="number"
              className={`form-input ${formErrors.price ? "error" : ""} ${derivedUnitCost != null ? "form-input-locked" : ""}`}
              value={formData.price}
              onChange={(event) => update("price", event.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              readOnly={derivedUnitCost != null}
            />
            {formErrors.price && (
              <span className="form-error">{formErrors.price}</span>
            )}
          </div>

          {packSummary && (
            <div className="inventory-pack-summary">
              <div className="inventory-pack-summary-head">{packSummary.headline}</div>
              {packSummary.note && <div className="inventory-pack-summary-note">{packSummary.note}</div>}
            </div>
          )}

          {showCupField ? (
            <div className="form-group">
              <label className="form-label">
                One cup weighs (grams)
                <InfoTip>
                  Only needed for powders and dry goods you measure with cups or spoons:
                  how many grams one cup holds, so "1 cup" can be turned into your
                  Stock Unit when the recipe is costed.
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
          ) : (
            <div className="form-group">
              <span className="form-hint inventory-cup-not-needed">{cupFieldNotNeededNote}</span>
            </div>
          )}

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
