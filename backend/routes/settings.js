// backend/routes/settings.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const BusinessProfileController = require('../controllers/businessProfileController');
const AccountController = require('../controllers/accountController');
const uploadLogo = require('../middleware/uploadLogo');
const virusScan = require('../middleware/virusScan'); // generic buffer scanner, reused as-is

router.get('/business-profile', authenticate, BusinessProfileController.get);
router.post('/business-profile', authenticate, BusinessProfileController.save);
router.post(
  '/business-profile/logo',
  authenticate,
  uploadLogo.single('logo'), // dedicated, image-only multer — see middleware/uploadLogo.js
  virusScan,                 // same scanner routes/upload.js already uses for CSVs
  BusinessProfileController.uploadLogo
);

// Account settings: change password flow (OTP -> verify -> change)
router.post('/account/change-password/send-code', authenticate, AccountController.sendChangePasswordCode);
router.post('/account/change-password/verify', authenticate, AccountController.verifyChangePasswordCode);
router.post('/account/change-password', authenticate, AccountController.changePassword);

module.exports = router;