// routes/mapping.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const mappingService = require('../services/mappingService');

// Get all products with their ingredients (filtered by user)
router.get('/products', authenticate, async (req, res) => {
  try {
    const { category, search } = req.query;
    const userId = req.user.id;
    
    const products = await mappingService.getProducts(userId, category, search);
    
    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
      details: error.message
    });
  }
});

// Get a single product with its ingredients
router.get('/products/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const product = await mappingService.getProductById(req.params.id, userId);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }
    
    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product',
      details: error.message
    });
  }
});

// Create a new product with ingredients
router.post('/products', authenticate, async (req, res) => {
  try {
    const { name, price, category, serving_size_label, ingredients } = req.body;
    const userId = req.user.id;
    
    if (!name || !price) {
      return res.status(400).json({
        success: false,
        error: 'Product name and price are required'
      });
    }
    
    const product = await mappingService.createProduct({
      name,
      price,
      category: category || 'Uncategorized',
      serving_size_label: serving_size_label || null,
      ingredients: ingredients || [],
      user_id: userId
    });
    
    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully'
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create product',
      details: error.message
    });
  }
});

// Update a product
router.put('/products/:id', authenticate, async (req, res) => {
  try {
    const { name, price, category, serving_size_label, is_active, ingredients } = req.body;
    const userId = req.user.id;
    
    const product = await mappingService.updateProduct(req.params.id, {
      name,
      price,
      category,
      serving_size_label,
      is_active,
      ingredients
    }, userId);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }
    
    res.json({
      success: true,
      data: product,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product',
      details: error.message
    });
  }
});

// Delete a product
router.delete('/products/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const success = await mappingService.deleteProduct(req.params.id, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete product',
      details: error.message
    });
  }
});

// Get all categories
router.get('/categories', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const categories = await mappingService.getCategories(userId);
    
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      details: error.message
    });
  }
});

module.exports = router;