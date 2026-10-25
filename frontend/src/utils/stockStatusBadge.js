// utils/stockStatusBadge.js
//
// Colours for a stock status label. NO calculation here on purpose: the
// status itself always comes from the backend (current_stock_status /
// predicted_stock_status, computed by backend/utils/stockStatus.js with the
// owner's thresholds). The Restock and History windows used to compute their
// own status from min_stock with yet another set of numbers (50% / 100% /
// 3x), which disagreed with the table on the same page.

const BADGES = {
  // Current Stock Level Status
  'Out of Stock': { color: '#dc2626', bgColor: '#fee2e2' },
  'Low Stock': { color: '#f59e0b', bgColor: '#fef3c7' },
  'Normal Stock': { color: '#16a34a', bgColor: '#dcfce7' },
  'Excess Stock': { color: '#3b82f6', bgColor: '#dbeafe' },
  // Predicted Stock Level Status
  'Critical Shortage': { color: '#dc2626', bgColor: '#fee2e2' },
  'Insufficient Supply': { color: '#f59e0b', bgColor: '#fef3c7' },
  'Sufficient Supply': { color: '#16a34a', bgColor: '#dcfce7' },
  'Above Forecast Limit': { color: '#3b82f6', bgColor: '#dbeafe' },
  Unassigned: { color: '#9ca3af', bgColor: '#f3f4f6' },
  Archived: { color: '#6b7280', bgColor: '#f3f4f6' },
};

// Old wording that may still arrive from a cached page.
const ALIASES = { Excess: 'Excess Stock' };

export function stockStatusBadge(label) {
  const key = ALIASES[label] || label;
  const badge = BADGES[key];
  if (!badge) return { label: 'Unknown', color: '#9ca3af', bgColor: '#f3f4f6' };
  return { label: key, ...badge };
}

// The current status of an ingredient row from the list, archived first.
export function currentStockBadge(item) {
  if (!item) return stockStatusBadge(null);
  if (item.is_archived) return stockStatusBadge('Archived');
  return stockStatusBadge(item.current_stock_status);
}
