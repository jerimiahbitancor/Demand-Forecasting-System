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
  pt: 480, pint: 480, pints: 480,
  qt: 960, quart: 960, quarts: 960,
  gal: 3840, gallon: 3840, gallons: 3840
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

// Common kitchen densities (grams per 240 mL cup) used when a recipe line is in
// a volume unit (cup, tbsp, tsp...) but the ingredient is stocked/priced by
// weight and has no grams_per_cup of its own. Matched loosely against the
// ingredient name, most specific first (brown sugar before sugar). Mirrors
// DENSITY_KEYWORDS in frontend/src/utils/recipeUnits.js and _DENSITY_KEYWORDS
// in ml-service/services/data_loader.py; ml-service/tests/fixtures/
// recipe_unit_cases.json keeps all three honest.
const DENSITY_KEYWORDS = [
  { match: /cake flour/i, g: 114 },
  { match: /bread flour/i, g: 127 },
  { match: /all[- ]?purpose|plain flour|flour/i, g: 125 },
  { match: /brown sugar|demerara|muscovado/i, g: 220 },
  { match: /powdered sugar|confectioner|icing sugar/i, g: 120 },
  { match: /sugar/i, g: 200 },
  { match: /butter/i, g: 227 },
  { match: /rice/i, g: 185 },
  { match: /cooking oil|oil/i, g: 216 },
  { match: /condensed milk/i, g: 306 },
  { match: /evaporated milk/i, g: 240 },
  { match: /heavy cream|whipping cream/i, g: 240 },
  { match: /cream/i, g: 240 },
  { match: /milk/i, g: 240 },
  { match: /water/i, g: 240 },
  { match: /yogurt|yoghurt/i, g: 245 },
  { match: /oats|oat/i, g: 90 },
  { match: /cornstarch|corn starch/i, g: 128 },
  { match: /baking powder/i, g: 192 },
  { match: /baking soda|bicarbonate/i, g: 220 },
  { match: /cocoa/i, g: 85 },
  { match: /honey/i, g: 340 },
  { match: /chocolate chip|choc chip/i, g: 170 },
  { match: /nuts?|peanut|cashew|almond/i, g: 120 },
  { match: /breadcrumb|panko/i, g: 108 },
  { match: /cheese/i, g: 113 },
  { match: /mayonnaise|mayo/i, g: 220 },
  { match: /soy sauce/i, g: 255 },
  { match: /vinegar/i, g: 240 },
  { match: /salt/i, g: 273 }
];

// Grams per 240 mL cup: the ingredient's own grams_per_cup when set, else a
// name-based estimate, else null (no trusted density).
function densityOf(gramsPerCup, ingredientName) {
  const explicit = Number(gramsPerCup);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const name = String(ingredientName || '');
  for (const { match, g } of DENSITY_KEYWORDS) {
    if (match.test(name)) return g;
  }
  return null;
}

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

// Parse a recipe-style quantity into a number: "1/2" -> 0.5, "1 1/2" -> 1.5,
// "0.75" -> 0.75. product_ingredients.quantity_per_serving is a free-text
// column, so stored values may be fractions, mixed numbers, or decimals.
// Returns NaN for unparseable input.
function parseRecipeQuantity(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const trimmed = String(value).trim();
  if (!trimmed) return NaN;

  const mixed = trimmed.match(/^(-?\d+(?:\.\d+)?)\s+([+-]?\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const den = parseInt(mixed[3], 10);
    if (den === 0) return NaN;
    return parseFloat(mixed[1]) + parseInt(mixed[2], 10) / den;
  }

  const fraction = trimmed.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const den = parseInt(fraction[2], 10);
    if (den === 0) return NaN;
    return parseInt(fraction[1], 10) / den;
  }

  return parseFloat(trimmed);
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
//
// `pack` ({ qty, unit }, ingredients.pack_qty/pack_unit) enables the
// purchase-pack conversion: "one sachet of blue lemonade powder is 150 g".
// It lets an opaque count unit in a recipe weigh out in the ingredient's
// stock unit (1 Sachets -> 0.15 kg) and lets a measured amount count out in
// packs when the ingredient is stocked by the pack (300 g -> 2 Packs).
function normalizeRecipeQuantityToUnit(quantity, fromUnit, toUnit, gramsPerCup, pieceWeightGrams, pack) {
  const qty = parseRecipeQuantity(quantity);
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

  const packQty = pack ? Number(pack.qty) : NaN;
  const packUnit = pack ? String(pack.unit || '').trim() : '';
  if (packQty > 0 && packUnit) {
    const packTargetOk = (toKind === 'mass' || toKind === 'volume')
      && canConvertBetween(packUnit, toUnit, gramsPerCup);
    // 1 Sachets of a 150 g sachet -> 0.15 kg. `fromKind === null` covers a
    // count word that was never registered as a unit (e.g. an old free-text
    // recipe row saying "sachet"), as long as it is not a known mass,
    // volume or piece unit.
    if (
      (fromKind === 'count' || fromKind === null) &&
      fromKind !== 'piece' &&
      packTargetOk
    ) {
      const onePackInTarget = normalizeRecipeQuantityToUnit(
        packQty, packUnit, toUnit, gramsPerCup, null, null
      );
      if (onePackInTarget > 0) return roundTo(qty * onePackInTarget);
    }

    // The other direction: the ingredient is stocked by the pack, so an
    // amount is measured out in packs (300 g of a 150 g pack -> 2 packs).
    if (
      (toKind === 'count' || toKind === null) &&
      (fromKind === 'mass' || fromKind === 'volume') &&
      canConvertBetween(fromUnit, packUnit, gramsPerCup)
    ) {
      const inPackUnit = normalizeRecipeQuantityToUnit(
        qty, fromUnit, packUnit, gramsPerCup, null, null
      );
      if (inPackUnit > 0) return roundTo(inPackUnit / packQty);
    }
  }

  const sameFamily = fromKind != null && fromKind === toKind && (fromKind === 'mass' || fromKind === 'volume');
  if (!sameFamily || fromFactor == null || toFactor == null) return qty;
  return roundTo((qty * fromFactor) / toFactor);
}

// True when `from` can be expressed in `to` with the rules this file
// implements: the same unit, the same mass/volume family, or a volume amount
// weighed out in grams when a density (gramsPerCup, already resolved) is
// known. Mass -> volume is deliberately NOT converted (see the "1 kg ->
// Liters (L)" case in the shared fixture), and unknown units never convert.
function canConvertBetween(from, to, gramsPerCup) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();
  if (!f || !t) return false;
  if (f === t) return true;
  const fromKind = unitKind(f);
  const toKind = unitKind(t);
  if (fromKind == null || toKind == null) return false;
  if (fromKind === toKind && (fromKind === 'mass' || fromKind === 'volume')) return true;
  if (fromKind === 'volume' && toKind === 'mass' && Number(gramsPerCup) > 0) return true;
  return false;
}

// The one entry point costing, demand and stock deduction should use: converts
// a recipe line into the ingredient's stock unit, looking up the density and
// per-piece weight itself so no caller can forget one.
//   quantity       recipe quantity ("1/2", 0.75, ...)
//   fromUnit       unit the recipe uses (product_ingredients.unit)
//   toUnit         unit the ingredient is stocked/priced in (ingredients.unit)
//   gramsPerCup    ingredients.grams_per_cup (may be null -> name estimate)
//   ingredientName used for the density / per-piece estimates
//   packQty/packUnit ingredients.pack_qty / pack_unit, so an opaque count
//                    unit (sachet, pack...) can weigh out via the pack.
function convertRecipeQuantity(quantity, fromUnit, toUnit, { gramsPerCup = null, ingredientName = '', packQty = null, packUnit = '' } = {}) {
  return normalizeRecipeQuantityToUnit(
    quantity,
    fromUnit,
    toUnit,
    densityOf(gramsPerCup, ingredientName),
    pieceWeightOf(ingredientName, fromUnit),
    Number(packQty) > 0 && packUnit ? { qty: Number(packQty), unit: packUnit } : null
  );
}

// Unit cost (price per ingredients.unit) derived from a purchase pack:
// "150 g for ₱200" on a kg-stocked ingredient -> ₱1333.33 per kg. Returns
// null when the pack is incomplete or its unit cannot be expressed in the
// stock unit (then the owner's own unit cost is kept instead).
function deriveUnitPrice({ packQty, packUnit, packPrice, stockUnit, gramsPerCup = null, ingredientName = '' }) {
  const qty = Number(parseRecipeQuantity(packQty));
  const price = Number(parseRecipeQuantity(packPrice));
  const from = String(packUnit || '').trim();
  const to = String(stockUnit || '').trim();
  if (!(qty > 0) || !(price > 0) || !from || !to) return null;
  if (from.toLowerCase() === to.toLowerCase()) return roundTo(price / qty, 6);
  const density = densityOf(gramsPerCup, ingredientName);
  if (!canConvertBetween(from, to, density)) return null;
  const inStockUnit = normalizeRecipeQuantityToUnit(qty, from, to, density, null, null);
  if (!(inStockUnit > 0)) return null;
  return roundTo(price / inStockUnit, 6);
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
  convertRecipeQuantity,
  deriveUnitPrice,
  canConvertBetween,
  densityOf,
  parseRecipeQuantity,
  pieceWeightOf,
  setUnitMetadata,
  loadUnitMetadataFromDb,
  isMissingColumnError,
};