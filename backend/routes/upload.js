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
const fs = require('fs');

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

      // Process file
      const processedData = await fileProcessor.processFile(
        file.path,
        file.originalname
      );

      console.log('📊 File processed:', processedData.rowCount, 'rows');

      let result;
      let uploadId = null;

      // Handle different file types
      if (fileType === 'menu') {
        // Process menu data - insert into products and product_ingredients ONLY
        result = await menuService.processMenuData(processedData.data);
        
        // DO NOT save menu uploads to uploads table
        // Only log the result
        console.log('✅ Menu data processed:', result);
        
        // Clean up file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }

        return res.status(201).json({
          success: true,
          message: 'Menu data uploaded and processed successfully',
          uploadId: null, // No upload ID for menu data
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
            filename: file.filename,
            originalName: file.originalname,
            path: file.path,
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

        // Clean up file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }

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
      
      // Clean up file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({ 
        error: 'Failed to process upload',
        details: error.message 
      });
    }
  }
);

module.exports = router;