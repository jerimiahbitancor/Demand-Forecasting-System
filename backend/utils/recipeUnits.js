// Shared unit conversion for recipe quantities (backend mirror of
// frontend/src/utils/recipeUnits.js). Keeps cost, demand and stock-deduction
// math correct when a product's recipe uses a different unit than the
// ingredient's stock/price unit (e.g. "1 cup" vs an ingredient priced per L).
// Keep the tables in sync with the frontend copy.
//
// Unit conversion metadata now lives in the ingredient_units table
// (see backend/sql/ingredient_unit_conversion_schema.sql): family
// (mass/volume/count), base_factor (grams or mL per 1 unit), is_piece, and
// per-piece weights. Load it once at boot with setUnitMetadata()/loadUnitMetadataFromDb().
// Until then (or if the migration hasn't run) the static tables below act as
// the offline fallback so costing never blocks on a database read.

const RECIPE_UNIT_BASE_FACTOR = {
  // mass (base: grams)
  kg: 1000, kilogram: 1000, kilograms: 1000, kilo: 1000, kilos: 1000,
  'kg (kg)': 1000, 'kilograms (kg)': 1000, 'kilogram (kg)': 1000,
  g: 1, gram: 1, grams: 1, gm: 1, 'g (g)': 1, 'gram (g)': 1, 'grams (g)': 1,
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
  lb: 454, lbs: 454, pound: 454, pounds: 454,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  // volume (base: millilitres)
  L: 1000, l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000,
  'l (l)': 1000, 'liter (l)': 1000, 'liters (l)': 1000, 'litre (l)': 1000, 'litres (l)': 1000,
  mL: 1, ml: 1, millilitre: 1, milliliter: 1, millilitres: 1, milliliters: 1,
  'ml (ml)': 1, 'milliliter (ml)': 1, 'milliliters (ml)': 1, 'millilitre (ml)': 1,
  cup: 240, cups: 240,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, tps: 5, teaspoon: 5, teaspoons: 5,
  'fl oz': 30, floz: 30, 'fluid ounce': 30, 'fluid ounces': 30,
  pt: 473, pint: 473, pints: 473,
  qt: 946, quart: 946, quarts: 946,
  gal: 3785, gallon: 3785, gallons: 3785
};

const RECIPE_MASS_UNITS = new Set([
  'kg', 'kilogram', 'kilograms', 'kilo', 'kilos', 'kg (kg)', 'kilograms (kg)', 'kilogram (kg)',
  'g', 'gram', 'grams', 'gm', 'g (g)', 'gram (g)', 'grams (g)', 'mg', 'milligram', 'milligrams',
  'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces'
]);

const RECIPE_VOLUME_UNITS = new Set([
  'L', 'l', 'litre', 'liter', 'litres', 'liters', 'l (l)', 'liter (l)', 'liters (l)', 'litre (l)', 'litres (l)',
  'mL', 'ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters',
  'ml (ml)', 'milliliter (ml)', 'milliliters (ml)', 'millilitre (ml)',
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'tps', 'teaspoon', 'teaspoons',
  'fl oz', 'floz', 'fluid ounce', 'fluid ounces',
  'pt', 'pint', 'pints', 'qt', 'quart', 'quarts', 'gal', 'gallon', 'gallons'
]);

// Count/piece units that can convert to weight via a per-piece estimate.
// Units without a trusted piece weight (packs, bottles, cans, bunches,
// sachets) stay out of this set so their quantities pass through unchanged.
const RECIPE_COUNT_PIECE_UNITS = new Set([
  'pcs', 'pc', 'piece', 'pieces',
  'pcs (pcs)', 'pc (pcs)', 'piece (pcs)', 'pieces (pcs)',
  'slice', 'slices', 'slice (pcs)', 'slices (pcs)',
  'clove', 'cloves', 'clove (pcs)', 'cloves (pcs)',
  'stick', 'sticks', 'stick (pcs)', 'sticks (pcs)'
]);

// Default per-piece weights (grams) used when a recipe quantity uses a piece
// unit but the ingredient is priced by weight.
const PIECE_WEIGHT_KEYWORDS = [
  { match: /\bpotato(es)?\b/i, g: 150 },
  { match: /\bonions?\b/i, g: 110 },
  { match: /\btomato(es)?\b/i, g: 120 },
  { match: /\bcarrots?\b/i, g: 60 },
  { match: /\beggs?\b/i, g: 50 },
  { match: /\blemon/i, g: 100 },
  { match: /calamansi|kalamansi/i, g: 30 },
  { match: /\bbananas?\b/i, g: 120 },
  { match: /\bapples?\b/i, g: 180 },
  { match: /\bgarlic/i, g: 3 },
  { match: /\bbreads?\b/i, g: 30 }
];

// ===========================================================================
// Database-driven overrides. Populated from ingredient_units by
// setUnitMetadata(); every lookup below consults this map first and falls
// back to the static tables above only when the unit isn't registered.
// ===========================================================================
// key (lowercased name/alias) -> { family, factor, isPiece, pieceWeightGrams }
const unitMetadata = new Map();

// Accept rows shaped like the ingredient_units table:
//   { name, family, base_factor, is_piece, piece_weight_grams, aliases: [] }
// Rebuilds the override map in place. Idempotent.
function setUnitMetadata(rows) {
  unitMetadata.clear();
  for (const u of rows || []) {
    const name = String(u.name || '').trim();
    if (!name) continue;
    const family = u.family === 'mass' || u.family === 'volume' ? u.family : 'count';
    const meta = {
      family,
      factor: family === 'count' ? null : Number(u.base_factor),
      isPiece: Boolean(u.is_piece) && family === 'count',
      pieceWeightGrams: u.piece_weight_grams != null ? Number(u.piece_weight_grams) : null,
    };
    const keys = [name, ...(Array.isArray(u.aliases) ? u.aliases : [])];
    for (const key of keys) {
      const clean = String(key || '').trim().toLowerCase();
      if (clean) unitMetadata.set(clean, meta);
    }
  }
}

// Resolve a unit's conversion kind: 'mass' | 'volume' | 'piece' | 'count' |
// null (unknown). 'piece' is a piece-like count unit (pcs/slices/cloves/sticks)
// that may convert to mass via a per-piece weight.
function unitKind(key) {
  const ov = unitMetadata.get(key);
  if (ov) {
    if (ov.family === 'mass') return 'mass';
    if (ov.family === 'volume') return 'volume';
    return ov.isPiece ? 'piece' : 'count';
  }
  if (RECIPE_MASS_UNITS.has(key)) return 'mass';
  if (RECIPE_VOLUME_UNITS.has(key)) return 'volume';
  if (RECIPE_COUNT_PIECE_UNITS.has(key)) return 'piece';
  return null;
}

// Base factor for a unit: grams for 'mass', mL for 'volume', null otherwise.
function unitFactor(key) {
  const ov = unitMetadata.get(key);
  if (ov) return ov.family === 'count' ? null : ov.factor;
  return RECIPE_UNIT_BASE_FACTOR[key] ?? null;
}

// Grams per piece for `pieceUnit` pieces of `ingredientName`, or null when no
// trusted estimate exists. A unit-level default set on the ingredient_units
// row (piece_weight_grams) wins; otherwise a name-based estimate is used.
function pieceWeightOf(ingredientName, pieceUnit) {
  const unit = String(pieceUnit || '').trim().toLowerCase();
  const ov = unitMetadata.get(unit);
  if (ov && ov.family === 'count' && ov.isPiece && ov.pieceWeightGrams != null) return ov.pieceWeightGrams;
  if (/^sticks?(\s\(pcs\))?$/.test(unit) && /butter/i.test(String(ingredientName || ''))) return 113;
  const name = String(ingredientName || '');
  for (const { match, g } of PIECE_WEIGHT_KEYWORDS) {
    if (match.test(name)) return g;
  }
  return null;
}

function roundTo(value, places = 4) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// Convert `quantity` expressed in `fromUnit` into `toUnit`. Same-family units
// convert; unrecognised or cross-family units are left as-is.
//
// `gramsPerCup` (ingredients.grams_per_cup) enables volume->mass conversion:
// when `fromUnit` is a volume unit and `toUnit` is a mass unit, the volume is
// first expressed in mL, then scaled by the ingredient's density (grams per
// 240 mL cup). Without a density the quantity passes through unchanged.
//
// `pieceWeightGrams` enables piece->mass conversion: when `fromUnit` is a
// piece unit (pcs, slices, cloves, sticks) and `toUnit` is a mass unit, each
// piece is weighed at `pieceWeightGrams`. Without a piece weight the quantity
// passes through unchanged.
function normalizeRecipeQuantityToUnit(quantity, fromUnit, toUnit, gramsPerCup, pieceWeightGrams) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return qty || 0;
  const from = String(fromUnit || '').trim().toLowerCase();
  const to = String(toUnit || '').trim().toLowerCase();
  const fromKind = unitKind(from);
  const toKind = unitKind(to);
  const fromFactor = unitFactor(from);
  const toFactor = unitFactor(to);

  if (
    fromKind === 'volume' &&
    toKind === 'mass' &&
    fromFactor != null &&
    toFactor != null &&
    Number(gramsPerCup) > 0
  ) {
    // volume (mL) -> grams via density (grams per 240 mL cup), then -> target mass.
    const grams = (qty * fromFactor) * (Number(gramsPerCup) / 240);
    return roundTo(grams / toFactor);
  }

  if (
    fromKind === 'piece' &&
    toKind === 'mass' &&
    toFactor != null &&
    Number(pieceWeightGrams) > 0
  ) {
    // pieces -> grams (per-piece weight), then -> target mass.
    return roundTo((qty * Number(pieceWeightGrams)) / toFactor);
  }

  const sameFamily = fromKind != null && fromKind === toKind && (fromKind === 'mass' || fromKind === 'volume');
  if (!sameFamily || fromFactor == null || toFactor == null) return qty;
  return roundTo((qty * fromFactor) / toFactor);
}

// True when a Supabase/Postgres error means the product_ingredients.unit
// column does not exist yet (migration 008 not applied). Callers use this to
// fall back to the old schema (quantities in the ingredient's own unit) so
// the app keeps working until the migration is run.
// SELECT on a missing column surfaces as Postgres 42703, but INSERT surfaces
// as PostgREST PGRST204 ("Could not find the 'unit' column ... in the schema
// cache") — both must be treated as "row unit column missing".
function isMissingColumnError(error) {
  return Boolean(
    error &&
    (error.code === '42703' ||
      error.code === 'PGRST204' ||
      typeof error.message === 'string' && (
        /does not exist/i.test(error.message) ||
        /could not find the .+ column .+ in the schema cache/i.test(error.message)
      ))
  );
}

// Load the conversion metadata for every active unit from the ingredient_units
// table and warm the override map. Falls back to the static tables when the
// migration hasn't run or the table is unreachable.
async function loadUnitMetadataFromDb(client) {
  if (!client) return false;
  try {
    const { data, error } = await client
      .from('ingredient_units')
      .select('name, family, base_factor, is_piece, piece_weight_grams, aliases, is_active')
      .eq('is_active', true);
    if (error) {
      if (isMissingColumnError(error) || /ingredient_units/.test(String(error.message))) return false;
      throw error;
    }
    setUnitMetadata(data && data.length ? data : []);
    return true;
  } catch (err) {
    console.error('Failed to load unit conversion metadata:', err.message);
    return false;
  }
}

module.exports = {
  normalizeRecipeQuantityToUnit,
  pieceWeightOf,
  setUnitMetadata,
  loadUnitMetadataFromDb,
  isMissingColumnError,
};