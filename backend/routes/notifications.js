const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authenticate = require('../middleware/auth');
const NotificationController = require('../controllers/notificationController');
const { RATE_LIMIT_BODY } = require('../middleware/rateLimits');
const { sendTestReminderEmail, TestEmailError } = require('../services/notificationService');

router.get('/', authenticate, NotificationController.list);
router.get('/unread-count', authenticate, NotificationController.unreadCount);
router.patch('/:id/read', authenticate, NotificationController.markAsRead);
router.patch('/mark-all-read', authenticate, NotificationController.markAllAsRead);
router.delete('/clear-all', authenticate, NotificationController.clearAll);

// POST /api/notifications/test-email — Settings > Business Profile's
// "Send test reminder email". Sends a sample reminder to the business email
// now, even when EMAIL_REMINDERS_ENABLED is off (an explicit owner action).
// At most 3 per 10 minutes per user, so the button cannot flood an inbox.
const testEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: RATE_LIMIT_BODY,
  // Runs after authenticate, so there is always a user to count by.
  keyGenerator: (req) => `test-email:${req.user?.id ?? req.user?.user_id ?? 'unknown'}`,
});

router.post('/test-email', authenticate, testEmailLimiter, async (req, res) => {
  try {
    const result = await sendTestReminderEmail();
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof TestEmailError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error('Test reminder email failed:', error && error.message);
    res.status(502).json({ success: false, error: 'The email could not be sent. Try again later.' });
  }
});

module.exports = router;
