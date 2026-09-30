const { supabaseAdmin } = require('../config/supabase');
const { logAction } = require('../services/auditService');
const { isMissingColumnError, setUnitMetadata } = require('../utils/recipeUnits');
const { fetchAllRows } = require('../utils/fetchAllRows');

const actorOf = (req) => req.user?.name || req.user?.email || null;

// Refresh the in-memory unit-conversion metadata used by recipe costing.
const refreshUnitMetadata = async () => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ingredient_units')
      .select('name, family, base_factor, is_piece, piece_weight_grams, aliases, is_active')
      .eq('is_active', true);
    if (error) {
      if (isMissingColumnError(error) || /ingredient_units/.test(String(error.message))) return;
      throw error;
    }
    setUnitMetadata(data && data.length ? data : []);
  } catch (error) {
    console.error('Error refreshing unit conversion metadata:', error.message);
  }
};

const getUnits = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ingredient_units')
      .select('id, name, family, base_factor, is_piece, piece_weight_grams, aliases, is_active, created_at, updated_at')
      .order('name');

    if (error && isMissingColumnError(error)) {
      const fallback = await supabaseAdmin
        .from('ingredient_units')
        .select('id, name, created_at, updated_at')
        .order('name');
      if (fallback.error) throw fallback.error;
      return res.json({ success: true, data: (fallback.data || []).map((u) => ({
        ...u,
        family: null,
        base_factor: null,
        is_piece: false,
        piece_weight_grams: null,
        aliases: [],
        is_active: true,
      })) });
    }

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

// Lookup keys for a unit: its name plus aliases, lowercased (the same keys
// utils/recipeUnits.js resolves units by).
const unitKeys = (unit) => [unit.name, ...(unit.aliases || [])]
  .map((key) => String(key ?? '').trim().toLowerCase())
  .filter(Boolean);

// First key in `keys` already owned by a unit other than `ignoreId`, or null.
// A second unit reusing a key (e.g. "KG" while "kg" belongs to Kilograms) would
// be resolved unpredictably, which is how the old duplicate rows happened.
const findKeyConflict = (units, keys, ignoreId = null) => {
  const owners = new Map();
  for (const unit of units || []) {
    if (unit.id === ignoreId) continue;
    for (const key of unitKeys(unit)) owners.set(key, unit.name);
  }
  for (const key of keys) {
    const owner = owners.get(String(key).trim().toLowerCase());
    if (owner) return { key, owner };
  }
  return null;
};

const UNIT_FAMILIES = ['mass', 'volume', 'count'];
// Reference unit each measurable family converts to (see recipeUnits.js).
const BASE_UNIT_BY_FAMILY = { mass: 'g', volume: 'mL' };

// Accepts ["kg", "kilo"] or "kg, kilo"; trims, drops blanks, removes repeats.
const parseAliases = (raw) => {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const alias = String(item ?? '').trim();
    const key = alias.toLowerCase();
    if (alias && !seen.has(key)) {
      seen.add(key);
      out.push(alias);
    }
  }
  return out;
};

const createUnit = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ success: false, error: 'Unit name is required' });
    if (name.length > 50) return res.status(400).json({ success: false, error: 'Unit name must be 50 characters or fewer' });

    // The recipe math needs to know what kind of unit this is. Without a
    // family it would be treated as a plain count and never converted.
    const family = String(req.body.family ?? '').trim().toLowerCase();
    if (!UNIT_FAMILIES.includes(family)) {
      return res.status(400).json({ success: false, error: 'Unit type is required: mass, volume or count' });
    }

    const row = { name, family, aliases: parseAliases(req.body.aliases), is_piece: false };

    if (family === 'count') {
      row.base_unit = null;
      row.base_factor = null;
      row.is_piece = Boolean(req.body.is_piece);
      if (req.body.piece_weight_grams !== undefined && req.body.piece_weight_grams !== null && req.body.piece_weight_grams !== '') {
        const pieceWeight = Number(req.body.piece_weight_grams);
        if (!row.is_piece || !Number.isFinite(pieceWeight) || pieceWeight <= 0) {
          return res.status(400).json({ success: false, error: 'Grams per piece must be a positive number and only applies to piece units' });
        }
        row.piece_weight_grams = pieceWeight;
      }
    } else {
      const factor = Number(req.body.base_factor);
      if (req.body.base_factor === undefined || req.body.base_factor === null || req.body.base_factor === '' || !Number.isFinite(factor) || factor <= 0) {
        return res.status(400).json({
          success: false,
          error: `Enter how many ${BASE_UNIT_BY_FAMILY[family] === 'g' ? 'grams' : 'millilitres'} are in 1 ${name} (a number above 0)`
        });
      }
      row.base_unit = BASE_UNIT_BY_FAMILY[family];
      row.base_factor = factor;
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('ingredient_units')
      .select('id, name, aliases');
    if (existingError) throw existingError;

    const conflict = findKeyConflict(existing, [name, ...row.aliases]);
    if (conflict) {
      return res.status(409).json({
        success: false,
        error: `"${conflict.key}" is already used by the unit "${conflict.owner}". Use that unit, or pick a different name.`
      });
    }

    const { data, error } = await supabaseAdmin
      .from('ingredient_units')
      .insert([row])
      .select()
      .single();

    if (error) throw error;

    await refreshUnitMetadata();
    await logAction('unit_created', `Created ${family} unit "${data.name}"`, actorOf(req));

    res.status(201).json({ success: true, data, message: 'Unit created successfully' });
  } catch (error) {
    console.error('Error creating unit:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'A unit with that name already exists.' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// Renaming changes the unit's name and ingredients.unit only. Saved recipe
// lines (product_ingredients.unit) are deliberately left alone, so the old name
// is kept as an alias: those lines keep converting instead of silently turning
// into an unknown unit.
const updateUnit = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ success: false, error: 'Unit name is required' });
    if (name.length > 50) return res.status(400).json({ success: false, error: 'Unit name must be 50 characters or fewer' });

    const { data: units, error: unitsError } = await supabaseAdmin
      .from('ingredient_units')
      .select('id, name, aliases');
    if (unitsError) throw unitsError;

    const currentUnit = (units || []).find((unit) => unit.id === req.params.id);
    if (!currentUnit) return res.status(404).json({ success: false, error: 'Unit not found' });

    const conflict = findKeyConflict(units, [name], currentUnit.id);
    if (conflict) {
      return res.status(409).json({
        success: false,
        error: `"${conflict.key}" is already used by the unit "${conflict.owner}". Pick a different name.`
      });
    }

    const oldName = currentUnit.name;
    const changes = { name, updated_at: new Date().toISOString() };
    if (oldName !== name) {
      const aliases = currentUnit.aliases || [];
      const covered = new Set([name, ...aliases].map((key) => key.trim().toLowerCase()));
      if (!covered.has(oldName.trim().toLowerCase())) changes.aliases = [...aliases, oldName];
    }

    const { data, error } = await supabaseAdmin
      .from('ingredient_units')
      .update(changes)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    if (oldName !== name) {
      const { error: ingredientError } = await supabaseAdmin
        .from('ingredients')
        .update({ unit: name })
        .eq('unit', oldName);
      if (ingredientError) throw ingredientError;
    }

    await refreshUnitMetadata();
    await logAction(
      'unit_updated',
      `Renamed unit "${oldName}" to "${name}"`,
      actorOf(req)
    );

    res.json({ success: true, data, message: 'Unit updated successfully' });
  } catch (error) {
    console.error('Error updating unit:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'A unit with that name already exists.' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// Who still uses this unit: ingredients (archived ones count, they can be
// restored) and saved recipe lines. A recipe line may hold an alias ("cup")
// rather than the unit's display name, so every lookup key is checked.
const findUnitUsage = async (unit) => {
  const keys = new Set(unitKeys(unit));

  const { data: ingredients, error: ingredientError } = await fetchAllRows(() => supabaseAdmin
    .from('ingredients')
    .select('id, name, unit, unit_id')
    .order('id'));
  if (ingredientError) throw ingredientError;
  const ingredientsUsing = (ingredients || []).filter((row) =>
    row.unit_id === unit.id || keys.has(String(row.unit ?? '').trim().toLowerCase()));

  let recipeLines = 0;
  const { data: lines, error: lineError } = await fetchAllRows(() => supabaseAdmin
    .from('product_ingredients')
    .select('id, unit')
    .order('id'));
  if (lineError && !isMissingColumnError(lineError)) throw lineError;
  if (!lineError) {
    recipeLines = (lines || []).filter((row) => keys.has(String(row.unit ?? '').trim().toLowerCase())).length;
  }

  return { ingredientsUsing, recipeLines };
};

const deleteUnit = async (req, res) => {
  try {
    const { data: currentUnit, error: lookupError } = await supabaseAdmin
      .from('ingredient_units')
      .select('id, name, aliases')
      .eq('id', req.params.id)
      .single();
    if (lookupError) {
      if (lookupError.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Unit not found' });
      throw lookupError;
    }

    // A unit in use cannot be deleted. Quietly moving its ingredients to
    // another unit would change what their price and stock mean (priced per
    // kg would become priced per piece), so the owner has to do that first.
    const { ingredientsUsing, recipeLines } = await findUnitUsage(currentUnit);
    if (ingredientsUsing.length > 0 || recipeLines > 0) {
      const parts = [];
      if (ingredientsUsing.length > 0) {
        const sample = ingredientsUsing.slice(0, 3).map((row) => row.name).join(', ');
        parts.push(`${ingredientsUsing.length} ingredient(s) (${sample}${ingredientsUsing.length > 3 ? ', ...' : ''})`);
      }
      if (recipeLines > 0) parts.push(`${recipeLines} recipe line(s)`);
      return res.status(409).json({
        success: false,
        error: `Can't delete "${currentUnit.name}" because it is still used by ${parts.join(' and ')}. Change those to another unit first.`
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('ingredient_units')
      .delete()
      .eq('id', req.params.id);
    if (deleteError) throw deleteError;

    await refreshUnitMetadata();
    await logAction('unit_deleted', `Deleted unit "${currentUnit.name}"`, actorOf(req));

    res.json({ success: true, message: 'Unit deleted.' });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({ success: false, error: 'Ingredient units table is not available. Run backend/sql/rename_ingredient_catalog_tables.sql in Supabase.' });
    }
    console.error('Error deleting unit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { getUnits, createUnit, updateUnit, deleteUnit };