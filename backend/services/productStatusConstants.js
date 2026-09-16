module.exports = {
  PRODUCT_STATUS_NOTES: {
    ACTIVE: '',
    NEW_PRODUCT: 'New product detected. Forecast available after 28 days of sales data.',
    STALE: 'No sales for 28 days. Excluded from forecast until sales resume.',
    NEVER_SOLD: 'No sales recorded since being added. Excluded from forecast until first sale.',
  },
  ARCHIVE_REASONS: {
    DISCONTINUED: 'Discontinued',
    SEASONAL: 'Seasonal',
    OUT_OF_STOCK_TEMP: 'Out of stock temporarily',
  },
  // deriveProductStatus() (productStatusService.js) returns a short display
  // status ('active' | 'new' | 'inactive' | 'archived') used for UI labels
  // — it does NOT match the products.status DB enum ('active' |
  // 'inactive_new' | 'inactive_discontinued' | 'archived'), and
  // products.is_active is a GENERATED column derived from status, so it
  // can never be written directly (Postgres error 428C9). Every direct
  // write to products.status must translate through this map first —
  // single source of truth so the translation can't drift between the
  // several places that need it (mappingService.js, menuService.js,
  // uploadService.js).
  PRODUCT_DB_STATUS_BY_DERIVED: {
    active: 'active',
    new: 'inactive_new',
    inactive: 'inactive_discontinued',
    archived: 'archived',
  },
};
