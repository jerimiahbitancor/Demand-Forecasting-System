// services/mappingService.js
const { supabase, isConfigured } = require('../config/supabase');

class MappingService {
  constructor() {
    console.log(`📦 MappingService: Supabase ${isConfigured ? '✅ Connected' : '❌ Using Memory Fallback'}`);
  }

  isSupabaseReady() {
    const ready = Boolean(isConfigured && supabase && typeof supabase.from === 'function');
    return ready;
  }

  // ----- Helper to validate userId -----
  isValidUserId(userId) {
    return userId && typeof userId === 'number' && Number.isInteger(userId) && userId > 0;
  }

  async getProducts(userId, category = null, search = null) {
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

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
      }

      if (category && category !== 'All') {
        query = query.eq('category', category);
      }

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  }

  async getProductById(id, userId) {
    try {
      if (!this.isSupabaseReady()) {
        return null;
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
        .eq('id', id);

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Error fetching product:', error);
      throw error;
    }
  }

  async createProduct(productData) {
    try {
      if (!this.isSupabaseReady()) {
        return { id: Date.now(), ...productData };
      }

      const insertData = {
        name: productData.name,
        price: productData.price,
        category: productData.category || 'Uncategorized',
        serving_size_label: productData.serving_size_label || null,
        is_active: true
      };

      if (this.isValidUserId(productData.user_id)) {
        insertData.user_id = productData.user_id;
      }

      const { data: product, error: productError } = await supabase
        .from('products')
        .insert(insertData)
        .select()
        .single();

      if (productError) throw productError;

      if (productData.ingredients && productData.ingredients.length > 0) {
        for (const ingredient of productData.ingredients) {
          const ingredientId = await this.getOrCreateIngredient(ingredient.name, ingredient.unit, productData.user_id);
          
          await supabase
            .from('product_ingredients')
            .insert({
              product_id: product.id,
              ingredient_id: ingredientId,
              quantity_per_serving: ingredient.quantity || 1
            });
        }
      }

      return product;
    } catch (error) {
      console.error('Error creating product:', error);
      throw error;
    }
  }

  async updateProduct(id, productData, userId) {
    try {
      if (!this.isSupabaseReady()) {
        return { id, ...productData };
      }

      const existingProduct = await this.getProductById(id, userId);
      if (!existingProduct) {
        return null;
      }

      const { data: product, error: productError } = await supabase
        .from('products')
        .update({
          name: productData.name,
          price: productData.price,
          category: productData.category,
          serving_size_label: productData.serving_size_label,
          is_active: productData.is_active
        })
        .eq('id', id)
        .select()
        .single();

      if (productError) throw productError;

      if (productData.ingredients !== undefined) {
        await supabase
          .from('product_ingredients')
          .delete()
          .eq('product_id', id);

        if (productData.ingredients && productData.ingredients.length > 0) {
          for (const ingredient of productData.ingredients) {
            const ingredientId = await this.getOrCreateIngredient(ingredient.name, ingredient.unit, userId);
            
            await supabase
              .from('product_ingredients')
              .insert({
                product_id: id,
                ingredient_id: ingredientId,
                quantity_per_serving: ingredient.quantity || 1
              });
          }
        }
      }

      return product;
    } catch (error) {
      console.error('Error updating product:', error);
      throw error;
    }
  }

  async deleteProduct(id, userId) {
    try {
      if (!this.isSupabaseReady()) {
        return true;
      }

      const existingProduct = await this.getProductById(id, userId);
      if (!existingProduct) {
        return false;
      }

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting product:', error);
      throw error;
    }
  }

  async getOrCreateIngredient(name, unit, userId) {
    try {
      if (!this.isSupabaseReady()) {
        return { id: Date.now() };
      }

      let query = supabase
        .from('ingredients')
        .select('id')
        .ilike('name', name);

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        return data.id;
      }

      const insertData = { name, unit };
      if (this.isValidUserId(userId)) {
        insertData.user_id = userId;
      }

      const { data: newData, error: insertError } = await supabase
        .from('ingredients')
        .insert(insertData)
        .select()
        .single();

      if (insertError) throw insertError;
      return newData.id;
    } catch (error) {
      console.error('Error getting/creating ingredient:', error);
      throw error;
    }
  }

  async getCategories(userId) {
    try {
      if (!this.isSupabaseReady()) {
        return [];
      }

      let query = supabase
        .from('products')
        .select('category')
        .order('category');

      if (this.isValidUserId(userId)) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      const categories = [...new Set(data.map(item => item.category).filter(Boolean))];
      return ['All', ...categories];
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  }
}

module.exports = new MappingService();