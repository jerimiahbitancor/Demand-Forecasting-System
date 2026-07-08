// services/fileProcessor.js
const xlsx = require('xlsx');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const path = require('path');

class FileProcessor {
  async processFile(filePath, originalName) {
    try {
      const ext = path.extname(originalName).toLowerCase();
      let data;

      if (ext === '.csv') {
        data = await this.processCSV(filePath);
      } else if (ext === '.xlsx' || ext === '.xls') {
        data = this.processExcel(filePath);
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

  processCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    });
  }

  processExcel(filePath) {
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      return data;
    } catch (error) {
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
    const lowerHeaders = headers.map(h => h.toLowerCase());

    // Different validation rules based on file type
    switch(fileType) {
      case 'sales': {
        // Required columns for sales
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

        // Validate each row
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
        // Required columns for menu
        const requiredColumns = ['Product Name', 'Ingredients', 'Quantity', 'Unit', 'Price'];
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

        // Validate each row
        data.forEach((row, index) => {
          const rowNumber = index + 2;
          const rowErrors = [];
          
          // Get actual column names (case insensitive)
          const productNameCol = headers.find(h => h.toLowerCase() === 'product name');
          const ingredientsCol = headers.find(h => h.toLowerCase() === 'ingredients');
          const quantityCol = headers.find(h => h.toLowerCase() === 'quantity');
          const unitCol = headers.find(h => h.toLowerCase() === 'unit');
          const priceCol = headers.find(h => h.toLowerCase() === 'price');

          const productName = row[productNameCol];
          const ingredients = row[ingredientsCol];
          const quantity = row[quantityCol];
          const unit = row[unitCol];
          const price = row[priceCol];

          // Validate Product Name
          if (!productName || productName.toString().trim() === '') {
            rowErrors.push('Product Name is empty');
          }

          // Validate Ingredients
          if (!ingredients || ingredients.toString().trim() === '') {
            rowErrors.push('Ingredients is empty');
          }

          // Validate Quantity (must be a number)
          if (!quantity || quantity.toString().trim() === '') {
            rowErrors.push('Quantity is empty');
          } else if (isNaN(parseFloat(quantity))) {
            rowErrors.push('Quantity must be a valid number');
          }

          // Validate Unit
          if (!unit || unit.toString().trim() === '') {
            rowErrors.push('Unit is empty');
          }

          // Validate Price (must be a number)
          if (!price || price.toString().trim() === '') {
            rowErrors.push('Price is empty');
          } else if (isNaN(parseFloat(price))) {
            rowErrors.push('Price must be a valid number');
          }

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
        // Required columns for historical
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
          
          const dateCol = headers.find(h => h.toLowerCase() === 'date');
          const volumeCol = headers.find(h => h.toLowerCase() === 'sales volume');
          
          const date = row[dateCol];
          const volume = row[volumeCol];

          if (!date || date.toString().trim() === '') {
            rowErrors.push('Date is empty');
          }

          if (!volume || volume.toString().trim() === '') {
            rowErrors.push('Sales Volume is empty');
          } else if (isNaN(parseFloat(volume))) {
            rowErrors.push('Sales Volume must be a valid number');
          }

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
        // No validation for unknown types
        validCount = data.length;
      }
    }

    return {
      totalRows: data.length,
      validRows: validCount,
      invalidRows: invalidCount,
      errors: errors.slice(0, 10) // Limit to first 10 errors
    };
  }

  // Helper method to get column names case-insensitively
  getColumnNames(data) {
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  }

  // Helper method to find column case-insensitively
  findColumn(headers, columnName) {
    return headers.find(h => h.toLowerCase() === columnName.toLowerCase());
  }
}

module.exports = new FileProcessor();