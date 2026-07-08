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

    // Different validation rules based on file type
    switch(fileType) {
      case 'sales':
        data.forEach((row, index) => {
          // Check for required fields (case insensitive)
          const rowKeys = Object.keys(row).map(k => k.toLowerCase());
          const hasDate = rowKeys.some(k => k.includes('date'));
          const hasTransaction = rowKeys.some(k => k.includes('transaction') || k.includes('id'));
          const hasAmount = rowKeys.some(k => k.includes('amount') || k.includes('sales') || k.includes('revenue'));
          
          if (!hasDate || !hasTransaction || !hasAmount) {
            errors.push({ 
              row: index + 2, 
              message: 'Missing required fields (date, transaction_id, sales_amount)' 
            });
            invalidCount++;
          } else {
            validCount++;
          }
        });
        break;
      case 'menu':
        data.forEach((row, index) => {
          const rowKeys = Object.keys(row).map(k => k.toLowerCase());
          const hasItem = rowKeys.some(k => k.includes('item') || k.includes('name') || k.includes('product'));
          const hasCategory = rowKeys.some(k => k.includes('category') || k.includes('type'));
          const hasPrice = rowKeys.some(k => k.includes('price') || k.includes('cost') || k.includes('amount'));
          
          if (!hasItem || !hasCategory || !hasPrice) {
            errors.push({ 
              row: index + 2, 
              message: 'Missing required fields (item_name, category, price)' 
            });
            invalidCount++;
          } else {
            validCount++;
          }
        });
        break;
      case 'historical':
        data.forEach((row, index) => {
          const rowKeys = Object.keys(row).map(k => k.toLowerCase());
          const hasDate = rowKeys.some(k => k.includes('date'));
          const hasVolume = rowKeys.some(k => k.includes('sales') || k.includes('volume') || k.includes('amount'));
          
          if (!hasDate || !hasVolume) {
            errors.push({ 
              row: index + 2, 
              message: 'Missing required fields (date, sales_volume)' 
            });
            invalidCount++;
          } else {
            validCount++;
          }
        });
        break;
      default:
        validCount = data.length;
    }

    return {
      totalRows: data.length,
      validRows: validCount,
      invalidRows: invalidCount,
      errors: errors.slice(0, 10) // Limit to first 10 errors
    };
  }
}

module.exports = new FileProcessor();