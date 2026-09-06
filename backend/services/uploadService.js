// services/uploadService.js
const { supabase, isConfigured, supabaseAdmin } = require('../config/supabase');
const mappingService = require('./mappingService');
const { deriveProductStatus } = require('./productStatusService');
const { PRODUCT_STATUS_NOTES } = require('./productStatusConstants');

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

  getCurrentDatePhilippines() {
    const now = new Date();
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return phTime.toISOString();
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
        const existing = this.memoryStore.uploads.find(
          u => u.filename === filename && u.user_id === numericId
        );
        return !!existing;
      }

      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      const { data, error } = await supabaseAdmin.from('uploads')
        .select('id, filename, upload_date')
        .eq('filename', filename)
        .eq('user_id', numericId)
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

        try {
          const insertedProduct = await mappingService.createProduct({
            name: productName,
            price: 0,
            category: 'Uncategorized',
            serving_size_label: 'serving',
            ingredients: [],
            user_id: numericId
          });

          console.log('[PRODUCT DISCOVERY] Created product:', JSON.stringify(insertedProduct, null, 2));

          const { data: persistedProduct, error: persistedProductError } = await supabaseAdmin
            .from('products')
            .select('id, name, price, category, is_active, created_at')
            .eq('id', insertedProduct?.id)
            .maybeSingle();

          if (persistedProductError) {
            throw persistedProductError;
          }

          if (!persistedProduct) {
            throw new Error(`Product insert returned no persisted row for "${productName}"`);
          }

          console.log('[PRODUCT DISCOVERY] Verified public.products row:', JSON.stringify(persistedProduct, null, 2));

          if (insertedProduct) {
            created.push(productName);
            existingByName.set(productName.trim().toLowerCase(), insertedProduct);
          }
        } catch (insertError) {
          if (insertError?.code === '23505' || /already exists/i.test(insertError?.message || '')) {
            existing.push(productName);
            continue;
          }
          throw insertError;
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

      for (const product of products || []) {
        productIdByName.set(String(product.name).trim().toLowerCase(), product.id);
      }

      const dailySalesRows = [];
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

        dailySalesRows.push({
          product_id: productId,
          sale_date: saleDate,
          quantity_sold: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
          upload_id: uploadId || null
        });
        if (!categoryByProductId.has(productId)) {
          categoryByProductId.set(productId, category);
        }
        productIds.add(productId);
      }

      if (dailySalesRows.length > 0) {
        const { error: saleInsertError } = await supabaseAdmin
          .from('daily_sales')
          .insert(dailySalesRows);

        if (saleInsertError) {
          throw saleInsertError;
        }
      }

      for (const [productId, category] of categoryByProductId) {
        const { error: categoryUpdateError } = await supabaseAdmin
          .from('products')
          .update({ category: category || 'Uncategorized' })
          .eq('id', productId)
          .eq('category', 'Uncategorized');

        if (categoryUpdateError) {
          throw categoryUpdateError;
        }
      }

      let productsUpdated = 0;
      const selectedProductIds = [...productIds];
      if (selectedProductIds.length === 0) {
        return { productsDetected, productsUpdated: 0, warnings };
      }

      const { data: productRows, error: productFetchError } = await supabaseAdmin.from('products')
        .select('id, created_at, first_sold_date, is_active, inactive_reason, inactive_since')
        .in('id', selectedProductIds);
      const { data: salesRows, error: salesFetchError } = await supabaseAdmin.from('daily_sales')
        .select('product_id, sale_date')
        .in('product_id', selectedProductIds)
        .order('sale_date', { ascending: true });

      if (productFetchError || salesFetchError) {
        throw productFetchError || salesFetchError;
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
          isActive: Boolean(product.is_active)
        });

        const { error: updateError } = await supabaseAdmin.from('products')
          .update({
            first_sold_date: firstSoldDate ? firstSoldDate.slice(0, 10) : null,
            is_active: status.isActive,
            inactive_reason: status.note || null,
            inactive_since: status.isActive ? null : (product.inactive_since || new Date().toISOString().slice(0, 10))
          })
          .eq('id', product.id);

        if (!updateError) {
          productsUpdated += 1;
        }
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

  async saveUploadRecord(fileData, processedData, userId = null) {
    let filename = fileData.originalName || fileData.filename;
    let numericId = null;
    
    try {
      numericId = await this.getNumericUserId(userId);
      
      console.log('Saving upload - userId:', userId, 'numericId:', numericId);
      
      if (!numericId) {
        console.error('User not found in custom users table.');
        throw new Error('User not found. Please login again.');
      }

      // Check if already processing - if so, clear it first (stale lock)
      if (this.isUploadProcessing(filename, numericId)) {
        console.log(`Stale processing lock found for ${filename}, clearing...`);
        this.clearProcessing(filename, numericId);
      }

      const isDuplicate = await this.checkDuplicateUpload(filename, numericId);
      if (isDuplicate) {
        console.log(`Duplicate upload detected: ${filename}`);
        throw new Error('Duplicate upload detected. This file has already been uploaded recently.');
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

      let status = 'processed';
      if (!validation.isValid) {
        status = 'failed';
      } else if (validation.invalidRows > 0) {
        status = 'pending';
      }

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
      } else if (filename && userId) {
        const numId = await this.getNumericUserId(userId);
        if (numId) {
          this.clearProcessing(filename, numId);
        }
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
          months_uploaded: Math.min(filtered.length, 12),
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

      const uploadedMonths = new Set(
        uploads
          .map((upload) => this.extractDateFromFilename(upload.filename || ''))
          .filter(Boolean)
          .map((date) => date.slice(0, 7))
      );
      const uploadIds = uploads.map((upload) => upload.id).filter(Boolean);

      if (uploadIds.length > 0) {
        try {
          const { data: salesDates = [], error: salesDatesError } = await supabaseAdmin
            .from('daily_sales')
            .select('sale_date, upload_id')
            .in('upload_id', uploadIds);

          if (salesDatesError) throw salesDatesError;

          const months = new Set(
            salesDates
              .map((sale) => String(sale.sale_date || '').slice(0, 7))
              .filter(Boolean)
          );
          months.forEach((month) => uploadedMonths.add(month));
        } catch (salesDatesError) {
          console.warn('Could not calculate uploaded months:', salesDatesError.message);
        }
      }

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
        months_uploaded: Math.min(uploadedMonths.size || uploads.length, 12),
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

  async getDashboardState(userId = null) {
    const stats = await this.getUploadStats(userId);
    const progress = await this.getUploadProgress(userId);

    let state = 'fully-operational';
    if (stats.total_uploads === 0 && stats.sales_records === 0) {
      state = 'no-data';
    } else if (stats.failed > 0) {
      state = 'data-needs-attention';
    } else if (progress.status === 'processing' || stats.pending > 0) {
      state = 'training';
    } else if ((stats.months_uploaded || 0) < 12) {
      state = 'uploaded-insufficient';
    }

    return {
      state,
      stats,
      progress
    };
  }
}

module.exports = new UploadService();
