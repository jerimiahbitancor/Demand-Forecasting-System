// routes/mapping.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const mappingService = require('../services/mappingService');

// ============== PRODUCT ENDPOINTS ==============

/**
 * GET /api/mapping/products
 * Get all products with their ingredients (filtered by user)
 * Query params: category, search, forceRefresh
 */
router.get('/products', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { category, search, forceRefresh } = req.query;
    const userId = req.user.id;
    
    console.log(`📊 Fetching products for user: ${userId}${forceRefresh ? ' (force refresh)' : ''}`);
    
    // Force refresh parameter to bypass cache
    const force = forceRefresh === 'true';
    const products = await mappingService.getProducts(userId, category, search, force);
    
    res.json({
      success: true,
      data: products,
      count: products.length,
      fromCache: !force && products.length > 0
    });
  } catch (error) {
    console.error('❌ Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/mapping/products/:id
 * Get a single product with its ingredients
 */
router.get('/products/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    const productId = parseInt(req.params.id);
    
    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID'
      });
    }
    
    const product = await mappingService.getProductById(productId, userId);
    
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
    console.error('❌ Error fetching product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/mapping/products
 * Create a new product with ingredients
 */
router.post('/products', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { name, price, category, serving_size_label, ingredients } = req.body;
    const userId = req.user.id;
    
    // Enhanced validation
    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Product name is required'
      });
    }
    
    if (!price) {
      return res.status(400).json({
        success: false,
        error: 'Product price is required'
      });
    }
    
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Price must be a valid number greater than 0'
      });
    }
    
    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one ingredient is required'
      });
    }
    
    console.log(`📝 Creating product "${name}" for user: ${userId}`);
    
    const product = await mappingService.createProduct({
      name: name.trim(),
      price: priceNum,
      category: category?.trim() || 'Uncategorized',
      serving_size_label: serving_size_label?.trim() || null,
      ingredients: ingredients.map(ing => ({
        name: ing.name.trim(),
        quantity: parseFloat(ing.quantity) || 1,
        unit: ing.unit || 'kg'
      })),
      user_id: userId
    });
    
    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating product:', error);
    
    // Handle specific database errors
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({
        success: false,
        error: 'A product with this name already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create product',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/mapping/products/:id
 * Update a product (verifies ownership)
 */
router.put('/products/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const productId = parseInt(req.params.id);
    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID'
      });
    }

    const { name, price, category, serving_size_label, is_active, ingredients } = req.body;
    const userId = req.user.id;
    
    // Validation
    if (name !== undefined && name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Product name cannot be empty'
      });
    }
    
    if (price !== undefined) {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Price must be a valid number greater than 0'
        });
      }
    }
    
    console.log(`✏️ Updating product ${productId} for user: ${userId}`);
    
    const product = await mappingService.updateProduct(productId, {
      name: name?.trim(),
      price: price !== undefined ? parseFloat(price) : undefined,
      category: category?.trim() || 'Uncategorized',
      serving_size_label: serving_size_label?.trim() || null,
      is_active: is_active !== undefined ? is_active : true,
      ingredients: ingredients !== undefined ? ingredients.map(ing => ({
        name: ing.name.trim(),
        quantity: parseFloat(ing.quantity) || 1,
        unit: ing.unit || 'kg'
      })) : undefined
    }, userId);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found or you do not have permission'
      });
    }
    
    res.json({
      success: true,
      data: product,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating product:', error);
    
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({
        success: false,
        error: 'A product with this name already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to update product',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/mapping/products/:id
 * Delete a product (verifies ownership)
 */
router.delete('/products/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const productId = parseInt(req.params.id);
    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID'
      });
    }

    const userId = req.user.id;
    
    console.log(`🗑️ Deleting product ${productId} for user: ${userId}`);
    
    const success = await mappingService.deleteProduct(productId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Product not found or you do not have permission'
      });
    }
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete product',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============== CATEGORY ENDPOINTS ==============

/**
 * GET /api/mapping/categories
 * Get all categories (filtered by user)
 * Query params: forceRefresh
 */
router.get('/categories', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    const { forceRefresh } = req.query;
    const force = forceRefresh === 'true';
    
    console.log(`📂 Fetching categories for user: ${userId}${force ? ' (force refresh)' : ''}`);
    
    const categories = await mappingService.getCategories(userId, force);
    
    res.json({
      success: true,
      data: categories,
      count: categories.length
    });
  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============== UTILITY ENDPOINTS ==============

/**
 * GET /api/mapping/stats
 * Get product statistics for the current user
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    
    // Get all products
    const products = await mappingService.getProducts(userId);
    
    // Calculate statistics
    const stats = {
      totalProducts: products.length,
      categories: new Set(products.map(p => p.category)).size,
      totalIngredients: products.reduce((sum, p) => 
        sum + (p.product_ingredients?.length || 0), 0
      ),
      averagePrice: products.length > 0 
        ? products.reduce((sum, p) => sum + p.price, 0) / products.length 
        : 0,
      highestPrice: products.length > 0 
        ? Math.max(...products.map(p => p.price)) 
        : 0,
      lowestPrice: products.length > 0 
        ? Math.min(...products.map(p => p.price)) 
        : 0
    };
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/mapping/search
 * Search products by name or ingredient
 * Query params: q (search query)
 */
router.get('/search', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { q } = req.query;
    const userId = req.user.id;
    
    if (!q || q.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }
    
    console.log(`🔍 Searching for "${q}" for user: ${userId}`);
    
    // Get all products and filter locally (or you could add a search endpoint to your service)
    const products = await mappingService.getProducts(userId);
    
    const results = products.filter(product => 
      product.name.toLowerCase().includes(q.toLowerCase()) ||
      product.category?.toLowerCase().includes(q.toLowerCase()) ||
      product.product_ingredients?.some(pi => 
        pi.ingredients.name.toLowerCase().includes(q.toLowerCase())
      )
    );
    
    res.json({
      success: true,
      data: results,
      count: results.length,
      query: q
    });
  } catch (error) {
    console.error('❌ Error searching products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search products',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/mapping/refresh
 * Force refresh the cache for the current user
 */
router.post('/refresh', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    
    console.log(`🔄 Refreshing cache for user: ${userId}`);
    
    // Clear session cache
    mappingService.clearSession(userId);
    
    // Fetch fresh data
    const products = await mappingService.getProducts(userId, null, null, true);
    const categories = await mappingService.getCategories(userId, true);
    
    res.json({
      success: true,
      message: 'Cache refreshed successfully',
      data: {
        productCount: products.length,
        categoryCount: categories.length
      }
    });
  } catch (error) {
    console.error('❌ Error refreshing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh cache',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;