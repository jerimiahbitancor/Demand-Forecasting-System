// services/mappingService.js
const { supabase, isConfigured } = require('../config/supabase');

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
      if (userId.length === 36) {
        try {
          const { data, error } = await supabase
            .from('users')
            .select('id')
            .eq('auth_id', userId)
            .maybeSingle();
          
          if (!error && data) {
            return data.id;
          }
          return null;
        } catch (error) {
          console.error('Error getting numeric user ID:', error);
          return null;
        }
      }
    }
    
    return null;
  }

  getSessionKey(userId, key) {
    return `mapping_${userId}_${key}`;
  }

  saveToSession(userId, key, data) {
    try {
      if (!userId || typeof sessionStorage === 'undefined') return;
      const sessionKey = this.getSessionKey(userId, key);
      sessionStorage.setItem(sessionKey, JSON.stringify(data));
    } catch (error) {
      // Silently fail - sessionStorage not available in Node.js
    }
  }

  getFromSession(userId, key) {
    try {
      if (!userId || typeof sessionStorage === 'undefined') return null;
      const sessionKey = this.getSessionKey(userId, key);
      const stored = sessionStorage.getItem(sessionKey);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      return null;
    }
  }

  clearSession(userId) {
    try {
      if (!userId || typeof sessionStorage === 'undefined') return;
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
      // Silently fail
    }
  }

  async getProducts(userId, category = null, search = null, forceRefresh = false) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        console.warn('Invalid userId provided to getProducts');
        return [];
      }

      if (!forceRefresh) {
        const cached = this.getFromSession(numericId, 'products');
        if (cached && Array.isArray(cached)) {
          console.log(`Using cached products from sessionStorage (${cached.length} items)`);
          
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

      console.log(`Fetching products for user_id: ${numericId}${forceRefresh ? ' (forced refresh)' : ''}`);

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
        .eq('user_id', numericId)
        .order('name');

      if (category && category !== 'All') {
        query = query.eq('category', category);
      }

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('Supabase error fetching products:', error);
        throw error;
      }

      if (data && Array.isArray(data)) {
        this.saveToSession(numericId, 'products', data);
        this.saveToSession(numericId, 'totalProducts', data.length);
        
        const categories = ['All', ...new Set(data.map(item => item.category).filter(Boolean))];
        this.saveToSession(numericId, 'categories', categories);
      }

      console.log(`Fetched ${data?.length || 0} products from database`);
      return data || [];

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

      console.log(`Fetching product ${id} for user_id: ${numericId}`);

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
        .eq('user_id', numericId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`Product ${id} not found`);
          return null;
        }
        throw error;
      }

      return data;

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

      console.log(`Creating product for user_id: ${numericId}`);

      const insertData = {
        name: productData.name.trim(),
        price: parseFloat(productData.price),
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || null,
        is_active: true,
        user_id: numericId
      };

      const { data: product, error: productError } = await supabase
        .from('products')
        .insert(insertData)
        .select()
        .single();

      if (productError) {
        console.error('Error creating product:', productError);
        throw productError;
      }

      if (productData.ingredients && productData.ingredients.length > 0) {
        console.log(`Adding ${productData.ingredients.length} ingredients to product ${product.id}`);
        
        for (const ingredient of productData.ingredients) {
          try {
            const ingredientId = await this.getOrCreateIngredient(
              ingredient.name,
              ingredient.unit || 'kg',
              numericId
            );

            const { error: piError } = await supabase
              .from('product_ingredients')
              .insert({
                product_id: product.id,
                ingredient_id: ingredientId,
                quantity_per_serving: parseFloat(ingredient.quantity) || 1
              });

            if (piError) {
              console.error(`Error adding ingredient ${ingredient.name}:`, piError);
            }
          } catch (ingredientError) {
            console.error(`Error processing ingredient ${ingredient.name}:`, ingredientError);
          }
        }
      }

      this.clearSession(numericId);

      const completeProduct = await this.getProductById(product.id, numericId);
      return completeProduct || product;

    } catch (error) {
      console.error('Error creating product:', error);
      throw error;
    }
  }

  async updateProduct(id, productData, userId) {
    try {
      console.log('Update product called with:', { id, userId });
      
      const numericId = await this.getNumericUserId(userId);
      console.log('Numeric ID resolved to:', numericId);
      
      if (!numericId) {
        throw new Error('Valid User ID is required to update a product');
      }

      const existingProduct = await this.getProductById(id, numericId);
      console.log('Existing product found:', existingProduct ? 'Yes' : 'No');
      
      if (!existingProduct) {
        console.log(`Product ${id} not found or does not belong to user ${numericId}`);
        return null;
      }

      if (!this.isSupabaseReady()) {
        return { ...existingProduct, ...productData };
      }

      console.log(`Updating product ${id} for user_id: ${numericId}`);

      // Build update data - only include fields that exist in the table
      const updateData = {};
      
      if (productData.name !== undefined) {
        updateData.name = productData.name.trim();
      }
      if (productData.price !== undefined) {
        updateData.price = parseFloat(productData.price);
      }
      if (productData.category !== undefined) {
        updateData.category = productData.category || 'Uncategorized';
      }
      if (productData.serving_size_label !== undefined) {
        updateData.serving_size_label = productData.serving_size_label || null;
      }
      if (productData.is_active !== undefined) {
        updateData.is_active = productData.is_active;
      }

      console.log('Update data:', updateData);

      const { data: product, error: productError } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', numericId)
        .select()
        .single();

      if (productError) {
        console.error('Error updating product:', productError);
        throw productError;
      }

      // Handle ingredients update
      if (productData.ingredients !== undefined) {
        // Delete existing ingredients
        const { error: deleteError } = await supabase
          .from('product_ingredients')
          .delete()
          .eq('product_id', id);

        if (deleteError) {
          console.error('Error deleting old ingredients:', deleteError);
          throw deleteError;
        }

        // Add new ingredients
        if (productData.ingredients && productData.ingredients.length > 0) {
          console.log(`Updating ${productData.ingredients.length} ingredients for product ${id}`);
          
          for (const ingredient of productData.ingredients) {
            try {
              const ingredientId = await this.getOrCreateIngredient(
                ingredient.name,
                ingredient.unit || 'kg',
                numericId
              );

              const { error: piError } = await supabase
                .from('product_ingredients')
                .insert({
                  product_id: id,
                  ingredient_id: ingredientId,
                  quantity_per_serving: parseFloat(ingredient.quantity) || 1
                });

              if (piError) {
                console.error(`Error adding ingredient ${ingredient.name}:`, piError);
              }
            } catch (ingredientError) {
              console.error(`Error processing ingredient ${ingredient.name}:`, ingredientError);
            }
          }
        }
      }

      this.clearSession(numericId);

      const completeProduct = await this.getProductById(product.id, numericId);
      return completeProduct || product;

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
        console.log(`Product ${id} not found or does not belong to user ${numericId}`);
        return false;
      }

      if (!this.isSupabaseReady()) {
        console.log(`Supabase not ready, simulating deletion of product ${id}`);
        return true;
      }

      console.log(`Deleting product ${id} for user_id: ${numericId}`);

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)
        .eq('user_id', numericId);

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

  async getOrCreateIngredient(name, unit, userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        throw new Error('Valid User ID is required to create an ingredient');
      }

      if (!this.isSupabaseReady()) {
        return Date.now();
      }

      const { data, error } = await supabase
        .from('ingredients')
        .select('id')
        .ilike('name', name)
        .eq('user_id', numericId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        return data.id;
      }

      console.log(`Creating new ingredient: ${name} (${unit})`);

      const insertData = {
        name: name.trim(),
        unit: unit || 'kg',
        user_id: numericId
      };

      const { data: newData, error: insertError } = await supabase
        .from('ingredients')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        console.error('Error creating ingredient:', insertError);
        throw insertError;
      }

      return newData.id;

    } catch (error) {
      console.error('Error getting/creating ingredient:', error);
      throw error;
    }
  }

  async getCategories(userId, forceRefresh = false) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        console.warn('Invalid userId provided to getCategories');
        return ['All'];
      }

      if (!forceRefresh) {
        const cached = this.getFromSession(numericId, 'categories');
        if (cached && Array.isArray(cached) && cached.length > 0) {
          console.log(`Using cached categories from sessionStorage (${cached.length} items)`);
          return cached;
        }
      }

      const products = await this.getProducts(numericId, null, null, forceRefresh);
      
      if (!products || products.length === 0) {
        return ['All'];
      }

      const categories = ['All', ...new Set(products.map(item => item.category).filter(Boolean))];
      
      this.saveToSession(numericId, 'categories', categories);

      console.log(`Found ${categories.length} categories`);
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