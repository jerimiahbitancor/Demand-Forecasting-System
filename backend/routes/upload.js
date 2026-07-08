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

// Upload file endpoint (protected)
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

      // Process file from memory buffer
      const processedData = await fileProcessor.processFile(
        file.buffer,
        file.originalname,
        file.mimetype
      );

      console.log('📊 File processed:', processedData.rowCount, 'rows');

      let result;
      let uploadId = null;

      // Handle different file types
      if (fileType === 'menu') {
        // Process menu data - insert into products and product_ingredients ONLY
        result = await menuService.processMenuData(processedData.data);
        
        console.log('✅ Menu data processed:', {
          totalRows: result.validation.totalRows,
          validRows: result.validation.validRows,
          invalidRows: result.validation.invalidRows,
          productsInserted: result.productsInserted || 0,
          ingredientsInserted: result.ingredientsInserted || 0
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
            productIngredientRelations: result.productIngredientRelations || 0
          }
        });
      } else {
        // Process sales data - ONLY goes to uploads table
        const validation = fileProcessor.validateData(processedData.data, fileType);

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

        return res.status(201).json({
          success: true,
          message: 'Sales data uploaded successfully',
          uploadId: uploadId,
          summary: {
            totalRows: processedData.rowCount,
            validRows: validation.validRows,
            invalidRows: validation.invalidRows,
            errors: validation.errors
          }
        });
      }

    } catch (error) {
      console.error('❌ Upload error:', error);
      
      res.status(500).json({ 
        success: false,
        error: 'Failed to process upload',
        details: error.message 
      });
    }
  }
);

module.exports = router;