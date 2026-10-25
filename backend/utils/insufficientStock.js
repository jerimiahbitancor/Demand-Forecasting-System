// utils/insufficientStock.js
//
// The "unmet condition" of a sales upload: the file needs more of one or more
// ingredients than is in stock, so NOTHING from it is saved (no daily_sales
// rows, no deductions). See migrations/020_sales_upload_requires_stock.sql.
//
// Pure: no I/O. Shared by uploadService (throws it), routes/upload.js
// (turns it into a 422 + notification) and the tests.

const { Decimal, unitLabel, formatAmount } = require('./salesModifiers');

const INSUFFICIENT_STOCK_CODE = 'INSUFFICIENT_STOCK';
const MAX_NAMES_IN_TEXT = 5;

const toDecimal = (value) => {
  try {
    const d = value instanceof Decimal ? value : new Decimal(value == null ? 0 : String(value));
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};

/**
 * One short ingredient, normalised.
 * Input fields are accepted in camelCase (Node check) or snake_case (the SQL
 * function's JSON). Amounts stay strings so no precision is lost.
 */
function normalizeShortfall(item = {}) {
  const required = toDecimal(item.required);
  const available = Decimal.max(0, toDecimal(item.available));
  const shortfall = item.shortfall != null
    ? toDecimal(item.shortfall)
    : Decimal.max(0, required.minus(available));
  return {
    ingredientId: item.ingredientId ?? item.ingredient_id ?? null,
    name: item.name || `Ingredient #${item.ingredientId ?? item.ingredient_id ?? '?'}`,
    unit: item.unit || null,
    required: required.toString(),
    available: available.toString(),
    shortfall: shortfall.toString(),
  };
}

// "Rice: needs 12 kg, 10 kg in stock (2 kg short)."
function describeInsufficientItem(item) {
  const s = normalizeShortfall(item);
  const u = unitLabel(s.unit);
  const amount = (v) => (u ? `${formatAmount(v)} ${u}` : formatAmount(v));
  return `${s.name}: needs ${amount(s.required)}, ${amount(s.available)} in stock (${amount(s.shortfall)} short).`;
}

// "Rice, Egg and 3 more"
function namesText(shortfalls) {
  const names = shortfalls.map((s) => s.name);
  if (names.length <= 1) return names[0] || '';
  const shown = names.slice(0, MAX_NAMES_IN_TEXT);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

class InsufficientStockError extends Error {
  /**
   * @param {object[]} shortfalls  one entry per short ingredient
   * @param {object} [options]
   * @param {string|null} [options.filename]
   */
  constructor(shortfalls = [], { filename = null } = {}) {
    const items = (shortfalls || []).map(normalizeShortfall);
    super(`Not enough stock for ${items.length} ingredient(s): ${namesText(items)}. The sales file was not saved.`);
    this.name = 'InsufficientStockError';
    this.code = INSUFFICIENT_STOCK_CODE;
    this.shortfalls = items;
    this.filename = filename;
  }
}

const isInsufficientStockError = (error) => Boolean(error && error.code === INSUFFICIENT_STOCK_CODE);

// The other unmet condition: a recipe line whose unit cannot be converted to
// the ingredient's stock unit. The stock needed cannot be known, so the file
// is refused too (owner's decision, Oct 24 2026), instead of being saved with
// that ingredient silently left undeducted.
const UNCONVERTIBLE_RECIPE_CODE = 'RECIPE_UNIT_UNCONVERTIBLE';

class UnconvertibleRecipeError extends Error {
  /**
   * @param {object[]} items  [{ ingredientId, ingredient, reasons: string[] }]
   * @param {object} [options]
   * @param {string|null} [options.filename]
   */
  constructor(items = [], { filename = null } = {}) {
    const list = (items || []).map((item) => ({
      ingredientId: item.ingredientId ?? null,
      ingredient: item.ingredient || `Ingredient #${item.ingredientId ?? '?'}`,
      reasons: (item.reasons || []).filter(Boolean),
    }));
    const details = list
      .map((item) => `${item.ingredient}: ${item.reasons.join('; ') || 'the recipe unit could not be converted'}.`)
      .join(' ');
    super(`The stock needed could not be worked out for ${list.length} ingredient(s), so the sales file was not saved. ${details}`);
    this.name = 'UnconvertibleRecipeError';
    this.code = UNCONVERTIBLE_RECIPE_CODE;
    this.items = list;
    this.filename = filename;
  }
}

const isUnconvertibleRecipeError = (error) => Boolean(error && error.code === UNCONVERTIBLE_RECIPE_CODE);

/**
 * The bell notification (and email) for a refused upload.
 * One per upload; key `upload_blocked_stock:<uploadId>`.
 */
function buildInsufficientStockNotice({ shortfalls = [], filename = null, uploadId = null } = {}) {
  const items = shortfalls.map(normalizeShortfall);
  const file = filename ? `"${filename}"` : 'The sales file';
  const lines = items.map(describeInsufficientItem);
  const key = `upload_blocked_stock:${uploadId ?? 'unknown'}`;
  return {
    type: 'error',
    title: 'File not saved: not enough stock',
    message: `${file} was not saved because these ingredients do not have enough stock: `
      + `${lines.join(' ')} Restock or correct the stock count, then upload the same file again.`,
    link: '/ingredient-management',
    metadata: {
      kind: 'upload_blocked_stock',
      key,
      upload_id: uploadId,
      filename,
      shortfalls: items,
    },
  };
}

module.exports = {
  InsufficientStockError,
  isInsufficientStockError,
  normalizeShortfall,
  describeInsufficientItem,
  buildInsufficientStockNotice,
  INSUFFICIENT_STOCK_CODE,
  UnconvertibleRecipeError,
  isUnconvertibleRecipeError,
  UNCONVERTIBLE_RECIPE_CODE,
};
