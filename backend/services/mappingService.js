// services/mappingService.js
const { supabase, isConfigured, supabaseAdmin } = require('../config/supabase');
const { deriveProductStatus } = require('./productStatusService');

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
          const { data, error } = await supabaseAdmin.from('user')
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

      console.log(`Fetching products${forceRefresh ? ' (forced refresh)' : ''}${status ? ` status=${status}` : ''}`);

      let query = supabaseAdmin.from('products')
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

      if (data && Array.isArray(data) && cacheKey) {
        this.saveToSession(numericId, cacheKey, data);
        this.saveToSession(numericId, 'totalProducts', data.length);
        
        const categories = ['All', ...new Set(data.map(item => item.category).filter(Boolean))];
        this.saveToSession(numericId, 'categories', categories);
      }

      const enrichedProducts = await this.enrichProductsWithStatus(data || [], numericId);
      const filteredByStatus = status === 'active'
        ? enrichedProducts.filter((item) => item.is_active)
        : status === 'inactive'
          ? enrichedProducts.filter((item) => !item.is_active)
          : enrichedProducts;

      console.log(`Fetched ${filteredByStatus.length || 0} products from database`);
      return filteredByStatus;

    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  }

  async enrichProductsWithStatus(products, numericId) {
    try {
      if (!Array.isArray(products) || products.length === 0) {
        return [];
      }

      if (!this.isSupabaseReady()) {
        return products.map((product) => ({
          ...product,
          is_active: Boolean(product.is_active),
          status: product.is_active ? 'active' : 'new',
          status_label: product.is_active ? 'ACTIVE' : 'INACTIVE (NEW)',
          status_reason: product.inactive_reason || 'New product detected. Forecast available after 4 weeks.'
        }));
      }

      const productIds = [...new Set(products.map((product) => product.id).filter(Boolean))];
      if (productIds.length === 0) {
        return products;
      }

      const { data: sales, error: salesError } = await supabaseAdmin.from('daily_sales')
        .select('product_id, sale_date')
        .in('product_id', productIds);

      if (salesError) {
        console.error('Error fetching sales for product status enrichment:', salesError);
        return products;
      }

      const salesByProduct = {};
      (sales || []).forEach((sale) => {
        const saleDate = new Date(sale.sale_date);
        if (!salesByProduct[sale.product_id]) {
          salesByProduct[sale.product_id] = { firstSoldDate: saleDate, lastSoldDate: saleDate };
          return;
        }

        if (saleDate < salesByProduct[sale.product_id].firstSoldDate) {
          salesByProduct[sale.product_id].firstSoldDate = saleDate;
        }
        if (saleDate > salesByProduct[sale.product_id].lastSoldDate) {
          salesByProduct[sale.product_id].lastSoldDate = saleDate;
        }
      });

      return products.map((product) => {
        const status = deriveProductStatus({
          firstSoldDate: salesByProduct[product.id]?.firstSoldDate || product.first_sold_date || null,
          lastSoldDate: salesByProduct[product.id]?.lastSoldDate || null,
          createdAt: product.created_at || null,
          isActive: Boolean(product.is_active)
        });

        return {
          ...product,
          is_active: status.isActive,
          status: status.status,
          status_label: status.label,
          status_reason: status.note || product.inactive_reason || '',
          inactive_reason: status.note || product.inactive_reason || null,
          inactive_since: product.inactive_since || null
        };
      });
    } catch (error) {
      console.error('Error enriching products with status:', error);
      return products;
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

      console.log(`Fetching product ${id}`);

      const { data, error } = await supabaseAdmin.from('products')
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
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`Product ${id} not found`);
          return null;
        }
        throw error;
      }

      const [enrichedProduct] = await this.enrichProductsWithStatus([data], numericId);
      return enrichedProduct || data;

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

      console.log('Creating product');

      const insertData = {
        name: productData.name.trim(),
        price: parseFloat(productData.price),
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || null,
        is_active: false,
        inactive_reason: 'New product detected. Forecast available after 4 weeks.',
        inactive_since: this.formatDate(new Date())
      };

      const { data: product, error: productError } = await supabaseAdmin.from('products')
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

            const { error: piError } = await supabaseAdmin.from('product_ingredients')
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
        // Fallback: return updated mock data
        return { ...existingProduct, ...productData };
      }

      console.log(`Updating product ${id}`);

      const updateData = {};
      if (productData.name !== undefined) updateData.name = productData.name.trim();
      if (productData.price !== undefined) updateData.price = parseFloat(productData.price);
      if (productData.category !== undefined) updateData.category = productData.category || 'Uncategorized';
      if (productData.serving_size_label !== undefined) updateData.serving_size_label = productData.serving_size_label || null;
      if (productData.is_active !== undefined && productData.is_active === false) {
        updateData.is_active = false;
        updateData.inactive_reason = existingProduct.inactive_reason || 'New product detected. Forecast available after 4 weeks.';
        updateData.inactive_since = existingProduct.inactive_since || this.formatDate(new Date());
      } else {
        updateData.is_active = existingProduct.is_active;
      }

      const { data: product, error: productError } = await supabaseAdmin.from('products')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (productError) {
        console.error('Error updating product:', productError);
        throw productError;
      }

      // Handle ingredients update
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
        const { error: deleteError } = await supabaseAdmin.from('product_ingredients')
          .delete()
          .eq('product_id', id);

        if (deleteError) {
          console.error('Error deleting old ingredients:', deleteError);
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

              const { error: piError } = await supabaseAdmin.from('product_ingredients')
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
        console.log(`Product ${id} not found`);
        return false;
      }

      if (!this.isSupabaseReady()) {
        console.log(`Supabase not ready, simulating deletion of product ${id}`);
        return true;
      }

      console.log(`Deleting product ${id}`);

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

  async getOrCreateIngredient(name, unit, userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        throw new Error('Valid User ID is required to create an ingredient');
      }

      if (!this.isSupabaseReady()) {
        return Date.now();
      }

      const { data, error } = await supabaseAdmin.from('ingredients')
        .select('id')
        .ilike('name', name)
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
        unit: unit || 'kg'
      };

      const { data: newData, error: insertError } = await supabaseAdmin.from('ingredients')
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

  getAllowedArchiveReasons() {
    return [
      'Discontinued',
      'Seasonal',
      'Out of stock temporarily'
    ];
  }

  getSystemStaleReasons() {
    return [
      'No sales for 28 days',
      'No sales yet'
    ];
  }

  formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  }

  async evaluateNewMenuProduct(productId, userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        throw new Error('Valid User ID is required for product evaluation');
      }

      const product = await this.getProductById(productId, numericId);
      if (!product) {
        return null;
      }

      if (product.first_sold_date) {
        return product;
      }

      const { data, error } = await supabaseAdmin.from('daily_sales')
        .select('sale_date')
        .eq('product_id', productId)
        .order('sale_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data && data.sale_date) {
        const firstSoldDate = this.formatDate(data.sale_date);
        const { data: updated, error: updateError } = await supabaseAdmin.from('products')
          .update({ first_sold_date: firstSoldDate })
          .eq('id', productId)
          .select()
          .single();

        if (updateError) {
          console.error('Error updating first_sold_date:', updateError);
          throw updateError;
        }

        this.clearSession(numericId);
        return updated;
      }

      return product;
    } catch (error) {
      console.error('Error evaluating new menu product:', error);
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
      const allowedReasons = this.getAllowedArchiveReasons();
      if (!allowedReasons.includes(normalizedReason)) {
        throw new Error(`Invalid archive reason. Allowed reasons: ${allowedReasons.join(', ')}`);
      }

      const existingProduct = await this.getProductById(id, numericId);
      if (!existingProduct) {
        throw new Error('Product not found or does not belong to user');
      }

      if (!this.isSupabaseReady()) {
        return {
          ...existingProduct,
          is_active: false,
          inactive_reason: normalizedReason,
          inactive_since: this.formatDate(new Date())
        };
      }

      const updateData = {
        is_active: false,
        inactive_reason: normalizedReason,
        inactive_since: this.formatDate(new Date())
      };

      const { data: product, error } = await supabaseAdmin.from('products')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error archiving product:', error);
        throw error;
      }

      this.clearSession(numericId);
      return product;
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

      if (existingProduct.is_active) {
        return existingProduct;
      }

      const manualReasons = this.getAllowedArchiveReasons();
      const reason = existingProduct.inactive_reason;

      if (reason === 'Discontinued' && !options.forceReactivate) {
        throw new Error('Discontinued products require explicit confirmation to reactivate. Set forceReactivate=true to proceed.');
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
        .single();

      if (error) {
        console.error('Error reactivating product:', error);
        throw error;
      }

      await this.evaluateNewMenuProduct(id, numericId);
      this.clearSession(numericId);
      return product;
    } catch (error) {
      console.error('Error reactivating product:', error);
      throw error;
    }
  }

  async reconcileProductActivation(userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        console.warn('Cannot reconcile product activation without a valid user ID');
        return { reconciled: false, message: 'Missing user ID' };
      }

      if (!this.isSupabaseReady()) {
        console.warn('Supabase not ready; skipping product activation reconciliation');
        return { reconciled: false, message: 'Supabase unavailable' };
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 28);
      const cutoffIso = this.formatDate(cutoffDate);

      const { data: products, error: productsError } = await supabaseAdmin.from('products')
        .select('id, name, created_at, is_active, inactive_reason, inactive_since, first_sold_date');

      if (productsError) {
        console.error('Error fetching products for reconciliation:', productsError);
        throw productsError;
      }

      if (!products || products.length === 0) {
        return { reconciled: true, updated: 0, reactivated: 0, archived: 0 };
      }

      const productIds = products.map((product) => product.id);
      const { data: sales, error: salesError } = await supabaseAdmin.from('daily_sales')
        .select('product_id, sale_date')
        .in('product_id', productIds);

      if (salesError) {
        console.error('Error fetching sales for product reconciliation:', salesError);
        throw salesError;
      }

      const salesByProduct = {};
      (sales || []).forEach((sale) => {
        const saleDate = new Date(sale.sale_date);
        const productId = sale.product_id;

        if (!salesByProduct[productId]) {
          salesByProduct[productId] = {
            lastSale: saleDate,
            firstSale: saleDate
          };
          return;
        }

        if (saleDate > salesByProduct[productId].lastSale) {
          salesByProduct[productId].lastSale = saleDate;
        }
        if (saleDate < salesByProduct[productId].firstSale) {
          salesByProduct[productId].firstSale = saleDate;
        }
      });

      let updatedCount = 0;
      let reactivatedCount = 0;
      let archivedCount = 0;
      let otherUpdatedCount = 0;

      for (const product of products) {
        const salesEntry = salesByProduct[product.id];
        const lastSale = salesEntry?.lastSale || null;
        const firstSale = salesEntry?.firstSale || null;
        const createdAt = product.created_at ? new Date(product.created_at) : null;
        const isActive = product.is_active;
        const reason = product.inactive_reason;
        const isSystemStale = this.getSystemStaleReasons().includes(reason);
        const updateData = {};

        if (!product.first_sold_date && firstSale) {
          updateData.first_sold_date = this.formatDate(firstSale);
        }

        if (isActive) {
          if (lastSale && lastSale < cutoffDate) {
            updateData.is_active = false;
            updateData.inactive_reason = 'No sales for 28 days';
            updateData.inactive_since = this.formatDate(lastSale);
          } else if (!lastSale && createdAt && createdAt < cutoffDate) {
            updateData.is_active = false;
            updateData.inactive_reason = 'No sales yet';
            updateData.inactive_since = this.formatDate(createdAt);
          }
        } else if (isSystemStale) {
          if (lastSale && lastSale >= cutoffDate) {
            updateData.is_active = true;
            updateData.inactive_reason = null;
            updateData.inactive_since = null;
          }
        }

        if (Object.keys(updateData).length > 0) {
          const { data: updatedProduct, error: updateError } = await supabaseAdmin.from('products')
            .update(updateData)
            .eq('id', product.id)
            .select()
            .single();

          if (updateError) {
            console.error(`Error updating product ${product.id} during reconciliation:`, updateError);
            continue;
          }

          if (updatedProduct) {
            if (updateData.is_active === true && !isActive) {
              reactivatedCount += 1;
              console.log(`Reactivated product ${product.id} (${product.name}) after recent sales`);
            } else if (updateData.is_active === false && isActive) {
              archivedCount += 1;
              console.log(`Archived product ${product.id} (${product.name}) due to stale sales`);
            } else {
              otherUpdatedCount += 1;
              console.log(`Updated product ${product.id} (${product.name}) during reconciliation`);
            }
          }
        }
      }

      if (archivedCount > 0 || reactivatedCount > 0 || otherUpdatedCount > 0) {
        this.clearSession(numericId);
      }

      return {
        reconciled: true,
        updated: archivedCount + otherUpdatedCount,
        reactivated: reactivatedCount,
        archived: archivedCount
      };
    } catch (error) {
      console.error('Error reconciling product activation:', error);
      throw error;
    }
  }

  async validateForecastEligibility(userId, productIds = null) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        return { activeProducts: [], missingMappings: [], errors: ['User not found'] };
      }

      const products = await this.getProducts(userId, null, null, true, 'active');
      const selectedProducts = productIds && productIds.length > 0
        ? products.filter((product) => productIds.includes(product.id))
        : products;

      const missingMappings = selectedProducts.filter((product) => !product.product_ingredients || product.product_ingredients.length === 0);
      const errors = missingMappings.length > 0
        ? ['Ingredient mapping missing']
        : [];

      return {
        activeProducts: selectedProducts,
        missingMappings,
        errors
      };
    } catch (error) {
      console.error('Error validating forecast eligibility:', error);
      throw error;
    }
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