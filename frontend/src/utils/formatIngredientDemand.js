import { isCountUnit } from "./formatStockQty.js";

export function formatIngredientDemandQty(value, unit) {
  if (value === null || value === undefined || value === "") return "—";
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "—";
  const formatted = isCountUnit(unit)
    ? String(Math.round(quantity))
    : quantity.toLocaleString("en-PH", {
      useGrouping: false,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatIngredientDemandMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
}
