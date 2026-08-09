// services/menuService.js
const { supabase, isConfigured } = require('../config/supabase');

class MenuService {
  constructor() {
    console.log(`📦 MenuService: Supabase ${isConfigured ? '✅ Connected' : '❌ Using Memory Fallback'}`);
  }

  isSupabaseReady() {
    return Boolean(isConfigured && supabase && typeof supabase.from === 'function');
  }

isValidUserId(userId) {
  if (!userId) return false;
  if (typeof userId === 'number' && Number.isInteger(userId) && userId > 0) {
    return true;
  }
  if (typeof userId === 'string' && userId.length === 36) {
    return true;
  }
  return false;
}

  // Validate file columns
  validateFileColumns(headers, requiredColumns) {
    const missingColumns = [];
    const validColumns = [];
    
    requiredColumns.forEach(col => {
      const found = headers.some(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      if (!found) {
        missingColumns.push(col);
      } else {
        validColumns.push(col);
      }
    });

    return {
      isValid: missingColumns.length === 0,
      missingColumns,
      validColumns,
      message: missingColumns.length > 0 
        ? `Missing required columns: ${missingColumns.join(', ')}. Required: ${requiredColumns.join(', ')}`
        : 'All required columns are present'
    };
  }

  // Validate file data rows
  validateFileData(data, requiredColumns) {
    const errors = [];
    let validRows = 0;
    let invalidRows = 0;
    
    const headers = Object.keys(data[0] || {});
    const columnMap = {};
    
    requiredColumns.forEach(col => {
      const found = headers.find(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      if (found) {
        columnMap[col] = found;
      }
    });

    data.forEach((row, index) => {
      const rowErrors = [];
      const rowNumber = index + 2;

      requiredColumns.forEach(col => {
        const actualCol = columnMap[col];
        if (!actualCol) {
          rowErrors.push(`${col} column not found`);
          return;
        }

        const value = row[actualCol];
        if (col === 'Quantity' || col === 'Price') {
          if (value === undefined || value === null || value === '' || value === ' ') {
            rowErrors.push(`${col} is empty`);
          } else if (isNaN(parseFloat(value))) {
            rowErrors.push(`${col} must be a valid number`);
          } else if (parseFloat(value) <= 0) {
            rowErrors.push(`${col} must be greater than 0`);
          }
        } else {
          if (value === undefined || value === null || value === '' || value === ' ') {
            rowErrors.push(`${col} is empty`);
          }
        }
      });

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
        invalidRows++;
      } else {
        validRows++;
      }
    });

    return {
      errors: errors.slice(0, 10),
      validRows,
      invalidRows,
      totalRows: data.length
    };
  }

  // Validate menu data
  validateMenuData(data) {
    const errors = [];
    let validCount = 0;
    let invalidCount = 0;
    
    if (data.length === 0) {
      return {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        errors: [{ row: 0, message: 'File is empty' }],
        isValid: false
      };
    }

    const requiredColumns = ['Product Name', 'Ingredients', 'Quantity', 'Unit', 'Price', 'Category'];
    const headers = Object.keys(data[0]);
    
    const columnValidation = this.validateFileColumns(headers, requiredColumns);
    
    if (!columnValidation.isValid) {
      errors.push({
        row: 1,
        message: columnValidation.message
      });
      return {
        totalRows: data.length,
        validRows: 0,
        invalidRows: data.length,
        errors: errors,
        isValid: false,
        columnValidation: columnValidation
      };
    }

    const rowValidation = this.validateFileData(data, requiredColumns);
    
    return {
      totalRows: data.length,
      validRows: rowValidation.validRows,
      invalidRows: rowValidation.invalidRows,
      errors: rowValidation.errors,
      isValid: rowValidation.errors.length === 0,
      columnValidation: columnValidation,
      rowValidation: rowValidation
    };
  }

  formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  }

  // Check for duplicates in database
  async checkDatabaseDuplicates(products, userId) {
    const duplicates = [];
    const seen = new Set();
    for (const product of products) {
      if (seen.has(product)) continue;
      seen.add(product);
      const existing = await this.getProductIdByNameAndUser(product, userId);
      if (existing) {
        duplicates.push({
          name: product,
          message: `Product "${product}" already exists in the database`
        });
      }
    }
    return duplicates;
  }

  async getProductSalesCoverage(productName, userId = null) {
    try {
      if (!this.isSupabaseReady()) {
        return { exists: false, hasSales: false };
      }

      if (!productName || !this.isValidUserId(userId)) {
        return { exists: false, hasSales: false };
      }

      const { data: product, error } = await supabase
        .from('products')
        .select('id')
        .ilike('name', productName)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (!product?.id) {
        return { exists: false, hasSales: false };
      }

      const { data: sales, error: salesError } = await supabase
        .from('daily_sales')
        .select('id')
        .eq('product_id', product.id)
        .limit(1);

      if (salesError) {
        throw salesError;
      }

      return { exists: true, hasSales: (sales || []).length > 0, productId: product.id };
    } catch (error) {
      console.error('Error checking product sales coverage:', error);
      return { exists: false, hasSales: false };
    }
  }

  async processMenuData(data, userId = null) {
    const validation = this.validateMenuData(data);
    
    console.log('📋 Menu Data Validation Results:');
    console.log(`  Total Rows: ${validation.totalRows}`);
    console.log(`  Valid Rows: ${validation.validRows}`);
    console.log(`  Invalid Rows: ${validation.invalidRows}`);
    console.log(`  Valid: ${validation.isValid ? '✅' : '❌'}`);
    
    if (validation.errors.length > 0) {
      console.log('  Errors:', validation.errors);
    }

    if (!validation.isValid) {
      return {
        validation: validation,
        productsInserted: 0,
        ingredientsInserted: 0,
        productIngredientRelations: 0,
        processed: false,
        message: 'Validation failed. Please fix the errors and try again.'
      };
    }

    // Extract product names for duplicate checking
    const productNames = [];
    for (const row of data) {
      const headers = Object.keys(row);
      const productNameCol = headers.find(h => h.toLowerCase() === 'product name');
      if (productNameCol && row[productNameCol]) {
        productNames.push(row[productNameCol].trim());
      }
    }

    // Only check duplicates if userId is valid
    let dbDuplicates = [];
    if (this.isValidUserId(userId)) {
      dbDuplicates = await this.checkDatabaseDuplicates(productNames, userId);
    }
    
    if (dbDuplicates.length > 0) {
      const duplicateErrors = dbDuplicates.map((dup, index) => ({
        row: index + 2,
        message: dup.message
      }));
      
      return {
        validation: {
          totalRows: data.length,
          validRows: 0,
          invalidRows: data.length,
          errors: duplicateErrors,
          isValid: false,
          dbDuplicates: dbDuplicates
        },
        productsInserted: 0,
        ingredientsInserted: 0,
        productIngredientRelations: 0,
        processed: false,
        message: `Found ${dbDuplicates.length} duplicate product(s) in the database. Please remove them from the file.`
      };
    }

    const errors = [];
    const warnings = [];
    let validCount = 0;
    let invalidCount = 0;
    let productsInserted = 0;
    let ingredientsInserted = 0;
    let productIngredientRelations = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNumber = i + 2;

      try {
        const headers = Object.keys(row);
        const productNameCol = headers.find(h => h.toLowerCase() === 'product name');
        const ingredientsCol = headers.find(h => h.toLowerCase() === 'ingredients');
        const quantityCol = headers.find(h => h.toLowerCase() === 'quantity');
        const unitCol = headers.find(h => h.toLowerCase() === 'unit');
        const priceCol = headers.find(h => h.toLowerCase() === 'price');
        const categoryCol = headers.find(h => h.toLowerCase() === 'category');

        const productName = row[productNameCol]?.trim();
        const ingredientsStr = row[ingredientsCol]?.trim();
        const quantity = parseFloat(row[quantityCol]);
        const unit = row[unitCol]?.trim();
        const price = parseFloat(row[priceCol]);
        const category = categoryCol ? row[categoryCol]?.trim() : 'Uncategorized';

        const salesCoverage = await this.getProductSalesCoverage(productName, userId);
        if (!salesCoverage.hasSales) {
          const warningMessage = `Product "${productName}" was not found in sales data. It will be treated as a future product and excluded from forecasting until sales appear.`;
          if (!warnings.some((warning) => warning.message === warningMessage)) {
            warnings.push({ product: productName, message: warningMessage });
          }
        }

        let productId = await this.getProductIdByNameAndUser(productName, userId);

        if (!productId) {
          productId = await this.insertProduct({
            name: productName,
            price: price,
            category: category || 'Uncategorized',
            serving_size_label: unit,
            is_active: false,
            first_sold_date: null
          });
          productsInserted++;
        } else {
          await this.updateProductCategoryIfNeeded(productId, category);
        }

        if (ingredientsStr) {
          const ingredientList = ingredientsStr.split(',').map(i => i.trim());
          
          for (const ingredientName of ingredientList) {
            if (ingredientName) {
              const ingredientId = await this.getOrCreateIngredient(ingredientName, unit, userId);
              
              if (ingredientId) {
                await this.insertProductIngredient({
                  product_id: productId,
                  ingredient_id: ingredientId,
                  quantity_per_serving: quantity || 1
                });
                productIngredientRelations++;
              }
            }
          }
        }

        validCount++;

      } catch (error) {
        console.error(`Error processing row ${rowNumber}:`, error);
        errors.push({
          row: rowNumber,
          message: error.message || 'Failed to process row'
        });
        invalidCount++;
      }
    }

    return {
      validation: {
        totalRows: data.length,
        validRows: validCount,
        invalidRows: invalidCount,
        errors: errors.slice(0, 10),
        isValid: errors.length === 0,
        warnings: warnings.slice(0, 10)
      },
      productsInserted: productsInserted,
      ingredientsInserted: ingredientsInserted,
      productIngredientRelations: productIngredientRelations,
      processed: true,
      message: 'Menu data processed successfully'
    };
  }

  async getProductIdByNameAndUser(name, userId) {
    try {
      if (!this.isSupabaseReady()) {
        return null;
      }

      let query = supabase
        .from('products')
        .select('id')
        .ilike('name', name);

      const { data, error } = await query.maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      return data?.id || null;
    } catch (error) {
      console.error('Error getting product:', error);
      return null;
    }
  }

  async insertProduct(productData) {
    try {
      if (!this.isSupabaseReady()) {
        console.log('📝 Product would be inserted (Supabase not configured):', productData.name);
        return Math.floor(Math.random() * 1000) + 1;
      }

      const insertData = {
        name: productData.name,
        price: productData.price,
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || null,
        is_active: productData.is_active !== undefined ? productData.is_active : false,
        inactive_reason: productData.is_active === true ? null : 'New product detected. Forecast available after 4 weeks.',
        inactive_since: productData.is_active === true ? null : this.formatDate(new Date()),
        first_sold_date: productData.first_sold_date || null
      };

      const { data, error } = await supabase
        .from('products')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          console.log(`⚠️ Product already exists: ${productData.name}`);
          const existing = await this.getProductIdByNameAndUser(productData.name, productData.user_id);
          if (existing) return existing;
        }
        throw error;
      }
      
      console.log(`✅ Product inserted: ${productData.name} (Category: ${productData.category}, ID: ${data.id}, User: ${productData.user_id || 'N/A'})`);
      return data.id;
    } catch (error) {
      console.error('Error inserting product:', error);
      throw new Error(`Failed to insert product: ${error.message}`);
    }
  }

  async updateProductCategoryIfNeeded(productId, category) {
    try {
      if (!this.isSupabaseReady() || !category) {
        return;
      }

      const { data, error } = await supabase
        .from('products')
        .select('category')
        .eq('id', productId)
        .single();

      if (error) {
        console.error('Error fetching product category:', error);
        return;
      }

      if (data.category !== category) {
        const { error: updateError } = await supabase
          .from('products')
          .update({ category: category })
          .eq('id', productId);

        if (updateError) {
          console.error('Error updating product category:', updateError);
        } else {
          console.log(`✅ Updated product category to: ${category}`);
        }
      }
    } catch (error) {
      console.error('Error updating product category:', error);
    }
  }

  async getOrCreateIngredient(name, unit, userId = null) {
    try {
      if (!this.isSupabaseReady()) {
        console.log(`📝 Ingredient would be created: ${name} (${unit})`);
        return Math.floor(Math.random() * 1000) + 1;
      }

      let query = supabase
        .from('ingredients')
        .select('id, name, unit')
        .ilike('name', name);

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        if (data.unit !== unit) {
          const { error: updateError } = await supabase
            .from('ingredients')
            .update({ unit: unit })
            .eq('id', data.id);
          
          if (updateError) {
            console.warn('Failed to update ingredient unit:', updateError);
          } else {
            console.log(`✅ Updated ingredient unit: ${name} -> ${unit}`);
          }
        }
        return data.id;
      }

      const insertData = { 
        name: name,
        unit: unit 
      };

      if (this.isValidUserId(userId)) {
        insertData.user_id = userId;
      }

      const { data: newData, error: insertError } = await supabase
        .from('ingredients')
        .insert(insertData)
        .select()
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          console.log(`⚠️ Ingredient already exists: ${name}`);
          const existing = await supabase
            .from('ingredients')
            .select('id')
            .ilike('name', name)
            .maybeSingle();
          if (existing.data) return existing.data.id;
        }
        throw insertError;
      }

      console.log(`✅ Ingredient inserted: ${name} (Unit: ${unit}, ID: ${newData.id}, User: ${userId || 'N/A'})`);
      return newData.id;

    } catch (error) {
      console.error('Error getting/creating ingredient:', error);
      throw new Error(`Failed to process ingredient: ${error.message}`);
    }
  }

  async insertProductIngredient(data) {
    try {
      if (!this.isSupabaseReady()) {
        console.log(`📝 Product-Ingredient relationship would be created (Supabase not configured)`);
        return;
      }

      const { error } = await supabase
        .from('product_ingredients')
        .insert({
          product_id: data.product_id,
          ingredient_id: data.ingredient_id,
          quantity_per_serving: data.quantity_per_serving || 1
        });

      if (error) {
        if (error.code === '23505') {
          console.log('⚠️ Duplicate product_ingredient relationship, skipping...');
          return;
        }
        throw error;
      }
      
      console.log(`✅ Product-Ingredient relationship created: Product ${data.product_id} -> Ingredient ${data.ingredient_id}`);
    } catch (error) {
      console.error('Error inserting product_ingredient:', error);
      throw new Error(`Failed to insert product_ingredient: ${error.message}`);
    }
  }

  async getProductsWithIngredients(userId = null) {
    try {
      if (!this.isSupabaseReady()) {
        return [];
      }

      let query = supabase
        .from('products')
        .select(`
          *,
          product_ingredients (
            quantity_per_serving,
            ingredients (
              id,
              name,
              unit
            )
          )
        `)
        .order('name');

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching products with ingredients:', error);
      throw error;
    }
  }

  async getProductsByCategory(category, userId = null) {
    try {
      if (!this.isSupabaseReady()) {
        return [];
      }

      let query = supabase
        .from('products')
        .select(`
          *,
          product_ingredients (
            quantity_per_serving,
            ingredients (
              id,
              name,
              unit
            )
          )
        `)
        .ilike('category', category)
        .order('name');

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching products by category:', error);
      throw error;
    }
  }

  async getCategories(userId = null) {
    try {
      if (!this.isSupabaseReady()) {
        return [];
      }

      let query = supabase
        .from('products')
        .select('category');

      const { data, error } = await query.order('category');

      if (error) throw error;
      
      const categories = [...new Set(data.map(item => item.category).filter(Boolean))];
      return categories;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  }
}

module.exports = new MenuService();