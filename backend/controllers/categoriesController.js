// controllers/categoriesController.js
const { supabaseAdmin } = require('../config/supabase');

const getCategories = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ingredient_categories')
      .select('id, name, description, created_at, updated_at')
      .order('name');

    if (error) throw error;

    const categoryData = req.query.includeMeta === 'true'
      ? data
      : ['All', ...data.map(cat => cat.name)];
    res.json({ success: true, data: categoryData });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('ingredient_categories')
      .insert([{ name: name.trim(), description: description || null }])
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data, message: 'Category created successfully' });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const { data: currentCategory, error: lookupError } = await supabaseAdmin
      .from('ingredient_categories')
      .select('name')
      .eq('id', id)
      .single();

    if (lookupError) throw lookupError;

    const { data, error } = await supabaseAdmin
      .from('ingredient_categories')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (currentCategory.name !== name.trim()) {
      const { error: inventoryError } = await supabaseAdmin
        .from('inventory_items')
        .update({ category: name.trim() })
        .eq('category', currentCategory.name);
      if (inventoryError) throw inventoryError;
    }

    res.json({ success: true, data, message: 'Category updated successfully' });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory
};