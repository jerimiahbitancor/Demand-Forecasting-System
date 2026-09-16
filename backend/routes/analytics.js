// routes/analytics.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const analyticsService = require('../services/analyticsService');

// GET /api/analytics/forecasting?productId=&from=&to=
router.get('/forecasting', authenticate, async (req, res) => {
  try {
    const { productId, from, to } = req.query;
    const data = await analyticsService.getForecastingAnalytics({
      productId: productId ? Number(productId) : undefined,
      from,
      to,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building forecasting analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to load forecasting analytics', details: error.message });
  }
});

// GET /api/analytics/product-performance?from=&to=
router.get('/product-performance', authenticate, async (req, res) => {
  try {
    const { from, to } = req.query;
    const data = await analyticsService.getProductPerformanceAnalytics({ from, to });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building product performance analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to load product performance analytics', details: error.message });
  }
});

// GET /api/analytics/ingredient-demand?date=&weekStart=
router.get('/ingredient-demand', authenticate, async (req, res) => {
  try {
    const { date, weekStart } = req.query;
    const data = await analyticsService.getIngredientDemandAnalytics({ date, weekStart });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building ingredient demand analytics:', error);
    res.status(500).json({ success: false, error: 'Failed to load ingredient demand analytics', details: error.message });
  }
});

module.exports = router;
