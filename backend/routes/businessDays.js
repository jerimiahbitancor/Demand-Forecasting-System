// routes/businessDays.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const businessDayService = require('../services/businessDayService');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/business-days/close — the owner's manual "Mark Store as
// Closed" action for one date. Only path (besides an upload) that ever
// resolves a date out of the default unconfirmed state.
router.post('/close', authenticate, async (req, res) => {
  try {
    const { date } = req.body || {};
    if (!date || !DATE_PATTERN.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'A valid date (YYYY-MM-DD) is required'
      });
    }

    const businessDay = await businessDayService.confirmClosedDate(date);
    res.json({ success: true, data: businessDay });
  } catch (error) {
    console.error('Error marking store as closed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark store as closed',
      details: error.message
    });
  }
});

// GET /api/business-days?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', authenticate, async (req, res) => {
  try {
    const { from, to } = req.query;
    const days = await businessDayService.getRange(from, to);
    res.json({ success: true, data: days });
  } catch (error) {
    console.error('Error fetching business days:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch business days',
      details: error.message
    });
  }
});

module.exports = router;
