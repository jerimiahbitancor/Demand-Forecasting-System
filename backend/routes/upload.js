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

      // Check for duplicate upload (same filename within last hour)
      try {
        const isDuplicate = await uploadService.checkDuplicateUpload(file.originalname, userId);
        if (isDuplicate) {
          console.log(`⚠️ Duplicate upload detected: ${file.originalname} for user ${userId}`);
          return res.status(409).json({
            success: false,
            error: 'Duplicate upload detected',
            message: 'This file has already been uploaded recently. Please wait before uploading again.'
          });
        }
      } catch (dupError) {
        console.error('Error checking duplicate:', dupError);
        // Continue with upload if duplicate check fails (fail open)
      }

      // Check if already processing
      if (uploadService.isUploadProcessing(file.originalname, userId)) {
        console.log(`⏳ Upload already in progress: ${file.originalname}`);
        return res.status(409).json({
          success: false,
          error: 'Upload in progress',
          message: 'This file is already being processed. Please wait.'
        });
      }

      const processedData = await fileProcessor.processFile(
        file.buffer,
        file.originalname,
        file.mimetype
      );

      console.log('📊 File processed:', processedData.rowCount, 'rows');

      let result;
      let uploadId = null;

      if (fileType === 'menu') {
        // Mark as processing
        uploadService.markUploadProcessing(file.originalname, userId);
        
        try {
          result = await menuService.processMenuData(processedData.data, userId);
          
          console.log('✅ Menu data processed:', {
            totalRows: result.validation.totalRows,
            validRows: result.validation.validRows,
            invalidRows: result.validation.invalidRows,
            productsInserted: result.productsInserted || 0,
            ingredientsInserted: result.ingredientsInserted || 0,
            userId: userId
          });

          // Mark as complete
          uploadService.markUploadComplete(file.originalname, userId);

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
        } catch (menuError) {
          // Mark as complete on error
          uploadService.markUploadComplete(file.originalname, userId);
          throw menuError;
        }
      } else {
        // SALES DATA - Use updated validation with new columns
        // Mark as processing
        uploadService.markUploadProcessing(file.originalname, userId);
        
        try {
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
            uploadDate: validation.uploadDate || new Date().toISOString().split('T')[0]
          };

          console.log('✅ Sales data processed:', summary);

          // Mark as complete
          uploadService.markUploadComplete(file.originalname, userId);

          return res.status(201).json({
            success: true,
            message: 'Sales data uploaded successfully',
            uploadId: uploadId,
            summary: summary
          });
        } catch (salesError) {
          // Mark as complete on error
          uploadService.markUploadComplete(file.originalname, userId);
          throw salesError;
        }
      }

    } catch (error) {
      console.error('❌ Upload error:', error);
      
      // Clean up processing lock if it exists
      if (req.file) {
        const userId = req.user?.id || null;
        uploadService.markUploadComplete(req.file.originalname, userId);
      }
      
      // Handle duplicate error
      if (error.message && error.message.includes('Duplicate upload')) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate upload detected',
          details: error.message
        });
      }
      
      if (error.message && error.message.includes('Invalid file format')) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid file format',
          details: error.message 
        });
      }
      
      if (error.message && error.message.includes('Missing required columns')) {
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
      
      // Check for duplicate from the service
      if (error.message && error.message.includes('already been uploaded')) {
        return res.status(409).json({ 
          success: false,
          error: 'Duplicate upload',
          details: error.message 
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
      count: uploads.length,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
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

// PUT /api/upload/:id - Update upload (status, etc.)
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const uploadId = parseInt(req.params.id);
    const { status, errorMessage } = req.body;
    
    if (isNaN(uploadId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid upload ID'
      });
    }
    
    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }
    
    const upload = await uploadService.updateUploadStatus(
      uploadId,
      status,
      errorMessage || null,
      userId
    );
    
    if (!upload) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found or you do not have permission'
      });
    }
    
    res.json({
      success: true,
      data: upload,
      message: 'Upload updated successfully'
    });
  } catch (error) {
    console.error('Error updating upload:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update upload',
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

// GET /api/upload/check-duplicate - Check if upload exists
router.get('/check-duplicate', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const { filename } = req.query;
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        error: 'Filename is required'
      });
    }
    
    const isDuplicate = await uploadService.checkDuplicateUpload(filename, userId);
    
    res.json({
      success: true,
      isDuplicate: isDuplicate,
      filename: filename
    });
  } catch (error) {
    console.error('Error checking duplicate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check duplicate',
      details: error.message
    });
  }
});

module.exports = router;