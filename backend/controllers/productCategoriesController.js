const { supabaseAdmin } = require('../config/supabase');

const getProductCategories = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('product_categories')
      .select('id, name, description, created_at, updated_at')
      .order('name');

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Error fetching product categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createProductCategory = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ success: false, error: 'Category name is required' });

    const { data, error } = await supabaseAdmin
      .from('product_categories')
      .insert([{ name, description: req.body.description || null }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data, message: 'Product category created successfully' });
  } catch (error) {
    console.error('Error creating product category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateProductCategory = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ success: false, error: 'Category name is required' });

    const { data: currentCategory, error: lookupError } = await supabaseAdmin
      .from('product_categories')
      .select('name')
      .eq('id', req.params.id)
      .single();
    if (lookupError) throw lookupError;

    const { data, error } = await supabaseAdmin
      .from('product_categories')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    if (currentCategory.name !== name) {
      const { error: productError } = await supabaseAdmin
        .from('products')
        .update({ category: name })
        .eq('category', currentCategory.name);
      if (productError) throw productError;
    }

    res.json({ success: true, data, message: 'Product category updated successfully' });
  } catch (error) {
    console.error('Error updating product category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { getProductCategories, createProductCategory, updateProductCategory };