// services/fileProcessor.js
const xlsx = require('xlsx');
const path = require('path');

class FileProcessor {
  constructor() {
    // Updated required columns for sales data - only the columns you need
    this.salesRequiredColumns = [
      'Item name',
      'Category',
      'Items sold',
      'Gross sales',
      'Items refunded',
      'Refunds',
      'Net sales'
    ];
    
    this.menuRequiredColumns = [
      'Product Name',
      'Ingredients',
      'Quantity',
      'Unit',
      'Price',
      'Category'
    ];
  }

  // Normalize column name for flexible matching
  normalizeColumnName(name) {
    if (!name) return '';
    let normalized = name.toString().trim().replace(/\s+/g, ' ');
    
    // Special mappings for common variations
    const mappings = {
      'item name': 'Item name',
      'category': 'Category',
      'items sold': 'Items sold',
      'gross sales': 'Gross sales',
      'items refunded': 'Items refunded',
      'refunds': 'Refunds',
      'net sales': 'Net sales'
    };
    
    const lowerKey = normalized.toLowerCase();
    return mappings[lowerKey] || normalized;
  }

  async processFile(fileBuffer, originalName, mimeType) {
    try {
      const ext = path.extname(originalName).toLowerCase();
      let data;

      if (ext === '.csv' || mimeType === 'text/csv' || mimeType === 'application/csv') {
        data = await this.processCSV(fileBuffer);
      } else if (ext === '.xlsx' || ext === '.xls' || 
                 mimeType === 'application/vnd.ms-excel' || 
                 mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        data = this.processExcel(fileBuffer);
      } else {
        throw new Error('Unsupported file format. Please upload CSV or Excel files.');
      }

      // Clean up data - trim all string values
      if (data.length > 0) {
        data = data.map(row => {
          const cleanRow = {};
          Object.keys(row).forEach(key => {
            const cleanKey = key.trim();
            const value = row[key];
            cleanRow[cleanKey] = typeof value === 'string' ? value.trim() : value;
          });
          return cleanRow;
        });
      }

      console.log(`📄 File processed: ${data.length} rows`);
      if (data.length > 0) {
        console.log('📋 Headers found:', Object.keys(data[0]));
      }

      return {
        rowCount: data.length,
        data: data,
        headers: data.length > 0 ? Object.keys(data[0]) : []
      };
    } catch (error) {
      console.error('File processing error:', error);
      throw error;
    }
  }

  processCSV(fileBuffer) {
    return new Promise((resolve, reject) => {
      const results = [];
      const text = fileBuffer.toString('utf8');
      const lines = text.split('\n');
      
      if (lines.length === 0) {
        resolve(results);
        return;
      }

      // Parse CSV with proper handling of quoted fields
      const headers = this.parseCSVLine(lines[0]).map(h => h.trim());
      
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          const values = this.parseCSVLine(lines[i]);
          const row = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          results.push(row);
        }
      }
      
      resolve(results);
    });
  }

  // Helper to parse CSV line with quoted fields
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  processExcel(fileBuffer) {
    try {
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, {
        defval: '',
        raw: true,
        header: 1
      });
      
      if (data.length === 0) return [];
      
      // First row is headers
      const headers = data[0].map(h => h ? h.toString().trim() : '');
      
      // Convert to objects with header keys
      const result = [];
      for (let i = 1; i < data.length; i++) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = data[i][index] !== undefined ? data[i][index] : '';
        });
        result.push(row);
      }
      
      return result;
    } catch (error) {
      console.error('Excel processing error:', error);
      throw error;
    }
  }

  validateData(data, fileType) {
    const errors = [];
    let validCount = 0;
    let invalidCount = 0;

    if (data.length === 0) {
      return {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        errors: [{ row: 0, message: 'File is empty' }]
      };
    }

    const headers = Object.keys(data[0]);
    let requiredColumns = [];

    switch(fileType) {
      case 'sales':
        requiredColumns = this.salesRequiredColumns;
        break;
      case 'menu':
        requiredColumns = this.menuRequiredColumns;
        break;
      default:
        validCount = data.length;
        return {
          totalRows: data.length,
          validRows: validCount,
          invalidRows: 0,
          errors: []
        };
    }

    // Check for missing columns using flexible matching
    const missingColumns = [];
    const columnMap = {};
    
    requiredColumns.forEach(col => {
      // Try exact match first
      let found = headers.some(h => h.trim() === col);
      
      // Try case-insensitive match
      if (!found) {
        found = headers.some(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      }
      
      // Try normalized match
      if (!found) {
        const normalizedCol = this.normalizeColumnName(col);
        found = headers.some(h => this.normalizeColumnName(h) === normalizedCol);
      }
      
      if (!found) {
        missingColumns.push(col);
      } else {
        // Find the actual column name in the headers
        const actualCol = headers.find(h => 
          h.trim() === col || 
          h.toLowerCase().trim() === col.toLowerCase().trim() ||
          this.normalizeColumnName(h) === this.normalizeColumnName(col)
        );
        columnMap[col] = actualCol || col;
      }
    });

    if (missingColumns.length > 0) {
      errors.push({
        row: 1,
        message: `Missing required columns: ${missingColumns.join(', ')}. Your file has: ${headers.join(', ')}. Required columns: ${requiredColumns.join(', ')}`
      });
      return {
        totalRows: data.length,
        validRows: 0,
        invalidRows: data.length,
        errors: errors,
        columnMap: columnMap
      };
    }

    // Validate each row
    data.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowErrors = [];
      
      requiredColumns.forEach(col => {
        const actualCol = columnMap[col] || col;
        const value = row[actualCol];
        
        // Check if value is empty
        if (value === undefined || value === null || value === '' || value === ' ') {
          rowErrors.push(`${col} is empty`);
        }
        
        // For numeric columns in sales data
        if (fileType === 'sales') {
          const numericColumns = ['Items sold', 'Gross sales', 'Items refunded', 'Refunds', 'Net sales'];
          if (numericColumns.includes(col)) {
            const numValue = parseFloat(value);
            if (value !== '' && value !== null && value !== undefined && isNaN(numValue)) {
              rowErrors.push(`${col} must be a valid number`);
            }
          }
        }
      });

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
        invalidCount++;
      } else {
        validCount++;
      }
    });

    return {
      totalRows: data.length,
      validRows: validCount,
      invalidRows: invalidCount,
      errors: errors.slice(0, 10),
      columnMap: columnMap
    };
  }

  getColumnNames(data) {
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  }

  findColumn(headers, columnName) {
    // Try exact match
    let found = headers.find(h => h.trim() === columnName);
    if (found) return found;
    
    // Try case-insensitive match
    found = headers.find(h => h.toLowerCase().trim() === columnName.toLowerCase().trim());
    if (found) return found;
    
    // Try normalized match
    const normalizedCol = this.normalizeColumnName(columnName);
    found = headers.find(h => this.normalizeColumnName(h) === normalizedCol);
    return found || null;
  }
}

module.exports = new FileProcessor();