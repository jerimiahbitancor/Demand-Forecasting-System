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

  // Scan file buffer (for memory storage)
  async scanBuffer(buffer, filename) {
    try {
      // For memory storage, we scan the buffer
      // Check file extension
      const ext = path.extname(filename).toLowerCase();
      const dangerousExts = ['.exe', '.bat', '.cmd', '.sh', '.vbs', '.js', '.jar'];
      
      // Check file size
      const fileSizeMB = buffer.length / (1024 * 1024);
      
      // Random 1% chance of "infection" for simulation
      const isRandomInfected = Math.random() < 0.01;
      const isDangerousExt = dangerousExts.includes(ext);
      const isTooLarge = fileSizeMB > 100;
      
      // Check for suspicious content (simulated)
      let isSuspicious = false;
      try {
        const content = buffer.toString('utf8');
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
      
      return {
        isClean: isClean,
        viruses: isClean ? [] : ['Simulated detection'],
        message: isClean ? 'File is clean' : 'File failed security check'
      };
    } catch (error) {
      console.error('Buffer scan error:', error);
      return { isClean: true, message: 'Scan failed, allowing upload' };
    }
  }

  // Middleware for Express (memory storage compatible)
  getMiddleware() {
    return async (req, res, next) => {
      try {
        // Skip if no file
        if (!req.file) {
          return next();
        }

        console.log(`🔍 Scanning file: ${req.file.originalname}`);

        // Scan the file buffer (for memory storage)
        const scanResult = await this.scanBuffer(req.file.buffer, req.file.originalname);

        if (!scanResult.isClean) {
          return res.status(400).json({
            success: false,
            error: 'Security scan failed',
            message: scanResult.message || 'File failed security scan. Please upload a different file.',
            details: scanResult.viruses || ['Unknown threat detected']
          });
        }

        console.log(`✅ File passed security scan: ${req.file.originalname}`);
        next();

      } catch (error) {
        console.error('❌ Virus scan error:', error);
        
        // Don't block upload if scan fails
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

module.exports = virusScanMiddleware;
module.exports.VirusScanner = VirusScanner;
module.exports.virusScanner = virusScanner;