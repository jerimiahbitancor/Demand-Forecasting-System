// backend/middleware/uploadLogo.js
//
// A dedicated, small multer instance for logo uploads — memory storage
// (so the controller gets req.file.buffer to hand straight to Supabase
// Storage), a tight size limit, and image-only mimetypes. Deliberately
// separate from middleware/upload.js, which is tuned for CSV sales data
// with different size/type expectations.

const multer = require('multer');

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'];

const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, matches the frontend's own check
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only PNG, JPG, GIF, or SVG images are allowed'));
    }
    cb(null, true);
  },
});

module.exports = uploadLogo;