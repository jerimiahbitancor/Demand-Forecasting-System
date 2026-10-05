// services/uploadService.js
const { fetchAllRows } = require('../utils/fetchAllRows');
const { accuracyFromWmape, beatsBaseline, modelNeedsAttention } = require('../utils/accuracy');
const { getProductSalesSummary } = require('../utils/productSalesSummary');
const { supabase, isConfigured, supabaseAdmin } = require('../config/supabase');
const mappingService = require('./mappingService');
const mlService = require('./mlService');
const businessDayService = require('./businessDayService');
const dataCoverageService = require('./dataCoverageService');
const logger = require('../utils/logger');
const { deriveProductStatus } = require('./productStatusService');
const { PRODUCT_STATUS_NOTES, PRODUCT_DB_STATUS_BY_DERIVED } = require('./productStatusConstants');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';
const { convertRecipeQuantity, isMissingColumnError } = require('../utils/recipeUnits');
const {
  splitModifiers,
  aggregateSalesRecords,
  computeStockDeductions,
  normalizeKeyword,
} = require('../utils/salesModifiers');

// modifier_rules is read once per minute at most: a 288-file backfill would
// otherwise query it 288 times for a table of a handful of rows.
const MODIFIER_RULES_TTL_MS = 60 * 1000;
let modifierRulesCache = { rules: null, loadedAt: 0 };
let warnedMissingModifierTables = false;

// PGRST205 / 42P01 = the table does not exist yet (migration 010 not run).
function isMissingTableError(error) {
  if (!error) return false;
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || /does not exist|could not find the table/i.test(error.message || '');
}

function warnMissingModifierTablesOnce() {
  if (warnedMissingModifierTables) return;
  warnedMissingModifierTables = true;
  console.warn('[MODIFIERS] modifier_rules / daily_sales_modifiers not found. '
    + 'Run ml-service/migrations/010_add_modifier_rules_and_daily_sales_modifiers.sql. '
    + 'Until then item names are used as-is (no modifier splitting).');
}

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

  /**
   * modifier_rules as [{ keyword, ingredient_id }], keyword upper-cased.
   * Empty list (names used as-is) if the table does not exist yet.
   */
  async getModifierRules({ forceRefresh = false } = {}) {
    const fresh = Date.now() - modifierRulesCache.loadedAt < MODIFIER_RULES_TTL_MS;
    if (!forceRefresh && modifierRulesCache.rules && fresh) {
      return modifierRulesCache.rules;
    }
    if (!this.isSupabaseReady()) {
      return [];
    }

    const { data, error } = await fetchAllRows(() => supabaseAdmin
      .from('modifier_rules')
      .select('keyword, ingredient_id')
      .order('keyword'));

    if (error) {
      if (isMissingTableError(error)) {
        warnMissingModifierTablesOnce();
        modifierRulesCache = { rules: [], loadedAt: Date.now() };
        return [];
      }
      throw error;
    }

    const rules = (data || [])
      .map((rule) => ({ keyword: normalizeKeyword(rule.keyword), ingredient_id: rule.ingredient_id }))
      .filter((rule) => rule.keyword);
    modifierRulesCache = { rules, loadedAt: Date.now() };
    return rules;
  }

  async getModifierKeywords() {
    return (await this.getModifierRules()).map((rule) => rule.keyword);
  }

  /**
   * Unique BASE product names in a file. "Marinated Porksilog NO EGG" is
   * listed as "Marinated Porksilog" (POS modifiers are not products), and a
   * name that is only a modifier ("NO RICE") is skipped — processSalesData
   * reports it as a warning. Pass the keywords from getModifierKeywords().
   */
  extractUniqueProductNames(rows = [], modifierKeywords = []) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const productNames = [];
    const seen = new Set();

    for (const row of rows) {
      const { baseName: productName, modifierOnly } = splitModifiers(
        this.normalizeProductName(
          this.getColumnValueByNames(row, ['Item name', 'Item Name', 'Product', 'Product name'])
        ),
        modifierKeywords
      );

      if (!productName || modifierOnly) {
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
      // BASE names only: a POS modifier name ("... NO EGG") must never
      // create its own product, whichever route called this (upload.js
      // passes names already split; mapping.js passes names from the UI).
      const modifierKeywords = Array.isArray(productNames) && productNames.length > 0
        ? await this.getModifierKeywords()
        : [];
      const normalizedProducts = Array.isArray(productNames)
        ? productNames
            .map((name) => splitModifiers(this.normalizeProductName(name), modifierKeywords))
            .filter((split) => !split.modifierOnly)
            .map((split) => split.baseName)
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

      // POS modifiers ("... NO EGG") — see utils/salesModifiers.js.
      const modifierRules = await this.getModifierRules();
      const modifierKeywords = modifierRules.map((rule) => rule.keyword);
      const ingredientIdByKeyword = new Map(modifierRules.map((rule) => [rule.keyword, rule.ingredient_id]));

      const uniqueSalesProductNames = this.extractUniqueProductNames(rows, modifierKeywords);
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

      // Keyed by `${productId}|${saleDate}`, not one entry per CSV row.
      // daily_sales is UNIQUE on (product_id, sale_date), and one day's
      // export can list the same product on several rows — a category split,
      // and now also its POS modifier rows ("Marinated Porksilog NO EGG"
      // belongs to Marinated Porksilog). Inserting one row per CSV row made
      // the batch fail with 23505 on every attempt; summing first fixes it.
      //
      // NET QUANTITY: quantity_sold = max(0, Items sold - Items refunded),
      // summed per product/date INCLUDING modifier rows, clamped once after
      // summing (a refund on one row can cancel a sale on another). Each
      // modifier's own net plates go to daily_sales_modifiers.
      // The rule lives in utils/salesModifiers.js (aggregateSalesRecords).
      const records = rows.map((row) => ({
        name: this.normalizeProductName(
          this.getColumnValueByNames(row, ['Item name', 'Item Name', 'Product', 'Product name'])
        ),
        sold: this.getColumnValueByNames(row, ['Items sold', 'Items Sold', 'Quantity', 'Units sold']),
        refunded: this.getColumnValueByNames(row, ['Items refunded', 'Items Refunded']),
        category: this.getColumnValueByNames(row, ['Category', 'Category Name'])?.toString()?.trim() || 'Uncategorized',
        saleDate: this.getSaleDateValue(row, fallbackDate),
      }));
      const aggregated = aggregateSalesRecords(records, {
        productIdByName,
        keywords: modifierKeywords,
        uploadId,
      });
      const { dailySalesRows, modifierRows } = aggregated;
      for (const [productId, category] of aggregated.categoryByProductId) {
        categoryByProductId.set(productId, category);
      }
      for (const row of dailySalesRows) {
        productIds.add(row.product_id);
      }
      if (aggregated.modifierOnlyNames.length > 0) {
        warnings.push(
          `Skipped ${aggregated.modifierOnlyNames.length} row name(s) that are only a modifier, `
          + `not a dish: ${aggregated.modifierOnlyNames.join(', ')}. Their plates were not counted.`
        );
      }

      if (dailySalesRows.length > 0) {
        const { error: saleInsertError } = await supabaseAdmin
          .from('daily_sales')
          .insert(dailySalesRows);

        if (saleInsertError) {
          throw saleInsertError;
        }
      }

      // Modifier counts are written AFTER daily_sales and never fail the
      // upload: daily_sales is the training input and is already committed.
      // Written before it, a later daily_sales failure would leave modifier
      // rows behind that block the retry on their own unique key.
      // Missing counts only make ingredient demand assume full recipes.
      if (modifierRows.length > 0) {
        const { error: modifierInsertError } = await supabaseAdmin
          .from('daily_sales_modifiers')
          .insert(modifierRows);
        if (modifierInsertError) {
          if (isMissingTableError(modifierInsertError)) {
            warnMissingModifierTablesOnce();
          } else {
            console.error('Error saving modifier counts:', modifierInsertError);
          }
          warnings.push(`Modifier counts (e.g. NO EGG) were not saved: ${modifierInsertError.message}`);
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
        // First/last sale per product via the view -- this is the per-upload
        // call that used to read every sales row for the selected products.
        const { data: salesSummary, error: salesFetchError } = await getProductSalesSummary(selectedProductIds);

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

          // Full recipe for every plate, except a modifier plate leaves out
          // the one ingredient its rule maps to (and only if that ingredient
          // is in this recipe). 10 plain + 3 NO EGG + 2 NO RICE -> egg 12,
          // rice 13. Computed as one net amount per ingredient and deducted
          // once, so the 0-floor in deduct_ingredient_stock can't distort it.
          const deductions = computeStockDeductions({
            dailySalesRows,
            modifierRows,
            recipeRows: recipeRows || [],
            activeProductIds,
            ingredientIdByKeyword,
            perServingFor: (recipe) => {
              const ingredientUnit = recipe.ingredients?.unit || recipe.unit || null;
              return convertRecipeQuantity(
                recipe.quantity_per_serving,
                recipe.unit,
                ingredientUnit,
                { gramsPerCup: recipe.ingredients?.grams_per_cup, ingredientName: recipe.ingredients?.name }
              );
            },
          });

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

      for (const product of productRows || []) {
        const summary = salesSummary.get(product.id);

        const firstSoldDate = summary?.firstSaleDate || product.first_sold_date || null;
        const lastSoldDate = summary?.lastSaleDate || firstSoldDate || null;
        const status = deriveProductStatus({
          firstSoldDate: firstSoldDate || null,
          lastSoldDate: lastSoldDate || null,
          createdAt: product.created_at || null,
          isActive: Boolean(product.is_active),
          inactiveReason: product.inactive_reason
        });

        const nextValues = {
          first_sold_date: firstSoldDate ? firstSoldDate.slice(0, 10) : null,
          // is_active is a GENERATED column (is_active = (status = 'active'))
          // — it can never be written directly (Postgres error 428C9, see
          // productStatusConstants.js). Every write to activity status must
          // go through the enum column instead, translated via
          // PRODUCT_DB_STATUS_BY_DERIVED, same as mappingService.js/menuService.js.
          status: PRODUCT_DB_STATUS_BY_DERIVED[status.status],
          inactive_reason: status.note || null,
          inactive_since: status.isActive ? null : (product.inactive_since || new Date().toISOString().slice(0, 10))
        };

        // Skip products whose values would not change. This used to send
        // one UPDATE per product in the file, every time — ~50 sequential
        // round trips per file. On a network where each query takes
        // ~150-400 ms that alone is 10+ seconds per file, and with 5 files
        // uploading at once requests ran past the browser's timeout and
        // were reported as failed even though the server finished them
        // (Oct 1 2026). Once history is loaded, most uploads change
        // nothing here, so this usually drops to zero queries.
        const currentFirstSold = product.first_sold_date ? String(product.first_sold_date).slice(0, 10) : null;
        const currentInactiveSince = product.inactive_since ? String(product.inactive_since).slice(0, 10) : null;
        const unchanged = currentFirstSold === nextValues.first_sold_date
          && product.status === nextValues.status
          && (product.inactive_reason || null) === nextValues.inactive_reason
          && currentInactiveSince === (nextValues.inactive_since ? nextValues.inactive_since.slice(0, 10) : null);
        if (unchanged) continue;

        const { error: updateError } = await supabaseAdmin.from('products')
          .update(nextValues)
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

  // `fingerprintPromise` (optional): a dataCoverageService fingerprint
  // already being fetched by the caller (getDashboardState), so one check
  // reads it once. Without it, this function fetches its own.
  async getUploadStats(userId = null, { fingerprintPromise = null } = {}) {
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
          menu_items: this.memoryStore.products.length,
          last_sync: filtered[filtered.length - 1]?.upload_date || null
        };
        return stats;
      }

      let query = supabaseAdmin.from('uploads')
        .select('id, filename, status, row_count, upload_date');

      if (numericId) {
        query = query.eq('user_id', numericId);
        logger.debug('upload_stats_fetch', { user_id: numericId });
      }

      // Independent reads, run in parallel: the uploads list, the menu
      // count, and the data fingerprint. The fingerprint must be read
      // BEFORE the sale-date computation below starts (see
      // dataCoverageService.js); awaiting it here guarantees that.
      const fingerprintRequest = fingerprintPromise || dataCoverageService
        .getFingerprint(supabaseAdmin)
        .catch((fingerprintError) => {
          console.warn('Could not read data fingerprint, computing sale coverage uncached:', fingerprintError.message);
          return null;
        });

      let menuQuery = supabaseAdmin.from('products')
        .select('*', { count: 'exact', head: true });

      const menuCountRequest = (async () => {
        try {
          const { count, error: productError } = await menuQuery;

          if (!productError) {
            return count || 0;
          }
        } catch (err) {
          console.warn('Could not fetch menu items count:', err.message);
        }
        return 0;
      })();

      const [{ data: uploads = [], error: uploadError }, fingerprint, menuItemsCount] = await Promise.all([
        query,
        fingerprintRequest,
        menuCountRequest,
      ]);

      if (uploadError) throw uploadError;

      const uploadIds = uploads.map((upload) => upload.id).filter(Boolean);

      // Display-only numbers. NEITHER gates training any more — the
      // first-use rule lives in utils/historyGate.js (see
      // getDashboardState), and it measures the span of the uploaded data,
      // never today's date.
      //
      // - days_of_history/months_uploaded: elapsed calendar time from the
      //   earliest sale date to TODAY. Kept for existing displays only.
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
          // Uses the shared helper, which stops on an EMPTY page rather
          // than a short one. The old inline loop broke on the first
          // short page — correct only while Supabase's Max rows is
          // exactly 1,000. If it were ever lowered, the first page would
          // come back short and this would stop early, silently
          // under-counting sale days again (the bug described above).
          //
          // Same query and calculation as before, but only re-run when the
          // data fingerprint changes (dataCoverageService.js). The upload
          // id set is part of the cache fingerprint because the query is
          // filtered by it and the uploads list was read in parallel with
          // the data fingerprint.
          const computeSaleCoverage = async () => {
            const { data: saleDateRows, error: pageError } = await fetchAllRows(() => supabaseAdmin
              .from('daily_sales')
              .select('sale_date')
              .in('upload_id', uploadIds)
              .order('sale_date')
              .order('product_id'));
            if (pageError) throw pageError;

            const distinctDates = new Set();
            for (const row of saleDateRows || []) {
              if (row.sale_date) distinctDates.add(row.sale_date);
            }

            return {
              distinctSaleDays: distinctDates.size,
              earliestSaleDate: distinctDates.size > 0 ? [...distinctDates].sort()[0] : null,
            };
          };

          let coverage;
          if (fingerprint) {
            const minId = uploadIds.reduce((a, b) => (b < a ? b : a), uploadIds[0]);
            const maxId = uploadIds.reduce((a, b) => (b > a ? b : a), uploadIds[0]);
            const idKey = `${uploadIds.length}:${minId}:${maxId}`;
            coverage = await dataCoverageService.cachedByFingerprint(
              `saleCoverage:${numericId}`,
              `${fingerprint}|${idKey}`,
              computeSaleCoverage
            );
          } else {
            coverage = await computeSaleCoverage();
          }

          distinctSaleDays = coverage.distinctSaleDays;
          earliestSaleDate = coverage.earliestSaleDate;
        } catch (salesDatesError) {
          console.warn('Could not calculate sales date coverage:', salesDatesError.message);
        }
      }

      const daysOfHistory = earliestSaleDate
        ? Math.max(0, dayjs().tz(PH_TZ).diff(dayjs(earliestSaleDate), 'day'))
        : 0;
      const monthsUploaded = Math.min(Math.floor(daysOfHistory / 30), 12);
      const actualMonthsUploaded = Math.min(Math.floor(distinctSaleDays / 30), 12);

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
        menu_items: menuItemsCount || 0,
        last_sync: uploads[uploads.length - 1]?.upload_date || new Date().toISOString()
      };

      logger.debug('upload_stats_calculated', {
        total_uploads: stats.total_uploads,
        actual_days_uploaded: stats.actual_days_uploaded,
      });
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

  async getLatestModelMetrics() {
    if (!this.isSupabaseReady()) return null;
    const { data, error } = await supabaseAdmin
      .from('model_metrics')
      .select('model_version, evaluation_date, mape, wmape, baseline_wmape')
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

  // One dashboard check. Same decisions, in the same order, as before;
  // the reads are just grouped so independent ones run in parallel, and
  // the two whole-table sale-date scans are cached by data fingerprint
  // (services/dataCoverageService.js).
  //
  // Each read is "settled" first and its result (or error) is only taken
  // at the point the old code awaited it, so an error in a read the old
  // code would never have reached still cannot change the answer.
  async getDashboardState(userId = null) {
    const settle = (promise) => promise.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    );
    const take = (result) => {
      if (!result.ok) throw result.error;
      return result.value;
    };

    // Resolve the user once; getUploadStats/getUploadProgress accept a number as-is.
    const numericId = await this.getNumericUserId(userId);

    // One fingerprint read per check, shared by both cached computations.
    const fingerprintPromise = this.isSupabaseReady()
      ? dataCoverageService.getFingerprint(supabaseAdmin).catch((fingerprintError) => {
        console.warn('Could not read data fingerprint, dashboard check runs uncached:', fingerprintError.message);
        return null;
      })
      : Promise.resolve(null);

    // Batch A.
    const [statsResult, progressResult, latestModelResult] = await Promise.all([
      settle(this.getUploadStats(numericId, { fingerprintPromise })),
      settle(this.getUploadProgress(numericId)),
      settle(this.getLatestModelMetrics()),
    ]);
    const stats = take(statsResult);
    const progress = take(progressResult);

    if (stats.total_uploads === 0 && stats.sales_records === 0) {
      return { state: 'no-data', stats, progress };
    }

    const latestModel = take(latestModelResult);

    // First-use history rule (utils/historyGate.js — ml-service's /train
    // applies the identical rule via services/history_gate.py):
    //   1. last sale date − first sale date + 1 >= 365 days (closed days
    //      count; today's date does not), and
    //   2. every date in that span is open (has sales) or confirmed closed.
    //
    // Applied ONLY while no model has been trained yet — the same
    // condition ml-service uses (model_metrics has no row). Once the store
    // is operating, a single missed upload inside the span would otherwise
    // flip a working dashboard back to this onboarding screen; missed
    // uploads after that are reported through forecast_runs.stale_days.
    if (!latestModel && !mlService.isTrainingInFlight()) {
      // Cached by fingerprint. businessDayService.getHistoryCoverage itself
      // stays uncached, because bulkConfirmClosed uses it to validate writes.
      const fingerprint = await fingerprintPromise;
      const { gate } = fingerprint
        ? await dataCoverageService.cachedByFingerprint(
          'historyCoverage',
          fingerprint,
          () => businessDayService.getHistoryCoverage()
        )
        : await businessDayService.getHistoryCoverage();
      if (!gate.passes) {
        return {
          state: 'uploaded-insufficient',
          stats,
          progress,
          // 'span' | 'unconfirmed' | 'both' | 'no_data'
          insufficientReason: gate.insufficientReason,
          history: {
            firstSaleDate: gate.firstSaleDate,
            lastSaleDate: gate.lastSaleDate,
            spanDays: gate.spanDays,
            spanMonths: gate.spanMonths,
            requiredSpanDays: gate.requiredSpanDays,
            openDays: gate.openDays,
            closedDays: gate.closedDays,
            unconfirmedDays: gate.unconfirmedDays,
          },
        };
      }
    }

    // Actual training-in-flight signal (see mlService.isTrainingInFlight),
    // not upload-processing status — those are different things that the
    // old logic conflated (progress.status === 'processing' || stats.pending > 0).
    if (mlService.isTrainingInFlight()) {
      return { state: 'training-in-progress', stats, progress };
    }

    if (!latestModel) {
      return { state: 'ready-to-train', stats, progress };
    }

    // Batch B: the remaining reads, in parallel. Each result is taken
    // where the old code awaited it.
    const [hasForecastsResult, forecastRunResult, dataQualityResult, unmappedResult] = await Promise.all([
      settle(this.hasUpcomingForecasts()),
      settle(this.getLatestForecastRun()),
      settle(this.getLastUploadDataQualityIssue()),
      settle(this.getUnmappedActiveProductInfo()),
    ]);

    const hasForecasts = take(hasForecastsResult);
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
    const forecastRun = take(forecastRunResult);
    const dataQualityIssue = take(dataQualityResult);

    const staleDays = forecastRun?.stale_days || 0;
    const isStale = staleDays > 0;

    // Accuracy is WMAPE-based now, and "is it good enough?" is answered by
    // comparison, not by a threshold (owner decision, Oct 1 2026): the
    // model needs attention when it does NOT beat the 7-day average on the
    // same test rows. The old rule was accuracy = 100 - MAPE with a
    // hardcoded "< 70%" cutoff — a number nobody chose, inherited from the
    // Lewis (1982) MAPE bands, which are dropped along with MAPE.
    //
    // The rule lives in utils/accuracy.js so Analytics and this dashboard
    // can never disagree about whether the model is healthy.
    const accuracy = accuracyFromWmape(latestModel.wmape);
    const baselineAccuracy = accuracyFromWmape(latestModel.baseline_wmape);
    const beatsBaselineFlag = beatsBaseline(latestModel.wmape, latestModel.baseline_wmape);
    const isLowAccuracy = modelNeedsAttention(latestModel.wmape, latestModel.baseline_wmape);
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
          isLowAccuracy, accuracy, baselineAccuracy, beatsBaseline: beatsBaselineFlag,
          needsRetraining, daysSinceTraining,
          dataQualityIssue,
        },
      };
    }

    const { hasUnmapped, unmappedCount, activeCount } = take(unmappedResult);
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
