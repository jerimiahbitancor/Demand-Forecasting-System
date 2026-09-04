// routes/categories.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const {
  getCategories,
  createCategory,
  updateCategory
} = require('../controllers/categoriesController');

// All routes require authentication
router.use(authenticateToken);

router.get('/', getCategories);
router.post('/', createCategory);
router.put('/:id', updateCategory);

module.exports = router;