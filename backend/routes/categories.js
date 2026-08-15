// routes/categories.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const {
  getCategories,
  createCategory
} = require('../controllers/categoriesController');

// All routes require authentication
router.use(authenticateToken);

router.get('/', getCategories);
router.post('/', createCategory);

module.exports = router;