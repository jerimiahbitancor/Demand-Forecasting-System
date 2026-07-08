// services/uploadService.js
const { supabase, isConfigured } = require('../config/supabase');
const fs = require('fs');
const path = require('path');

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

  async saveUploadRecord(fileData, processedData, userId = null) {
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
        sales_records: uploads.reduce((sum, upload) => sum + (upload.row_count || 0), 0), // Only from uploads table
        menu_items: menuItemsCount || 0, // Only from products table
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