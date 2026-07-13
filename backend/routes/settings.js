// backend/routes/settings.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const BusinessProfileController = require('../controllers/businessProfile');

// Using middleware/auth.js's `authenticate` (not authMiddleware.js's
// `requireAuth`) because it resolves the full user row from Supabase, so
// req.user.id is guaranteed to be the numeric id your FK columns expect.
// You have two auth middlewares doing overlapping jobs right now — worth
// consolidating to one eventually, but not urgent.
router.get('/business-profile', authenticate, BusinessProfileController.get);
router.post('/business-profile', authenticate, BusinessProfileController.save);

module.exports = router;