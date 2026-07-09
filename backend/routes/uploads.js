// routes/uploads.js
const express = require('express');
const router = express.Router();
const uploadService = require('../services/uploadService');
const authenticate = require('../middleware/auth');

// Get all uploads with pagination (filtered by user)
router.get('/', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { status, limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;
    
    console.log('📊 Fetching uploads for user:', userId);
    
    const uploads = await uploadService.getUploads({
      status: status || null,
      limit: parseInt(limit),
      offset: parseInt(offset),
      userId: userId
    });

    res.json({
      success: true,
      data: uploads,
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

// Get single upload by ID (protected)
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    const upload = await uploadService.getUploadById(parseInt(req.params.id), userId);
    
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

// Update upload status (protected)
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { status } = req.body;
    const userId = req.user.id;
    
    if (!status || !['pending', 'processing', 'processed', 'failed'].includes(status)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid status. Must be pending, processing, processed, or failed' 
      });
    }

    const upload = await uploadService.updateUploadStatus(
      parseInt(req.params.id),
      status,
      req.body.errorMessage || null,
      userId
    );

    if (!upload) {
      return res.status(404).json({ 
        success: false,
        error: 'Upload not found' 
      });
    }

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: upload
    });
  } catch (error) {
    console.error('Error updating upload status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update upload status',
      details: error.message 
    });
  }
});

// Delete upload (protected)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    await uploadService.deleteUpload(parseInt(req.params.id), userId);
    
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

// Get upload statistics (protected)
router.get('/stats/summary', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
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