const express = require('express');
const router = express.Router();
const { uploadSingle } = require('../middleware/upload');
const { validateFile, validateUploadData } = require('../middleware/validation');
const virusScan = require('../middleware/virus-scan');
const authenticate = require('../middleware/auth');
const fileProcessor = require('../services/fileProcessor');
const uploadService = require('../services/uploadService');
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

      // Process file
      const processedData = await fileProcessor.processFile(
        file.path,
        file.originalname
      );

      // Validate data
      const validation = fileProcessor.validateData(processedData.data, fileType);

      // Save to Supabase
      const uploadId = await uploadService.saveUploadRecord(
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

      // Optional: Delete file after processing to save space
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        uploadId: uploadId,
        summary: {
          totalRows: processedData.rowCount,
          validRows: validation.validRows,
          invalidRows: validation.invalidRows,
          errors: validation.errors
        }
      });

    } catch (error) {
      console.error('Upload error:', error);
      
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