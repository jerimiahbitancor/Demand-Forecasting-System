// components/market modal/MarketPriceModal.jsx
import { useState } from "react";
import { FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "../InventoryModal";

const DEFAULT_SOURCES = [
  { key: "robinsons", label: "Robinson's" },
  { key: "sm", label: "SM" },
  { key: "puregold", label: "Puregold" },
  { key: "wet_market", label: "Wet Market" },
  { key: "da_reference", label: "DA Reference" },
];

const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Stamp "now" but keep the user-picked calendar date. Midnight-UTC stamps are
// dangerous here: the comparison view shows the latest scraped_at per store, so
// a same-day midnight stamp can be OLDER than an earlier recording and the
// edited price would never appear. Using the current time guarantees the newest
// recording always wins.
const buildScrapedAt = (dateISO) => {
  const now = new Date();
  const [y, m, d] = (dateISO || todayISO()).split('-').map(Number);
  const local = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  return Number.isNaN(local.getTime()) ? now.toISOString() : local.toISOString();
};

// NOTE: this modal is rendered by its parent with a changing `key`, so it is
// freshly mounted (all state re-initialized from props) each time it opens.
const MarketPriceModal = ({
  isOpen,
  mode,
  row,
  ingredients,
  sources,
  isSubmitting,
  onSubmit,
  onClose,
}) => {
  // Build the price fields from the live source list (falls back to defaults
  // while the sources are still loading).
  const sourceFields = (sources && sources.length ? sources : DEFAULT_SOURCES).map((s) => ({
    key: s.key,
    label: `${s.label} Price (₱)`,
    hint: s.tooltip || null,
  }));

  const initialPrices = (m, r) => {
    const result = {};
    sourceFields.forEach((f) => {
      result[f.key] = m === "edit" && r && r[f.key] != null ? String(r[f.key]) : "";
    });
    return result;
  };

  const [ingredientSearch, setIngredientSearch] = useState(() =>
    mode === "edit" && row ? row.ingredient || "" : ""
  );
  const [selectedIngredientId, setSelectedIngredientId] = useState(() =>
    mode === "edit" && row ? String(row.ingredientId) : ""
  );
  const [selectedUnit, setSelectedUnit] = useState(() =>
    mode === "edit" && row ? row.unit || "kg" : "kg"
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [prices, setPrices] = useState(() => initialPrices(mode, row));
  const [recordedDate, setRecordedDate] = useState(todayISO());
  const [errors, setErrors] = useState({});

  if (!isOpen) return null;

  const filteredIngredients = (ingredients || []).filter((ing) =>
    ing.name.toLowerCase().includes(ingredientSearch.toLowerCase())
  );

  const selectIngredient = (ingredient) => {
    setSelectedIngredientId(String(ingredient.id));
    setIngredientSearch(ingredient.name);
    setSelectedUnit(ingredient.unit || "kg");
    setDropdownOpen(false);
    setErrors((prev) => ({ ...prev, ingredient: undefined }));
  };

  const close = () => {
    if (!isSubmitting) onClose();
  };

  const handleSubmit = () => {
    const nextErrors = {};

    if (!selectedIngredientId) {
      nextErrors.ingredient = "Please select an ingredient";
    }

    const hasAnyPrice = sourceFields.some((f) => prices[f.key] !== "" && prices[f.key] !== null && prices[f.key] !== undefined);
    if (!hasAnyPrice) {
      nextErrors.prices = "Enter at least one price";
    } else {
      sourceFields.forEach((f) => {
        const value = prices[f.key];
        if (value === "" || value === null || value === undefined) return;
        if (Number.isNaN(Number(value)) || Number(value) < 0) {
          const sourceError = `${f.label} must be a valid number >= 0`;
          nextErrors.prices = nextErrors.prices === "Enter at least one price" ? sourceError : (nextErrors.prices || sourceError);
        }
      });
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Build entries using the same source keys the market_price table expects.
    const entries = sourceFields
      .filter((f) => prices[f.key] !== "" && prices[f.key] !== null && prices[f.key] !== undefined)
      .map((f) => ({
        source: f.key,
        price: Number(Number(prices[f.key]).toFixed(2)),
        unit: selectedUnit,
        is_manual_entry: true,
        scraped_at: buildScrapedAt(recordedDate),
      }));

    onSubmit({
      ingredientId: Number(selectedIngredientId),
      entries,
    });
  };

  return (
    <InventoryModal className="modal-lg market-price-modal" onClose={close}>
      <div className="modal-header inventory-modal-header">
        <h3 className="modal-title">{mode === "edit" ? "Edit Price Entry" : "Add Price Entry"}</h3>
        <button className="modal-close-btn" onClick={close}>
          <FaTimes />
        </button>
      </div>

      <div className="modal-body inventory-modal-body">
        <div className="form-grid">
          {/* Ingredient */}
          <div className={`form-group full-width ${mode === "edit" ? "" : "market-ingredient-field"}`}>
            <label className="form-label">Ingredient <span className="required-star">*</span></label>
            {mode === "edit" ? (
              <input className="form-input" value={ingredientSearch} disabled readOnly />
            ) : (
              <>
                <input
                  className={`form-input ${errors.ingredient ? "error" : ""}`}
                  placeholder="Search ingredient..."
                  value={ingredientSearch}
                  onChange={(e) => {
                    setIngredientSearch(e.target.value);
                    setSelectedIngredientId("");
                    setDropdownOpen(true);
                    setErrors((prev) => ({ ...prev, ingredient: undefined }));
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                />
                {dropdownOpen && (
                  <div className="market-ingredient-dropdown">
                    {filteredIngredients.length === 0 ? (
                      <div className="market-ingredient-empty">No matching ingredients</div>
                    ) : (
                      filteredIngredients.map((ing) => (
                        <div
                          key={ing.id}
                          className="market-ingredient-option"
                          onMouseDown={() => selectIngredient(ing)}
                        >
                          <span>{ing.name}</span>
                          <span className="market-ingredient-unit">{ing.unit}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {errors.ingredient && <span className="form-error">{errors.ingredient}</span>}
              </>
            )}
          </div>

          {/* Unit */}
          <div className="form-group">
            <label className="form-label">Unit</label>
            <input className="form-input" value={selectedUnit} disabled readOnly />
          </div>

          {/* Date recorded */}
          <div className="form-group">
            <label className="form-label">Date Recorded <span className="required-star">*</span></label>
            <input
              type="date"
              className="form-input"
              value={recordedDate}
              onChange={(e) => setRecordedDate(e.target.value)}
            />
          </div>

          {/* Source prices */}
          {sourceFields.map((field) => (
            <div className="form-group" key={field.key}>
              <label className="form-label">{field.label}</label>
              <input
                type="number"
                className="form-input"
                value={prices[field.key]}
                onChange={(e) => setPrices({ ...prices, [field.key]: e.target.value })}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
              {field.hint && <span className="market-da-hint">{field.hint}</span>}
            </div>
          ))}

          {errors.prices && <span className="form-error full-width">{errors.prices}</span>}
        </div>
      </div>

      <div className="modal-footer inventory-modal-footer">
        <button className="btn-secondary" onClick={close} disabled={isSubmitting}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : <><FaSave /> Save Prices</>}
        </button>
      </div>
    </InventoryModal>
  );
};

export default MarketPriceModal;