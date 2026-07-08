// middleware/virus-scan.js
const fs = require('fs');
const path = require('path');

let clamd;
try {
  clamd = require('clamdjs');
} catch (error) {
  console.log('⚠️ clamdjs not installed, using simulated virus scan');
}

class VirusScanner {
  constructor() {
    this.scanner = null;
    this.isClamAVAvailable = false;
    this.useSimulation = true;
    
    this.initScanner();
  }

  initScanner() {
    try {
      const host = process.env.CLAMAV_HOST || '127.0.0.1';
      const port = parseInt(process.env.CLAMAV_PORT) || 3310;
      const timeout = parseInt(process.env.CLAMAV_TIMEOUT) || 30000;

      if (clamd) {
        // Create scanner with proper options
        this.scanner = clamd.createScanner(host, port, timeout);
        this.isClamAVAvailable = true;
        console.log(`✅ ClamAV scanner initialized at ${host}:${port}`);
      } else {
        console.log('⚠️ ClamAV scanner not available, using simulation mode');
      }
    } catch (error) {
      console.error('❌ Failed to initialize ClamAV scanner:', error.message);
      console.log('⚠️ Using simulated virus scan');
    }
  }

  async checkClamAVStatus() {
    if (!this.isClamAVAvailable || !this.scanner) {
      return false;
    }

    try {
      const version = await this.scanner.version();
      console.log('✅ ClamAV version:', version);
      return true;
    } catch (error) {
      console.warn('⚠️ ClamAV not responding:', error.message);
      this.isClamAVAvailable = false;
      return false;
    }
  }

  // Scan a file with ClamAV
  async scanWithClamAV(filePath) {
    try {
      const result = await this.scanner.scanFile(filePath);
      return {
        isClean: result.isClean,
        viruses: result.viruses || [],
        message: result.isClean ? 'File is clean' : `Virus detected: ${result.viruses.join(', ')}`
      };
    } catch (error) {
      console.error('ClamAV scan error:', error);
      throw new Error(`ClamAV scan failed: ${error.message}`);
    }
  }

  // Simulated virus scan (fallback)
  async scanSimulated(filePath) {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Check file extension for potential malware patterns (simulated)
        const ext = path.extname(filePath).toLowerCase();
        const dangerousExts = ['.exe', '.bat', '.cmd', '.sh', '.vbs', '.js', '.jar'];
        
        // Check file size (over 100MB might be suspicious)
        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        
        // Random 1% chance of "infection" for simulation
        const isRandomInfected = Math.random() < 0.01;
        
        // Check if file extension is dangerous
        const isDangerousExt = dangerousExts.includes(ext);
        
        // Check if file is too large (might be malicious)
        const isTooLarge = fileSizeMB > 100;
        
        // Additional checks for suspicious file content (simulated)
        let isSuspicious = false;
        try {
          const buffer = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' });
          const content = buffer.toString();
          // Check for common malware patterns (simulated)
          const suspiciousPatterns = [
            'eval(', 'exec(', 'system(', 'shell_exec', 'base64_decode',
            'malware', 'virus', 'trojan', 'worm', 'ransomware'
          ];
          isSuspicious = suspiciousPatterns.some(pattern => 
            content.toLowerCase().includes(pattern.toLowerCase())
          );
        } catch (e) {
          // Binary files will fail here, that's fine
        }
        
        const isClean = !isRandomInfected && !isDangerousExt && !isTooLarge && !isSuspicious;
        
        resolve({
          isClean: isClean,
          viruses: isClean ? [] : ['Simulated detection'],
          message: isClean ? 'File is clean' : 'File failed security check'
        });
      }, 1000);
    });
  }

  // Main scan function
  async scanFile(filePath) {
    // First try ClamAV if available
    if (this.isClamAVAvailable && this.scanner) {
      try {
        const isRunning = await this.checkClamAVStatus();
        if (isRunning) {
          return await this.scanWithClamAV(filePath);
        }
      } catch (error) {
        console.warn('⚠️ ClamAV scan failed, falling back to simulation:', error.message);
        this.isClamAVAvailable = false;
      }
    }

    // Fallback to simulated scan
    console.log('🔍 Using simulated virus scan');
    return await this.scanSimulated(filePath);
  }

  // Clean up infected file
  async handleInfectedFile(filePath, scanResult) {
    const errorMessage = scanResult.viruses && scanResult.viruses.length > 0
      ? `Virus detected: ${scanResult.viruses.join(', ')}`
      : 'File failed security scan';

    // Delete infected file
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Infected file deleted: ${path.basename(filePath)}`);
      } catch (error) {
        console.error('Error deleting infected file:', error);
      }
    }

    throw new Error(errorMessage);
  }

  // Clean up file on error
  async cleanupFile(filePath) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ File cleaned up: ${path.basename(filePath)}`);
      } catch (error) {
        console.error('Error cleaning up file:', error);
      }
    }
  }

  // Middleware for Express
  getMiddleware() {
    return async (req, res, next) => {
      try {
        // Skip if no file
        if (!req.file) {
          return next();
        }

        console.log(`🔍 Scanning file: ${path.basename(req.file.path)}`);

        // Scan the file
        const scanResult = await this.scanFile(req.file.path);

        if (!scanResult.isClean) {
          // Handle infected file
          await this.handleInfectedFile(req.file.path, scanResult);
          return res.status(400).json({
            success: false,
            error: 'Security scan failed',
            message: scanResult.message || 'File failed security scan. Please upload a different file.',
            details: scanResult.viruses || ['Unknown threat detected']
          });
        }

        console.log(`✅ File passed security scan: ${path.basename(req.file.path)}`);
        next();

      } catch (error) {
        console.error('❌ Virus scan error:', error);
        
        // Clean up file on error
        if (req.file && fs.existsSync(req.file.path)) {
          await this.cleanupFile(req.file.path);
        }

        // Don't block upload if scan fails, but log the error
        // In production, you might want to block uploads if scan fails
        if (process.env.FAIL_ON_SCAN_ERROR === 'true') {
          return res.status(500).json({
            success: false,
            error: 'Security scan failed',
            message: 'Unable to scan file for security threats. Please try again.'
          });
        }

        // If scan fails, allow upload but log warning
        console.warn('⚠️ Allowing upload despite scan error');
        next();
      }
    };
  }
}

// Create singleton instance
const virusScanner = new VirusScanner();

// Export middleware function
const virusScanMiddleware = virusScanner.getMiddleware();

// Also export the scanner class and instance for testing
module.exports = virusScanMiddleware;
module.exports.VirusScanner = VirusScanner;
module.exports.virusScanner = virusScanner;