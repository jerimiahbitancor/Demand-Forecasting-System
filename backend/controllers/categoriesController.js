// controllers/categoriesController.js
const { supabaseAdmin } = require('../config/supabase');
const { logAction } = require('../services/auditService');

const actorOf = (req) => req.user?.name || req.user?.email || null;

const getCategories = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ingredient_categories')
      .select('id, name, created_at, updated_at')
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
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('ingredient_categories')
      .insert([{ name: name.trim() }])
      .select()
      .single();

    if (error) throw error;

    await logAction('category_created', `Created category "${data.name}"`, actorOf(req));

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
        .from('ingredients')
        .update({ category: name.trim() })
        .eq('category', currentCategory.name);
      if (inventoryError) throw inventoryError;
    }

    await logAction(
      'category_updated',
      `Renamed category "${currentCategory.name}" to "${name.trim()}"`,
      actorOf(req)
    );

    res.json({ success: true, data, message: 'Category updated successfully' });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: currentCategory, error: lookupError } = await supabaseAdmin
      .from('ingredient_categories')
      .select('name')
      .eq('id', id)
      .single();
    if (lookupError) throw lookupError;

    const { data: affected, error: affectedError } = await supabaseAdmin
      .from('ingredients')
      .select('id')
      .eq('category', currentCategory.name);
    if (affectedError) throw affectedError;

    if (affected.length > 0) {
      const { error: reassignError } = await supabaseAdmin
        .from('ingredients')
        .update({ category: 'Uncategorized' })
        .eq('category', currentCategory.name);
      if (reassignError) throw reassignError;
    }

    const { error: deleteError } = await supabaseAdmin
      .from('ingredient_categories')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    await logAction(
      'category_deleted',
      `Deleted category "${currentCategory.name}" (${affected.length} ingredient(s) moved to "Uncategorized")`,
      actorOf(req)
    );

    res.json({
      success: true,
      message: `Category deleted. ${affected.length} ingredient(s) moved to "Uncategorized".`
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    if (error.code === '42P01') {
      return res.status(503).json({ success: false, error: 'Categories table is not available.' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory
};