const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const NotificationController = require('../controllers/notificationController');

router.get('/', authenticate, NotificationController.list);
router.get('/unread-count', authenticate, NotificationController.unreadCount);
router.patch('/:id/read', authenticate, NotificationController.markAsRead);
router.patch('/mark-all-read', authenticate, NotificationController.markAllAsRead);
router.delete('/clear-all', authenticate, NotificationController.clearAll);

module.exports = router;
