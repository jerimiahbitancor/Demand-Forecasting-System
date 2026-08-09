// /backend/controllers/ProductController.js
const { supabase } = require('../config/supabase');

class ProductController {
  static _ensureSupabase(res) {
    if (!supabase) {
      res.status(500).json({
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY first.',
      });
      return false;
    }
    return true;
  }

  // ---------- READ ----------

  static async getAll(req, res) {
    if (!ProductController._ensureSupabase(res)) return;

    try {
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (productError) throw productError;

      const { data: mappings, error: mappingError } = await supabase
        .from('product_ingredients')
        .select('id, product_id, quantity_per_serving, ingredients ( id, name, unit )');

      if (mappingError) throw mappingError;

      const productsWithIngredients = products.map((product) => ({
        ...product,
        ingredients: mappings
          .filter((m) => m.product_id === product.id)
          .map((m) => ({
            mapping_id: m.id,
            ingredient_id: m.ingredients.id,
            name: m.ingredients.name,
            unit: m.ingredients.unit,
            quantity: m.quantity_per_serving,
          })),
      }));

      res.json(productsWithIngredients);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch products: ' + error.message });
    }
  }

  static async getById(req, res) {
    if (!ProductController._ensureSupabase(res)) return;

    const { id } = req.params;
    try {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', parseInt(id))
        .single();

      if (productError || !product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const { data: mappings, error: mappingError } = await supabase
        .from('product_ingredients')
        .select('id, quantity_per_serving, ingredients ( id, name, unit )')
        .eq('product_id', product.id);

      if (mappingError) throw mappingError;

      product.ingredients = mappings.map((m) => ({
        mapping_id: m.id,
        ingredient_id: m.ingredients.id,
        name: m.ingredients.name,
        unit: m.ingredients.unit,
        quantity: m.quantity_per_serving,
      }));

      res.json(product);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch product: ' + error.message });
    }
  }

  // ---------- CREATE ----------

  static async create(req, res) {
    if (!ProductController._ensureSupabase(res)) return;

    const { name, category, price, ingredients = [] } = req.body;

    if (!name || !category || price === undefined) {
      return res.status(400).json({ error: 'Product name, category, and price are required' });
    }

    if (isNaN(price) || Number(price) <= 0) {
      return res.status(400).json({ error: 'Price must be a positive number' });
    }

    let insertedProductId = null;

    try {
      // 1. Insert the product
      const { data: newProduct, error: productError } = await supabase
        .from('products')
        .insert({ name, category, price })
        .select()
        .single();

      if (productError) throw productError;
      insertedProductId = newProduct.id;

      // 2. Resolve + insert ingredient mappings
      if (ingredients.length > 0) {
        const mappingRows = await ProductController._buildMappingRows(
          insertedProductId,
          ingredients
        );

        const { error: mappingError } = await supabase
          .from('product_ingredients')
          .insert(mappingRows);

        if (mappingError) throw mappingError;
      }

      res.status(201).json({
        success: true,
        message: `Product ${newProduct.name} successfully created.`,
        product: newProduct,
      });
    } catch (error) {
      // Manual rollback — Supabase JS has no cross-table transaction support.
      // See write-up: this is a documented limitation, not an oversight.
      if (insertedProductId) {
        await supabase.from('product_ingredients').delete().eq('product_id', insertedProductId);
        await supabase.from('products').delete().eq('id', insertedProductId);
      }
      res.status(500).json({ error: 'Failed to create product: ' + error.message });
    }
  }

  // ---------- UPDATE ----------

  static async update(req, res) {
    if (!ProductController._ensureSupabase(res)) return;

    const { id } = req.params;
    const { name, category, price, ingredients } = req.body;

    if (price !== undefined && (isNaN(price) || Number(price) <= 0)) {
      return res.status(400).json({ error: 'Price must be a positive number' });
    }

    try {
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (category !== undefined) updates.category = category;
      if (price !== undefined) updates.price = price;

      const { data: updatedProduct, error: productError } = await supabase
        .from('products')
        .update(updates)
        .eq('id', parseInt(id))
        .select()
        .single();

      if (productError || !updatedProduct) {
        return res.status(404).json({ error: 'Product not found' });
      }

      // Replace ingredient mappings wholesale — simpler and safer than diffing
      // individual rows, at the cost of a delete+reinsert per edit.
      if (Array.isArray(ingredients)) {
        const { error: deleteError } = await supabase
          .from('product_ingredients')
          .delete()
          .eq('product_id', updatedProduct.id);

        if (deleteError) throw deleteError;

        if (ingredients.length > 0) {
          const mappingRows = await ProductController._buildMappingRows(
            updatedProduct.id,
            ingredients
          );

          const { error: insertError } = await supabase
            .from('product_ingredients')
            .insert(mappingRows);

          if (insertError) throw insertError;
        }
      }

      res.json({
        success: true,
        message: `Changes to ${updatedProduct.name} saved.`,
        product: updatedProduct,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update product: ' + error.message });
    }
  }

  // ---------- DELETE ----------

  static async remove(req, res) {
    if (!ProductController._ensureSupabase(res)) return;

    const { id } = req.params;

    try {
      const { data: product, error: findError } = await supabase
        .from('products')
        .select('id, name')
        .eq('id', parseInt(id))
        .single();

      if (findError || !product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      // Manual cascade — your schema has no ON DELETE CASCADE on
      // product_ingredients.product_id, so this must happen first.
      const { error: mappingDeleteError } = await supabase
        .from('product_ingredients')
        .delete()
        .eq('product_id', product.id);

      if (mappingDeleteError) throw mappingDeleteError;

      const { error: productDeleteError } = await supabase
        .from('products')
        .delete()
        .eq('id', product.id);

      if (productDeleteError) throw productDeleteError;

      res.json({
        success: true,
        message: `Product ${product.name} has been removed.`,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete product: ' + error.message });
    }
  }

  // ---------- INTERNAL HELPER ----------

  // Finds an existing ingredient by name (case-insensitive) or creates it.
  // Existing ingredient's unit always wins over the submitted unit.
  static async _buildMappingRows(productId, ingredients) {
    const rows = [];
    const seenIngredientIds = new Set();

    for (const ing of ingredients) {
      if (!ing.name || !ing.quantity || Number(ing.quantity) <= 0) {
        throw new Error(`Each ingredient needs a name and a positive quantity`);
      }

      const { data: existing, error: findError } = await supabase
        .from('ingredients')
        .select('id, unit')
        .ilike('name', ing.name.trim())
        .maybeSingle();

      if (findError) throw findError;

      let ingredientId;

      if (existing) {
        ingredientId = existing.id;
      } else {
        const { data: newIngredient, error: createError } = await supabase
          .from('ingredients')
          .insert({ name: ing.name.trim(), unit: ing.unit })
          .select('id')
          .single();

        if (createError) throw createError;
        ingredientId = newIngredient.id;
      }

      if (seenIngredientIds.has(ingredientId)) {
        throw new Error(`Ingredient "${ing.name}" was added more than once for this product`);
      }
      seenIngredientIds.add(ingredientId);

      rows.push({
        product_id: productId,
        ingredient_id: ingredientId,
        quantity_per_serving: ing.quantity,
      });
    }

    return rows;
  }
}

module.exports = ProductController;