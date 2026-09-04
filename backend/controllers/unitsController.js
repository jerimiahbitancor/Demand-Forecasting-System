const { supabaseAdmin } = require('../config/supabase');

const getUnits = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ingredient_units')
      .select('id, name, created_at, updated_at')
      .order('name');

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Error fetching units:', error);
    if (error.code === '42P01') {
      return res.status(503).json({ success: false, error: 'Ingredient units table is not available. Run backend/sql/rename_ingredient_catalog_tables.sql in Supabase.' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

const createUnit = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ success: false, error: 'Unit name is required' });

    const { data, error } = await supabaseAdmin
      .from('ingredient_units')
      .insert([{ name }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data, message: 'Unit created successfully' });
  } catch (error) {
    console.error('Error creating unit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateUnit = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ success: false, error: 'Unit name is required' });

    const { data: currentUnit, error: lookupError } = await supabaseAdmin
      .from('ingredient_units')
      .select('name')
      .eq('id', req.params.id)
      .single();
    if (lookupError) throw lookupError;

    const { data, error } = await supabaseAdmin
      .from('ingredient_units')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    if (currentUnit.name !== name) {
      const { error: ingredientError } = await supabaseAdmin
        .from('ingredients')
        .update({ unit: name })
        .eq('unit', currentUnit.name);
      if (ingredientError) throw ingredientError;

      const { error: inventoryError } = await supabaseAdmin
        .from('inventory_items')
        .update({ unit: name })
        .eq('unit', currentUnit.name);
      if (inventoryError) throw inventoryError;
    }
    res.json({ success: true, data, message: 'Unit updated successfully' });
  } catch (error) {
    console.error('Error updating unit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { getUnits, createUnit, updateUnit };