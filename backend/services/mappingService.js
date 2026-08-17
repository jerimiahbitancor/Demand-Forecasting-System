// services/mappingService.js
const { supabase, isConfigured, supabaseAdmin } = require('../config/supabase');

class MappingService {
  constructor() {
    console.log(`MappingService: Supabase ${isConfigured ? 'Connected' : 'Using Memory Fallback'}`);
  }

  isSupabaseReady() {
    return Boolean(isConfigured && supabase && typeof supabase.from === 'function');
  }

  isValidUserId(userId) {
    if (!userId) return false;
    if (typeof userId === 'number' && Number.isInteger(userId) && userId > 0) {
      return true;
    }
    if (typeof userId === 'string' && userId.length === 36) {
      return true;
    }
    return false;
  }

  async getNumericUserId(userId) {
    if (!userId) return null;
    
    if (typeof userId === 'number') {
      return userId;
    }
    
    if (typeof userId === 'string') {
      const num = parseInt(userId);
      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
    
    return null;
  }

  getSessionKey(userId, key) {
    return `mapping_${userId}_${key}`;
  }

  isSessionStorageAvailable() {
    return typeof sessionStorage !== 'undefined' && sessionStorage !== null;
  }

  saveToSession(userId, key, data) {
    try {
      if (!userId || !this.isSessionStorageAvailable()) return;
      const sessionKey = this.getSessionKey(userId, key);
      sessionStorage.setItem(sessionKey, JSON.stringify(data));
    } catch (error) {
      // Silently fail - sessionStorage not available in Node.js
    }
  }

  getFromSession(userId, key) {
    try {
      if (!userId || !this.isSessionStorageAvailable()) return null;
      const sessionKey = this.getSessionKey(userId, key);
      const stored = sessionStorage.getItem(sessionKey);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      return null;
    }
  }

  clearSession(userId) {
    try {
      if (!userId || !this.isSessionStorageAvailable()) return;
      const keys = [
        'products',
        'products_inactive',
        'categories_active',
        'categories_inactive',
        'totalProducts'
      ];
      keys.forEach(key => {
        sessionStorage.removeItem(this.getSessionKey(userId, key));
      });
    } catch (error) {
      // Silently fail
    }
  }

  // ============ MAIN METHODS ============

  async getProducts(userId, category = null, search = null, forceRefresh = false, status = 'active') {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        console.warn('Invalid userId provided to getProducts');
        return [];
      }

      const cacheKeys = {
        active: 'products',
        inactive: 'products_inactive'
      };
      const cacheKey = cacheKeys[status] || null;
      
      if (!forceRefresh && cacheKey) {
        const cached = this.getFromSession(numericId, cacheKey);
        if (cached && Array.isArray(cached)) {
          console.log(`Using cached products from sessionStorage (${cached.length} items, status=${status})`);
          
          let filtered = [...cached];
          if (category && category !== 'All') {
            filtered = filtered.filter(item => item.category === category);
          }
          if (search) {
            filtered = filtered.filter(item =>
              item.name.toLowerCase().includes(search.toLowerCase()) ||
              item.category?.toLowerCase().includes(search.toLowerCase())
            );
          }
          return filtered;
        }
      }

      if (!this.isSupabaseReady()) {
        console.warn('Supabase not ready, returning empty array');
        return [];
      }

      console.log(`Fetching products from products table${forceRefresh ? ' (forced refresh)' : ''}${status ? ` status=${status}` : ''}`);

      // Query from products table
      let query = supabaseAdmin.from('products')
        .select('*')
        .order('name');

      // Status filter
      if (status === 'active') {
        query = query.eq('is_active', true);
      } else if (status === 'inactive') {
        query = query.eq('is_active', false);
      }

      if (category && category !== 'All') {
        query = query.eq('category', category);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%`);
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('Supabase error fetching products:', error);
        throw error;
      }

      // Transform products data
      const transformedData = (data || []).map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        category: item.category || 'Uncategorized',
        serving_size_label: item.serving_size_label || 'serving',
        is_active: item.is_active,
        created_at: item.created_at,
        first_sold_date: item.first_sold_date,
        inactive_reason: item.inactive_reason,
        inactive_since: item.inactive_since,
        // For ingredients, we need to fetch from product_ingredients
        product_ingredients: []
      }));

      // Fetch ingredients for each product
      for (let product of transformedData) {
        const { data: ingredientsData, error: ingredientsError } = await supabaseAdmin
          .from('product_ingredients')
          .select(`
            quantity_per_serving,
            inventory_items!inner (
              id,
              name,
              unit
            )
          `)
          .eq('product_id', product.id);

        if (!ingredientsError && ingredientsData) {
          product.product_ingredients = ingredientsData.map(pi => ({
            id: pi.inventory_items?.id,
            quantity_per_serving: pi.quantity_per_serving,
            ingredients: {
              id: pi.inventory_items?.id,
              name: pi.inventory_items?.name,
              unit: pi.inventory_items?.unit
            }
          }));
        }
      }

      if (data && Array.isArray(data) && cacheKey) {
        this.saveToSession(numericId, cacheKey, transformedData);
        this.saveToSession(numericId, 'totalProducts', transformedData.length);
        
        const categories = ['All', ...new Set(transformedData.map(item => item.category).filter(Boolean))];
        this.saveToSession(numericId, 'categories', categories);
      }

      console.log(`Fetched ${transformedData.length || 0} products from database`);
      return transformedData;

    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  }

  async getProductById(id, userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        console.warn('Invalid userId provided to getProductById');
        return null;
      }

      const cached = this.getFromSession(numericId, 'products');
      if (cached && Array.isArray(cached)) {
        const found = cached.find(p => p.id === id);
        if (found) {
          console.log(`Found product ${id} in cache`);
          return found;
        }
      }

      if (!this.isSupabaseReady()) {
        console.warn('Supabase not ready');
        return null;
      }

      console.log(`Fetching product ${id} from products table`);

      const { data, error } = await supabaseAdmin.from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`Product ${id} not found`);
          return null;
        }
        throw error;
      }

      if (!data) {
        console.log(`Product ${id} not found`);
        return null;
      }

      // Transform to product format
      const transformedData = {
        id: data.id,
        name: data.name,
        price: data.price,
        category: data.category || 'Uncategorized',
        serving_size_label: data.serving_size_label || 'serving',
        is_active: data.is_active,
        created_at: data.created_at,
        first_sold_date: data.first_sold_date,
        inactive_reason: data.inactive_reason,
        inactive_since: data.inactive_since,
        product_ingredients: []
      };

      // Fetch ingredients
      const { data: ingredientsData, error: ingredientsError } = await supabaseAdmin
        .from('product_ingredients')
        .select(`
          quantity_per_serving,
          inventory_items!inner (
            id,
            name,
            unit
          )
        `)
        .eq('product_id', id);

      if (!ingredientsError && ingredientsData) {
        transformedData.product_ingredients = ingredientsData.map(pi => ({
          id: pi.inventory_items?.id,
          quantity_per_serving: pi.quantity_per_serving,
          ingredients: {
            id: pi.inventory_items?.id,
            name: pi.inventory_items?.name,
            unit: pi.inventory_items?.unit
          }
        }));
      }

      return transformedData;

    } catch (error) {
      console.error('Error fetching product:', error);
      throw error;
    }
  }

  async createProduct(productData) {
    try {
      const userId = productData.user_id;
      const numericId = await this.getNumericUserId(userId);
      
      if (!numericId) {
        throw new Error('Valid User ID is required to create a product');
      }

      if (!this.isSupabaseReady()) {
        const mockProduct = {
          id: Date.now(),
          ...productData,
          created_at: new Date().toISOString()
        };
        return mockProduct;
      }

      console.log('Creating product in products table');

      // Insert into products table
      const insertData = {
        name: productData.name.trim(),
        price: parseFloat(productData.price),
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || 'serving',
        is_active: true
      };

      const { data: product, error: productError } = await supabaseAdmin.from('products')
        .insert(insertData)
        .select()
        .maybeSingle();

      if (productError) {
        console.error('Error creating product:', productError);
        throw productError;
      }

      // Insert ingredients into product_ingredients
      if (productData.ingredients && productData.ingredients.length > 0) {
        for (const ingredient of productData.ingredients) {
          // Find the inventory item by name
          const { data: inventoryItem, error: inventoryError } = await supabaseAdmin
            .from('inventory_items')
            .select('id')
            .ilike('name', ingredient.name)
            .maybeSingle();

          if (inventoryError) {
            console.error('Error finding inventory item:', inventoryError);
            continue;
          }

          if (inventoryItem) {
            const { error: piError } = await supabaseAdmin
              .from('product_ingredients')
              .insert({
                product_id: product.id,
                ingredient_id: inventoryItem.id,
                quantity_per_serving: parseFloat(ingredient.quantity) || 1
              });

            if (piError) {
              console.error('Error adding ingredient to product:', piError);
            }
          } else {
            console.warn(`Inventory item "${ingredient.name}" not found, skipping`);
          }
        }
      }

      this.clearSession(numericId);

      const transformedData = {
        id: product.id,
        name: product.name,
        price: product.price,
        category: product.category || 'Uncategorized',
        serving_size_label: product.serving_size_label || 'serving',
        is_active: product.is_active,
        created_at: product.created_at,
        product_ingredients: []
      };

      return transformedData;

    } catch (error) {
      console.error('Error creating product:', error);
      throw error;
    }
  }

  async updateProduct(id, productData, userId) {
    try {
      console.log('Update product called with:', { id, userId });
      
      const numericId = await this.getNumericUserId(userId);
      console.log('Numeric ID resolved');
      
      if (!numericId) {
        throw new Error('Valid User ID is required to update a product');
      }

      const existingProduct = await this.getProductById(id, numericId);
      console.log('Existing product found:', existingProduct ? 'Yes' : 'No');
      
      if (!existingProduct) {
        console.log(`Product ${id} not found`);
        return null;
      }

      if (!this.isSupabaseReady()) {
        return { ...existingProduct, ...productData };
      }

      console.log(`Updating product ${id} in products table`);

      const updateData = {};
      
      if (productData.name !== undefined) updateData.name = productData.name.trim();
      if (productData.price !== undefined) updateData.price = parseFloat(productData.price);
      if (productData.category !== undefined) updateData.category = productData.category || 'Uncategorized';
      if (productData.serving_size_label !== undefined) updateData.serving_size_label = productData.serving_size_label || 'serving';
      if (productData.is_active !== undefined) updateData.is_active = productData.is_active;

      const { data: product, error: productError } = await supabaseAdmin.from('products')
        .update(updateData)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (productError) {
        console.error('Error updating product:', productError);
        throw productError;
      }

      // Update ingredients if provided
      if (productData.ingredients !== undefined) {
        // Delete existing ingredients
        await supabaseAdmin
          .from('product_ingredients')
          .delete()
          .eq('product_id', id);

        // Insert new ingredients
        for (const ingredient of productData.ingredients) {
          const { data: inventoryItem, error: inventoryError } = await supabaseAdmin
            .from('inventory_items')
            .select('id')
            .ilike('name', ingredient.name)
            .maybeSingle();

          if (inventoryError) {
            console.error('Error finding inventory item:', inventoryError);
            continue;
          }

          if (inventoryItem) {
            await supabaseAdmin
              .from('product_ingredients')
              .insert({
                product_id: id,
                ingredient_id: inventoryItem.id,
                quantity_per_serving: parseFloat(ingredient.quantity) || 1
              });
          }
        }
      }

      this.clearSession(numericId);

      const transformedData = {
        id: product.id,
        name: product.name,
        price: product.price,
        category: product.category || 'Uncategorized',
        serving_size_label: product.serving_size_label || 'serving',
        is_active: product.is_active,
        created_at: product.created_at,
        product_ingredients: []
      };

      return transformedData;

    } catch (error) {
      console.error('Error updating product:', error);
      throw error;
    }
  }

  async deleteProduct(id, userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        throw new Error('Valid User ID is required to delete a product');
      }

      const existingProduct = await this.getProductById(id, numericId);
      if (!existingProduct) {
        console.log(`Product ${id} not found`);
        return false;
      }

      if (!this.isSupabaseReady()) {
        console.log(`Supabase not ready, simulating deletion of product ${id}`);
        return true;
      }

      console.log(`Deleting product ${id} from products table`);

      // Delete ingredients first
      await supabaseAdmin
        .from('product_ingredients')
        .delete()
        .eq('product_id', id);

      // Delete product
      const { error } = await supabaseAdmin.from('products')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting product:', error);
        throw error;
      }

      this.clearSession(numericId);

      console.log(`Product ${id} deleted successfully`);
      return true;

    } catch (error) {
      console.error('Error deleting product:', error);
      throw error;
    }
  }

  async archiveProduct(id, reason, userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        throw new Error('Valid User ID is required to archive a product');
      }

      if (!reason || typeof reason !== 'string' || reason.trim() === '') {
        throw new Error('Archive reason is required');
      }

      const normalizedReason = reason.trim();

      const existingProduct = await this.getProductById(id, numericId);
      if (!existingProduct) {
        throw new Error('Product not found or does not belong to user');
      }

      if (!this.isSupabaseReady()) {
        return {
          ...existingProduct,
          is_active: false,
          inactive_reason: normalizedReason
        };
      }

      const updateData = {
        is_active: false,
        inactive_reason: normalizedReason,
        inactive_since: new Date().toISOString()
      };

      const { data: product, error } = await supabaseAdmin.from('products')
        .update(updateData)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        console.error('Error archiving product:', error);
        throw error;
      }

      this.clearSession(numericId);
      
      const transformedData = {
        id: product.id,
        name: product.name,
        is_active: false,
        inactive_reason: normalizedReason,
        inactive_since: product.inactive_since
      };
      
      return transformedData;
    } catch (error) {
      console.error('Error archiving product:', error);
      throw error;
    }
  }

  async reactivateProduct(id, userId, options = {}) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        throw new Error('Valid User ID is required to reactivate a product');
      }

      const existingProduct = await this.getProductById(id, numericId);
      if (!existingProduct) {
        throw new Error('Product not found or does not belong to user');
      }

      if (existingProduct.is_active === true) {
        return existingProduct;
      }

      if (!this.isSupabaseReady()) {
        return {
          ...existingProduct,
          is_active: true,
          inactive_reason: null,
          inactive_since: null
        };
      }

      const updateData = {
        is_active: true,
        inactive_reason: null,
        inactive_since: null
      };

      const { data: product, error } = await supabaseAdmin.from('products')
        .update(updateData)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        console.error('Error reactivating product:', error);
        throw error;
      }

      this.clearSession(numericId);
      
      const transformedData = {
        id: product.id,
        name: product.name,
        is_active: true,
        inactive_reason: null,
        inactive_since: null
      };
      
      return transformedData;
    } catch (error) {
      console.error('Error reactivating product:', error);
      throw error;
    }
  }

  getAllowedArchiveReasons() {
    return [
      'Discontinued product',
      'Seasonal item',
      'Out of stock temporarily'
    ];
  }

  async getCategories(userId, forceRefresh = false, status = 'active') {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        console.warn('Invalid userId provided to getCategories');
        return ['All'];
      }

      const cacheKey = `categories_${status || 'all'}`;
      if (!forceRefresh) {
        const cached = this.getFromSession(numericId, cacheKey);
        if (cached && Array.isArray(cached) && cached.length > 0) {
          console.log(`Using cached categories from sessionStorage (${cached.length} items, status=${status})`);
          return cached;
        }
      }

      const products = await this.getProducts(numericId, null, null, forceRefresh, status);
      
      if (!products || products.length === 0) {
        return ['All'];
      }

      const categories = ['All', ...new Set(products.map(item => item.category).filter(Boolean))];
      
      this.saveToSession(numericId, cacheKey, categories);

      console.log(`Found ${categories.length} categories for status=${status}`);
      return categories;

    } catch (error) {
      console.error('Error fetching categories:', error);
      return ['All'];
    }
  }

  async getTotalProducts(userId, forceRefresh = false) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        return 0;
      }

      if (!forceRefresh) {
        const cached = this.getFromSession(numericId, 'totalProducts');
        if (cached !== null && typeof cached === 'number') {
          return cached;
        }
      }

      const products = await this.getProducts(numericId, null, null, forceRefresh);
      const count = products?.length || 0;
      this.saveToSession(numericId, 'totalProducts', count);
      return count;

    } catch (error) {
      console.error('Error getting total products:', error);
      return 0;
    }
  }
}

module.exports = new MappingService();