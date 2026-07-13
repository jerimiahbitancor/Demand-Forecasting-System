// services/uploadService.js
const { supabase, isConfigured } = require('../config/supabase');

class UploadService {
  constructor() {
    this.memoryStore = {
      uploads: [],
      products: []
    };
    // Track in-progress uploads to prevent duplicates
    this.processingUploads = new Set();
    console.log(`📦 UploadService: Supabase ${isConfigured ? '✅ Connected' : '❌ Using Memory Fallback'}`);
  }

  isSupabaseReady() {
    return Boolean(isConfigured && supabase && typeof supabase.from === 'function');
  }

  isValidUserId(userId) {
    return userId && typeof userId === 'number' && Number.isInteger(userId) && userId > 0;
  }

  // Check if an upload is already being processed
  isUploadProcessing(filename, userId) {
    const key = `${userId}-${filename}`;
    return this.processingUploads.has(key);
  }

  // Mark upload as processing
  markUploadProcessing(filename, userId) {
    const key = `${userId}-${filename}`;
    this.processingUploads.add(key);
  }

  // Mark upload as completed
  markUploadComplete(filename, userId) {
    const key = `${userId}-${filename}`;
    this.processingUploads.delete(key);
  }

  // Get current date in Philippines time (UTC+8) as ISO string
  getCurrentDatePhilippines() {
    const now = new Date();
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return phTime.toISOString();
  }

  // Get current date for display in Philippines time
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

  // Extract date from filename - KEPT FOR REFERENCE BUT NOT USED FOR upload_date
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
      
      return null;
    } catch (error) {
      console.error('Error extracting date from filename:', error);
      return null;
    }
  }

  // Check for duplicate upload (same filename and user within last hour)
  async checkDuplicateUpload(filename, userId) {
    try {
      if (!this.isSupabaseReady()) {
        // Check memory store for duplicates
        const existing = this.memoryStore.uploads.find(
          u => u.filename === filename && u.user_id === userId
        );
        return !!existing;
      }

      // Check for existing upload with same filename in the last hour
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      let query = supabase
        .from('uploads')
        .select('id, filename, upload_date')
        .eq('filename', filename)
        .eq('user_id', userId)
        .gte('upload_date', oneHourAgo.toISOString())
        .limit(1);

      const { data, error } = await query;

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

  // Normalize column name
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

  // Validate file columns with flexible matching
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

  // Validate file data rows - ONLY VALIDATE, NO TOTALS
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

  // Process and validate sales data
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
    
    console.log('📋 Headers found:', headers);
    console.log('📋 Required columns:', requiredColumns);
    
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

  // Save upload record with duplicate prevention
  async saveUploadRecord(fileData, processedData, userId = null) {
    try {
      const filename = fileData.originalName || fileData.filename;
      
      // Check for duplicate upload
      const isDuplicate = await this.checkDuplicateUpload(filename, userId);
      if (isDuplicate) {
        console.log(`⚠️ Duplicate upload detected: ${filename} for user ${userId}`);
        throw new Error('Duplicate upload detected. This file has already been uploaded recently.');
      }

      // Check if already processing
      if (this.isUploadProcessing(filename, userId)) {
        console.log(`⏳ Upload already in progress: ${filename}`);
        throw new Error('Upload already in progress. Please wait.');
      }

      // Mark as processing
      this.markUploadProcessing(filename, userId);

      const uploadDate = this.getCurrentDatePhilippines();
      const philippinesDisplayTime = this.getCurrentDatePhilippinesDisplay();
      
      const validation = await this.validateSalesData(processedData.data || [], filename);
      
      console.log('📋 Validation Results:');
      console.log(`  Filename: ${filename}`);
      console.log(`  Upload Date (PH Time): ${philippinesDisplayTime}`);
      console.log(`  Total Rows: ${validation.totalRows}`);
      console.log(`  Valid Rows: ${validation.validRows}`);
      console.log(`  Invalid Rows: ${validation.invalidRows}`);
      console.log(`  Valid: ${validation.isValid ? '✅' : '❌'}`);
      
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

      if (this.isValidUserId(userId)) {
        insertData.user_id = userId;
        console.log(`👤 Saving upload for user_id: ${userId}`);
      }

      let result;
      if (!this.isSupabaseReady()) {
        const upload = {
          id: this.memoryStore.uploads.length + 1,
          ...insertData,
          created_at: new Date().toISOString()
        };
        this.memoryStore.uploads.push(upload);
        console.log('📝 Upload saved to memory (ID:', upload.id, ')');
        result = upload.id;
      } else {
        const { data, error } = await supabase
          .from('uploads')
          .insert(insertData)
          .select()
          .single();

        if (error) {
          console.error('❌ Supabase insert error:', error);
          throw error;
        }
        
        console.log(`✅ Upload saved to Supabase (ID: ${data.id})`);
        console.log(`   Upload Date (PH Time): ${philippinesDisplayTime}`);
        result = data.id;
      }

      // Mark as complete
      this.markUploadComplete(filename, userId);
      return result;

    } catch (error) {
      // Mark as complete even on error to free the lock
      const filename = fileData.originalName || fileData.filename;
      this.markUploadComplete(filename, userId);
      console.error('❌ Error saving upload record:', error);
      throw error;
    }
  }

  async getUploads(options = {}) {
    try {
      if (!this.isSupabaseReady()) {
        let uploads = [...this.memoryStore.uploads].sort((a, b) => new Date(b.upload_date || 0) - new Date(a.upload_date || 0));
        if (options.status) {
          uploads = uploads.filter((upload) => upload.status === options.status);
        }
        const offset = Number(options.offset) || 0;
        const limit = Number(options.limit) || 50;
        return uploads.slice(offset, offset + limit);
      }

      let query = supabase
        .from('uploads')
        .select('*')
        .order('upload_date', { ascending: false });

      if (this.isValidUserId(options.userId)) {
        query = query.eq('user_id', options.userId);
        console.log(`🔍 Filtering uploads for user_id: ${options.userId}`);
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
      if (!this.isSupabaseReady()) {
        return this.memoryStore.uploads.find((upload) => upload.id === Number(id)) || null;
      }

      let query = supabase
        .from('uploads')
        .select('*')
        .eq('id', id);

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.single();

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
      const updateData = { status: status };

      if (errorMessage) {
        const existing = await this.getUploadById(id, userId);
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

      let query = supabase
        .from('uploads')
        .update(updateData)
        .eq('id', id);

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.select().single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating upload status:', error);
      throw error;
    }
  }

  async deleteUpload(id, userId = null) {
    try {
      const upload = await this.getUploadById(id, userId);
      if (!upload) {
        throw new Error('Upload not found');
      }

      if (!this.isSupabaseReady()) {
        this.memoryStore.uploads = this.memoryStore.uploads.filter((item) => item.id !== Number(id));
        return true;
      }

      let query = supabase
        .from('uploads')
        .delete()
        .eq('id', id);

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
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
      if (!this.isSupabaseReady()) {
        const uploads = this.memoryStore.uploads;
        const stats = {
          total_uploads: uploads.length,
          processed: uploads.filter((upload) => upload.status === 'processed').length,
          pending: uploads.filter((upload) => upload.status === 'pending').length,
          failed: uploads.filter((upload) => upload.status === 'failed').length,
          sales_records: uploads.reduce((sum, upload) => sum + (upload.row_count || 0), 0),
          menu_items: this.memoryStore.products.length,
          last_sync: uploads[uploads.length - 1]?.upload_date || null
        };
        return stats;
      }

      let query = supabase
        .from('uploads')
        .select('status, row_count, upload_date');

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
        console.log(`🔍 Fetching stats for user_id: ${userId}`);
      }

      const { data: uploads = [], error: uploadError } = await query;

      if (uploadError) throw uploadError;

      let menuQuery = supabase
        .from('products')
        .select('*', { count: 'exact', head: true });

      if (this.isValidUserId(userId)) {
        menuQuery = menuQuery.eq('user_id', userId);
      }

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
        menu_items: menuItemsCount || 0,
        last_sync: uploads[uploads.length - 1]?.upload_date || new Date().toISOString()
      };

      console.log('📊 Stats calculated:', stats);
      return stats;
    } catch (error) {
      console.error('Error fetching stats:', error);
      throw error;
    }
  }
}

module.exports = new UploadService();