// Shared unit conversion for recipe quantities (frontend mirror of
// backend/utils/recipeUnits.js and ml-service/services/data_loader.py).
//
// product_ingredients.unit stores the unit a product's recipe actually uses,
// while the ingredient itself is priced in its own stock unit. To keep
// "price x quantity" correct, every quantity is normalised to the ingredient's
// unit before being multiplied.
//
import UNIT_CONVERSION_DATA from '../../../shared/ingredientUnits.json' with { type: 'json' };

const UNIT_DEFINITIONS = UNIT_CONVERSION_DATA.units;
const UNIT_BY_ALIAS = new Map();
const RECIPE_UNIT_BASE_FACTOR = {};
for (const definition of UNIT_DEFINITIONS) {
  for (const key of [definition.name, ...definition.aliases]) {
    const normalized = String(key).trim().toLowerCase();
    UNIT_BY_ALIAS.set(normalized, definition);
    RECIPE_UNIT_BASE_FACTOR[normalized] = definition.family === 'count' ? null : definition.baseFactor;
  }
}
const RECIPE_MASS_UNITS = new Set(UNIT_DEFINITIONS.filter((u) => u.family === 'mass')
  .flatMap((u) => [u.name, ...u.aliases].map((key) => key.toLowerCase())));
const RECIPE_VOLUME_UNITS = new Set(UNIT_DEFINITIONS.filter((u) => u.family === 'volume')
  .flatMap((u) => [u.name, ...u.aliases].map((key) => key.toLowerCase())));
const RECIPE_COUNT_PIECE_UNITS = new Set(UNIT_DEFINITIONS.filter((u) => u.family === 'count')
  .flatMap((u) => [u.name, ...u.aliases].map((key) => key.toLowerCase())));
export const RECIPE_EXTRA_UNITS = UNIT_DEFINITIONS.map((u) => u.name);

// ===========================================================================
// Database-driven metadata, loaded from GET /units.
// ===========================================================================
// key (lowercased name/alias) -> { family, factor, isPiece, pieceWeightGrams }
const unitMetadata = new Map();

// Accepts the rows GET /units returns:
//   { name, family, base_factor, is_piece, piece_weight_grams, aliases, is_active }
// Rebuilds the map from scratch, so call it again after any unit change.
// Inactive rows are skipped, like the backend loader. Rows without a valid
// family (the old-schema fallback of /units) are skipped too, so they never
// turn kg into a plain count; those units keep using the built-in tables.
export const setUnitMetadata = (rows) => {
  unitMetadata.clear();
  for (const u of rows || []) {
    if (u.is_active === false) continue;
    const name = String(u.name || '').trim();
    const definition = UNIT_BY_ALIAS.get(name.toLowerCase());
    if (!name || !definition) continue;
    if (u.family !== 'mass' && u.family !== 'volume' && u.family !== 'count') continue;
    const meta = {
      name: definition.name,
      family: definition.family,
      factor: definition.family === 'count' ? null : definition.baseFactor,
      isPiece: false,
      pieceWeightGrams: null
    };
    for (const key of [name, ...(Array.isArray(u.aliases) ? u.aliases : [])]) {
      const clean = String(key || '').trim().toLowerCase();
      if (clean) unitMetadata.set(clean, meta);
    }
  }
};

// 'mass' | 'volume' | 'piece' | 'count' | null (unknown) for a unit name/alias.
// 'piece' is a piece-like count unit (pcs/slices/cloves/sticks) that may
// convert to mass through a per-piece weight.
export const unitKindOf = (unit) => {
  const key = String(unit || '').trim().toLowerCase();
  const definition = UNIT_BY_ALIAS.get(key);
  if (definition) return definition.family;
  const meta = unitMetadata.get(key);
  if (meta) return meta.family;
  if (RECIPE_MASS_UNITS.has(key)) return 'mass';
  if (RECIPE_VOLUME_UNITS.has(key)) return 'volume';
  if (RECIPE_COUNT_PIECE_UNITS.has(key)) return 'count';
  return null;
};

// The unit's display name from ingredient_units for any of its names/aliases
// ("kg" -> "Kilograms (kg)"). Unknown units come back
// unchanged, so nothing a recipe line already holds is ever lost.
export const canonicalUnitName = (unit) => {
  const meta = unitMetadata.get(String(unit || '').trim().toLowerCase());
  const key = String(unit || '').trim().toLowerCase();
  return UNIT_BY_ALIAS.get(key)?.name || meta?.name || unit;
};

// The short form of a unit, used where the full name would be too long:
//   "Grams (g)" -> "g", "Pieces (pcs)" -> "pcs", "Kilogram (kg)" -> "kg".
export const unitShortLabel = (unit) => {
  const text = String(unit || '').trim();
  if (!text) return 'unit';
  const inBrackets = /\(([^)]+)\)/.exec(text);
  if (inBrackets && inBrackets[1].trim()) return inBrackets[1].trim();
  return text;
};

// What the recipe-unit dropdown should offer: the active ingredient_units rows
// and nothing else, grouped by kind and ordered small -> large. Aliases are
// lookup keys, never separate choices. [{ label, units: [name, ...] }].
// Falls back to the built-in cooking units only when no rows were loaded.
const UNIT_GROUP_LABELS = { mass: 'Weight', volume: 'Volume', count: 'Count / pieces' };
export const groupUnitsForSelect = () => {
  const groups = [];
  for (const family of ['mass', 'volume', 'count']) {
    const members = UNIT_DEFINITIONS.filter((u) => u.family === family);
    if (members.length) groups.push({ label: UNIT_GROUP_LABELS[family], units: members.map((u) => u.name) });
  }
  return groups;
};

// Grams (mass) or mL (volume) in one of `unit`; null for counts / unknown.
const unitFactorOf = (unit) => {
  const key = String(unit || '').trim().toLowerCase();
  const definition = UNIT_BY_ALIAS.get(key);
  if (definition) return definition.family === 'count' ? null : definition.baseFactor;
  const meta = unitMetadata.get(key);
  if (meta) return meta.family === 'count' ? null : meta.factor;
  return RECIPE_UNIT_BASE_FACTOR[key] ?? null;
};

// Count units are not converted into weight.
export const pieceWeightOf = () => null;

export const roundTo = (value, places = 4) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

// Parse a recipe-style quantity into a number: "1/2" -> 0.5, "1 1/2" -> 1.5,
// "0.75" -> 0.75. product_ingredients.quantity_per_serving is a free-text
// column, so stored values may be fractions, mixed numbers, or decimals.
// Returns NaN for unparseable input.
export const parseRecipeQuantity = (value) => {
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
};

// Convert between supported units. Weight, volume and count are independent
// families; mass cannot be inferred from volume without ingredient-specific
// density data.
export const normalizeRecipeQuantityToUnit = (quantity, fromUnit, toUnit) => {
  const qty = parseRecipeQuantity(quantity);
  if (!Number.isFinite(qty)) return NaN;
  const normalizedFrom = String(fromUnit || '').trim().toLowerCase();
  const normalizedTo = String(toUnit || '').trim().toLowerCase();
  if (!UNIT_BY_ALIAS.has(normalizedFrom) || !UNIT_BY_ALIAS.has(normalizedTo)) return NaN;
  const fromKind = unitKindOf(fromUnit);
  const toKind = unitKindOf(toUnit);
  const fromFactor = unitFactorOf(fromUnit);
  const toFactor = unitFactorOf(toUnit);
  if (fromKind == null || toKind == null) return NaN;
  if (fromKind === 'count' && toKind === 'count') {
    return UNIT_BY_ALIAS.get(String(fromUnit).trim().toLowerCase())?.name
      === UNIT_BY_ALIAS.get(String(toUnit).trim().toLowerCase())?.name ? Math.max(0, qty) : NaN;
  }
  if (fromFactor == null || toFactor == null) return NaN;
  if (fromKind !== toKind) {
    return NaN;
  }
  if (qty <= 0) return 0;
  return roundTo((qty * fromFactor) / toFactor);
};

// True when `from` can be expressed in `to` with the rules above: the same
// unit or the same conversion family. Unknown units do not
// convert, matching the backend / ml-service copies.
export const canConvertBetween = (from, to) => {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();
  if (!f || !t || !UNIT_BY_ALIAS.has(f) || !UNIT_BY_ALIAS.has(t)) return false;
  if (f === t) return true;
  const fromKind = unitKindOf(f);
  const toKind = unitKindOf(t);
  if (fromKind == null || toKind == null) return false;
  if (fromKind === toKind && (fromKind === 'mass' || fromKind === 'volume')) return true;
  if (fromKind === 'count' && toKind === 'count') {
    return UNIT_BY_ALIAS.get(f)?.name === UNIT_BY_ALIAS.get(t)?.name;
  }
  return false;
};

// The one entry point cost previews should use: converts a recipe line into the
// ingredient's stock unit, looking up the density and per-piece weight itself.
// Same result as the backend's convertRecipeQuantity (demand / COGS / stock
// deduction), so what the owner sees matches what the system books.
export const convertRecipeQuantity = (quantity, fromUnit, toUnit) =>
  normalizeRecipeQuantityToUnit(quantity, fromUnit, toUnit);

// Cost of `quantity` `recipeUnit` of an ingredient priced `price` per its
// stock unit, converted to the stock unit and scaled by price:
//   cost = convertedAmount x unit price
// Returns the converted amount and its cost, plus count-unit estimation data.
export const priceRecipeIngredient = ({ quantity, recipeUnit, stockUnit, price }) => {
  const qty = Number(quantity);
  const unitPrice = Number(price) || 0;
  if (!Number.isFinite(qty) || qty <= 0 || !recipeUnit || !stockUnit) {
    return { converted: null, cost: 0, pieceWeight: null, needsPieceWeight: false };
  }
  const converted = normalizeRecipeQuantityToUnit(qty, recipeUnit, stockUnit);
  const pieceWeight = null;
  return {
    converted,
    cost: converted * unitPrice,
    pieceWeight,
    needsPieceWeight: false
  };
};
