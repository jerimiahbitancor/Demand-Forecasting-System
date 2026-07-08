const supabase = require('../config/supabase');
const fileProcessor = require('./fileProcessor');
const fs = require('fs');
const path = require('path');

class UploadService {
  async saveUploadRecord(fileData, processedData, userId = null) {
    try {
      const { data, error } = await supabase
        .from('uploads')
        .insert({
          filename: fileData.filename,
          original_name: fileData.originalName,
          file_path: fileData.path,
          file_size: fileData.size,
          file_type: fileData.type,
          row_count: processedData.rowCount,
          status: 'processed',
          metadata: {
            headers: processedData.headers,
            validation: processedData.validation,
            sample: processedData.data.slice(0, 5)
          },
          user_id: userId
        })
        .select()
        .single();

      if (error) throw error;
      return data.id;
    } catch (error) {
      console.error('Error saving upload record:', error);
      throw error;
    }
  }

  async getUploads(options = {}) {
    try {
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
      return data;
    } catch (error) {
      console.error('Error fetching uploads:', error);
      throw error;
    }
  }

  async getUploadById(id) {
    try {
      const { data, error } = await supabase
        .from('uploads')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Record not found
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
      const { data, error } = await supabase
        .from('uploads')
        .update({
          status: status,
          error_message: errorMessage,
          processed_date: status === 'processed' ? new Date().toISOString() : null
        })
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
      // Get file path first
      const upload = await this.getUploadById(id);
      if (!upload) {
        throw new Error('Upload not found');
      }

      // Delete file from filesystem
      const filePath = path.join(__dirname, '..', upload.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete from Supabase
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
      const { data, error } = await supabase
        .from('uploads')
        .select('status, row_count');
      
      if (error) throw error;
      
      const stats = {
        total_uploads: data.length,
        processed: data.filter(u => u.status === 'processed').length,
        pending: data.filter(u => u.status === 'pending').length,
        failed: data.filter(u => u.status === 'failed').length,
        total_rows: data.reduce((sum, u) => sum + (u.row_count || 0), 0)
      };
      
      return stats;
    } catch (error) {
      console.error('Error fetching stats:', error);
      throw error;
    }
  }
}

module.exports = new UploadService();