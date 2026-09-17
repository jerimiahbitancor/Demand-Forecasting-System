// Shared unit conversion for recipe quantities.
//
// product_ingredients.unit stores the unit a product's recipe actually uses
// (e.g. "1 cup of soy sauce"), while the ingredient itself is priced in its
// own stock unit (e.g. "Liters"). To keep "price x quantity" correct, every
// quantity is normalised to the ingredient's unit before being multiplied.
// See also backend/utils/recipeUnits.js — keep the tables in sync.
export const RECIPE_UNIT_BASE_FACTOR = {
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

export const RECIPE_MASS_UNITS = new Set([
  'kg', 'kilogram', 'kilograms', 'kilo', 'kilos', 'kg (kg)', 'kilograms (kg)', 'kilogram (kg)',
  'g', 'gram', 'grams', 'gm', 'g (g)', 'gram (g)', 'grams (g)', 'mg', 'milligram', 'milligrams',
  'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces'
]);

export const RECIPE_VOLUME_UNITS = new Set([
  'L', 'l', 'litre', 'liter', 'litres', 'liters', 'l (l)', 'liter (l)', 'liters (l)', 'litre (l)', 'litres (l)',
  'mL', 'ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters',
  'ml (ml)', 'milliliter (ml)', 'milliliters (ml)', 'millilitre (ml)',
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'tps', 'teaspoon', 'teaspoons',
  'fl oz', 'floz', 'fluid ounce', 'fluid ounces',
  'pt', 'pint', 'pints', 'qt', 'quart', 'quarts', 'gal', 'gallon', 'gallons'
]);

// Count/piece units that can convert to weight via a per-piece estimate
// ("4 pcs of potato" -> grams). Units without a trusted piece weight
// (packs, bottles, cans, bunches, sachets) stay out of this set so their
// quantities pass through unchanged.
export const RECIPE_COUNT_PIECE_UNITS = new Set([
  'pcs', 'pc', 'piece', 'pieces',
  'pcs (pcs)', 'pc (pcs)', 'piece (pcs)', 'pieces (pcs)',
  'slice', 'slices', 'slice (pcs)', 'slices (pcs)',
  'clove', 'cloves', 'clove (pcs)', 'cloves (pcs)',
  'stick', 'sticks', 'stick (pcs)', 'sticks (pcs)'
]);

// Extra human-friendly cooking units offered in the recipe editor that aren't
// necessarily in the ingredient_units table (kg/g/L/mL/pcs/box/pack).
export const RECIPE_EXTRA_UNITS = [
  'cup', 'tbsp', 'tsp', 'tps', 'fl oz', 'lb', 'oz', 'mg',
  'pt', 'qt', 'gal', 'pints', 'quarts', 'gallons',
  'pcs', 'slices', 'packs', 'sachets', 'bottles', 'cans', 'bunches', 'cloves', 'sticks'
];

// Common kitchen densities (grams per cup, 1 cup = 240 mL) used when converting
// a volume recipe unit to a mass purchase unit and the ingredient has no
// grams_per_cup set. Matched loosely against the ingredient name; the most
// specific names are checked first (e.g. brown sugar before sugar).
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

export const recipeDensityFor = (gramsPerCup, ingredientName) => {
  const explicit = Number(gramsPerCup);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const name = String(ingredientName || '');
  for (const { match, g } of DENSITY_KEYWORDS) {
    if (match.test(name)) return g;
  }
  return null;
};

// Default per-piece weights (grams) used when a recipe quantity uses a piece
// unit (pcs / slices / cloves / sticks) but the ingredient is priced by weight
// (kg / g). These are market-friendly estimates; the exact paperweight can
// later live on the ingredient row (e.g. grams_per_piece).
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

// Grams per piece for `pieceUnit` pieces of `ingredientName`, or null when no
// trusted estimate exists (packs, bottles, cans, bunches, ...).
export const pieceWeightOf = (ingredientName, pieceUnit) => {
  const unit = String(pieceUnit || '').trim().toLowerCase();
  if (/^sticks?(\s\(pcs\))?$/.test(unit) && /butter/i.test(String(ingredientName || ''))) return 113;
  const name = String(ingredientName || '');
  for (const { match, g } of PIECE_WEIGHT_KEYWORDS) {
    if (match.test(name)) return g;
  }
  return null;
};

export const roundTo = (value, places = 4) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

// Cost of `quantity` `recipeUnit` of an ingredient priced `price` per its
// stock unit, converted to the stock unit and scaled by price:
//   cost = convertedAmount x unit price
// Returns { converted, cost, gramsPerCupUsed, needsDensity, pieceWeight, needsPieceWeight }.
export const priceRecipeIngredient = ({ quantity, recipeUnit, stockUnit, price, gramsPerCup, ingredientName }) => {
  const qty = Number(quantity);
  const unitPrice = Number(price) || 0;
  if (!Number.isFinite(qty) || qty <= 0 || !recipeUnit || !stockUnit) {
    return { converted: null, cost: 0, gramsPerCupUsed: null, needsDensity: false, pieceWeight: null, needsPieceWeight: false };
  }
  const density = recipeDensityFor(gramsPerCup, ingredientName);
  const pieceWeight = pieceWeightOf(ingredientName, recipeUnit);
  const converted = normalizeRecipeQuantityToUnit(qty, recipeUnit, stockUnit, density, pieceWeight);
  const from = String(recipeUnit).trim().toLowerCase();
  const to = String(stockUnit).trim().toLowerCase();
  const volumeToMass = RECIPE_VOLUME_UNITS.has(from) && RECIPE_MASS_UNITS.has(to);
  const pieceToMass = RECIPE_COUNT_PIECE_UNITS.has(from) && RECIPE_MASS_UNITS.has(to);
  return {
    converted,
    cost: converted * unitPrice,
    gramsPerCupUsed: density,
    needsDensity: volumeToMass && !density,
    pieceWeight,
    needsPieceWeight: pieceToMass && !pieceWeight
  };
};

// Convert `quantity` expressed in `fromUnit` into `toUnit` (the ingredient's
// unit). Same-family units convert (mL -> L, g -> kg, cup -> L, g -> tbsp, ...).
// Unrecognised or cross-family units (e.g. kg -> pcs) are left as-is.
//
// `gramsPerCup` (ingredients.grams_per_cup) enables volume->mass conversion:
// when `fromUnit` is a volume unit and `toUnit` is a mass unit, the volume is
// first expressed in mL, then scaled by the ingredient's density (grams per
// 240 mL cup). Without a density the quantity passes through unchanged
// (otherwise "1 cup of flour" priced per kg would wrongly cost 1 kg).
//
// `pieceWeightGrams` enables piece->mass conversion: when `fromUnit` is a
// piece unit (pcs, slices, cloves, sticks) and `toUnit` is a mass unit, each
// piece is weighed at `pieceWeightGrams` (e.g. 150 g per potato). Without a
// piece weight the quantity passes through unchanged.
export const normalizeRecipeQuantityToUnit = (quantity, fromUnit, toUnit, gramsPerCup, pieceWeightGrams) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return qty || 0;
  const from = String(fromUnit || '').trim().toLowerCase();
  const to = String(toUnit || '').trim().toLowerCase();
  const fromFactor = RECIPE_UNIT_BASE_FACTOR[from];
  const toFactor = RECIPE_UNIT_BASE_FACTOR[to];

  if (
    RECIPE_VOLUME_UNITS.has(from) &&
    RECIPE_MASS_UNITS.has(to) &&
    fromFactor != null &&
    toFactor != null &&
    Number(gramsPerCup) > 0
  ) {
    const grams = (qty * fromFactor) * (Number(gramsPerCup) / 240);
    return roundTo(grams / toFactor);
  }

  if (
    RECIPE_COUNT_PIECE_UNITS.has(from) &&
    RECIPE_MASS_UNITS.has(to) &&
    toFactor != null &&
    Number(pieceWeightGrams) > 0
  ) {
    return roundTo((qty * Number(pieceWeightGrams)) / toFactor);
  }

  const sameFamily =
    (RECIPE_MASS_UNITS.has(from) && RECIPE_MASS_UNITS.has(to)) ||
    (RECIPE_VOLUME_UNITS.has(from) && RECIPE_VOLUME_UNITS.has(to));
  if (!sameFamily || fromFactor == null || toFactor == null) return qty;
  return roundTo((qty * fromFactor) / toFactor);
};