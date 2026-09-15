const { supabaseAdmin } = require('../config/supabase');
const { logAction } = require('../services/auditService');

const actorOf = (req) => req.user?.name || req.user?.email || null;

const getProductCategories = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('product_categories')
      .select('id, name, created_at, updated_at')
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
      .insert([{ name }])
      .select()
      .single();

    if (error) throw error;

    await logAction('product_category_created', `Created product category "${data.name}"`, actorOf(req));

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

    await logAction(
      'product_category_updated',
      `Renamed product category "${currentCategory.name}" to "${name}"`,
      actorOf(req)
    );

    res.json({ success: true, data, message: 'Product category updated successfully' });
  } catch (error) {
    console.error('Error updating product category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const deleteProductCategory = async (req, res) => {
  try {
    const { data: currentCategory, error: lookupError } = await supabaseAdmin
      .from('product_categories')
      .select('name')
      .eq('id', req.params.id)
      .single();
    if (lookupError) throw lookupError;

    const { data: affected, error: affectedError } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('category', currentCategory.name);
    if (affectedError) throw affectedError;

    if (affected.length > 0) {
      const { error: reassignError } = await supabaseAdmin
        .from('products')
        .update({ category: 'Uncategorized' })
        .eq('category', currentCategory.name);
      if (reassignError) throw reassignError;
    }

    const { error: deleteError } = await supabaseAdmin
      .from('product_categories')
      .delete()
      .eq('id', req.params.id);
    if (deleteError) throw deleteError;

    await logAction(
      'product_category_deleted',
      `Deleted product category "${currentCategory.name}" (${affected.length} product(s) moved to "Uncategorized")`,
      actorOf(req)
    );

    res.json({
      success: true,
      message: `Product category deleted. ${affected.length} product(s) moved to "Uncategorized".`
    });
  } catch (error) {
    console.error('Error deleting product category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { getProductCategories, createProductCategory, updateProductCategory, deleteProductCategory };