// services/menuService.js
const { supabase, isConfigured } = require('../config/supabase');

class MenuService {
  constructor() {
    console.log(`📦 MenuService: Supabase ${isConfigured ? '✅ Connected' : '❌ Using Memory Fallback'}`);
  }

  isSupabaseReady() {
    const ready = Boolean(isConfigured && supabase && typeof supabase.from === 'function');
    return ready;
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
    
    // Get actual column names from the data
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
        // Special validation for specific columns
        if (col === 'Quantity' || col === 'Price') {
          if (value === undefined || value === null || value === '' || value === ' ') {
            rowErrors.push(`${col} is empty`);
          } else if (isNaN(parseFloat(value))) {
            rowErrors.push(`${col} must be a valid number`);
          } else if (parseFloat(value) <= 0) {
            rowErrors.push(`${col} must be greater than 0`);
          }
        } else {
          // For string columns (Product Name, Ingredients, Unit, Category)
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
    
    // Validate columns
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

    // Validate rows
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

  async processMenuData(data) {
    // First validate the data
    const validation = this.validateMenuData(data);
    
    console.log('📋 Menu Data Validation Results:');
    console.log(`  Total Rows: ${validation.totalRows}`);
    console.log(`  Valid Rows: ${validation.validRows}`);
    console.log(`  Invalid Rows: ${validation.invalidRows}`);
    console.log(`  Valid: ${validation.isValid ? '✅' : '❌'}`);
    
    if (validation.errors.length > 0) {
      console.log('  Errors:', validation.errors);
    }

    // If validation fails, return validation results without processing
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

    // Only proceed if validation passes
    const errors = [];
    let validCount = 0;
    let invalidCount = 0;
    let productsInserted = 0;
    let ingredientsInserted = 0;
    let productIngredientRelations = 0;

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNumber = i + 2;

      try {
        // Find the actual column names (case insensitive)
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

        // Check if product already exists
        let productId = await this.getProductIdByName(productName);

        if (!productId) {
          // Insert new product with category
          productId = await this.insertProduct({
            name: productName,
            price: price,
            category: category || 'Uncategorized',
            serving_size_label: unit,
            is_active: true,
            first_sold_date: null
          });
          productsInserted++;
        } else {
          // If product exists, check if category needs updating
          await this.updateProductCategoryIfNeeded(productId, category);
        }

        // Process ingredients (assuming ingredients are comma-separated)
        if (ingredientsStr) {
          const ingredientList = ingredientsStr.split(',').map(i => i.trim());
          
          for (const ingredientName of ingredientList) {
            if (ingredientName) {
              // Get or create ingredient with unit
              const ingredientId = await this.getOrCreateIngredient(ingredientName, unit);
              
              if (ingredientId) {
                // Insert product_ingredient relationship
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
        isValid: errors.length === 0
      },
      productsInserted: productsInserted,
      ingredientsInserted: ingredientsInserted,
      productIngredientRelations: productIngredientRelations,
      processed: true,
      message: 'Menu data processed successfully'
    };
  }

  // Legacy method for backward compatibility
  async processMenuDataOld(data) {
    const errors = [];
    let validCount = 0;
    let invalidCount = 0;
    let productsInserted = 0;
    let ingredientsInserted = 0;
    let productIngredientRelations = 0;

    // Validate data first
    const validation = this.validateMenuData(data);
    
    if (validation.errors.length > 0) {
      return {
        validation: validation,
        productsInserted: 0,
        ingredientsInserted: 0,
        productIngredientRelations: 0
      };
    }

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNumber = i + 2;

      try {
        // Find the actual column names (case insensitive)
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

        // Check if product already exists
        let productId = await this.getProductIdByName(productName);

        if (!productId) {
          // Insert new product with category
          productId = await this.insertProduct({
            name: productName,
            price: price,
            category: category || 'Uncategorized',
            serving_size_label: unit,
            is_active: true,
            first_sold_date: null
          });
          productsInserted++;
        } else {
          // If product exists, check if category needs updating
          await this.updateProductCategoryIfNeeded(productId, category);
        }

        // Process ingredients (assuming ingredients are comma-separated)
        if (ingredientsStr) {
          const ingredientList = ingredientsStr.split(',').map(i => i.trim());
          
          for (const ingredientName of ingredientList) {
            if (ingredientName) {
              // Get or create ingredient with unit
              const ingredientId = await this.getOrCreateIngredient(ingredientName, unit);
              
              if (ingredientId) {
                // Insert product_ingredient relationship
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
        errors: errors.slice(0, 10)
      },
      productsInserted: productsInserted,
      ingredientsInserted: ingredientsInserted,
      productIngredientRelations: productIngredientRelations
    };
  }

  // Rest of the methods remain the same...
  async getProductIdByName(name) {
    try {
      if (!this.isSupabaseReady()) {
        return null;
      }

      const { data, error } = await supabase
        .from('products')
        .select('id')
        .ilike('name', name)
        .maybeSingle();

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

      const { data, error } = await supabase
        .from('products')
        .insert({
          name: productData.name,
          price: productData.price,
          category: productData.category || 'Uncategorized',
          serving_size_label: productData.serving_size_label || null,
          is_active: productData.is_active !== undefined ? productData.is_active : true,
          first_sold_date: productData.first_sold_date || null
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          console.log(`⚠️ Product already exists: ${productData.name}`);
          const existing = await this.getProductIdByName(productData.name);
          if (existing) return existing;
        }
        throw error;
      }
      
      console.log(`✅ Product inserted: ${productData.name} (Category: ${productData.category}, ID: ${data.id})`);
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

  async getOrCreateIngredient(name, unit) {
    try {
      if (!this.isSupabaseReady()) {
        console.log(`📝 Ingredient would be created: ${name} (${unit})`);
        return Math.floor(Math.random() * 1000) + 1;
      }

      const { data, error } = await supabase
        .from('ingredients')
        .select('id, name, unit')
        .ilike('name', name)
        .maybeSingle();

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

      const { data: newData, error: insertError } = await supabase
        .from('ingredients')
        .insert({ 
          name: name,
          unit: unit 
        })
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

      console.log(`✅ Ingredient inserted: ${name} (Unit: ${unit}, ID: ${newData.id})`);
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

  async getProductsWithIngredients() {
    try {
      if (!this.isSupabaseReady()) {
        return [];
      }

      const { data, error } = await supabase
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

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching products with ingredients:', error);
      throw error;
    }
  }

  async getProductsByCategory(category) {
    try {
      if (!this.isSupabaseReady()) {
        return [];
      }

      const { data, error } = await supabase
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

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching products by category:', error);
      throw error;
    }
  }

  async getCategories() {
    try {
      if (!this.isSupabaseReady()) {
        return [];
      }

      const { data, error } = await supabase
        .from('products')
        .select('category')
        .order('category');

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