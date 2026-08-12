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
};
