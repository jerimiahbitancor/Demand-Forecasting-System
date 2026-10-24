// Shared unit conversion for recipe quantities (backend mirror of
// frontend/src/utils/recipeUnits.js). Keeps cost, demand and stock-deduction
// math correct when a product's recipe uses a different unit than the
// ingredient's stock/price unit.
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
const Decimal = require('decimal.js');
const UNIT_CONVERSION_DATA = require('../../shared/ingredientUnits.json');

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

const UNIT_BY_ALIAS = new Map();
const RECIPE_UNIT_BASE_FACTOR = {};
const RECIPE_UNIT_CANONICAL = {};
for (const definition of UNIT_CONVERSION_DATA.units) {
  for (const key of [definition.name, ...definition.aliases]) {
    const normalized = String(key).trim().toLowerCase();
    UNIT_BY_ALIAS.set(normalized, definition);
    RECIPE_UNIT_BASE_FACTOR[normalized] = definition.family === 'count' ? null : String(definition.baseFactor);
    const shortName = definition.name.match(/\(([^)]+)\)\s*$/)?.[1] || definition.name;
    RECIPE_UNIT_CANONICAL[normalized] = shortName.toLowerCase();
  }
}
const RECIPE_MASS_UNITS = new Set(UNIT_CONVERSION_DATA.units.filter((u) => u.family === 'mass')
  .flatMap((u) => [u.name, ...u.aliases].map((key) => key.toLowerCase())));
const RECIPE_VOLUME_UNITS = new Set(UNIT_CONVERSION_DATA.units.filter((u) => u.family === 'volume')
  .flatMap((u) => [u.name, ...u.aliases].map((key) => key.toLowerCase())));
const RECIPE_COUNT_PIECE_UNITS = new Set(UNIT_CONVERSION_DATA.units.filter((u) => u.family === 'count')
  .flatMap((u) => [u.name, ...u.aliases].map((key) => key.toLowerCase())));
// ---------------------------------------------------------------------------
// Database-driven metadata.
// ---------------------------------------------------------------------------
// key (lowercased name/alias) -> { family, factor, isPiece, pieceWeightGrams, canonical }
const unitMetadata = new Map();

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
    const definition = UNIT_BY_ALIAS.get(name.toLowerCase());
    if (!name || !definition) continue;
    const meta = {
      family: definition.family,
      factor: definition.family === 'count' ? null : String(definition.baseFactor),
      isPiece: false,
      pieceWeightGrams: null,
      canonical: definition.name.toLowerCase(),
    };
    const keys = [name, ...definition.aliases];
    for (const key of keys) {
      const clean = String(key || '').trim().toLowerCase();
      if (clean) unitMetadata.set(clean, meta);
    }
  }
}

// Resolve a supported unit's conversion kind.
function unitKind(key) {
  const definition = UNIT_BY_ALIAS.get(String(key || '').trim().toLowerCase());
  if (definition) return definition.family;
  const ov = unitMetadata.get(key);
  if (ov) return ov.family;
  if (RECIPE_MASS_UNITS.has(key)) return 'mass';
  if (RECIPE_VOLUME_UNITS.has(key)) return 'volume';
  if (RECIPE_COUNT_PIECE_UNITS.has(key)) return 'count';
  return null;
}

// Base factor for a unit: grams for 'mass', mL for 'volume', null otherwise.
function unitFactor(key) {
  const definition = UNIT_BY_ALIAS.get(String(key || '').trim().toLowerCase());
  if (definition) return definition.family === 'count' ? null : String(definition.baseFactor);
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

function pieceWeightOf() {
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

// Convert through the standard base unit for the matching family. Mass,
// volume and count are independent families.
function normalizeRecipeQuantityToUnit(quantity, fromUnit, toUnit, materialType = 'dry') {
  const target = String(toUnit || '').trim();
  const targetCanonical = canonicalOf(target);
  const targetKind = unitKind(targetCanonical);
  const ingredient = {
    id: null,
    name: '',
    unit: target,
    base_unit: target,
    unit_family: targetKind,
    material_type: materialType,
  };
  return unitService.resolve(quantity, fromUnit, ingredient).baseAmount;
}

// True when `from` can be expressed in `to` with the rules this file
// implements: the same unit, same-family conversion, or a standard wet/dry
// volume-to-weight conversion.
function canConvertBetween(from, to) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();
  if (!f || !t || !UNIT_BY_ALIAS.has(f) || !UNIT_BY_ALIAS.has(t)) return false;
  if (f === t) return true;
  const fromKind = unitKind(f);
  const toKind = unitKind(t);
  if (fromKind == null || toKind == null) return false;
  if (fromKind === toKind && (fromKind === 'mass' || fromKind === 'volume')) return true;
  if (fromKind === 'count' && toKind === 'count') return canonicalOf(f) === canonicalOf(t);
  if (['mass', 'volume'].includes(fromKind) && ['mass', 'volume'].includes(toKind)) return true;
  return false;
}

// The one entry point costing, demand and stock deduction should use: converts
// a recipe line into the ingredient's stock unit, looking up the density and
// per-piece weight itself so no caller can forget one.
//   quantity       recipe quantity ("1/2", 0.75, ...)
//   fromUnit       unit the recipe uses (product_ingredients.unit)
//   toUnit         unit the ingredient is stocked/priced in (ingredients.unit)
//   materialType   ingredient's wet/dry classification
function convertRecipeQuantity(quantity, fromUnit, toUnit, { materialType = 'dry' } = {}) {
  const target = String(toUnit || '').trim();
  const unit = canonicalOf(target);
  const family = unitKind(unit);
  const ingredient = {
    id: null,
    name: '',
    unit: target,
    base_unit: target,
    unit_family: family,
    material_type: materialType,
  };
  return unitService.resolve(quantity, fromUnit, ingredient).baseAmount;
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

    if (!UNIT_BY_ALIAS.has(from) || !UNIT_BY_ALIAS.has(baseLower)) {
      fail('only the supported ingredient units can be converted');
    }
    // 1. The units already match ('pcs' and 'Pieces (pcs)' are the same unit).
    if (sameUnit(from, baseUnit)) {
      return { baseAmount: qty.gt(0) ? qty : new Decimal(0), baseUnit: baseUnit };
    }
    const safeQuantity = qty.gt(0) ? qty : new Decimal(0);

    const fromFamily = familyOf(from, ingredient);
    const baseFamily = familyOf(baseLower, ingredient);
    // Same-family units convert through their common base unit.
    if (fromFamily && fromFamily === baseFamily && (fromFamily === 'mass' || fromFamily === 'volume')) {
      const fromFactor = unitFactor(from);
      const baseFactor = unitFactor(baseLower);
      if (fromFactor == null || baseFactor == null) {
        fail('the unit is not registered, so it cannot be converted');
      }
      return {
        baseAmount: safeQuantity.mul(new Decimal(String(fromFactor))).div(new Decimal(String(baseFactor))),
        baseUnit: baseUnit,
      };
    }

    if (fromFamily === 'count' && baseFamily === 'count') {
      fail('count quantities can only be converted between identical units');
    }

    fail('the unit families do not match');
    return null; // unreachable; fail() always throws
  },
};

function inventoryUnitMetadata({ unit, materialType = 'dry' }) {
  const stockUnit = String(unit || '').trim();
  if (!UNIT_BY_ALIAS.has(stockUnit.toLowerCase())) {
    throw new UnitConversionError(`Unsupported stock unit "${stockUnit}". Choose a supported ingredient unit.`);
  }
  const baseUnit = canonicalOf(stockUnit);
  const unitFamily = familyOf(stockUnit, { unit: stockUnit });
  return {
    base_unit: baseUnit,
    unit_family: unitFamily,
    stock_scale: 3,
    allow_fractional: unitFamily !== 'count',
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
    return true;
  } catch (err) {
    console.error('Failed to load unit conversion metadata:', err.message);
    return false;
  }
}

// Count units. Same rule as the frontend's
// isCountUnit() in frontend/src/utils/formatStockQty.js (kept in step by
// tests/toBuy.crosscheck.test.mjs): the unit tables first, then a word list
// for units they may not list, also matched on the abbreviation in
// brackets ("Pieces (pcs)" -> "pcs").
const COUNT_UNIT_WORDS = new Set([
  'pc', 'pcs', 'piece', 'pieces',
]);

function isCountUnit(unit) {
  const text = String(unit || '').trim().toLowerCase();
  if (!text) return false;
  const kind = unitKind(text);
  if (kind === 'count') return true;
  if (kind === 'mass' || kind === 'volume') return false;
  const inBrackets = /\(([^)]+)\)/.exec(text);
  const candidates = [text, inBrackets ? inBrackets[1].trim() : null].filter(Boolean);
  return candidates.some((c) => {
    const k = unitKind(c);
    return k === 'count' || COUNT_UNIT_WORDS.has(c);
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
}

module.exports = {
  isCountUnit,
  toBuyQuantity,
  normalizeRecipeQuantityToUnit,
  convertRecipeQuantity,
  canConvertBetween,
  parseRecipeQuantity,
  parseRecipeQuantityDecimal,
  recipeQuantityForStorage,
  pieceWeightOf,
  canonicalOf,
  sameUnit,
  setUnitMetadata,
  loadUnitMetadataFromDb,
  isMissingColumnError,
  familyOf,
  inventoryUnitMetadata,
  unitService,
  UnitConversionError,
  Decimal,
};
