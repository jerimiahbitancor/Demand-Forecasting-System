const express = require('express');
const authenticateToken = require('../middleware/auth');
const { getProductCategories, createProductCategory, updateProductCategory, deleteProductCategory } = require('../controllers/productCategoriesController');

const router = express.Router();
router.use(authenticateToken);
router.get('/', getProductCategories);
router.post('/', createProductCategory);
router.put('/:id', updateProductCategory);
router.delete('/:id', deleteProductCategory);

module.exports = router;