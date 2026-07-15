// backend/middleware/validation.js
const path = require('path');

const validateFile = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const file = req.file;
  
  // Validate file size (20MB)
  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    return res.status(400).json({ 
      error: 'File size exceeds 20MB limit' 
    });
  }

  // Validate file type
  const allowedTypes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/csv'
  ];
  
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (!allowedTypes.includes(file.mimetype) && !allowedExtensions.includes(ext)) {
    return res.status(400).json({ 
      error: 'Invalid file type. Only CSV and Excel files are allowed.' 
    });
  }

  next();
};

const validateUploadData = (req, res, next) => {
  const { fileType } = req.body;
  
  if (!fileType) {
    return res.status(400).json({ error: 'File type is required' });
  }

  const validTypes = ['sales', 'menu', 'historical'];
  if (!validTypes.includes(fileType)) {
    return res.status(400).json({ 
      error: 'Invalid file type. Must be sales, menu, or historical' 
    });
  }

  next();
};

module.exports = { validateFile, validateUploadData };