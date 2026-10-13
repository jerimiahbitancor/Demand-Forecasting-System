// routes/marketPrice.js
/**
 * Market Price routes — MANUAL-ENTRY + DA DAILY IMPORT
 *
 * Prices reach this screen two ways:
 *   - manually, entered by authorized users via the UI (is_manual_entry = true);
 *   - automatically, once a day, from the DA's own public "Daily Price Index"
 *     sheets (Bantay Presyo) via services/daPriceImportService.js and
 *     jobs/dailyPriceImportJob.js (is_manual_entry = false, source
 *     'da_reference'). That job is the ONLY outbound request in the backend.
 *
 * The `scraped_at` column is the recording timestamp: a manual entry's time, or
 * the as-of date of the automated DA sheet. It is kept under this name to avoid
 * a database migration.
 */
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const {
  getComparison,
  getIngredientPrices,
  getPriceHistory,
  createManualPrice,
  updateManualPrice,
  deleteManualPrice,
  bulkUpsertPrices,
  getSourcesList,
  createSource,
  deleteSource
} = require('../controllers/marketPriceController');

// All routes require authentication.
// No ROUTE here makes an outbound HTTP request; the daily DA importer runs on
// its own cron, not through any of these handlers.
router.use(authenticateToken);

router.get('/sources', getSourcesList);
router.post('/sources', createSource);
router.delete('/sources/:id', deleteSource);
router.get('/comparison', getComparison);
router.get('/ingredient/:ingredientId', getIngredientPrices);
router.get('/history/:ingredientId', getPriceHistory);
router.post('/bulk-upsert', bulkUpsertPrices);
router.post('/', createManualPrice);
router.put('/:id', updateManualPrice);
router.delete('/:id', deleteManualPrice);

module.exports = router;