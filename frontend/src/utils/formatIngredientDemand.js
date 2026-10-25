// Display rule for INGREDIENT DEMAND amounts and money (Analytics > Ingredient
// Demand, its reports and the grocery list). Owner decision, Oct 25 2026:
//   - every amount strictly 2 decimals            1.2 kg   -> "1.20 kg"
//   - pieces (pcs) are whole numbers              17 pcs   -> "17 pcs"
//   - the unit sits next to its value, in its SHORT form ("kg", not
//     "Kilograms (kg)"), so a cell reads as one quantity
//   - money is ₱ with 2 decimals                  115.5    -> "₱115.50"
//   - a price per unit keeps 2 decimals, except a price under ₱1 that would
//     otherwise read ₱0.00 (₱0.0035/g): it shows up to 4 decimals so the
//     cost stays checkable by hand. The math always uses the stored price.
import { isCountUnit } from "./formatStockQty.js";
import { unitShortLabel } from "./recipeUnits.js";

// -> { value: "1.20", unit: "kg" } (unit "" when unknown); null for no value.
export function ingredientDemandParts(value, unit) {
  if (value === null || value === undefined || value === "") return null;
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return null;
  const formatted = isCountUnit(unit)
    ? Math.round(quantity).toLocaleString("en-PH")
    : quantity.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { value: formatted, unit: unit ? unitShortLabel(unit) : "" };
}

export function formatIngredientDemandQty(value, unit) {
  const parts = ingredientDemandParts(value, unit);
  if (!parts) return "—";
  return parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
}

export function formatIngredientDemandMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
}

// "₱50.00/kg"; "₱0.0035/g" for a tiny per-gram price; "—" without a price.
export function formatUnitPrice(price, unit) {
  if (price === null || price === undefined || price === "") return "—";
  const amount = Number(price);
  if (!Number.isFinite(amount)) return "—";
  const tiny = amount > 0 && amount < 1 && Number(amount.toFixed(2)) !== amount;
  const text = amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: tiny ? 4 : 2,
  });
  return `₱${text}/${unit ? unitShortLabel(unit) : "unit"}`;
}

// The hover line under Est. Cost: "2.31 kg × ₱50.00/kg = ₱115.50".
export function estCostFormula(toBuy, unit, price, estCost) {
  if (price === null || price === undefined || toBuy === null || toBuy === undefined) return null;
  return `${formatIngredientDemandQty(toBuy, unit)} × ${formatUnitPrice(price, unit)} = ${formatIngredientDemandMoney(estCost)}`;
}
