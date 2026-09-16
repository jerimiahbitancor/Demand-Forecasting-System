// routes/forecastSummary.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const analyticsService = require('../services/analyticsService');

// GET /api/forecast/summary — Dashboard KPI card data (predicted sales
// today, actual sales yesterday, forecast accuracy, stock alert counts).
router.get('/summary', authenticate, async (req, res) => {
  try {
    const data = await analyticsService.getForecastSummary();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building forecast summary:', error);
    res.status(500).json({ success: false, error: 'Failed to load forecast summary', details: error.message });
  }
});

module.exports = router;
