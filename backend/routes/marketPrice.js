// routes/marketPrice.js
/**
 * Market Price routes — LEGAL / MANUAL-ONLY EDITION
 *
 * This module does NOT scrape any website and does NOT call any external API.
 * All prices are entered manually by authorized users via the UI.
 * The `scraped_at` column is repurposed as "recorded_at" (timestamp of manual entry).
 *
 * Rationale: scraping Philippine supermarket or government websites may violate
 * their Terms of Service, the Cybercrime Prevention Act, and NPC Advisory
 * No. 2026-01 on data privacy. See: https://privacy.gov.ph/
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
// No route ever makes an outbound HTTP request — this is manual-entry only.
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