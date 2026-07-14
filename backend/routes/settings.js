// backend/routes/settings.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const BusinessProfileController = require('../controllers/businessProfile');
const AccountController = require('../controllers/accountController');

router.get('/business-profile', authenticate, BusinessProfileController.get);
router.post('/business-profile', authenticate, BusinessProfileController.save);

// Account settings: change password flow (OTP -> verify -> change)
router.post('/account/change-password/send-code', authenticate, AccountController.sendChangePasswordCode);
router.post('/account/change-password/verify', authenticate, AccountController.verifyChangePasswordCode);
router.post('/account/change-password', authenticate, AccountController.changePassword);

module.exports = router;