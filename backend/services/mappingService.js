// services/mappingService.js
const { supabase, isConfigured, supabaseAdmin } = require('../config/supabase');
const { deriveProductStatus, isArchivedProduct, loadStatusInputs, statusInputsFor } = require('./productStatusService');
const { fetchAllRows } = require('../utils/fetchAllRows');
const { addAlias } = require('./productAliasService');
const { productNameKey } = require('../utils/productNameKey');
const { PRODUCT_DB_STATUS_BY_DERIVED } = require('./productStatusConstants');
const { isMissingColumnError, recipeQuantityForStorage } = require('../utils/recipeUnits');
const logger = require('../utils/logger');

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
        'products_archived',
        'products_all',
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
        inactive: 'products_inactive',
        archived: 'products_archived',
        all: 'products_all'
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

      logger.debug('products_db_fetch', { forceRefresh: Boolean(forceRefresh), status: status || null });

      // Query from products table
      let query = supabaseAdmin.from('products')
        .select('*')
        .order('name');

      // Status filter
      if (status === 'active') {
        query = query.eq('is_active', true);
      } else if (status === 'inactive') {
        query = query.eq('is_active', false);
      } else if (status === 'archived') {
        // isArchivedProduct(): status first, reason prefix as a fallback.
        query = query.or('status.eq.archived,inactive_reason.ilike.archived%');
      } else if (status === 'all') {
        // "All products" shows everything EXCEPT archived ones.
        query = query.not('status', 'eq', 'archived');
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
        // status = 'archived' first; the reason prefix only as a fallback.
        is_archived: isArchivedProduct(item),
        created_at: item.created_at,
        updated_at: item.updated_at,
        first_sold_date: item.first_sold_date,
        inactive_reason: item.inactive_reason,
        inactive_since: item.inactive_since,
        status: isArchivedProduct(item) ? 'archived' : (item.is_active ? 'active' : 'inactive'),
        status_label: isArchivedProduct(item) ? 'ARCHIVED' : (item.is_active ? 'ACTIVE' : 'INACTIVE (NEW)'),
        // For ingredients, we need to fetch from product_ingredients
        product_ingredients: []
      }));

      if (transformedData.length > 0) {
        // Same rule and inputs as the post-upload reconcile, so the list
        // shows what the next upload would store.
        const statusInputs = await loadStatusInputs(supabaseAdmin, {
          productIds: transformedData.map(product => product.id),
        });

        for (const product of transformedData) {
          const statusDetails = deriveProductStatus(statusInputsFor(product, statusInputs));
          product.status = statusDetails.status;
          product.status_label = statusDetails.label;
          product.status_note = statusDetails.note;
          product.is_archived = statusDetails.isArchived;
        }
      }

      // Fetch all product ingredients in one query instead of one query per product.
      if (transformedData.length > 0) {
        const productIds = transformedData.map(product => product.id);
        // Column ladder: migration 012 (pack) -> migration 008 (recipe unit)
        // -> oldest schema. A missing column just drops that level.
        const ingredientCols = (withPack) => (withPack
          ? 'id, name, unit, price, grams_per_cup, pack_qty, pack_unit, pack_price'
          : 'id, name, unit, price, grams_per_cup');
        const recipeSelect = (withUnit, withPack) => `
            product_id,
            quantity_per_serving,
            ${withUnit ? 'unit,' : ''}
            ingredients!inner (
              ${ingredientCols(withPack)}
            )
          `;
        let ingredientsResult = await supabaseAdmin
          .from('product_ingredients')
          .select(recipeSelect(true, true))
          .in('product_id', productIds);

        // Migration 008 adds product_ingredients.unit. Until it runs, fall
        // back to the previous schema and treat every quantity as being in
        // the ingredient's own unit.
        if (ingredientsResult.error && isMissingColumnError(ingredientsResult.error)) {
          ingredientsResult = await supabaseAdmin
            .from('product_ingredients')
            .select(recipeSelect(true, false))
            .in('product_id', productIds);
        }
        if (ingredientsResult.error && isMissingColumnError(ingredientsResult.error)) {
          ingredientsResult = await supabaseAdmin
            .from('product_ingredients')
            .select(recipeSelect(false, false))
            .in('product_id', productIds);
        }

        const { data: ingredientsData, error: ingredientsError } = ingredientsResult;

        if (!ingredientsError && ingredientsData) {
          const ingredientsByProduct = new Map();

          for (const pi of ingredientsData) {
            const productIngredients = ingredientsByProduct.get(pi.product_id) || [];
            productIngredients.push({
              id: pi.ingredients?.id,
              quantity_per_serving: pi.quantity_per_serving,
              unit: pi.unit || pi.ingredients?.unit || null,
              grams_per_cup: pi.ingredients?.grams_per_cup ?? null,
              ingredients: {
                id: pi.ingredients?.id,
                name: pi.ingredients?.name,
                unit: pi.ingredients?.unit,
                price: pi.ingredients?.price,
                grams_per_cup: pi.ingredients?.grams_per_cup ?? null,
                pack_qty: pi.ingredients?.pack_qty ?? null,
                pack_unit: pi.ingredients?.pack_unit ?? null,
                pack_price: pi.ingredients?.pack_price ?? null
              }
            });
            ingredientsByProduct.set(pi.product_id, productIngredients);
          }

          for (const product of transformedData) {
            product.product_ingredients = ingredientsByProduct.get(product.id) || [];
          }
        }
      }

      if (data && Array.isArray(data) && cacheKey) {
        this.saveToSession(numericId, cacheKey, transformedData);
        this.saveToSession(numericId, 'totalProducts', transformedData.length);
        
        const categories = ['All', ...new Set(transformedData.map(item => item.category).filter(Boolean))];
        this.saveToSession(numericId, 'categories', categories);
      }

      logger.debug('products_db_fetched', { count: transformedData.length || 0 });
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
        is_archived: isArchivedProduct(data),
        created_at: data.created_at,
        updated_at: data.updated_at,
        first_sold_date: data.first_sold_date,
        inactive_reason: data.inactive_reason,
        inactive_since: data.inactive_since,
        product_ingredients: []
      };

      // Fetch ingredients (same column ladder as getProducts: pack ->
      // recipe unit -> oldest schema).
      const ingredientCols = (withPack) => (withPack
        ? 'id, name, unit, price, grams_per_cup, pack_qty, pack_unit, pack_price'
        : 'id, name, unit, price, grams_per_cup');
      let ingredientsResult = await supabaseAdmin
        .from('product_ingredients')
        .select(`
          quantity_per_serving,
          unit,
          ingredients!inner (
            ${ingredientCols(true)}
          )
        `)
        .eq('product_id', id);

      if (ingredientsResult.error && isMissingColumnError(ingredientsResult.error)) {
        ingredientsResult = await supabaseAdmin
          .from('product_ingredients')
          .select(`
            quantity_per_serving,
            ingredients!inner (
              ${ingredientCols(true)}
            )
          `)
          .eq('product_id', id);
      }
      if (ingredientsResult.error && isMissingColumnError(ingredientsResult.error)) {
        ingredientsResult = await supabaseAdmin
          .from('product_ingredients')
          .select(`
            quantity_per_serving,
            ingredients!inner (
              ${ingredientCols(false)}
            )
          `)
          .eq('product_id', id);
      }

      const { data: ingredientsData, error: ingredientsError } = ingredientsResult;

      if (!ingredientsError && ingredientsData) {
        transformedData.product_ingredients = ingredientsData.map(pi => ({
          id: pi.ingredients?.id,
          quantity_per_serving: pi.quantity_per_serving,
          unit: pi.unit || pi.ingredients?.unit || null,
          grams_per_cup: pi.ingredients?.grams_per_cup ?? null,
          ingredients: {
            id: pi.ingredients?.id,
            name: pi.ingredients?.name,
            unit: pi.ingredients?.unit,
            price: pi.ingredients?.price,
            grams_per_cup: pi.ingredients?.grams_per_cup ?? null,
            pack_qty: pi.ingredients?.pack_qty ?? null,
            pack_unit: pi.ingredients?.pack_unit ?? null,
            pack_price: pi.ingredients?.pack_price ?? null
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

      // Insert into products table. products.is_active is a GENERATED
      // column (derived from status) — writing it directly throws
      // Postgres error 428C9. A freshly created product hasn't sold
      // anything yet, so it starts 'inactive_new', same as the column
      // default and consistent with deriveProductStatus()'s own logic.
      const insertData = {
        name: productData.name.trim(),
        price: Number.isFinite(parseFloat(productData.price)) ? parseFloat(productData.price) : 0,
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || 'serving',
        status: PRODUCT_DB_STATUS_BY_DERIVED.new
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
            .from('ingredients')
            .select('id, unit')
            .ilike('name', ingredient.name)
            .maybeSingle();

          if (inventoryError) {
            console.error('Error finding inventory item:', inventoryError);
            continue;
          }

          if (inventoryItem) {
            const piRow = {
              product_id: product.id,
              ingredient_id: inventoryItem.id,
              quantity_per_serving: recipeQuantityForStorage(String(ingredient.quantity ?? '').trim() || '1'),
              unit: (ingredient.unit && String(ingredient.unit).trim()) || inventoryItem.unit || 'kg'
            };
            let piResult = await supabaseAdmin.from('product_ingredients').insert(piRow);
            if (piResult.error && isMissingColumnError(piResult.error)) {
              const { unit, ...piRowNoUnit } = piRow;
              piResult = await supabaseAdmin.from('product_ingredients').insert(piRowNoUnit);
            }

            if (piResult.error) {
              console.error('Error adding ingredient to product:', piResult.error);
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
        updated_at: product.updated_at || product.created_at,
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
      // is_active is GENERATED from status (428C9 if written directly).
      // No caller currently sends is_active on this endpoint, but the API
      // still accepts it — map explicitly to a status instead of
      // hardcoding a bare enum string. false is mapped to
      // 'inactive_discontinued' rather than 'inactive_new': this is a
      // manual toggle on an EXISTING product, and 'new' specifically
      // means "no sales history yet", which doesn't apply here.
      if (productData.is_active !== undefined) {
        updateData.status = productData.is_active
          ? PRODUCT_DB_STATUS_BY_DERIVED.active
          : PRODUCT_DB_STATUS_BY_DERIVED.inactive;
      }

      // Always stamp updated_at so the "Last Updated" column reflects any
      // change, including ingredient-only edits (products.updated_at is
      // also updated by the update_products_updated_at trigger when the
      // column is present — stamping here makes the write deterministic).
      // If the column hasn't been added yet (migration
      // 008_add_products_updated_at.sql), PostgREST rejects the write with
      // 42703 — retry once without the stamp so edits still succeed.
      updateData.updated_at = new Date().toISOString();

      let { data: product, error: productError } = await supabaseAdmin.from('products')
        .update(updateData)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (productError && (productError.code === '42703' || productError.code === 'PGRST204')) {
        console.warn('products.updated_at column missing — retrying update without updated_at; apply migration 008_add_products_updated_at.sql');
        const retryData = { ...updateData };
        delete retryData.updated_at;
        const retry = await supabaseAdmin.from('products')
          .update(retryData)
          .eq('id', id)
          .select()
          .maybeSingle();
        product = retry.data;
        productError = retry.error;
      }

      if (productError) {
        console.error('Error updating product:', productError);
        throw productError;
      }

      // Renamed: keep the OLD name as an alias, so Loyverse files that still
      // use it match this product instead of creating a new one. Best
      // effort: the rename itself already succeeded.
      if (
        updateData.name !== undefined
        && existingProduct.name
        && productNameKey(existingProduct.name) !== productNameKey(updateData.name)
      ) {
        try {
          await addAlias(supabaseAdmin, existingProduct.name, Number(id));
        } catch (aliasError) {
          console.error('Product renamed, but its old name could not be kept as an alias:', aliasError);
        }
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
            .from('ingredients')
            .select('id, unit')
            .ilike('name', ingredient.name)
            .maybeSingle();

          if (inventoryError) {
            console.error('Error finding inventory item:', inventoryError);
            continue;
          }

          if (inventoryItem) {
            const piRow = {
              product_id: id,
              ingredient_id: inventoryItem.id,
              quantity_per_serving: recipeQuantityForStorage(String(ingredient.quantity ?? '').trim() || '1'),
              unit: (ingredient.unit && String(ingredient.unit).trim()) || inventoryItem.unit || 'kg'
            };
            let piResult = await supabaseAdmin.from('product_ingredients').insert(piRow);
            if (piResult.error && isMissingColumnError(piResult.error)) {
              const { unit, ...piRowNoUnit } = piRow;
              piResult = await supabaseAdmin.from('product_ingredients').insert(piRowNoUnit);
            }
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
        updated_at: product.updated_at,
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
      // deriveProductStatus() (productStatusService.js) — and three other
      // inline copies of the same check in this file — detect "archived"
      // purely by testing /^archived\b/i against inactive_reason. None of
      // the three reasons getAllowedArchiveReasons() actually offers
      // ('Discontinued product', 'Seasonal item', 'Out of stock
      // temporarily') match that pattern, so a product archived through
      // this endpoint with any of them was silently falling through to
      // Inactive (Discontinued) instead of Archived. Prefixing here (once,
      // at the single write path) instead of loosening the regex at every
      // read site keeps the existing detection mechanism working for old
      // rows too, e.g. the frontend's current hardcoded "Archived by user"
      // reason, which already happened to match.
      const storedReason = /^archived\b/i.test(normalizedReason)
        ? normalizedReason
        : `Archived: ${normalizedReason}`;

      const existingProduct = await this.getProductById(id, numericId);
      if (!existingProduct) {
        throw new Error('Product not found or does not belong to user');
      }

      if (!this.isSupabaseReady()) {
        return {
          ...existingProduct,
          is_active: false,
          inactive_reason: storedReason
        };
      }

      // is_active is GENERATED from status — write status instead (428C9
      // if written directly).
      const updateData = {
        status: PRODUCT_DB_STATUS_BY_DERIVED.archived,
        inactive_reason: storedReason,
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
        inactive_reason: product.inactive_reason,
        inactive_since: product.inactive_since,
        updated_at: product.updated_at
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

      // is_active is GENERATED from status — write status instead (428C9
      // if written directly).
      const updateData = {
        status: PRODUCT_DB_STATUS_BY_DERIVED.active,
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
        inactive_since: null,
        updated_at: product.updated_at
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

  // Recomputes products.status (active / new / inactive / archived) for
  // every product from real signals — first_sold_date, most recent
  // daily_sales row, and inactive_reason — using the same
  // deriveProductStatus() rule the rest of the codebase already reads
  // (productStatusService.js, imported above). This was being CALLED
  // after every upload (see routes/upload.js) but never actually
  // existed on this class, so it threw and was silently swallowed by
  // the caller's try/catch every single time — meaning products.status
  // has effectively never been updated since whatever the one-time
  // migration backfill set it to. Fixing it here, not just adding a
  // stub, since anything reading products.status (training eligibility,
  // the Product Status analytics panel, the Dashboard's "all active
  // products have recipes" check) depends on it being real.
  //
  // Products are shared business data (no user_id column — see schema),
  // so this recomputes status for ALL products; userId is accepted only
  // for call-site compatibility with the existing upload.js callers.
  async reconcileProductActivation(userId = null) {
    if (!this.isSupabaseReady()) {
      return { updated: 0 };
    }

    try {
      const { data: products, error: productsError } = await fetchAllRows(() => supabaseAdmin
        .from('products')
        .select('id, first_sold_date, created_at, is_active, inactive_reason, status')
        .order('id'));

      if (productsError) throw productsError;
      if (!products || products.length === 0) {
        return { updated: 0 };
      }

      // This runs after EVERY sales upload, for ALL products. Its inputs
      // (sales days, last real sale, confirmed-open days) come from a few
      // paged reads for every product at once — never one query per
      // product, and never the whole daily_sales table (that exhausted the
      // connection pool during a bulk backfill, Oct 1 2026).
      const statusInputs = await loadStatusInputs(supabaseAdmin);

      const updates = [];
      for (const product of products) {
        // Archived is the owner's call, not a sales rule: leave it alone,
        // even when the reason lost its "Archived" prefix.
        if (isArchivedProduct(product)) continue;
        const derived = deriveProductStatus(statusInputsFor(product, statusInputs));
        const dbStatus = PRODUCT_DB_STATUS_BY_DERIVED[derived.status];

        if (dbStatus && dbStatus !== product.status) {
          updates.push({ id: product.id, status: dbStatus });
        }
      }

      for (const update of updates) {
        const { error: updateError } = await supabaseAdmin
          .from('products')
          .update({ status: update.status })
          .eq('id', update.id);
        if (updateError) {
          console.error(`Error updating status for product ${update.id}:`, updateError);
        }
      }

      return { updated: updates.length, checked: products.length };
    } catch (error) {
      console.error('Error reconciling product activation:', error);
      throw error;
    }
  }
}

module.exports = new MappingService();