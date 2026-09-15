const { supabaseAdmin } = require('../config/supabase');
const { logAction } = require('../services/auditService');

const actorOf = (req) => req.user?.name || req.user?.email || null;

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

    await logAction('unit_created', `Created unit "${data.name}"`, actorOf(req));

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
        .from('ingredients')
        .update({ unit: name })
        .eq('unit', currentUnit.name);
      if (inventoryError) throw inventoryError;
    }

    await logAction(
      'unit_updated',
      `Renamed unit "${currentUnit.name}" to "${name}"`,
      actorOf(req)
    );

    res.json({ success: true, data, message: 'Unit updated successfully' });
  } catch (error) {
    console.error('Error updating unit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const deleteUnit = async (req, res) => {
  try {
    const { data: currentUnit, error: lookupError } = await supabaseAdmin
      .from('ingredient_units')
      .select('name')
      .eq('id', req.params.id)
      .single();
    if (lookupError) throw lookupError;

    const { data: affected, error: affectedError } = await supabaseAdmin
      .from('ingredients')
      .select('id')
      .eq('unit', currentUnit.name);
    if (affectedError) throw affectedError;

    if (affected.length > 0) {
      const { error: reassignError } = await supabaseAdmin
        .from('ingredients')
        .update({ unit: 'pcs' })
        .eq('unit', currentUnit.name);
      if (reassignError) throw reassignError;
    }

    const { error: deleteError } = await supabaseAdmin
      .from('ingredient_units')
      .delete()
      .eq('id', req.params.id);
    if (deleteError) throw deleteError;

    await logAction(
      'unit_deleted',
      `Deleted unit "${currentUnit.name}" (${affected.length} ingredient(s) moved to "pcs")`,
      actorOf(req)
    );

    res.json({
      success: true,
      message: `Unit deleted. ${affected.length} ingredient(s) moved to "pcs".`
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ success: false, error: 'Ingredient units table is not available. Run backend/sql/rename_ingredient_catalog_tables.sql in Supabase.' });
    }
    console.error('Error deleting unit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { getUnits, createUnit, updateUnit, deleteUnit };