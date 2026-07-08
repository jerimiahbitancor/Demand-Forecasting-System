const fs = require('fs');

// In production, integrate with ClamAV or similar
const scanFile = async (filePath) => {
  try {
    // Simulated virus scan
    // For production, use clamdjs or similar library
    // const clamd = require('clamdjs');
    // const scanner = clamd.createScanner('127.0.0.1', 3310);
    // const result = await scanner.scanFile(filePath);
    // return result.isClean;
    
    return new Promise((resolve) => {
      setTimeout(() => {
        // 99% success rate for simulation
        const isClean = Math.random() > 0.01;
        resolve(isClean);
      }, 1000);
    });
  } catch (error) {
    console.error('Virus scan error:', error);
    return false;
  }
};

const virusScanMiddleware = async (req, res, next) => {
  try {
    if (!req.file) {
      return next();
    }

    const isClean = await scanFile(req.file.path);
    
    if (!isClean) {
      // Delete infected file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        error: 'File failed security scan. Please upload a different file.' 
      });
    }

    next();
  } catch (error) {
    console.error('Virus scan error:', error);
    // Don't block upload if scan fails, but log the error
    next();
  }
};

module.exports = virusScanMiddleware;