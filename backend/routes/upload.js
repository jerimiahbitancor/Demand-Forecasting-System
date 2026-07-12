// routes/upload.js
const express = require('express');
const router = express.Router();
const { uploadSingle } = require('../middleware/upload');
const { validateFile, validateUploadData } = require('../middleware/validation');
const virusScan = require('../middleware/virus-scan');
const authenticate = require('../middleware/auth');
const fileProcessor = require('../services/fileProcessor');
const uploadService = require('../services/uploadService');
const menuService = require('../services/menuService');

router.post(
  '/',
  authenticate,
  uploadSingle,
  validateFile,
  virusScan,
  validateUploadData,
  async (req, res) => {
    try {
      const { fileType } = req.body;
      const file = req.file;
      
      const userId = req.user?.id || null;
      
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      console.log('📄 Processing file:', file.originalname, 'Type:', fileType);
      console.log('👤 User ID:', userId);

      const processedData = await fileProcessor.processFile(
        file.buffer,
        file.originalname,
        file.mimetype
      );

      console.log('📊 File processed:', processedData.rowCount, 'rows');

      let result;
      let uploadId = null;

      if (fileType === 'menu') {
        result = await menuService.processMenuData(processedData.data, userId);
        
        console.log('✅ Menu data processed:', {
          totalRows: result.validation.totalRows,
          validRows: result.validation.validRows,
          invalidRows: result.validation.invalidRows,
          productsInserted: result.productsInserted || 0,
          ingredientsInserted: result.ingredientsInserted || 0,
          userId: userId
        });

        return res.status(201).json({
          success: true,
          message: 'Menu data uploaded and processed successfully',
          uploadId: null,
          summary: {
            totalRows: result.validation.totalRows,
            validRows: result.validation.validRows,
            invalidRows: result.validation.invalidRows,
            errors: result.validation.errors,
            productsInserted: result.productsInserted || 0,
            ingredientsInserted: result.ingredientsInserted || 0,
            productIngredientRelations: result.productIngredientRelations || 0,
            userId: userId
          }
        });
      } else {
        // SALES DATA - Use updated validation with new columns
        const validation = await uploadService.validateSalesData(
          processedData.data, 
          file.originalname
        );

        uploadId = await uploadService.saveUploadRecord(
          {
            filename: file.filename || `${Date.now()}-${file.originalname}`,
            originalName: file.originalname,
            size: file.size,
            type: file.mimetype
          },
          {
            rowCount: processedData.rowCount,
            headers: processedData.headers,
            data: processedData.data,
            validation: validation
          },
          userId
        );

        const summary = {
          totalRows: processedData.rowCount,
          validRows: validation.validRows || 0,
          invalidRows: validation.invalidRows || 0,
          errors: validation.errors || [],
          uploadDate: validation.uploadDate || new Date().toISOString().split('T')[0],
          totals: validation.totals || {
            grossSales: 0,
            netSales: 0,
            itemsSold: 0
          }
        };

        console.log('✅ Sales data processed:', summary);

        return res.status(201).json({
          success: true,
          message: 'Sales data uploaded successfully',
          uploadId: uploadId,
          summary: summary
        });
      }

    } catch (error) {
      console.error('❌ Upload error:', error);
      
      if (error.message.includes('Invalid file format')) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid file format',
          details: error.message 
        });
      }
      
      if (error.message.includes('Missing required columns')) {
        return res.status(400).json({ 
          success: false,
          error: 'Missing required columns',
          details: error.message,
          requiredColumns: [
            'Item name',
            'Category',
            'Items sold',
            'Gross sales',
            'Items refunded',
            'Refunds',
            'Net sales'
          ]
        });
      }
      
      res.status(500).json({ 
        success: false,
        error: 'Failed to process upload',
        details: error.message 
      });
    }
  }
);

// GET /api/upload - Get all uploads
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const { status, limit = 50, offset = 0 } = req.query;
    
    console.log('📋 Fetching uploads for user:', userId);
    
    const uploads = await uploadService.getUploads({
      userId,
      status,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      data: uploads,
      count: uploads.length
    });
  } catch (error) {
    console.error('Error fetching uploads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch uploads',
      details: error.message
    });
  }
});

// GET /api/upload/:id - Get specific upload
router.get('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const uploadId = parseInt(req.params.id);
    
    if (isNaN(uploadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid upload ID'
      });
    }
    
    const upload = await uploadService.getUploadById(uploadId, userId);
    
    if (!upload) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found'
      });
    }
    
    res.json({
      success: true,
      data: upload
    });
  } catch (error) {
    console.error('Error fetching upload:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch upload',
      details: error.message
    });
  }
});

// DELETE /api/upload/:id - Delete upload
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const uploadId = parseInt(req.params.id);
    
    if (isNaN(uploadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid upload ID'
      });
    }
    
    const success = await uploadService.deleteUpload(uploadId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found or you do not have permission'
      });
    }
    
    res.json({
      success: true,
      message: 'Upload deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting upload:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete upload',
      details: error.message
    });
  }
});

// GET /api/upload/stats/summary - Get upload statistics
router.get('/stats/summary', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    
    console.log('📊 Fetching stats for user:', userId);
    
    const stats = await uploadService.getUploadStats(userId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      details: error.message
    });
  }
});

module.exports = router;