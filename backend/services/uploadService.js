// services/uploadService.js
const { supabase, isConfigured } = require('../config/supabase');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

class UploadService {
  constructor() {
    this.memoryStore = {
      uploads: [],
      products: []
    };
    console.log(`📦 UploadService: Supabase ${isConfigured ? '✅ Connected' : '❌ Using Memory Fallback'}`);
  }

  isSupabaseReady() {
    const ready = Boolean(isConfigured && supabase && typeof supabase.from === 'function');
    return ready;
  }

  // Validate file columns
  validateFileColumns(headers, requiredColumns, fileType) {
    const missingColumns = [];
    const validColumns = [];
    
    requiredColumns.forEach(col => {
      const found = headers.some(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      if (!found) {
        missingColumns.push(col);
      } else {
        validColumns.push(col);
      }
    });

    return {
      isValid: missingColumns.length === 0,
      missingColumns,
      validColumns,
      message: missingColumns.length > 0 
        ? `Missing required columns: ${missingColumns.join(', ')}. Required: ${requiredColumns.join(', ')}`
        : 'All required columns are present'
    };
  }

  // Validate file data rows
  validateFileData(data, requiredColumns) {
    const errors = [];
    let validRows = 0;
    let invalidRows = 0;
    
    // Get actual column names from the data (case insensitive matching)
    const headers = Object.keys(data[0] || {});
    const columnMap = {};
    
    requiredColumns.forEach(col => {
      const found = headers.find(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      if (found) {
        columnMap[col] = found;
      }
    });

    data.forEach((row, index) => {
      const rowErrors = [];
      const rowNumber = index + 2; // +2 because 0-indexed and header row is 1

      requiredColumns.forEach(col => {
        const actualCol = columnMap[col];
        if (!actualCol) {
          rowErrors.push(`${col} column not found`);
          return;
        }

        const value = row[actualCol];
        // Check if value is empty, undefined, null, or only whitespace
        if (value === undefined || value === null || value === '' || value === ' ') {
          rowErrors.push(`${col} is empty`);
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
      errors: errors.slice(0, 10), // Limit to first 10 errors
      validRows,
      invalidRows,
      totalRows: data.length
    };
  }

  // Process and validate sales data
  async validateSalesData(data) {
    const requiredColumns = ['Date', 'Item Name', 'Item Sold', 'Category', 'Net Sales'];
    
    // Get headers from data
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    
    // Check if data is empty
    if (data.length === 0) {
      return {
        isValid: false,
        errors: [{ row: 0, message: 'File is empty' }],
        validRows: 0,
        invalidRows: 0,
        totalRows: 0,
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

    // Validate columns
    const columnValidation = this.validateFileColumns(headers, requiredColumns, 'sales');
    
    if (!columnValidation.isValid) {
      return {
        isValid: false,
        errors: [{ row: 1, message: columnValidation.message }],
        validRows: 0,
        invalidRows: data.length,
        totalRows: data.length,
        validation: {
          columns: columnValidation
        }
      };
    }

    // Validate rows
    const rowValidation = this.validateFileData(data, requiredColumns);

    return {
      isValid: rowValidation.errors.length === 0,
      errors: rowValidation.errors,
      validRows: rowValidation.validRows,
      invalidRows: rowValidation.invalidRows,
      totalRows: data.length,
      validation: {
        columns: columnValidation,
        rows: rowValidation
      }
    };
  }

  // Save upload record with validation
  async saveUploadRecord(fileData, processedData, userId = null) {
    try {
      // Validate the data before saving
      const validation = await this.validateSalesData(processedData.data || []);
      
      // Log validation results
      console.log('📋 Validation Results:');
      console.log(`  Total Rows: ${validation.totalRows}`);
      console.log(`  Valid Rows: ${validation.validRows}`);
      console.log(`  Invalid Rows: ${validation.invalidRows}`);
      console.log(`  Valid: ${validation.isValid ? '✅' : '❌'}`);
      
      if (validation.errors.length > 0) {
        console.log('  Errors:', validation.errors);
      }

      // Determine status based on validation
      let status = 'processed';
      if (!validation.isValid) {
        status = 'failed';
      } else if (validation.invalidRows > 0) {
        status = 'pending'; // Some rows have issues but file is valid
      }

      const record = {
        filename: fileData.filename,
        original_name: fileData.originalName || fileData.filename,
        file_size: fileData.size || 0,
        file_type: fileData.type || 'unknown',
        row_count: validation.totalRows,
        valid_rows: validation.validRows,
        invalid_rows: validation.invalidRows,
        status: status,
        validation_errors: validation.errors.length > 0 ? JSON.stringify(validation.errors) : null
      };

      console.log('💾 Saving to uploads table:', {
        filename: record.original_name,
        rows: record.row_count,
        valid: record.valid_rows,
        invalid: record.invalid_rows,
        status: record.status
      });

      if (!this.isSupabaseReady()) {
        const upload = {
          id: this.memoryStore.uploads.length + 1,
          ...record,
          upload_date: new Date().toISOString(),
          user_id: userId
        };
        this.memoryStore.uploads.push(upload);
        console.log('📝 Upload saved to memory (ID:', upload.id, ')');
        return upload.id;
      }

      // Only insert columns that exist in your uploads table
      const insertData = {
        filename: fileData.filename,
        row_count: validation.totalRows,
        status: status,
        // Note: original_name, file_size, file_type, valid_rows, invalid_rows, validation_errors 
        // are not in the uploads table schema, so we don't include them
      };

      const { data, error } = await supabase
        .from('uploads')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('❌ Supabase insert error:', error);
        throw error;
      }
      
      console.log('✅ Upload saved to Supabase (ID:', data.id, ')');
      return data.id;
    } catch (error) {
      console.error('❌ Error saving upload record:', error);
      throw error;
    }
  }

  // Legacy method for compatibility
  async saveUploadRecordOld(fileData, processedData, userId = null) {
    try {
      const record = {
        filename: fileData.filename,
        row_count: processedData.rowCount || 0,
        status: 'processed'
      };

      console.log('💾 Saving sales data to uploads table:', record);

      if (!this.isSupabaseReady()) {
        const upload = {
          id: this.memoryStore.uploads.length + 1,
          ...record,
          upload_date: new Date().toISOString(),
          user_id: userId
        };
        this.memoryStore.uploads.push(upload);
        console.log('📝 Sales upload saved to memory (ID:', upload.id, ')');
        return upload.id;
      }

      const { data, error } = await supabase
        .from('uploads')
        .insert(record)
        .select()
        .single();

      if (error) {
        console.error('❌ Supabase insert error:', error);
        throw error;
      }
      
      console.log('✅ Sales upload saved to Supabase (ID:', data.id, ')');
      return data.id;
    } catch (error) {
      console.error('❌ Error saving upload record:', error);
      throw error;
    }
  }

  // Rest of the methods remain the same...
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
      return data || [];
    } catch (error) {
      console.error('Error fetching uploads:', error);
      throw error;
    }
  }

  async getUploadById(id) {
    try {
      if (!this.isSupabaseReady()) {
        return this.memoryStore.uploads.find((upload) => upload.id === Number(id)) || null;
      }

      const { data, error } = await supabase
        .from('uploads')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Error fetching upload:', error);
      throw error;
    }
  }

  async updateUploadStatus(id, status, errorMessage = null) {
    try {
      const updateData = { status: status };

      if (!this.isSupabaseReady()) {
        const upload = this.memoryStore.uploads.find((item) => item.id === Number(id));
        if (!upload) return null;
        upload.status = status;
        return upload;
      }

      const { data, error } = await supabase
        .from('uploads')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating upload status:', error);
      throw error;
    }
  }

  async deleteUpload(id) {
    try {
      const upload = await this.getUploadById(id);
      if (!upload) {
        throw new Error('Upload not found');
      }

      if (!this.isSupabaseReady()) {
        this.memoryStore.uploads = this.memoryStore.uploads.filter((item) => item.id !== Number(id));
        return true;
      }

      const { error } = await supabase
        .from('uploads')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting upload:', error);
      throw error;
    }
  }

  async getUploadStats() {
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

      // Get uploads stats - ONLY SALES DATA (everything in uploads table)
      const { data: uploads = [], error: uploadError } = await supabase
        .from('uploads')
        .select('status, row_count, upload_date');

      if (uploadError) throw uploadError;

      // Get menu items count from products table (separate from sales)
      let menuItemsCount = 0;
      try {
        const { count, error: productError } = await supabase
          .from('products')
          .select('*', { count: 'exact', head: true });

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