// Shared unit conversion for recipe quantities (backend mirror of
// frontend/src/utils/recipeUnits.js). Keeps cost, demand and stock-deduction
// math correct when a product's recipe uses a different unit than the
// ingredient's stock/price unit (e.g. "1 cup" vs an ingredient priced per L).
// Keep the tables in sync with the frontend copy.
//
// Precision rules (U1-U4 of the inventory hardening task):
//   - Every quantity is a decimal.js Decimal, never a JS float. Postgres
//     numerics arrive as STRINGS; they are parsed into Decimal, never
//     through Number().
//   - A conversion that cannot be RESOLVED throws UnitConversionError. There
//     is no silent 1:1 fallback: guessing a unit corrupts stock levels.
//   - The canonical unit of an ingredient is its base_unit ('g' | 'mL' |
//     'piece'). ingredients.unit stays display-only.
//
// Unit conversion metadata lives in the ingredient_units table
// (see backend/sql/ingredient_unit_conversion_schema.sql): family
// (mass/volume/count), base_factor (grams or mL per 1 unit), is_piece, and
// per-piece weights. Load it once at boot with setUnitMetadata()/
// loadUnitMetadataFromDb(). Until then (or if the migration hasn't run) the
// static tables below act as the offline fallback so costing never blocks on
// a database read.
//
// House measures that have no universal answer (1 tbsp sugar = 12 g) live in
// the ingredient_unit_conversions table and are loaded with
// setIngredientUnitConversions(). They WIN over the generic density tables.

const Decimal = require('decimal.js');

// 40 significant digits is far more than numeric(18,6) can hold, so the
// running totals never lose precision before the single final rounding.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * Thrown when a recipe amount cannot be expressed in the ingredient's
 * canonical unit. The caller decides what to do with it (the upload pipeline
 * marks the ingredient "unconvertible" and surfaces a warning).
 */
class UnitConversionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UnitConversionError';
    this.code = 'UNIT_CONVERSION_FAILED';
    this.details = details;
  }
}

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

// The canonical spelling of a unit: 'kg', 'g', 'mg', 'ml', 'l', 'cup', 'tbsp',
// 'tsp', 'pcs', 'slice', 'clove', 'stick', 'pack', 'sachet', 'bottle', 'can',
// 'bunch'. Aliases and display names ('Kilograms (kg)', 'pcs', 'Pieces (pcs)')
// all collapse onto the same key, so "pcs" and "Pieces (pcs)" are recognised
// as the SAME unit.
const RECIPE_UNIT_CANONICAL = {
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  'kg (kg)': 'kg', 'kilograms (kg)': 'kg', 'kilogram (kg)': 'kg',
  g: 'g', gram: 'g', grams: 'g', gm: 'g', 'g (g)': 'g', 'gram (g)': 'g', 'grams (g)': 'g',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  l: 'l', L: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  'l (l)': 'l', 'liter (l)': 'l', 'liters (l)': 'l', 'litre (l)': 'l', 'litres (l)': 'l',
  ml: 'ml', mL: 'ml', millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml',
  'ml (ml)': 'ml', 'milliliter (ml)': 'ml', 'milliliters (ml)': 'ml', 'millilitre (ml)': 'ml',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', tps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  floz: 'floz', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  pt: 'pt', pint: 'pt', pints: 'pt',
  qt: 'qt', quart: 'qt', quarts: 'qt',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs',
  'pcs (pcs)': 'pcs', 'pc (pcs)': 'pcs', 'piece (pcs)': 'pcs', 'pieces (pcs)': 'pcs',
  slice: 'slice', slices: 'slice', 'slice (pcs)': 'slice', 'slices (pcs)': 'slice',
  clove: 'clove', cloves: 'clove', 'clove (pcs)': 'clove', 'cloves (pcs)': 'clove',
  stick: 'stick', sticks: 'stick', 'stick (pcs)': 'stick', 'sticks (pcs)': 'stick',
  pack: 'pack', packs: 'pack', 'pack (pcs)': 'pack', 'packs (pcs)': 'pack',
  sachet: 'sachet', sachets: 'sachet',
  bottle: 'bottle', bottles: 'bottle',
  can: 'can', cans: 'can',
  bunch: 'bunch', bunches: 'bunch',
};

// ---------------------------------------------------------------------------
// Database-driven metadata.
// ---------------------------------------------------------------------------
// key (lowercased name/alias) -> { family, factor, isPiece, pieceWeightGrams, canonical }
const unitMetadata = new Map();
// key `${ingredientId}|${fromUnit}|${toUnit}` -> Decimal factor
const ingredientUnitConversions = new Map();

// The canonical key of a unit row: the short name in the brackets when the
// display name has one ('Kilograms (kg)' -> 'kg'), else the name itself.
function canonicalUnitName(name) {
  const text = String(name || '').trim();
  const inner = text.match(/\(([^)]+)\)\s*$/);
  const short = inner ? inner[1].trim() : text;
  const key = short.toLowerCase();
  return RECIPE_UNIT_CANONICAL[key] || key;
}

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
      factor: family === 'count' || u.base_factor == null ? null : String(u.base_factor),
      isPiece: Boolean(u.is_piece) && family === 'count',
      pieceWeightGrams: u.piece_weight_grams == null ? null : String(u.piece_weight_grams),
      canonical: canonicalUnitName(name),
    };
    const keys = [name, ...(Array.isArray(u.aliases) ? u.aliases : [])];
    for (const key of keys) {
      const clean = String(key || '').trim().toLowerCase();
      if (clean) unitMetadata.set(clean, meta);
    }
  }
}

// Accept rows shaped like the ingredient_unit_conversions table:
//   { ingredient_id, from_unit, to_unit, factor }
// House measures (1 tbsp sugar = 12 g). They override the generic density
// tables, because a kitchen measure depends on the ingredient, not the unit.
function setIngredientUnitConversions(rows = []) {
  ingredientUnitConversions.clear();
  for (const row of rows || []) {
    if (row == null) continue;
    const ingredientId = row.ingredient_id;
    const from = String(row.from_unit || '').trim().toLowerCase();
    const to = String(row.to_unit || '').trim().toLowerCase();
    if (ingredientId == null || !from || !to || row.factor == null) continue;
    const factor = new Decimal(row.factor);
    if (!factor.isFinite() || factor.lte(0)) continue;
    ingredientUnitConversions.set(`${ingredientId}|${from}|${to}`, factor);
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

// The canonical key of a unit: 'pcs' and 'Pieces (pcs)' are the same unit.
function canonicalOf(unit) {
  const key = String(unit || '').trim().toLowerCase();
  if (!key) return '';
  const ov = unitMetadata.get(key);
  if (ov) return ov.canonical;
  return RECIPE_UNIT_CANONICAL[key] || key;
}

// True when both spellings mean the same unit.
function sameUnit(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return canonicalOf(left) === canonicalOf(right);
}

// Grams per piece from explicitly configured unit metadata. Ingredient-name
// guesses are intentionally not used for stock deductions.
function densityOf(gramsPerCup) {
  if (gramsPerCup == null || gramsPerCup === '') return null;
  const density = new Decimal(String(gramsPerCup));
  return density.isFinite() && density.gt(0) ? density : null;
}

function pieceWeightOf(ingredientName, pieceUnit) {
  const unit = String(pieceUnit || '').trim().toLowerCase();
  const ov = unitMetadata.get(unit);
  if (ov && ov.family === 'count' && ov.isPiece && ov.pieceWeightGrams != null) return ov.pieceWeightGrams;
  return null;
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

// Parse a recipe quantity EXACTLY into a Decimal. Fractions and mixed numbers
// are exact: "1/3" -> 0.3333... (40 digits), never 0.3333333333333333.
function parseRecipeQuantityDecimal(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Decimal) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const mixed = trimmed.match(/^(-?\d+(?:\.\d+)?)\s+([+-]?\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const den = new Decimal(mixed[3]);
    if (den.isZero()) return null;
    return new Decimal(mixed[1]).plus(new Decimal(mixed[2]).div(den));
  }

  const fraction = trimmed.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const den = new Decimal(fraction[2]);
    if (den.isZero()) return null;
    return new Decimal(fraction[1]).div(den);
  }

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const parsed = new Decimal(trimmed);
  return parsed.isFinite() ? parsed : null;
}

function recipeQuantityForStorage(value) {
  const quantity = parseRecipeQuantityDecimal(value);
  if (!quantity || !quantity.isFinite()) {
    throw new TypeError(`Invalid recipe quantity: ${value}`);
  }
  return quantity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed();
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
  const target = String(toUnit || '').trim();
  const targetCanonical = canonicalOf(target);
  const targetKind = unitKind(targetCanonical);
  const ingredient = {
    id: null,
    name: '',
    unit: target,
    base_unit: target,
    unit_family: targetKind === 'piece' ? 'count' : targetKind,
    density_g_per_ml: gramsPerCup == null || gramsPerCup === ''
      ? null
      : new Decimal(String(gramsPerCup)).div(240).toString(),
    piece_weight_grams: pieceWeightGrams == null ? null : String(pieceWeightGrams),
    pack_size: null,
  };
  if (pack?.qty != null && pack?.unit) {
    ingredient.pack_size = unitService.resolve(pack.qty, pack.unit, ingredient).baseAmount.toString();
  }
  return unitService.resolve(quantity, fromUnit, ingredient).baseAmount;
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
  if (fromKind === 'volume' && toKind === 'mass') {
    try {
      return new Decimal(String(gramsPerCup)).gt(0);
    } catch {
      return false;
    }
  }
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
  const target = String(toUnit || '').trim();
  const unit = canonicalOf(target);
  const family = unitKind(unit);
  const ingredient = {
    id: null,
    name: ingredientName,
    unit: target,
    base_unit: target,
    unit_family: family === 'piece' ? 'count' : family,
    density_g_per_ml: gramsPerCup == null || gramsPerCup === ''
      ? null
      : new Decimal(String(gramsPerCup)).div(240).toString(),
    pack_size: null,
  };
  if (packQty != null && packUnit) {
    const packContents = unitService.resolve(packQty, packUnit, ingredient);
    ingredient.pack_size = packContents.baseAmount.toString();
  }
  return unitService.resolve(quantity, fromUnit, ingredient).baseAmount;
}

// Unit cost (price per ingredients.unit) derived from a purchase pack:
// "150 g for 200" on a kg-stocked ingredient -> 1333.33 per kg. Returns
// null when the pack is incomplete or its unit cannot be expressed in the
// stock unit (then the owner's own unit cost is kept instead).
function deriveUnitPrice({ packQty, packUnit, packPrice, stockUnit, gramsPerCup = null, ingredientName = '' }) {
  const qty = parseRecipeQuantityDecimal(packQty);
  const price = parseRecipeQuantityDecimal(packPrice);
  const from = String(packUnit || '').trim();
  const to = String(stockUnit || '').trim();
  if (!qty?.gt(0) || !price?.gt(0) || !from || !to) return null;
  try {
    const inStockUnit = normalizeRecipeQuantityToUnit(
      qty,
      from,
      to,
      gramsPerCup,
      null,
      null
    );
    if (!inStockUnit.gt(0)) return null;
    return price.div(inStockUnit).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  } catch (error) {
    if (error instanceof UnitConversionError) return null;
    throw error;
  }
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

// ---------------------------------------------------------------------------
// unitService.resolve(amount, fromUnit, ingredient)
// The strict, canonical-unit resolver. Everything internal works in the
// ingredient's base_unit ('g' | 'mL' | 'piece'); the `unit` column is
// display-only.
//
// Throws UnitConversionError when the conversion cannot be resolved. There is
// NO silent 1:1 fallback: an ingredient whose recipe unit cannot be resolved
// is marked "unconvertible" and is not deducted at all.
// ---------------------------------------------------------------------------

// The canonical unit of an ingredient. base_unit wins; otherwise derive it
// from the unit_family / the unit's own family.
function baseUnitOf(ingredient = {}) {
  const explicit = String(ingredient.base_unit || '').trim();
  if (explicit) return canonicalOf(explicit) || explicit;
  const family = String(ingredient.unit_family || '').trim().toLowerCase();
  if (family === 'mass') return 'g';
  if (family === 'volume') return 'ml';
  if (family === 'count') return 'pcs';
  // Fall back to the stock unit itself, which is already in the ingredient's
  // own unit when the canonical columns were never filled in.
  const unit = String(ingredient.unit || '').trim();
  if (!unit) return null;
  return canonicalOf(unit) || unit;
}

// The family of a unit, taking the ingredient's own unit_family into account
// for the (unregistered) base units 'g', 'mL' and 'piece'.
function familyOf(unit, ingredient = {}) {
  const key = String(unit || '').trim().toLowerCase();
  if (key === 'g' || key === 'gram' || key === 'grams' || key === 'gm') return 'mass';
  if (key === 'ml' || key === 'millilitre' || key === 'milliliter') return 'volume';
  if (key === 'piece' || key === 'pcs' || key === 'pc' || key === 'pieces') return 'count';
  const canonical = canonicalOf(unit).toLowerCase();
  const kind = unitKind(key) || unitKind(canonical);
  if (kind) return kind === 'piece' ? 'count' : kind;
  // Unknown unit: the ingredient's own family is the only hint available.
  const family = String(ingredient.unit_family || '').trim().toLowerCase();
  return family || null;
}

// Grams per mL for an ingredient.
//
// ONLY ingredients.density_g_per_ml counts (U2). There is no name-based
// estimate here and no grams_per_cup fallback: a guessed density silently
// corrupts the stock level. The migration fills density_g_per_ml from
// grams_per_cup (grams_per_cup / 240), so an ingredient that used to work
// keeps working once the migration has run.
function densityOfIngredient(ingredient = {}) {
  const explicit = ingredient.density_g_per_ml;
  if (explicit == null || explicit === '') return null;
  const d = new Decimal(explicit);
  return d.isFinite() && d.gt(0) ? d : null;
}

// A "pack"-like unit word: an opaque count unit the ingredient is bought in.
const PACK_UNIT_WORDS = new Set(['pack', 'packs', 'sachet', 'sachets', 'packet', 'packets', 'bag', 'bags', 'box', 'boxes', 'bottle', 'bottles', 'can', 'cans', 'bunch', 'bunches', 'dozen', 'dozens']);

function isPackUnit(unit) {
  const key = String(unit || '').trim().toLowerCase();
  if (!key) return false;
  if (PACK_UNIT_WORDS.has(key)) return true;
  // "150 g pack", "pack (150g)" -> still a pack.
  return /\bpack(s|et|ets|age|ages)?\b/.test(key);
}

const unitService = {
  /**
   * Convert `amount` (a Decimal, a numeric string, or a number) from
   * `fromUnit` into the ingredient's canonical base unit.
   *
   * Returns { baseAmount: Decimal, baseUnit: string }.
   * Throws UnitConversionError when the conversion cannot be resolved.
   */
  resolve(amount, fromUnit, ingredient = {}) {
    const qty = amount instanceof Decimal
      ? amount
      : parseRecipeQuantityDecimal(amount);

    if (qty == null || !qty.isFinite()) {
      throw new UnitConversionError(
        `Recipe quantity for ${ingredient.name || 'an ingredient'} is not a number`,
        { ingredientId: ingredient.id, amount: amount == null ? null : String(amount) }
      );
    }
    if (qty.lte(0)) {
      return { baseAmount: new Decimal(0), baseUnit: baseUnitOf(ingredient) || String(fromUnit || '') };
    }

    const from = String(fromUnit || '').trim().toLowerCase();
    const baseUnit = baseUnitOf(ingredient);
    if (!from) {
      throw new UnitConversionError(
        `Recipe for ${ingredient.name || 'an ingredient'} has no unit, so it cannot be converted to ${baseUnit || 'the stock unit'}`,
        { ingredientId: ingredient.id, fromUnit: fromUnit == null ? null : String(fromUnit), toUnit: baseUnit }
      );
    }
    if (!baseUnit) {
      throw new UnitConversionError(
        `Ingredient ${ingredient.name || ingredient.id} has no base unit, so a recipe in ${from} cannot be converted`,
        { ingredientId: ingredient.id, fromUnit, toUnit: null }
      );
    }

    const baseLower = String(baseUnit).toLowerCase();
    const fail = (reason) => {
      throw new UnitConversionError(
        `Cannot convert ${from} to ${baseUnit} for ${ingredient.name || `ingredient #${ingredient.id}`}: ${reason}`,
        { ingredientId: ingredient.id, fromUnit: from, toUnit: baseUnit, reason }
      );
    };

    // 1. The units already match ('pcs' and 'Pieces (pcs)' are the same unit).
    if (sameUnit(from, baseUnit)) {
      return { baseAmount: qty, baseUnit: baseUnit };
    }

    // 2. Per-ingredient house measure (1 tbsp sugar = 12 g). These win over
    //    the generic density tables.
    if (ingredient.id != null) {
      const prefix = `${ingredient.id}|${from}|`;
      const overrides = ingredient.unitConversions || ingredient.unit_conversions || [];
      const candidates = overrides.filter((row) => (
        String(row.from_unit || '').trim().toLowerCase() === from
      ));
      const directOverride = candidates.find((row) => (
        sameUnit(row.to_unit, baseUnit)
      )) || (candidates.length === 1 ? candidates[0] : null);
      const globalMatches = [...ingredientUnitConversions.entries()].filter(([key]) => key.startsWith(prefix));
      const globalOverride = globalMatches.find(([key]) => sameUnit(key.slice(prefix.length), baseUnit))
        || (globalMatches.length === 1 ? globalMatches[0] : null);
      const selectedOverride = directOverride
        ? [`${prefix}${String(directOverride.to_unit).trim().toLowerCase()}`, new Decimal(String(directOverride.factor))]
        : globalOverride;
      if (!selectedOverride && (candidates.length > 1 || globalMatches.length > 1)) {
        fail('multiple house-measure overrides match this recipe unit');
      }
      const match = selectedOverride;
      const override = match && match[1];
      if (override) {
        const overrideTarget = match[0].slice(prefix.length);
        if (sameUnit(overrideTarget, baseUnit)) {
          return { baseAmount: qty.mul(override), baseUnit };
        }
        const converted = unitService.resolve(
          qty.mul(override),
          overrideTarget,
          { ...ingredient, id: null }
        );
        return { baseAmount: converted.baseAmount, baseUnit };
      }
    }

    const fromFamily = familyOf(from, ingredient);
    const baseFamily = familyOf(baseLower, ingredient);

    // 3. pack -> the ingredient's own unit: one pack holds pack_size base
    //    units (a 12-egg pack of an ingredient stocked in pcs, a 150 g sachet
    //    of an ingredient stocked in g).
    if (isPackUnit(from)) {
      const packSize = ingredient.pack_size != null && ingredient.pack_size !== ''
        ? new Decimal(ingredient.pack_size)
        : null;
      if (packSize == null || !packSize.isFinite() || packSize.lte(0)) {
        fail('the ingredient has no valid pack_size');
      }
      return { baseAmount: qty.mul(packSize), baseUnit: baseUnit };
    }

    // 4. mass <-> volume: only with a known density.
    const crossFamily = (fromFamily === 'mass' && baseFamily === 'volume')
      || (fromFamily === 'volume' && baseFamily === 'mass');
    if (crossFamily) {
      const density = densityOfIngredient(ingredient);
      if (density == null) {
        fail('the ingredient has no density_g_per_ml, so mass and volume cannot be mixed');
      }
      const fromFactor = unitFactor(from);
      const baseFactor = unitFactor(baseLower);
      if (fromFactor == null || baseFactor == null) {
        fail('the unit is not registered, so it cannot be converted');
      }
      const grams = fromFamily === 'mass'
        ? qty.mul(new Decimal(String(fromFactor)))
        : qty.mul(new Decimal(String(fromFactor))).mul(density);
      if (baseFamily === 'mass') {
        return { baseAmount: grams.div(new Decimal(String(baseFactor))), baseUnit: baseUnit };
      }
      const ml = grams.div(density);
      return { baseAmount: ml.div(new Decimal(String(baseFactor))), baseUnit: baseUnit };
    }

    // 5. Same family (mass with mass, volume with volume).
    if (fromFamily && fromFamily === baseFamily && (fromFamily === 'mass' || fromFamily === 'volume')) {
      const fromFactor = unitFactor(from);
      const baseFactor = unitFactor(baseLower);
      if (fromFactor == null || baseFactor == null) {
        fail('the unit is not registered, so it cannot be converted');
      }
      return {
        baseAmount: qty.mul(new Decimal(String(fromFactor))).div(new Decimal(String(baseFactor))),
        baseUnit: baseUnit,
      };
    }

    // 6. count -> count that is not a pack: only an explicit override or an
    //    identical unit can be right. Never assume 1:1.
    if (fromFamily === 'count' && baseFamily === 'count') {
      fail('a count unit can only be converted through the ingredient\'s pack_size or a house measure');
    }

    // 7. piece -> mass via the per-piece weight.
    if (fromFamily === 'count' && baseFamily === 'mass') {
      const weight = ingredient.piece_weight_grams != null
        ? new Decimal(String(ingredient.piece_weight_grams))
        : pieceWeightOf(ingredient.name, from);
      const baseFactor = unitFactor(baseLower);
      if (weight == null || baseFactor == null) {
        fail('there is no known weight for this piece unit');
      }
      return {
        baseAmount: qty.mul(weight instanceof Decimal ? weight : new Decimal(String(weight))).div(new Decimal(String(baseFactor))),
        baseUnit: baseUnit,
      };
    }

    fail('the unit families do not match');
    return null; // unreachable; fail() always throws
  },
};

function inventoryUnitMetadata({ unit, name, gramsPerCup, packQty, packUnit }) {
  const stockUnit = String(unit || '').trim();
  const baseUnit = canonicalOf(stockUnit);
  const unitFamily = familyOf(stockUnit, { unit: stockUnit });
  const gramsPerCupDecimal = parseRecipeQuantityDecimal(gramsPerCup);
  const density = gramsPerCupDecimal?.gt(0)
    ? gramsPerCupDecimal.div(240).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
    : null;
  const ingredient = {
    name,
    unit: stockUnit,
    base_unit: baseUnit,
    unit_family: unitFamily,
    density_g_per_ml: density,
  };
  let packSize = null;

  if (packQty != null && packUnit) {
    packSize = unitService.resolve(packQty, packUnit, ingredient)
      .baseAmount.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
  }

  return {
    base_unit: baseUnit,
    unit_family: unitFamily,
    stock_scale: 3,
    allow_fractional: unitFamily !== 'count',
    pack_size: packSize,
    density_g_per_ml: density,
  };
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
    await loadIngredientUnitConversionsFromDb(client);
    return true;
  } catch (err) {
    console.error('Failed to load unit conversion metadata:', err.message);
    return false;
  }
}

// Count units (pcs, sachets, packs...). Same rule as the frontend's
// isCountUnit() in frontend/src/utils/formatStockQty.js (kept in step by
// tests/toBuy.crosscheck.test.mjs): the unit tables first, then a word list
// for units they may not list, also matched on the abbreviation in
// brackets ("Pieces (pcs)" -> "pcs").
const COUNT_UNIT_WORDS = new Set([
  'pc', 'pcs', 'piece', 'pieces',
  'sachet', 'sachets', 'pack', 'packs', 'packet', 'packets',
  'bottle', 'bottles', 'can', 'cans', 'box', 'boxes', 'bag', 'bags',
  'tray', 'trays', 'bunch', 'bunches', 'roll', 'rolls',
  'slice', 'slices', 'clove', 'cloves', 'stick', 'sticks',
  'head', 'heads', 'dozen', 'dozens',
]);

function isCountUnit(unit) {
  const text = String(unit || '').trim().toLowerCase();
  if (!text) return false;
  const kind = unitKind(text);
  if (kind === 'count' || kind === 'piece') return true;
  if (kind === 'mass' || kind === 'volume') return false;
  const inBrackets = /\(([^)]+)\)/.exec(text);
  const candidates = [text, inBrackets ? inBrackets[1].trim() : null].filter(Boolean);
  return candidates.some((c) => {
    const k = unitKind(c);
    return k === 'count' || k === 'piece' || COUNT_UNIT_WORDS.has(c);
  });
}

// "To buy" (Grocery List, restock email): max(0, need - stock), rounded UP
// to a whole number for count units — nobody buys 47.3 eggs. Mass and
// volume units stay exact. The 1e-9 keeps float noise (48.0000000001)
// from becoming 49.
function toBuyQuantity(need, stock, unit) {
  const raw = Math.max(0, (Number(need) || 0) - (Number(stock) || 0));
  if (!isCountUnit(unit)) return raw;
  return Math.max(0, Math.ceil(raw - 1e-9));
=========
// Load the per-ingredient house measures. Best effort: the table is new, so a
// missing one must not break the boot.
async function loadIngredientUnitConversionsFromDb(client) {
  if (!client) return false;
  try {
    const { data, error } = await client
      .from('ingredient_unit_conversions')
      .select('ingredient_id, from_unit, to_unit, factor');
    if (error) {
      if (isMissingColumnError(error) || /ingredient_unit_conversions/.test(String(error.message))) return false;
      throw error;
    }
    setIngredientUnitConversions(data && data.length ? data : []);
    return true;
  } catch (err) {
    console.error('Failed to load ingredient unit conversions:', err.message);
    return false;
  }
>>>>>>>>> Temporary merge branch 2
}

module.exports = {
  isCountUnit,
  toBuyQuantity,
  normalizeRecipeQuantityToUnit,
  convertRecipeQuantity,
  deriveUnitPrice,
  canConvertBetween,
  densityOf,
  parseRecipeQuantity,
  parseRecipeQuantityDecimal,
  recipeQuantityForStorage,
  pieceWeightOf,
  canonicalOf,
  sameUnit,
  setUnitMetadata,
  setIngredientUnitConversions,
  loadUnitMetadataFromDb,
  loadIngredientUnitConversionsFromDb,
  isMissingColumnError,
  familyOf,
  inventoryUnitMetadata,
  unitService,
  UnitConversionError,
  Decimal,
};
