// routes/businessDays.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const businessDayService = require('../services/businessDayService');
const { logAction } = require('../services/auditService');

const actorOf = (req) => req.user?.name || req.user?.email || null;

// GET /api/business-days/gaps — dates inside the sales history that have
// no sales and are not marked closed, each with its weekday. Feeds the
// one-time "Were these days your store was closed?" review on the
// dashboard. The frontend groups them by month.
router.get('/gaps', authenticate, async (req, res) => {
  try {
    const data = await businessDayService.getGapDates();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error listing business-day gaps:', error);
    res.status(500).json({ success: false, error: 'Failed to list dates with no sales', details: error.message });
  }
});

// POST /api/business-days/bulk-close  { dates: ['YYYY-MM-DD', ...] }
// Marks a list of past dates closed. All-or-nothing: 400 with a reason per
// bad date if any date has sales, is in the future, is outside the sales
// history, or is malformed. Safe to repeat — already-closed dates succeed.
router.post('/bulk-close', authenticate, async (req, res) => {
  try {
    const { dates } = req.body || {};
    const result = await businessDayService.bulkConfirmClosed(dates);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: 'Some dates cannot be marked closed. Nothing was saved.',
        errors: result.errors,
      });
    }

    if (result.closed.length > 0) {
      const first = result.closed[0];
      const last = result.closed[result.closed.length - 1];
      await logAction(
        'business_days_bulk_closed',
        `Marked ${result.closed.length} date(s) as closed (${first} to ${last})` +
          (result.alreadyClosed.length ? `; ${result.alreadyClosed.length} were already closed` : ''),
        actorOf(req)
      );
    }

    res.json({
      success: true,
      data: { closed: result.closed, alreadyClosed: result.alreadyClosed },
    });
  } catch (error) {
    console.error('Error marking dates as closed:', error);
    res.status(500).json({ success: false, error: 'Failed to mark dates as closed', details: error.message });
  }
});

// POST /api/business-days/close  { date: 'YYYY-MM-DD' } — the single-date
// "Mark Store as Closed" action. Same checks as bulk-close: it can no
// longer mark a date that has sales as closed.
router.post('/close', authenticate, async (req, res) => {
  try {
    const { date } = req.body || {};
    const result = await businessDayService.confirmClosedDate(date);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.errors[0]?.reason || 'This date cannot be marked closed.',
        errors: result.errors,
      });
    }
    res.json({ success: true, data: { closed: result.closed, alreadyClosed: result.alreadyClosed } });
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
