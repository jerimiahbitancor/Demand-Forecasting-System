// controllers/categoriesController.js
const { supabase } = require('../config/supabase');

const getCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('name')
      .order('name');

    if (error) throw error;

    const categoryNames = ['All', ...data.map(cat => cat.name)];
    res.json({ success: true, data: categoryNames });
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

    const { data, error } = await supabase
      .from('categories')
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

module.exports = {
  getCategories,
  createCategory
};