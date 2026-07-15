// services/mappingService.js
const { supabase, isConfigured } = require('../config/supabase');

class MappingService {
  constructor() {
    console.log(`📦 MappingService: Supabase ${isConfigured ? '✅ Connected' : '❌ Using Memory Fallback'}`);
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

  // Session storage helpers
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
      console.warn('Failed to save to sessionStorage:', error);
    }
  }

  getFromSession(userId, key) {
    try {
      if (!userId || !this.isSessionStorageAvailable()) return null;
      const sessionKey = this.getSessionKey(userId, key);
      const stored = sessionStorage.getItem(sessionKey);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.warn('Failed to read from sessionStorage:', error);
      return null;
    }
  }

  clearSession(userId) {
    try {
      if (!userId || !this.isSessionStorageAvailable()) return;
      const keys = [
        'products',
        'categories',
        'totalProducts',
        'searchTerm',
        'selectedCategory',
        'sortBy',
        'currentPage'
      ];
      keys.forEach(key => {
        sessionStorage.removeItem(this.getSessionKey(userId, key));
      });
    } catch (error) {
      console.warn('Failed to clear sessionStorage:', error);
    }
  }

  async getProducts(userId, category = null, search = null, forceRefresh = false) {
    try {
      // Validate userId
      if (!this.isValidUserId(userId)) {
        console.warn('⚠️ Invalid userId provided to getProducts');
        return [];
      }

      // Try to get from sessionStorage first (unless force refresh)
      if (!forceRefresh) {
        const cached = this.getFromSession(userId, 'products');
        if (cached && Array.isArray(cached)) {
          console.log(`📦 Using cached products from sessionStorage (${cached.length} items)`);
          
          // Filter cached data if category or search is specified
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

      // Fetch from Supabase
      if (!this.isSupabaseReady()) {
        console.warn('⚠️ Supabase not ready, returning empty array');
        return [];
      }

      console.log(`🔍 Fetching products for user_id: ${userId}${forceRefresh ? ' (forced refresh)' : ''}`);

      let query = supabase
        .from('products')
        .select(`
          *,
          product_ingredients (
            quantity_per_serving,
            ingredients (
              id,
              name,
              unit
            )
          )
        `)
        .eq('user_id', userId)
        .order('name');

      if (category && category !== 'All') {
        query = query.eq('category', category);
      }

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('❌ Supabase error fetching products:', error);
        throw error;
      }

      // Save to sessionStorage
      if (data && Array.isArray(data)) {
        this.saveToSession(userId, 'products', data);
        this.saveToSession(userId, 'totalProducts', data.length);
        
        // Also save categories
        const categories = ['All', ...new Set(data.map(item => item.category).filter(Boolean))];
        this.saveToSession(userId, 'categories', categories);
      }

      console.log(`✅ Fetched ${data?.length || 0} products from database`);
      return data || [];

    } catch (error) {
      console.error('❌ Error fetching products:', error);
      throw error;
    }
  }

  async getProductById(id, userId) {
    try {
      if (!this.isValidUserId(userId)) {
        console.warn('⚠️ Invalid userId provided to getProductById');
        return null;
      }

      // Check cache first
      const cached = this.getFromSession(userId, 'products');
      if (cached && Array.isArray(cached)) {
        const found = cached.find(p => p.id === id);
        if (found) {
          console.log(`📦 Found product ${id} in cache`);
          return found;
        }
      }

      // Fetch from Supabase
      if (!this.isSupabaseReady()) {
        console.warn('⚠️ Supabase not ready');
        return null;
      }

      console.log(`🔍 Fetching product ${id} for user_id: ${userId}`);

      const { data, error } = await supabase
        .from('products')
        .select(`
          *,
          product_ingredients (
            quantity_per_serving,
            ingredients (
              id,
              name,
              unit
            )
          )
        `)
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`ℹ️ Product ${id} not found`);
          return null;
        }
        throw error;
      }

      return data;

    } catch (error) {
      console.error('❌ Error fetching product:', error);
      throw error;
    }
  }

  async createProduct(productData) {
    try {
      const userId = productData.user_id;
      
      if (!this.isValidUserId(userId)) {
        throw new Error('Valid User ID is required to create a product');
      }

      if (!this.isSupabaseReady()) {
        // Fallback: create in-memory product with ID
        const mockProduct = {
          id: Date.now(),
          ...productData,
          created_at: new Date().toISOString()
        };
        return mockProduct;
      }

      console.log(`👤 Creating product for user_id: ${userId}`);

      const insertData = {
        name: productData.name.trim(),
        price: parseFloat(productData.price),
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || null,
        is_active: true,
        user_id: userId
      };

      const { data: product, error: productError } = await supabase
        .from('products')
        .insert(insertData)
        .select()
        .single();

      if (productError) {
        console.error('❌ Error creating product:', productError);
        throw productError;
      }

      // Add ingredients if provided
      if (productData.ingredients && productData.ingredients.length > 0) {
        console.log(`📝 Adding ${productData.ingredients.length} ingredients to product ${product.id}`);
        
        for (const ingredient of productData.ingredients) {
          try {
            const ingredientId = await this.getOrCreateIngredient(
              ingredient.name,
              ingredient.unit || 'kg',
              userId
            );

            const { error: piError } = await supabase
              .from('product_ingredients')
              .insert({
                product_id: product.id,
                ingredient_id: ingredientId,
                quantity_per_serving: parseFloat(ingredient.quantity) || 1
              });

            if (piError) {
              console.error(`❌ Error adding ingredient ${ingredient.name}:`, piError);
              // Continue with other ingredients even if one fails
            }
          } catch (ingredientError) {
            console.error(`❌ Error processing ingredient ${ingredient.name}:`, ingredientError);
          }
        }
      }

      // Clear cache to force refresh
      this.clearSession(userId);

      // Fetch the complete product with ingredients
      const completeProduct = await this.getProductById(product.id, userId, true);
      return completeProduct || product;

    } catch (error) {
      console.error('❌ Error creating product:', error);
      throw error;
    }
  }

  async updateProduct(id, productData, userId) {
    try {
      if (!this.isValidUserId(userId)) {
        throw new Error('Valid User ID is required to update a product');
      }

      // Check if product exists and belongs to user
      const existingProduct = await this.getProductById(id, userId);
      if (!existingProduct) {
        console.log(`⚠️ Product ${id} not found or does not belong to user ${userId}`);
        return null;
      }

      if (!this.isSupabaseReady()) {
        // Fallback: return updated mock data
        return { ...existingProduct, ...productData };
      }

      console.log(`✏️ Updating product ${id} for user_id: ${userId}`);

      const updateData = {
        name: productData.name.trim(),
        price: parseFloat(productData.price),
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || null,
        is_active: productData.is_active !== undefined ? productData.is_active : true
      };

      const { data: product, error: productError } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (productError) {
        console.error('❌ Error updating product:', productError);
        throw productError;
      }

      // Update ingredients if provided
      if (productData.ingredients !== undefined) {
        // Validate ingredient payload before mutating DB.
        const normalizedIngredients = Array.isArray(productData.ingredients)
          ? productData.ingredients.map((ingredient) => ({
              name: ingredient.name?.trim(),
              quantity: ingredient.quantity !== undefined && ingredient.quantity !== null
                ? parseFloat(ingredient.quantity)
                : NaN,
              unit: ingredient.unit?.trim() || 'kg'
            }))
          : [];

        if (normalizedIngredients.some((ingredient) => !ingredient.name)) {
          throw new Error('All ingredients must include a name.');
        }

        if (normalizedIngredients.some((ingredient) => isNaN(ingredient.quantity) || ingredient.quantity <= 0)) {
          throw new Error('All ingredient quantities must be numbers greater than 0.');
        }

        // Delete existing ingredients
        const { error: deleteError } = await supabase
          .from('product_ingredients')
          .delete()
          .eq('product_id', id);

        if (deleteError) {
          console.error('❌ Error deleting old ingredients:', deleteError);
          throw deleteError;
        }

        // Add new ingredients
        if (normalizedIngredients.length > 0) {
          console.log(`📝 Updating ${normalizedIngredients.length} ingredients for product ${id}`);
          
          for (const ingredient of normalizedIngredients) {
            try {
              const ingredientId = await this.getOrCreateIngredient(
                ingredient.name,
                ingredient.unit,
                userId
              );

              const { error: piError } = await supabase
                .from('product_ingredients')
                .insert({
                  product_id: id,
                  ingredient_id: ingredientId,
                  quantity_per_serving: ingredient.quantity
                });

              if (piError) {
                console.error(`❌ Error adding ingredient ${ingredient.name}:`, piError);
                throw piError;
              }
            } catch (ingredientError) {
              console.error(`❌ Error processing ingredient ${ingredient.name || '[missing name]'}:`, ingredientError);
              throw ingredientError;
            }
          }
        }
      }

      // Clear cache to force refresh
      this.clearSession(userId);

      // Fetch the complete updated product
      const completeProduct = await this.getProductById(product.id, userId, true);
      return completeProduct || product;

    } catch (error) {
      console.error('❌ Error updating product:', error);
      throw error;
    }
  }

  async deleteProduct(id, userId) {
    try {
      if (!this.isValidUserId(userId)) {
        throw new Error('Valid User ID is required to delete a product');
      }

      // Check if product exists and belongs to user
      const existingProduct = await this.getProductById(id, userId);
      if (!existingProduct) {
        console.log(`⚠️ Product ${id} not found or does not belong to user ${userId}`);
        return false;
      }

      if (!this.isSupabaseReady()) {
        console.log(`ℹ️ Supabase not ready, simulating deletion of product ${id}`);
        return true;
      }

      console.log(`🗑️ Deleting product ${id} for user_id: ${userId}`);

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        console.error('❌ Error deleting product:', error);
        throw error;
      }

      // Clear cache
      this.clearSession(userId);

      console.log(`✅ Product ${id} deleted successfully`);
      return true;

    } catch (error) {
      console.error('❌ Error deleting product:', error);
      throw error;
    }
  }

  async getOrCreateIngredient(name, unit, userId) {
    try {
      if (!this.isValidUserId(userId)) {
        throw new Error('Valid User ID is required to create an ingredient');
      }

      if (!this.isSupabaseReady()) {
        // Fallback: return mock ID
        return Date.now();
      }

      // Try to find existing ingredient
      const { data, error } = await supabase
        .from('ingredients')
        .select('id')
        .ilike('name', name)
        .eq('user_id', userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        return data.id;
      }

      // Create new ingredient
      console.log(`➕ Creating new ingredient: ${name} (${unit})`);

      const insertData = {
        name: name.trim(),
        unit: unit || 'kg',
        user_id: userId
      };

      const { data: newData, error: insertError } = await supabase
        .from('ingredients')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('❌ Error creating ingredient:', insertError);
        throw insertError;
      }

      return newData.id;

    } catch (error) {
      console.error('❌ Error getting/creating ingredient:', error);
      throw error;
    }
  }

  async getCategories(userId, forceRefresh = false) {
    try {
      if (!this.isValidUserId(userId)) {
        console.warn('⚠️ Invalid userId provided to getCategories');
        return ['All'];
      }

      // Get from cache first
      if (!forceRefresh) {
        const cached = this.getFromSession(userId, 'categories');
        if (cached && Array.isArray(cached) && cached.length > 0) {
          console.log(`📦 Using cached categories from sessionStorage (${cached.length} items)`);
          return cached;
        }
      }

      // Get products to extract categories
      const products = await this.getProducts(userId, null, null, forceRefresh);
      
      if (!products || products.length === 0) {
        return ['All'];
      }

      const categories = ['All', ...new Set(products.map(item => item.category).filter(Boolean))];
      
      // Save to cache
      this.saveToSession(userId, 'categories', categories);

      console.log(`✅ Found ${categories.length} categories`);
      return categories;

    } catch (error) {
      console.error('❌ Error fetching categories:', error);
      return ['All'];
    }
  }

  // Method to get total product count from cache or database
  async getTotalProducts(userId, forceRefresh = false) {
    try {
      if (!this.isValidUserId(userId)) {
        return 0;
      }

      if (!forceRefresh) {
        const cached = this.getFromSession(userId, 'totalProducts');
        if (cached !== null && typeof cached === 'number') {
          return cached;
        }
      }

      const products = await this.getProducts(userId, null, null, forceRefresh);
      const count = products?.length || 0;
      this.saveToSession(userId, 'totalProducts', count);
      return count;

    } catch (error) {
      console.error('❌ Error getting total products:', error);
      return 0;
    }
  }
}

module.exports = new MappingService();