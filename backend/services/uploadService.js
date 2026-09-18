// services/uploadService.js
const { supabase, isConfigured, supabaseAdmin } = require('../config/supabase');
const mappingService = require('./mappingService');
const mlService = require('./mlService');
const { deriveProductStatus } = require('./productStatusService');
const { PRODUCT_STATUS_NOTES, PRODUCT_DB_STATUS_BY_DERIVED } = require('./productStatusConstants');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';
const { normalizeRecipeQuantityToUnit, pieceWeightOf, isMissingColumnError } = require('../utils/recipeUnits');

class UploadService {
  constructor() {
    this.memoryStore = {
      uploads: [],
      products: []
    };
    this.processingUploads = new Set();
    console.log(`UploadService: Supabase ${isConfigured ? 'Connected' : 'Using Memory Fallback'}`);
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
    
    if (typeof userId === 'string' && userId.length === 36) {
      try {
        const { data, error } = await supabaseAdmin
          .from('user')
          .select('id')
          .eq('auth_id', userId)
          .maybeSingle();
        
        if (!error && data) {
          console.log('Found user in custom table with ID:', data.id);
          return data.id;
        }
        
        console.log('User not found in custom table for auth_id:', userId);
        return null;
      } catch (error) {
        console.error('Error getting numeric user ID:', error);
        return null;
      }
    }
    
    return null;
  }

  getProcessingKey(filename, userId) {
    return `${userId}-${filename}`;
  }

  isUploadProcessing(filename, userId) {
    const key = this.getProcessingKey(filename, userId);
    return this.processingUploads.has(key);
  }

  markUploadProcessing(filename, userId) {
    const key = this.getProcessingKey(filename, userId);
    this.processingUploads.add(key);
    console.log(`Marked as processing: ${key}`);
  }

  markUploadComplete(filename, userId) {
    const key = this.getProcessingKey(filename, userId);
    this.processingUploads.delete(key);
    console.log(`Marked as complete: ${key}`);
  }

  clearProcessing(filename, userId) {
    const key = this.getProcessingKey(filename, userId);
    this.processingUploads.delete(key);
    console.log(`Cleared processing: ${key}`);
  }

  // uploads.upload_date is `timestamp without time zone` — Postgres
  // stores whatever local date/time digits it's given and ignores any
  // zone marker on the input. The old version of this method added 8h
  // to the real UTC instant and then called .toISOString(), which
  // happened to produce the right PH wall-clock digits followed by a
  // "Z" — technically correct only because that trailing "Z" then gets
  // silently discarded by the column type. That's an accident waiting
  // to break (e.g. if this string is ever read back with a UTC-aware
  // parser, or the column type changes). Building the string explicitly
  // in Asia/Manila with no zone suffix says what it means instead of
  // relying on that coincidence.
  getCurrentDatePhilippines() {
    return dayjs().tz(PH_TZ).format('YYYY-MM-DDTHH:mm:ss.SSS');
  }

  getCurrentDatePhilippinesDisplay() {
    const now = new Date();
    const options = {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };
    return now.toLocaleString('en-PH', options);
  }

  extractDateFromFilename(filename) {
    try {
      const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
      
      const dateMatch = nameWithoutExt.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const date = new Date(dateMatch[1]);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
      
      const altMatch = nameWithoutExt.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (altMatch) {
        const month = altMatch[1].padStart(2, '0');
        const day = altMatch[2].padStart(2, '0');
        const year = altMatch[3];
        const date = new Date(`${year}-${month}-${day}`);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      const yearMonthMatch = nameWithoutExt.match(/(?:^|[^0-9])(\d{4})[-_](0?[1-9]|1[0-2])(?:[^0-9]|$)/);
      if (yearMonthMatch) {
        return new Date(`${yearMonthMatch[1]}-${yearMonthMatch[2].padStart(2, '0')}-01`).toISOString();
      }

      const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december';
      const monthYearMatch = nameWithoutExt.match(new RegExp(`(${monthNames})[^0-9]*(\\d{4})`, 'i'))
        || nameWithoutExt.match(new RegExp(`(\\d{4})[^a-zA-Z]+(${monthNames})`, 'i'));
      if (monthYearMatch) {
        const year = /^\d{4}$/.test(monthYearMatch[1]) ? monthYearMatch[1] : monthYearMatch[2];
        const monthName = /^\d{4}$/.test(monthYearMatch[1]) ? monthYearMatch[2] : monthYearMatch[1];
        const month = monthNames.split('|').indexOf(monthName.toLowerCase()) + 1;
        return new Date(`${year}-${String(month).padStart(2, '0')}-01`).toISOString();
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting date from filename:', error);
      return null;
    }
  }

  async checkDuplicateUpload(filename, userId) {
    try {
      const numericId = await this.getNumericUserId(userId);
      if (!numericId) {
        return false;
      }

      if (!this.isSupabaseReady()) {
        // Only a genuinely-completed upload should block a retry — a row
        // left at 'pending' or 'failed' by a pipeline that threw partway
        // through was never actually saved, so it shouldn't count.
        const existing = this.memoryStore.uploads.find(
          u => u.filename === filename && u.user_id === numericId && u.status === 'processed'
        );
        return !!existing;
      }

      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      const { data, error } = await supabaseAdmin.from('uploads')
        .select('id, filename, upload_date')
        .eq('filename', filename)
        .eq('user_id', numericId)
        .eq('status', 'processed')
        .gte('upload_date', oneHourAgo.toISOString())
        .limit(1);

      if (error) {
        console.error('Error checking duplicate:', error);
        return false;
      }

      return data && data.length > 0;
    } catch (error) {
      console.error('Error checking duplicate upload:', error);
      return false;
    }
  }

  normalizeColumnName(name) {
    if (!name) return '';
    let normalized = name.toString().trim().replace(/\s+/g, ' ');
    
    const mappings = {
      'item name': 'Item name',
      'category': 'Category',
      'items sold': 'Items sold',
      'gross sales': 'Gross sales',
      'items refunded': 'Items refunded',
      'refunds': 'Refunds',
      'net sales': 'Net sales'
    };
    
    const lowerKey = normalized.toLowerCase();
    return mappings[lowerKey] || normalized;
  }

  getColumnValueByNames(row, names = []) {
    if (!row || typeof row !== 'object') return null;

    const headers = Object.keys(row);
    for (const name of names) {
      const found = headers.find((header) => header?.toLowerCase().trim() === name.toLowerCase().trim());
      if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') {
        return row[found];
      }
    }
    return null;
  }

  getSaleDateValue(row, fallbackDate) {
    const dateColumns = ['Date', 'Sale Date', 'Sale date', 'Date sold', 'Transaction date', 'Order date', 'Invoice date'];
    const rawValue = this.getColumnValueByNames(row, dateColumns);
    if (!rawValue) return fallbackDate;

    const parsedDate = new Date(rawValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return fallbackDate;
    }

    return parsedDate.toISOString().slice(0, 10);
  }

  normalizeProductName(value) {
    if (value === null || value === undefined) {
      return '';
    }

    return String(value)
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*[-–—]\s*/g, ' ');
  }

  extractUniqueProductNames(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const productNames = [];
    const seen = new Set();

    for (const row of rows) {
      const productName = this.normalizeProductName(
        this.getColumnValueByNames(row, ['Item name', 'Item Name', 'Product', 'Product name'])
      );

      if (!productName) {
        continue;
      }

      const key = productName.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      productNames.push(productName);
    }

    return productNames;
  }

  async syncProductsFromSales(productNames = [], userId = null) {
    try {
      const normalizedProducts = Array.isArray(productNames)
        ? productNames
            .map((name) => this.normalizeProductName(name))
            .filter((name) => name && name.length > 0)
        : [];

      const uniqueProducts = [...new Map(
        normalizedProducts.map((name) => [name.toLowerCase(), name])
      ).values()];

      if (uniqueProducts.length === 0) {
        return {
          success: true,
          created: [],
          existing: [],
          createdCount: 0,
          existingCount: 0,
          warnings: []
        };
      }

      const numericId = userId ? await this.getNumericUserId(userId) : null;
      if (!numericId || !this.isSupabaseReady()) {
        return {
          success: true,
          created: [],
          existing: uniqueProducts,
          createdCount: 0,
          existingCount: uniqueProducts.length,
          warnings: ['Product sync deferred because Supabase is unavailable.']
        };
      }

      const { data: existingProducts, error: fetchError } = await supabaseAdmin
        .from('products')
        .select('id, name');

      if (fetchError) {
        throw fetchError;
      }

      const existingByName = new Map(
        (existingProducts || []).map((product) => [String(product.name).trim().toLowerCase(), product])
      );

      const created = [];
      const existing = [];

      for (const productName of uniqueProducts) {
        const key = productName.trim().toLowerCase();
        console.log('[PRODUCT DISCOVERY] Checking product:', JSON.stringify(productName));
        if (existingByName.has(key)) {
          console.log('[PRODUCT DISCOVERY] Existing:', true, JSON.stringify(existingByName.get(key)));
          existing.push(productName);
          continue;
        }

        console.log('[PRODUCT DISCOVERY] Existing:', false);
        console.log('[PRODUCT DISCOVERY] Creating product:', JSON.stringify(productName));

        // INSERT ... ON CONFLICT (name) DO NOTHING, not mappingService
        // .createProduct() wrapped in try/catch for a 23505. Several
        // files upload concurrently (UPLOAD_CONCURRENCY in
        // UploadData.jsx), each running its own syncProductsFromSales —
        // two files can both see the same new product name as "not yet
        // existing" in their own `existingByName` snapshot above (taken
        // at the top of this call) and race to create it. That's not a
        // bug, just an inherent TOCTOU gap in "check, then create" under
        // concurrency — but a plain insert makes the race's loser throw a
        // real exception that then has to be caught and logged as an
        // "Error creating product" console.error, which reads like a
        // real failure even though the outcome (the product exists,
        // exactly once, name still unique) is completely correct. ON
        // CONFLICT DO NOTHING lets Postgres resolve the race silently:
        // the loser's statement just returns no row instead of throwing.
        // (mappingService.createProduct() is intentionally NOT reused
        // here — its throw-on-duplicate behavior is exactly right for a
        // person manually adding a product from the UI, just not for
        // this auto-discovery path.)
        const { data: insertedProduct, error: insertError } = await supabaseAdmin
          .from('products')
          .upsert(
            {
              name: productName,
              price: 0,
              category: 'Uncategorized',
              serving_size_label: 'serving',
              status: PRODUCT_DB_STATUS_BY_DERIVED.new
            },
            { onConflict: 'name', ignoreDuplicates: true }
          )
          .select('id, name, price, category, is_active, created_at')
          .maybeSingle();

        if (insertError) {
          throw insertError;
        }

        if (insertedProduct) {
          console.log('[PRODUCT DISCOVERY] Created product:', JSON.stringify(insertedProduct, null, 2));
          created.push(productName);
          existingByName.set(productName.trim().toLowerCase(), insertedProduct);
          mappingService.clearSession(numericId);
        } else {
          // Conflict resolved by ON CONFLICT DO NOTHING — this name
          // already exists (most likely created moments ago by a
          // concurrent request processing another file in this batch).
          console.log('[PRODUCT DISCOVERY] Already created by a concurrent request:', JSON.stringify(productName));
          existing.push(productName);
        }
      }

      return {
        success: true,
        created,
        existing,
        createdCount: created.length,
        existingCount: existing.length,
        warnings: []
      };
    } catch (error) {
      console.error('Error syncing products from sales data:', error);
      throw error;
    }
  }

  async processSalesData(rows = [], userId = null, uploadId = null, filename = null) {
    try {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { productsDetected: 0, productsUpdated: 0, warnings: [] };
      }

      const numericId = userId ? await this.getNumericUserId(userId) : null;
      if (!numericId || !this.isSupabaseReady()) {
        return { productsDetected: 0, productsUpdated: 0, warnings: [] };
      }

      const fallbackDate = this.extractDateFromFilename(filename) || new Date().toISOString().slice(0, 10);
      const productIds = new Set();
      const productIdByName = new Map();
      const categoryByProductId = new Map();
      const warnings = [];
      let productsDetected = 0;

      const uniqueSalesProductNames = this.extractUniqueProductNames(rows);
      if (uniqueSalesProductNames.length > 0) {
        const syncSummary = await this.syncProductsFromSales(uniqueSalesProductNames, numericId);
        if (Array.isArray(syncSummary.created) && syncSummary.created.length > 0) {
          productsDetected += syncSummary.created.length;
        }
      }

      const { data: products, error: productsError } = await supabaseAdmin
        .from('products')
        .select('id, name, created_at, first_sold_date, is_active, inactive_reason, inactive_since, category');

      if (productsError) {
        throw productsError;
      }

      const currentCategoryByProductId = new Map();
      for (const product of products || []) {
        productIdByName.set(String(product.name).trim().toLowerCase(), product.id);
        currentCategoryByProductId.set(product.id, product.category);
      }

      // Keyed by `${productId}|${saleDate}`, not just pushed one entry per
      // CSV row. daily_sales is UNIQUE on (product_id, sale_date), but a
      // single day's export can legitimately list the same product on more
      // than one row — e.g. an add-on/modifier item split across two
      // category rows, or a product whose category changed mid-period so
      // Loyverse's per-category grouping emits it twice. Pushing one insert
      // row per CSV row in that case makes the whole batch INSERT fail with
      // a Postgres 23505 the moment two rows collide — not because of any
      // earlier upload, but because of duplicate rows within this exact
      // file, on every single attempt. Summing quantity_sold for matching
      // (product_id, sale_date) pairs before the insert fixes that: it
      // mirrors how Loyverse's own "Items sold" figure is already a net
      // aggregate, not a per-line-item count.
      const dailySalesByKey = new Map();
      for (const row of rows) {
        const rawProductName = this.getColumnValueByNames(row, ['Item name', 'Item Name', 'Product', 'Product name']);
        const productName = this.normalizeProductName(rawProductName);
        if (!productName) {
          continue;
        }

        const productNameKey = productName.toLowerCase();
        const productId = productIdByName.get(productNameKey);
        if (!productId) {
          continue;
        }

        const quantity = parseFloat(this.getColumnValueByNames(row, ['Items sold', 'Items Sold', 'Quantity', 'Units sold']) || 0);
        const category = this.getColumnValueByNames(row, ['Category', 'Category Name'])?.toString()?.trim() || 'Uncategorized';
        const saleDate = this.getSaleDateValue(row, fallbackDate);
        // A missing/blank/non-numeric "Items sold" value must become a
        // real 0, never a fabricated 1 — the ML pipeline treats an
        // explicit zero-quantity row as legitimate "sold nothing that
        // day" signal (see feature_engineering.py's closed-day docstring).
        // Silently inventing a sale of 1 here would corrupt training data.
        const normalizedQuantity = Number.isFinite(quantity) ? Math.max(0, Math.round(quantity)) : 0;

        const key = `${productId}|${saleDate}`;
        const existingRow = dailySalesByKey.get(key);
        if (existingRow) {
          existingRow.quantity_sold += normalizedQuantity;
        } else {
          dailySalesByKey.set(key, {
            product_id: productId,
            sale_date: saleDate,
            quantity_sold: normalizedQuantity,
            upload_id: uploadId || null
          });
        }

        if (!categoryByProductId.has(productId)) {
          categoryByProductId.set(productId, category);
        }
        productIds.add(productId);
      }

      const dailySalesRows = [...dailySalesByKey.values()];

      if (dailySalesRows.length > 0) {
        const { error: saleInsertError } = await supabaseAdmin
          .from('daily_sales')
          .insert(dailySalesRows);

        if (saleInsertError) {
          throw saleInsertError;
        }
      }

      // Everything from here on is best-effort. daily_sales already has
      // this file's rows safely committed at this point — that's the part
      // that actually matters for training data, and it's what
      // checkDuplicateUpload/the unique constraint protect. If anything
      // below throws (a stale product_ingredients row pointing at a
      // deleted ingredient, a transient Supabase hiccup, etc.), the OLD
      // behavior let it propagate all the way up to routes/upload.js's
      // catch, which marks the whole upload 'failed' — even though the
      // sales data is already in. A retry of the exact same file would
      // then hit a false "duplicate" 23505 on data that's already
      // correctly there, with no way to actually finish the upload. So
      // category backfill, stock deduction, and status reconciliation are
      // now caught here and turned into warnings instead of aborting the
      // whole request.
      let productsUpdated = 0;
      try {
        // Skip products that don't need a change (still in memory from the
        // `products` fetch above, no extra query) — was one UPDATE per
        // product every upload even when category was already set.
        //
        // This used to be a single batched .upsert(rows, {onConflict:
        // 'id'}) instead of a per-row loop — faster, but wrong tool: under
        // concurrent uploads (several files in the same UPLOAD_CONCURRENCY
        // batch touching overlapping products), that upsert was observed
        // to occasionally take the INSERT branch instead of UPDATE for a
        // product id that demonstrably already existed — id=1459 ("Add
        // Chili") failed with "null value in column name violates
        // not-null constraint" moments after being confirmed to exist in
        // the same request. Since this list only ever contains ids for
        // rows already confirmed to exist (currentCategoryByProductId
        // comes from the same fetch as productIdByName), a plain .update()
        // is both correct and structurally unable to insert a bad stub
        // row the way upsert's conflict path apparently could here.
        for (const [productId, category] of categoryByProductId) {
          const normalizedCategory = category || 'Uncategorized';
          const currentCategory = currentCategoryByProductId.get(productId);
          if (currentCategory === 'Uncategorized' && normalizedCategory !== 'Uncategorized') {
            const { error: categoryUpdateError } = await supabaseAdmin
              .from('products')
              .update({ category: normalizedCategory })
              .eq('id', productId);

            if (categoryUpdateError) {
              throw categoryUpdateError;
            }
          }
        }

        const selectedProductIds = [...productIds];
        if (selectedProductIds.length === 0) {
          return { productsDetected, productsUpdated: 0, warnings };
        }

        const { data: productRows, error: productFetchError } = await supabaseAdmin.from('products')
          .select('id, created_at, first_sold_date, is_active, inactive_reason, inactive_since, status')
          .in('id', selectedProductIds);
        const { data: salesRows, error: salesFetchError } = await supabaseAdmin.from('daily_sales')
          .select('product_id, sale_date')
          .in('product_id', selectedProductIds)
          .order('sale_date', { ascending: true });

        if (productFetchError || salesFetchError) {
          throw productFetchError || salesFetchError;
        }

      // Only active products with a mapped recipe deduct stock automatically.
      const activeProductIds = new Set(
        (productRows || []).filter((product) => product.is_active === true).map((product) => product.id)
      );
      if (activeProductIds.size > 0) {
        let recipeResult = await supabaseAdmin
          .from('product_ingredients')
          .select('product_id, ingredient_id, quantity_per_serving, unit, ingredients!inner(name, unit, grams_per_cup)')
          .in('product_id', [...activeProductIds]);

          if (recipeResult.error && isMissingColumnError(recipeResult.error)) {
            recipeResult = await supabaseAdmin
              .from('product_ingredients')
              .select('product_id, ingredient_id, quantity_per_serving, ingredients!inner(name, unit, grams_per_cup)')
              .in('product_id', [...activeProductIds]);
          }

          const { data: recipeRows, error: recipeError } = recipeResult;
          if (recipeError) throw recipeError;

          const deductions = new Map();
          for (const sale of dailySalesRows) {
            if (!activeProductIds.has(sale.product_id)) continue;
            for (const recipe of (recipeRows || []).filter((row) => row.product_id === sale.product_id)) {
              const ingredientUnit = recipe.ingredients?.unit || recipe.unit || null;
              const perServing = normalizeRecipeQuantityToUnit(
                recipe.quantity_per_serving,
                recipe.unit,
                ingredientUnit,
                recipe.ingredients?.grams_per_cup,
                pieceWeightOf(recipe.ingredients?.name, recipe.unit)
              );
              const amount = Number(perServing) * Number(sale.quantity_sold);
              if (!Number.isFinite(amount) || amount <= 0) continue;
              deductions.set(recipe.ingredient_id, (deductions.get(recipe.ingredient_id) || 0) + amount);
            }
          }

          for (const [ingredientId, deduction] of deductions) {
            // Was SELECT quantity, then compute new = max(0, old - deduction)
            // in JS, then UPDATE — two round trips wide open to a lost
            // update: two concurrent uploads deducting the same ingredient
            // can both read the same starting quantity before either write
            // lands, so the second UPDATE clobbers the first instead of
            // stacking. deduct_ingredient_stock() (migrations/
            // 001_add_deduct_ingredient_stock_function.sql) does the read,
            // clamp, and write as one atomic statement in Postgres, so
            // concurrent callers serialize on the row instead of racing.
            const { data: deductionResult, error: deductionError } = await supabaseAdmin
              .rpc('deduct_ingredient_stock', {
                p_ingredient_id: ingredientId,
                p_deduction: deduction,
                p_updated_by: numericId
              });

            if (deductionError) throw deductionError;

            const deductionRow = Array.isArray(deductionResult) ? deductionResult[0] : deductionResult;
            if (!deductionRow) {
              throw new Error(`Ingredient ${ingredientId} not found while deducting stock`);
            }

            const previousQuantity = Number(deductionRow.previous_quantity) || 0;
            const newQuantity = Number(deductionRow.new_quantity) || 0;

            const { error: transactionError } = await supabaseAdmin
              .from('inventory_transactions')
              .insert({
                ingredient_id: ingredientId,
                transaction_type: 'sale',
                quantity: -deduction,
                previous_quantity: previousQuantity,
                new_quantity: newQuantity,
                reason: 'Automatic deduction from active mapped product sales',
                created_by: numericId
              });

          if (transactionError) throw transactionError;
        }
      }

      const salesByProductId = new Map();
      for (const sale of salesRows || []) {
        const dates = salesByProductId.get(sale.product_id) || [];
        dates.push(sale.sale_date);
        salesByProductId.set(sale.product_id, dates);
      }

      for (const product of productRows || []) {
        const productSales = salesByProductId.get(product.id) || [];

        const firstSoldDate = productSales[0] || product.first_sold_date || null;
        const lastSoldDate = productSales[productSales.length - 1] || firstSoldDate || null;
        const status = deriveProductStatus({
          firstSoldDate: firstSoldDate || null,
          lastSoldDate: lastSoldDate || null,
          createdAt: product.created_at || null,
          isActive: Boolean(product.is_active),
          inactiveReason: product.inactive_reason
        });

        const { error: updateError } = await supabaseAdmin.from('products')
          .update({
            first_sold_date: firstSoldDate ? firstSoldDate.slice(0, 10) : null,
            // is_active is a GENERATED column (is_active = (status = 'active'))
            // — it can never be written directly (Postgres error 428C9, see
            // productStatusConstants.js). Every write to activity status must
            // go through the enum column instead, translated via
            // PRODUCT_DB_STATUS_BY_DERIVED, same as mappingService.js/menuService.js.
            status: PRODUCT_DB_STATUS_BY_DERIVED[status.status],
            inactive_reason: status.note || null,
            inactive_since: status.isActive ? null : (product.inactive_since || new Date().toISOString().slice(0, 10))
          })
          .eq('id', product.id);

          if (updateError) throw updateError;
          productsUpdated += 1;
        }
      } catch (postInsertError) {
        console.error('Sales data was saved, but follow-up processing (category backfill / stock deduction / status reconciliation) failed:', postInsertError);
        warnings.push(`Sales data was saved, but some follow-up processing did not complete: ${postInsertError.message}`);
      }

      return {
        productsDetected,
        productsUpdated,
        warnings
      };
    } catch (error) {
      console.error('Error processing sales data:', error);
      throw error;
    }
  }

  validateFileColumns(headers, requiredColumns, fileType) {
    const missingColumns = [];
    const validColumns = [];
    const columnMap = {};
    
    const normalizedHeaders = headers.map(h => this.normalizeColumnName(h));
    
    requiredColumns.forEach(col => {
      let found = headers.some(h => h.trim() === col);
      
      if (!found) {
        found = headers.some(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      }
      
      if (!found) {
        const normalizedCol = this.normalizeColumnName(col);
        found = normalizedHeaders.some(h => h === normalizedCol);
      }
      
      if (!found) {
        missingColumns.push(col);
      } else {
        validColumns.push(col);
        const actualCol = headers.find(h => 
          h.trim() === col || 
          h.toLowerCase().trim() === col.toLowerCase().trim() ||
          this.normalizeColumnName(h) === this.normalizeColumnName(col)
        );
        columnMap[col] = actualCol || col;
      }
    });

    return {
      isValid: missingColumns.length === 0,
      missingColumns,
      validColumns,
      columnMap,
      message: missingColumns.length > 0 
        ? `Missing required columns: ${missingColumns.join(', ')}. Required: ${requiredColumns.join(', ')}`
        : 'All required columns are present'
    };
  }

  validateFileData(data, requiredColumns, columnMap) {
    const errors = [];
    let validRows = 0;
    let invalidRows = 0;
    
    data.forEach((row, index) => {
      const rowErrors = [];
      const rowNumber = index + 2;

      requiredColumns.forEach(col => {
        const actualCol = columnMap[col];
        if (!actualCol) {
          rowErrors.push(`${col} column not found`);
          return;
        }

        const value = row[actualCol];
        if (value === undefined || value === null || value === '' || value === ' ') {
          rowErrors.push(`${col} is empty`);
        } else if (['Items sold', 'Gross sales', 'Items refunded', 'Refunds', 'Net sales'].includes(col)) {
          const numValue = parseFloat(value);
          if (isNaN(numValue) && value.toString().trim() !== '') {
            rowErrors.push(`${col} must be a valid number`);
          }
        }
      });

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
        invalidRows++;
      } else {
        validRows++;
      }
    });

    return {
      errors: errors.slice(0, 10),
      validRows,
      invalidRows,
      totalRows: data.length
    };
  }

  async validateSalesData(data, filename) {
    const requiredColumns = [
      'Item name',
      'Category',
      'Items sold',
      'Gross sales',
      'Items refunded',
      'Refunds',
      'Net sales'
    ];
    
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    
    console.log('Headers found:', headers);
    console.log('Required columns:', requiredColumns);
    
    if (data.length === 0) {
      return {
        isValid: false,
        errors: [{ row: 0, message: 'File is empty' }],
        validRows: 0,
        invalidRows: 0,
        totalRows: 0,
        uploadDate: this.getCurrentDatePhilippines(),
        validation: {
          columns: {
            isValid: false,
            missingColumns: ['Data is empty'],
            validColumns: [],
            message: 'File contains no data'
          }
        }
      };
    }

    const columnValidation = this.validateFileColumns(headers, requiredColumns, 'sales');
    
    if (!columnValidation.isValid) {
      return {
        isValid: false,
        errors: [{ row: 1, message: columnValidation.message }],
        validRows: 0,
        invalidRows: data.length,
        totalRows: data.length,
        uploadDate: this.getCurrentDatePhilippines(),
        validation: {
          columns: columnValidation
        }
      };
    }

    const rowValidation = this.validateFileData(data, requiredColumns, columnValidation.columnMap);

    return {
      isValid: rowValidation.errors.length === 0,
      errors: rowValidation.errors,
      validRows: rowValidation.validRows,
      invalidRows: rowValidation.invalidRows,
      totalRows: data.length,
      uploadDate: this.getCurrentDatePhilippines(),
      validation: {
        columns: columnValidation,
        rows: rowValidation
      }
    };
  }

  // numericId must be the already-resolved numeric user id — the caller
  // (routes/upload.js) already calls getNumericUserId() and
  // checkDuplicateUpload() once before deciding to process the file at
  // all, so redoing both here was the exact same two Supabase queries
  // firing twice per upload request for no reason.
  async saveUploadRecord(fileData, processedData, numericId) {
    const filename = fileData.originalName || fileData.filename;

    try {
      console.log('Saving upload - numericId:', numericId);

      if (!numericId) {
        console.error('User not found in custom users table.');
        throw new Error('User not found. Please login again.');
      }

      // Check if already processing - if so, clear it first (stale lock)
      if (this.isUploadProcessing(filename, numericId)) {
        console.log(`Stale processing lock found for ${filename}, clearing...`);
        this.clearProcessing(filename, numericId);
      }

      this.markUploadProcessing(filename, numericId);

      const uploadDate = this.getCurrentDatePhilippines();
      const philippinesDisplayTime = this.getCurrentDatePhilippinesDisplay();
      
      const validation = processedData.validation || await this.validateSalesData(processedData.data || [], filename);
      
      console.log('Validation Results:');
      console.log(`  Filename: ${filename}`);
      console.log(`  Upload Date (PH Time): ${philippinesDisplayTime}`);
      console.log(`  Total Rows: ${validation.totalRows}`);
      console.log(`  Valid Rows: ${validation.validRows}`);
      console.log(`  Invalid Rows: ${validation.invalidRows}`);
      console.log(`  Valid: ${validation.isValid ? 'Yes' : 'No'}`);
      
      if (validation.errors.length > 0) {
        console.log('  Errors:', validation.errors);
      }

      // 'processed' means the full pipeline (product sync, daily_sales
      // insert, status reconciliation) actually completed — set below by
      // routes/upload.js via updateUploadStatus() once that's true. This
      // row existing only means validation passed and it's queued to run.
      const status = validation.isValid ? 'pending' : 'failed';

      const insertData = {
        filename: filename,
        upload_date: uploadDate,
        row_count: validation.totalRows,
        status: status,
        error_message: JSON.stringify({
          validRows: validation.validRows,
          invalidRows: validation.invalidRows,
          errors: validation.errors.slice(0, 5),
          philippinesTime: philippinesDisplayTime,
          filenameDate: this.extractDateFromFilename(filename)
        })
      };

      if (numericId) {
        insertData.user_id = numericId;
        console.log(`Saving upload for user_id: ${numericId}`);
      }

      let result;
      if (!this.isSupabaseReady()) {
        const upload = {
          id: this.memoryStore.uploads.length + 1,
          ...insertData,
          created_at: new Date().toISOString()
        };
        this.memoryStore.uploads.push(upload);
        console.log('Upload saved to memory (ID:', upload.id, ')');
        result = upload.id;
      } else {
        console.log('Inserting into Supabase:', insertData);
        const { data, error } = await supabaseAdmin.from('uploads')
          .insert(insertData)
          .select()
          .single();

        if (error) {
          console.error('Supabase insert error:', error);
          throw error;
        }
        
        console.log(`Upload saved to Supabase (ID: ${data.id})`);
        console.log(`   Upload Date (PH Time): ${philippinesDisplayTime}`);
        result = data.id;
      }

      this.markUploadComplete(filename, numericId);
      return result;

    } catch (error) {
      // Always clear processing lock on error
      if (filename && numericId) {
        this.clearProcessing(filename, numericId);
      }
      console.error('Error saving upload record:', error);
      throw error;
    }
  }

  async getUploads(options = {}) {
    try {
      const numericId = await this.getNumericUserId(options.userId);

      if (!this.isSupabaseReady()) {
        let uploads = [...this.memoryStore.uploads].sort((a, b) => new Date(b.upload_date || 0) - new Date(a.upload_date || 0));
        if (options.status) {
          uploads = uploads.filter((upload) => upload.status === options.status);
        }
        if (numericId) {
          uploads = uploads.filter((upload) => upload.user_id === numericId);
        }
        const offset = Number(options.offset) || 0;
        const limit = Number(options.limit) || 50;
        return uploads.slice(offset, offset + limit);
      }

      let query = supabaseAdmin.from('uploads')
        .select('*')
        .order('upload_date', { ascending: false });

      if (numericId) {
        query = query.eq('user_id', numericId);
        console.log(`Filtering uploads for user_id: ${numericId}`);
      }

      if (options.status) {
        query = query.eq('status', options.status);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      const parsedData = (data || []).map(item => {
        if (item.error_message && typeof item.error_message === 'string') {
          try {
            item.metadata = JSON.parse(item.error_message);
          } catch (e) {}
        }
        return item;
      });
      
      return parsedData;
    } catch (error) {
      console.error('Error fetching uploads:', error);
      throw error;
    }
  }

  async getUploadById(id, userId = null) {
    try {
      const numericId = await this.getNumericUserId(userId);

      if (!this.isSupabaseReady()) {
        return this.memoryStore.uploads.find((upload) => upload.id === Number(id)) || null;
      }

      let query = supabaseAdmin.from('uploads')
        .select('*')
        .eq('id', id);

      if (numericId) {
        query = query.eq('user_id', numericId);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      if (data && data.error_message && typeof data.error_message === 'string') {
        try {
          data.metadata = JSON.parse(data.error_message);
        } catch (e) {}
      }
      
      return data;
    } catch (error) {
      console.error('Error fetching upload:', error);
      throw error;
    }
  }

  async updateUploadStatus(id, status, errorMessage = null, userId = null) {
    try {
      const numericId = await this.getNumericUserId(userId);
      const updateData = { status: status };

      if (errorMessage) {
        const existing = await this.getUploadById(id, numericId);
        let metadata = {};
        if (existing && existing.error_message) {
          try {
            metadata = JSON.parse(existing.error_message);
          } catch (e) {}
        }
        metadata.error = errorMessage;
        updateData.error_message = JSON.stringify(metadata);
      }

      if (!this.isSupabaseReady()) {
        const upload = this.memoryStore.uploads.find((item) => item.id === Number(id));
        if (!upload) return null;
        upload.status = status;
        if (errorMessage) upload.error_message = updateData.error_message;
        return upload;
      }

      let query = supabaseAdmin.from('uploads')
        .update(updateData)
        .eq('id', id);

      if (numericId) {
        query = query.eq('user_id', numericId);
      }

      const { data, error } = await query.select().maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating upload status:', error);
      throw error;
    }
  }

  async deleteUpload(id, userId = null) {
    try {
      const numericId = await this.getNumericUserId(userId);
      const upload = await this.getUploadById(id, numericId);
      if (!upload) {
        throw new Error('Upload not found');
      }

      if (!this.isSupabaseReady()) {
        this.memoryStore.uploads = this.memoryStore.uploads.filter((item) => item.id !== Number(id));
        return true;
      }

      let query = supabaseAdmin.from('uploads')
        .delete()
        .eq('id', id);

      if (numericId) {
        query = query.eq('user_id', numericId);
      }

      const { error } = await query;

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting upload:', error);
      throw error;
    }
  }

  async getUploadStats(userId = null) {
    try {
      const numericId = await this.getNumericUserId(userId);

      if (!this.isSupabaseReady()) {
        const uploads = this.memoryStore.uploads;
        const filtered = numericId ? uploads.filter(u => u.user_id === numericId) : uploads;
        const stats = {
          total_uploads: filtered.length,
          processed: filtered.filter((upload) => upload.status === 'processed').length,
          pending: filtered.filter((upload) => upload.status === 'pending').length,
          failed: filtered.filter((upload) => upload.status === 'failed').length,
          sales_records: filtered.reduce((sum, upload) => sum + (upload.row_count || 0), 0),
          days_of_history: 0,
          months_uploaded: 0,
          actual_days_uploaded: 0,
          actual_months_uploaded: 0,
          earliest_sale_date: null,
          menu_items: this.memoryStore.products.length,
          last_sync: filtered[filtered.length - 1]?.upload_date || null
        };
        return stats;
      }

      let query = supabaseAdmin.from('uploads')
        .select('id, filename, status, row_count, upload_date');

      if (numericId) {
        query = query.eq('user_id', numericId);
        console.log(`Fetching stats for user_id: ${numericId}`);
      }

      const { data: uploads = [], error: uploadError } = await query;

      if (uploadError) throw uploadError;

      const uploadIds = uploads.map((upload) => upload.id).filter(Boolean);

      // Two different numbers, deliberately kept separate:
      //
      // - days_of_history/months_uploaded ("elapsed calendar time since
      //   the earliest sale date") mirrors ml-service/app.py's actual
      //   first-training gate exactly, so the "ready to train"/
      //   "insufficient data" dashboard state can never drift from
      //   whether a real /train call would actually be allowed to run.
      //   This is intentionally tolerant of closed days — a business
      //   that's open Mon-Fri only will still reach 365 here after a
      //   calendar year, same as ml-service's own gate.
      //
      // - actual_days_uploaded/actual_months_uploaded ("how many distinct
      //   calendar days actually have a real sales row") is what gets
      //   shown to the owner as "how much sales data have I uploaded" —
      //   uploading a handful of sample rows from over a year ago would
      //   otherwise make days_of_history alone look like "12/12 months
      //   met" the instant today's real clock has drifted far enough past
      //   that old date, even though almost no data actually exists. The
      //   owner needs an honest count of what's actually been uploaded to
      //   track progress by, independent of the gate.
      let earliestSaleDate = null;
      let distinctSaleDays = 0;
      if (uploadIds.length > 0) {
        try {
          // PostgREST/Supabase silently caps a single .select() at 1000
          // rows — with a real account's daily_sales easily running into
          // the tens of thousands of rows, an unpaginated query here was
          // truncated to whatever the first 1000 rows happened to be,
          // collapsing a genuine 400+ distinct sale dates down to ~22 and
          // making a fully-uploaded year look almost empty. Page through
          // with .range() until a page comes back short of PAGE_SIZE.
          const PAGE_SIZE = 1000;
          const distinctDates = new Set();
          let offset = 0;
          for (;;) {
            const { data: page = [], error: pageError } = await supabaseAdmin
              .from('daily_sales')
              .select('sale_date')
              .in('upload_id', uploadIds)
              .range(offset, offset + PAGE_SIZE - 1);

            if (pageError) throw pageError;
            for (const row of page) {
              if (row.sale_date) distinctDates.add(row.sale_date);
            }
            if (page.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }

          distinctSaleDays = distinctDates.size;
          if (distinctDates.size > 0) {
            earliestSaleDate = [...distinctDates].sort()[0];
          }
        } catch (salesDatesError) {
          console.warn('Could not calculate sales date coverage:', salesDatesError.message);
        }
      }

      const daysOfHistory = earliestSaleDate
        ? Math.max(0, dayjs().tz(PH_TZ).diff(dayjs(earliestSaleDate), 'day'))
        : 0;
      const monthsUploaded = Math.min(Math.floor(daysOfHistory / 30), 12);
      const actualMonthsUploaded = Math.min(Math.floor(distinctSaleDays / 30), 12);

      let menuQuery = supabaseAdmin.from('products')
        .select('*', { count: 'exact', head: true });

      let menuItemsCount = 0;
      try {
        const { count, error: productError } = await menuQuery;

        if (!productError) {
          menuItemsCount = count || 0;
        }
      } catch (err) {
        console.warn('Could not fetch menu items count:', err.message);
      }

      const stats = {
        total_uploads: uploads.length,
        processed: uploads.filter((upload) => upload.status === 'processed').length,
        pending: uploads.filter((upload) => upload.status === 'pending').length,
        failed: uploads.filter((upload) => upload.status === 'failed').length,
        sales_records: uploads.reduce((sum, upload) => sum + (upload.row_count || 0), 0),
        days_of_history: daysOfHistory,
        months_uploaded: monthsUploaded,
        actual_days_uploaded: distinctSaleDays,
        actual_months_uploaded: actualMonthsUploaded,
        earliest_sale_date: earliestSaleDate,
        menu_items: menuItemsCount || 0,
        last_sync: uploads[uploads.length - 1]?.upload_date || new Date().toISOString()
      };

      console.log('Stats calculated:', stats);
      return stats;
    } catch (error) {
      console.error('Error fetching stats:', error);
      throw error;
    }
  }

  async getUploadProgress(userId = null) {
    const numericId = await this.getNumericUserId(userId);
    const userPrefix = numericId ? `${numericId}-` : null;
    const isProcessing = userPrefix
      ? [...this.processingUploads].some((key) => key.startsWith(userPrefix))
      : false;

    if (!this.isSupabaseReady()) {
      const uploads = this.memoryStore.uploads
        .filter((upload) => !numericId || upload.user_id === numericId)
        .sort((a, b) => new Date(b.upload_date || 0) - new Date(a.upload_date || 0));
      const latest = uploads[0];

      return {
        progress: isProcessing ? 50 : latest?.status === 'processed' ? 100 : 0,
        status: isProcessing ? 'processing' : latest?.status || 'idle'
      };
    }

    let query = supabaseAdmin
      .from('uploads')
      .select('status, upload_date')
      .order('upload_date', { ascending: false })
      .limit(1);

    if (numericId) {
      query = query.eq('user_id', numericId);
    }

    const { data: uploads = [], error } = await query;
    if (error) throw error;

    const latest = uploads[0];
    return {
      progress: isProcessing ? 50 : latest?.status === 'processed' ? 100 : 0,
      status: isProcessing ? 'processing' : latest?.status || 'idle'
    };
  }

  // model_metrics.evaluation_date only carries a date, so "days since
  // trained" is measured in whole days. ~30-45 days was the range given
  // for the retraining cadence (monthly, per CLAUDE.md); 45 gives a
  // grace period past the 30-day cadence before flagging attention,
  // rather than flagging the instant the cadence is technically due.
  static RETRAINING_CADENCE_DAYS = 45;

  // getDashboardState()'s "ready to train" gate used to check ONLY
  // days_of_history (elapsed calendar time since the earliest sale date)
  // >= 365 — deliberately tolerant of closed days, matching ml-service's
  // own first-training gate exactly. But that alone can't distinguish a
  // genuine, mostly-complete year of real data from a sparse/old sample
  // that happens to span >365 elapsed days (e.g. a handful of rows dated
  // over a year ago) — the exact scenario actual_days_uploaded/
  // actual_months_uploaded were built to call out, except that number was
  // previously display-only and never actually gated anything.
  //
  // Deliberately strict, by request: a full 365 real sale-day rows must
  // actually exist (366 in a span that crosses a leap day) — not a
  // percentage of the elapsed span. This is meant to push toward
  // uploading more real history before training unlocks, not just to
  // tolerate the closed days that happen along the way.
  static MIN_ACTUAL_SALE_DAYS = 365;

  // True if [from, today] contains a Feb 29 — the one case where a real
  // "full year" of daily rows is 366, not 365. dayjs silently rolls a
  // non-leap-year "Feb 29" over into March 1 instead of marking it
  // invalid, so the leap-year check has to be done arithmetically, not by
  // just trying to construct the date and seeing if it parses.
  spanIncludesLeapDay(fromDateStr) {
    if (!fromDateStr) return false;
    const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const from = dayjs(fromDateStr).tz(PH_TZ);
    const today = dayjs().tz(PH_TZ);
    for (let year = from.year(); year <= today.year(); year++) {
      if (!isLeapYear(year)) continue;
      const feb29 = dayjs.tz(`${year}-02-29`, PH_TZ);
      if (!feb29.isBefore(from, 'day') && !feb29.isAfter(today, 'day')) {
        return true;
      }
    }
    return false;
  }

  async getLatestModelMetrics() {
    if (!this.isSupabaseReady()) return null;
    const { data, error } = await supabaseAdmin
      .from('model_metrics')
      .select('model_version, evaluation_date, mape')
      .order('evaluation_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('Could not fetch latest model_metrics:', error.message);
      return null;
    }
    return data;
  }

  async hasUpcomingForecasts() {
    if (!this.isSupabaseReady()) return false;
    const today = new Date().toISOString().slice(0, 10);
    const { count, error } = await supabaseAdmin
      .from('forecasts')
      .select('id', { count: 'exact', head: true })
      .gte('forecast_date', today);
    if (error) {
      console.warn('Could not check forecasts existence:', error.message);
      return false;
    }
    return (count || 0) > 0;
  }

  async getLatestForecastRun() {
    if (!this.isSupabaseReady()) return null;
    const { data, error } = await supabaseAdmin
      .from('forecast_runs')
      .select('run_at, stale_days, last_confirmed_date')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('Could not fetch latest forecast_runs row:', error.message);
      return null;
    }
    return data;
  }

  // "Unmapped" is derived live from product_ingredients (same rule
  // CLAUDE.md documents for the Analytics module — no stored
  // MAPPED/UNMAPPED column, to avoid a second source of truth).
  async getUnmappedActiveProductInfo() {
    const empty = { hasUnmapped: false, unmappedCount: 0, activeCount: 0 };
    if (!this.isSupabaseReady()) return empty;

    const { data: activeProducts, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('status', 'active');
    if (productsError) {
      console.warn('Could not fetch active products for mapping check:', productsError.message);
      return empty;
    }
    if (!activeProducts || activeProducts.length === 0) return empty;

    const activeIds = activeProducts.map((p) => p.id);
    const { data: mappedRows, error: mapError } = await supabaseAdmin
      .from('product_ingredients')
      .select('product_id')
      .in('product_id', activeIds);
    if (mapError) {
      console.warn('Could not fetch product_ingredients for mapping check:', mapError.message);
      return empty;
    }

    const mappedSet = new Set((mappedRows || []).map((r) => r.product_id));
    const unmappedCount = activeIds.filter((id) => !mappedSet.has(id)).length;
    return { hasUnmapped: unmappedCount > 0, unmappedCount, activeCount: activeIds.length };
  }

  // uploads.error_message is NOT a "problem happened" flag — saveUploadRecord
  // (above) JSON-stringifies a {validRows, invalidRows, errors,
  // philippinesTime, filenameDate} metadata blob into it on EVERY upload,
  // success or not; updateUploadStatus adds its own `error` key on top of
  // that same blob only when something real actually failed. Treating mere
  // non-null-ness as "an issue was detected" (the old behavior here) meant
  // this was true for essentially every upload ever made, including a
  // completely clean one (validRows: 50, invalidRows: 0, errors: []) —
  // which is exactly what surfaced a permanent, false "Data Quality Issue"
  // card on the Dashboard. Only report something when the parsed metadata
  // actually says there was a problem.
  async getLastUploadDataQualityIssue() {
    if (!this.isSupabaseReady()) return null;
    const { data, error } = await supabaseAdmin
      .from('uploads')
      .select('error_message, upload_date')
      .order('upload_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('Could not fetch latest upload for data-quality check:', error.message);
      return null;
    }
    if (!data?.error_message) return null;

    let metadata;
    try {
      metadata = JSON.parse(data.error_message);
    } catch (parseError) {
      // Not JSON — some older/other code path stored a plain string
      // directly. Treat it as a real message rather than silently dropping it.
      return data.error_message;
    }

    if (metadata.error) return metadata.error;
    if (Number(metadata.invalidRows) > 0) {
      return `${metadata.invalidRows} row(s) failed validation on the last upload.`;
    }
    if (Array.isArray(metadata.errors) && metadata.errors.length > 0) {
      return metadata.errors[0];
    }
    return null;
  }

  async getDashboardState(userId = null) {
    const stats = await this.getUploadStats(userId);
    const progress = await this.getUploadProgress(userId);

    if (stats.total_uploads === 0 && stats.sales_records === 0) {
      return { state: 'no-data', stats, progress };
    }

    // Two conditions, both required:
    // 1) days_of_history >= 365 — matches ml-service/app.py's actual
    //    first-training gate exactly (elapsed calendar time since the
    //    earliest sale date), tolerant of closed days by design.
    // 2) actual_days_uploaded >= a full real year of sale-day rows (365,
    //    or 366 if the span crosses a leap day) — closes the gap (1)
    //    alone leaves open: a sparse/old sample could clear 365 elapsed
    //    days on a handful of real rows. Deliberately strict (a hard row
    //    count, not a percentage of the elapsed span) — the point is to
    //    push toward uploading a genuinely complete year, not just to
    //    tolerate the closed days along the way. See
    //    MIN_ACTUAL_SALE_DAYS's comment above.
    const daysOfHistory = stats.days_of_history || 0;
    const requiredActualDays = this.spanIncludesLeapDay(stats.earliest_sale_date)
      ? UploadService.MIN_ACTUAL_SALE_DAYS + 1
      : UploadService.MIN_ACTUAL_SALE_DAYS;
    stats.required_actual_days = requiredActualDays;

    const elapsedInsufficient = daysOfHistory < 365;
    const coverageInsufficient = (stats.actual_days_uploaded || 0) < requiredActualDays;
    if (elapsedInsufficient || coverageInsufficient) {
      // Tells the frontend WHY it's still insufficient, instead of always
      // pointing the owner at "upload more" when the real blocker might be
      // that a lot of already-uploaded days are legitimately missing sales
      // rows (closed days, gaps) rather than too little elapsed time.
      const insufficientReason = elapsedInsufficient && coverageInsufficient
        ? 'both'
        : elapsedInsufficient
          ? 'elapsed'
          : 'coverage';
      return { state: 'uploaded-insufficient', stats, progress, insufficientReason };
    }

    // Actual training-in-flight signal (see mlService.isTrainingInFlight),
    // not upload-processing status — those are different things that the
    // old logic conflated (progress.status === 'processing' || stats.pending > 0).
    if (mlService.isTrainingInFlight()) {
      return { state: 'training-in-progress', stats, progress };
    }

    const latestModel = await this.getLatestModelMetrics();
    if (!latestModel) {
      return { state: 'ready-to-train', stats, progress };
    }

    const hasForecasts = await this.hasUpcomingForecasts();
    if (!hasForecasts) {
      // A model exists but no current forecasts yet (e.g. trained just
      // now, first /forecast run hasn't landed). No dedicated state for
      // this narrow window in the 7-state spec — training-in-progress is
      // the closest fit, since the dashboard genuinely isn't usable yet
      // for a different reason than "not trained at all". Deliberately
      // checked BEFORE the attention checks below, regardless of accuracy:
      // a system that has never yet attempted to operate (no forecast run
      // has happened at all) isn't a production problem yet — judging it
      // as one is premature. (A prior version of this function reordered
      // this check to run AFTER the attention checks specifically so a bad
      // model would surface immediately — that meant a system whose
      // accuracy never improves could get permanently stuck in
      // 'data-needs-attention' without ever reaching 'training-in-progress'
      // (post-model), 'forecasts-ready-recipes-pending', or
      // 'fully-operational', since nothing was ever wired up to actually
      // call POST /api/ml/forecast and flip hasUpcomingForecasts() to
      // true. That's fixed separately — see the Generate Forecast button
      // and the cron scheduler — which is what makes restoring this
      // original order safe again.)
      return { state: 'training-in-progress', stats, progress };
    }

    // Model trained + forecasts exist — NOW check the data-needs-attention
    // OR before deciding forecasts-ready-recipes-pending vs
    // fully-operational, since staleness/accuracy/retraining/data-quality
    // issues can happen to an otherwise-complete dashboard. This is the
    // correct moment for "an operating system just got worse," not a
    // precondition for letting it operate at all.
    const [forecastRun, dataQualityIssue] = await Promise.all([
      this.getLatestForecastRun(),
      this.getLastUploadDataQualityIssue(),
    ]);

    const staleDays = forecastRun?.stale_days || 0;
    const isStale = staleDays > 0;
    const accuracy = latestModel.mape != null
      ? Math.max(0, Math.min(100, 100 - Number(latestModel.mape)))
      : null;
    const isLowAccuracy = accuracy !== null && accuracy < 70;
    const daysSinceTraining = latestModel.evaluation_date
      ? Math.floor((Date.now() - new Date(latestModel.evaluation_date).getTime()) / 86400000)
      : null;
    const needsRetraining = daysSinceTraining !== null && daysSinceTraining > UploadService.RETRAINING_CADENCE_DAYS;

    if (isStale || isLowAccuracy || needsRetraining || dataQualityIssue) {
      return {
        state: 'data-needs-attention',
        stats,
        progress,
        attention: {
          isStale, staleDays, lastConfirmedDate: forecastRun?.last_confirmed_date || null,
          isLowAccuracy, accuracy,
          needsRetraining, daysSinceTraining,
          dataQualityIssue,
        },
      };
    }

    const { hasUnmapped, unmappedCount, activeCount } = await this.getUnmappedActiveProductInfo();
    if (hasUnmapped) {
      return {
        state: 'forecasts-ready-recipes-pending',
        stats, progress,
        mapping: { unmappedCount, activeCount },
      };
    }

    return { state: 'fully-operational', stats, progress };
  }
}

module.exports = new UploadService();
