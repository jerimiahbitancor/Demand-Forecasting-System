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

  async getProducts(category = null, search = null) {
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

  async getProductById(id) {
    try {
      if (!this.isSupabaseReady()) {
        return null;
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
        .eq('id', id)
        .single();

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

      // Insert product
      const { data: product, error: productError } = await supabase
        .from('products')
        .insert({
          name: productData.name,
          price: productData.price,
          category: productData.category || 'Uncategorized',
          serving_size_label: productData.serving_size_label || null,
          is_active: true
        })
        .select()
        .single();

      if (productError) throw productError;

      // Insert ingredients if provided
      if (productData.ingredients && productData.ingredients.length > 0) {
        for (const ingredient of productData.ingredients) {
          // Get or create ingredient
          const ingredientId = await this.getOrCreateIngredient(ingredient.name, ingredient.unit);
          
          // Insert product_ingredient relationship
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

  async updateProduct(id, productData) {
    try {
      if (!this.isSupabaseReady()) {
        return { id, ...productData };
      }

      // Update product
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

      // If ingredients provided, update them
      if (productData.ingredients !== undefined) {
        // Delete existing product_ingredients
        await supabase
          .from('product_ingredients')
          .delete()
          .eq('product_id', id);

        // Insert new ingredients
        if (productData.ingredients && productData.ingredients.length > 0) {
          for (const ingredient of productData.ingredients) {
            const ingredientId = await this.getOrCreateIngredient(ingredient.name, ingredient.unit);
            
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

  async deleteProduct(id) {
    try {
      if (!this.isSupabaseReady()) {
        return true;
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

  async getOrCreateIngredient(name, unit) {
    try {
      if (!this.isSupabaseReady()) {
        return { id: Date.now() };
      }

      // Try to find existing ingredient
      const { data, error } = await supabase
        .from('ingredients')
        .select('id')
        .ilike('name', name)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        return data.id;
      }

      // Create new ingredient
      const { data: newData, error: insertError } = await supabase
        .from('ingredients')
        .insert({ name, unit })
        .select()
        .single();

      if (insertError) throw insertError;
      return newData.id;
    } catch (error) {
      console.error('Error getting/creating ingredient:', error);
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
      return ['All', ...categories];
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  }
}

module.exports = new MappingService();