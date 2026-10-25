import { isCountUnit } from "./formatStockQty.js";
import { normalizeRecipeQuantityToUnit, parseRecipeQuantity, roundTo, unitShortLabel } from "./recipeUnits.js";

const GRAM_UNIT_LABELS = new Set(["g", "gram", "grams", "gm", "gms"]);

// A pack is measured in pieces for count units and in grams for gram units.
// Kilograms are deliberately excluded: pack pricing there is entered per kg.
// Returns null for other units.
export const packQuantityKind = (unit) => {
  if (isCountUnit(unit)) return "pieces";
  if (GRAM_UNIT_LABELS.has(unitShortLabel(unit).toLowerCase())) return "grams";
  return null;
};

// The pack size expressed in the ingredient's stock unit: pieces stay pieces,
// grams are used as-is for gram ingredients. Returns null for kilograms and
// other units, which do not use pack pricing.
export const packQuantityInStockUnit = ({ unit, pieces_per_pack, grams_per_pack } = {}) => {
  const kind = packQuantityKind(unit);
  if (kind === "pieces") {
    const pieces = parseRecipeQuantity(pieces_per_pack);
    return Number.isFinite(pieces) && pieces > 0 ? pieces : null;
  }
  if (kind === "grams") {
    const grams = parseRecipeQuantity(grams_per_pack);
    if (!Number.isFinite(grams) || grams <= 0) return null;
    const quantity = normalizeRecipeQuantityToUnit(grams, "Grams (g)", unit);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
  }
  return null;
};

// The cost per stock unit implied by a purchase pack. Returns null when the
// unit is not pieces/grams, the pack price is missing, or the pack size is
// missing, so a manually entered cost is left alone.
export const pricePerUnitFromPack = (values = {}) => {
  const packPrice = parseRecipeQuantity(values.pack_price);
  if (!Number.isFinite(packPrice) || packPrice <= 0) return null;
  const packQuantity = packQuantityInStockUnit(values);
  if (packQuantity === null) return null;
  return roundTo(packPrice / packQuantity, 6);
};

// Show the pack fields only when the unit has a pack size: pieces for count
// units and grams for gram units. Kilograms and other units hide them.
export const shouldShowPackFields = (values = {}) => packQuantityKind(values.unit) !== null;

export const packPriceLabel = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
};
