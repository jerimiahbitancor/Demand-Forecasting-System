// services/fileProcessor.js
const xlsx = require('xlsx');
const csv = require('csv-parser');
const { Readable } = require('stream');
const path = require('path');

class FileProcessor {
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
        throw new Error('Unsupported file format');
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

      const headers = lines[0].split(',').map(h => h.trim());
      
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          const values = lines[i].split(',').map(v => v.trim());
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

  processExcel(fileBuffer) {
    try {
      // Use buffer directly instead of file path
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      return data;
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

    switch(fileType) {
      case 'sales': {
        const requiredColumns = ['Date', 'Item Name', 'Item Sold', 'Category', 'Net Sales'];
        const missingColumns = [];
        
        requiredColumns.forEach(col => {
          const found = headers.some(h => h.toLowerCase() === col.toLowerCase());
          if (!found) {
            missingColumns.push(col);
          }
        });

        if (missingColumns.length > 0) {
          errors.push({
            row: 1,
            message: `Missing required columns: ${missingColumns.join(', ')}. Found: ${headers.join(', ')}`
          });
          return {
            totalRows: data.length,
            validRows: 0,
            invalidRows: data.length,
            errors: errors
          };
        }

        data.forEach((row, index) => {
          const rowNumber = index + 2;
          const rowErrors = [];
          
          requiredColumns.forEach(col => {
            const actualCol = headers.find(h => h.toLowerCase() === col.toLowerCase());
            const value = row[actualCol];
            if (value === undefined || value === null || value === '' || value === ' ') {
              rowErrors.push(`${col} is empty`);
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
        break;
      }

      case 'menu': {
        const requiredColumns = ['Product Name', 'Ingredients', 'Quantity', 'Unit', 'Price', 'Category'];
        const missingColumns = [];
        
        requiredColumns.forEach(col => {
          const found = headers.some(h => h.toLowerCase() === col.toLowerCase());
          if (!found) {
            missingColumns.push(col);
          }
        });

        if (missingColumns.length > 0) {
          errors.push({
            row: 1,
            message: `Missing required columns: ${missingColumns.join(', ')}. Found: ${headers.join(', ')}`
          });
          return {
            totalRows: data.length,
            validRows: 0,
            invalidRows: data.length,
            errors: errors
          };
        }

        data.forEach((row, index) => {
          const rowNumber = index + 2;
          const rowErrors = [];
          
          requiredColumns.forEach(col => {
            const actualCol = headers.find(h => h.toLowerCase() === col.toLowerCase());
            const value = row[actualCol];
            if (value === undefined || value === null || value === '' || value === ' ') {
              rowErrors.push(`${col} is empty`);
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
        break;
      }

      case 'historical': {
        const requiredColumns = ['Date', 'Sales Volume'];
        const missingColumns = [];
        
        requiredColumns.forEach(col => {
          const found = headers.some(h => h.toLowerCase() === col.toLowerCase());
          if (!found) {
            missingColumns.push(col);
          }
        });

        if (missingColumns.length > 0) {
          errors.push({
            row: 1,
            message: `Missing required columns: ${missingColumns.join(', ')}. Found: ${headers.join(', ')}`
          });
          return {
            totalRows: data.length,
            validRows: 0,
            invalidRows: data.length,
            errors: errors
          };
        }

        data.forEach((row, index) => {
          const rowNumber = index + 2;
          const rowErrors = [];
          
          requiredColumns.forEach(col => {
            const actualCol = headers.find(h => h.toLowerCase() === col.toLowerCase());
            const value = row[actualCol];
            if (value === undefined || value === null || value === '' || value === ' ') {
              rowErrors.push(`${col} is empty`);
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
        break;
      }

      default: {
        validCount = data.length;
      }
    }

    return {
      totalRows: data.length,
      validRows: validCount,
      invalidRows: invalidCount,
      errors: errors.slice(0, 10)
    };
  }

  getColumnNames(data) {
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  }

  findColumn(headers, columnName) {
    return headers.find(h => h.toLowerCase() === columnName.toLowerCase());
  }
}

module.exports = new FileProcessor();