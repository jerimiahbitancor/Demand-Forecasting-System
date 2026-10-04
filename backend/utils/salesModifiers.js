// POS MODIFIERS — "Marinated Porksilog NO EGG" is NOT a separate product.
//
// Owner decision (Oct 2 2026): words like "NO RICE" / "NO EGG" at the END of
// a Loyverse item name are modifiers on the base dish. "Marinated Porksilog",
// "Marinated Porksilog NO EGG" and "Marinated Porksilog NO RICE" are one
// product, Marinated Porksilog. The plates still count as demand for that
// dish (that is the training input); the modifier only changes which
// ingredients those plates used.
//
// The keyword list is NOT hardcoded — it comes from the modifier_rules table
// (keyword -> the one ingredient that keyword leaves out). This file holds
// the pure logic so it can be tested without a database:
//   splitModifiers()        name -> { baseName, modifiers, modifierOnly }
//   aggregateSalesRecords() file rows -> daily_sales + daily_sales_modifiers rows
//   computeStockDeductions() how much of each ingredient one upload used

// Characters allowed between a dish name and a trailing modifier, and
// between two modifiers: spaces, commas, dashes, slashes, colons.
const SEPARATOR_CHARS = '\\s,;:\\-–—/';
const TRAILING_SEPARATORS = new RegExp(`[${SEPARATOR_CHARS}.]+$`);

function normalizeKeyword(keyword) {
  return String(keyword || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One regex per keyword, longest first so "NO RICE" wins over a shorter
// keyword that happens to be its tail. Whole words only: the keyword must
// be preceded by the start of the text, a separator or an opening bracket,
// and must END the text. Inner spaces match any run of whitespace.
function buildKeywordMatchers(keywords) {
  const unique = [...new Set((keywords || []).map(normalizeKeyword).filter(Boolean))];
  unique.sort((a, b) => b.length - a.length);
  return unique.map((keyword) => ({
    keyword,
    regex: new RegExp(
      `(^|[${SEPARATOR_CHARS}(\\[])${escapeRegExp(keyword).replace(/ /g, '\\s+')}$`,
      'i'
    ),
  }));
}

// Peels keywords off the END of `text`, one at a time, until the end no
// longer is one. Returns what is left and the keywords found (in reading
// order). Never looks anywhere but the end.
function peelTrailingKeywords(text, matchers) {
  let rest = text;
  const found = [];
  for (;;) {
    const trimmed = rest.replace(TRAILING_SEPARATORS, '');
    const hit = matchers.find(({ regex }) => regex.test(trimmed));
    if (!hit) break;
    const match = trimmed.match(hit.regex);
    found.unshift(hit.keyword);
    rest = trimmed.slice(0, match.index + match[1].length);
  }
  return { rest, found };
}

/**
 * Splits trailing POS modifiers off an item name.
 *
 *   "Marinated Porksilog NO EGG"        -> base "Marinated Porksilog", [NO EGG]
 *   "Marinated Porksilog (NO EGG)"      -> same
 *   "Marinated Porksilog - no rice"     -> base ..., [NO RICE]
 *   "Marinated Porksilog NO RICE NO EGG"-> base ..., [NO RICE, NO EGG]
 *   "Sinigang NO RICE Bowl"             -> untouched (not at the end)
 *   "NO RICE"                           -> modifierOnly: true, baseName ''
 *
 * A bracket group at the end is only removed when EVERYTHING inside it is
 * modifiers, so "Bilao (Large)" or "Tapa (NO RICE extra)" stay as they are.
 */
function splitModifiers(name, keywords) {
  const original = String(name || '').replace(/\s+/g, ' ').trim();
  const matchers = buildKeywordMatchers(keywords);
  if (!original || matchers.length === 0) {
    return { baseName: original, modifiers: [], modifierOnly: false };
  }

  let rest = original;
  const modifiers = [];
  for (;;) {
    const trimmed = rest.replace(TRAILING_SEPARATORS, '');
    const last = trimmed.slice(-1);

    if (last === ')' || last === ']') {
      const openIndex = trimmed.lastIndexOf(last === ')' ? '(' : '[');
      if (openIndex === -1) break;
      const inner = trimmed.slice(openIndex + 1, -1);
      const peeled = peelTrailingKeywords(inner, matchers);
      if (peeled.found.length === 0 || peeled.rest.replace(TRAILING_SEPARATORS, '').trim() !== '') {
        break; // the brackets hold something other than modifiers
      }
      modifiers.unshift(...peeled.found);
      rest = trimmed.slice(0, openIndex);
      continue;
    }

    const peeled = peelTrailingKeywords(trimmed, matchers);
    if (peeled.found.length === 0) break;
    modifiers.unshift(...peeled.found);
    rest = peeled.rest;
  }

  if (modifiers.length === 0) {
    return { baseName: original, modifiers: [], modifierOnly: false };
  }

  const baseName = rest
    .replace(new RegExp(`[${SEPARATOR_CHARS}.(\\[]+$`), '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    baseName,
    modifiers: [...new Set(modifiers)],
    modifierOnly: baseName === '',
  };
}

function toWholeNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/**
 * Turns one file's rows into the rows to insert.
 *
 * records: [{ name, sold, refunded, saleDate, category }] — name already normalised
 *          by uploadService.normalizeProductName().
 *
 * daily_sales.quantity_sold = net plates of the BASE dish, modifier rows
 * included (sold - refunded per row, summed per product/date, then clamped
 * at 0 once — refunds on one row can cancel sales on another).
 * daily_sales_modifiers.quantity = net plates per product/date/keyword,
 * clamped to 0..quantity_sold (a modifier can't exceed the dish total).
 * A row naming two modifiers counts toward both.
 */
function aggregateSalesRecords(records, { productIdByName, keywords = [], uploadId = null } = {}) {
  const dailyByKey = new Map();
  const modifierByKey = new Map();
  const modifierOnlyNames = new Set();
  const unmatchedNames = new Set();
  const categoryByProductId = new Map();

  for (const record of records || []) {
    if (!record || !record.name) continue;
    const { baseName, modifiers, modifierOnly } = splitModifiers(record.name, keywords);
    if (modifierOnly) {
      modifierOnlyNames.add(record.name);
      continue;
    }

    const productId = productIdByName.get(baseName.toLowerCase());
    if (!productId) {
      unmatchedNames.add(baseName);
      continue;
    }

    if (record.category && !categoryByProductId.has(productId)) {
      categoryByProductId.set(productId, record.category);
    }

    const net = toWholeNumber(record.sold) - toWholeNumber(record.refunded);
    const dailyKey = `${productId}|${record.saleDate}`;
    const daily = dailyByKey.get(dailyKey);
    if (daily) {
      daily.quantity_sold += net;
    } else {
      dailyByKey.set(dailyKey, {
        product_id: productId,
        sale_date: record.saleDate,
        quantity_sold: net,
        upload_id: uploadId || null,
      });
    }

    for (const keyword of modifiers) {
      const modifierKey = `${dailyKey}|${keyword}`;
      const existing = modifierByKey.get(modifierKey);
      if (existing) {
        existing.quantity += net;
      } else {
        modifierByKey.set(modifierKey, {
          product_id: productId,
          sale_date: record.saleDate,
          keyword,
          quantity: net,
          upload_id: uploadId || null,
        });
      }
    }
  }

  const dailySalesRows = [...dailyByKey.values()].map((row) => ({
    ...row,
    quantity_sold: Math.max(0, row.quantity_sold),
  }));
  const totalByKey = new Map(dailySalesRows.map((row) => [`${row.product_id}|${row.sale_date}`, row.quantity_sold]));
  const modifierRows = [...modifierByKey.values()]
    .map((row) => ({
      ...row,
      quantity: Math.min(
        totalByKey.get(`${row.product_id}|${row.sale_date}`) || 0,
        Math.max(0, row.quantity)
      ),
    }))
    .filter((row) => row.quantity > 0);

  return {
    dailySalesRows,
    modifierRows,
    categoryByProductId,
    modifierOnlyNames: [...modifierOnlyNames],
    unmatchedNames: [...unmatchedNames],
  };
}

/**
 * Ingredient used by one upload, per ingredient id.
 *
 * For every plate of an active product with a recipe, the full recipe is
 * used — except a modifier plate leaves out the ONE ingredient its keyword
 * maps to, and only when that ingredient is in this product's recipe.
 * Worked as "all plates minus the plates without it", per ingredient, so the
 * stock is deducted once (never deducted then added back), and plates never
 * go below 0.
 *
 *   10 plain + 3 NO EGG + 2 NO RICE = 15 plates -> egg 12, rice 13.
 *
 * perServingFor(recipeRow) returns the per-plate amount in the ingredient's
 * own unit (uploadService passes the recipe-unit conversion).
 */
function computeStockDeductions({
  dailySalesRows = [],
  modifierRows = [],
  recipeRows = [],
  activeProductIds = new Set(),
  ingredientIdByKeyword = new Map(),
  perServingFor,
}) {
  const platesWithoutIngredient = new Map(); // product|date|ingredient -> plates
  for (const modifier of modifierRows) {
    const ingredientId = ingredientIdByKeyword.get(normalizeKeyword(modifier.keyword));
    if (ingredientId === undefined || ingredientId === null) continue;
    const key = `${modifier.product_id}|${modifier.sale_date}|${ingredientId}`;
    platesWithoutIngredient.set(key, (platesWithoutIngredient.get(key) || 0) + Number(modifier.quantity || 0));
  }

  const recipesByProduct = new Map();
  for (const recipe of recipeRows) {
    if (!recipesByProduct.has(recipe.product_id)) recipesByProduct.set(recipe.product_id, []);
    recipesByProduct.get(recipe.product_id).push(recipe);
  }

  const deductions = new Map();
  for (const sale of dailySalesRows) {
    if (!activeProductIds.has(sale.product_id)) continue;
    for (const recipe of recipesByProduct.get(sale.product_id) || []) {
      const without = platesWithoutIngredient.get(`${sale.product_id}|${sale.sale_date}|${recipe.ingredient_id}`) || 0;
      const plates = Math.max(0, Number(sale.quantity_sold) - without);
      const amount = Number(perServingFor(recipe)) * plates;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      deductions.set(recipe.ingredient_id, (deductions.get(recipe.ingredient_id) || 0) + amount);
    }
  }
  return deductions;
}

module.exports = {
  normalizeKeyword,
  splitModifiers,
  aggregateSalesRecords,
  computeStockDeductions,
};
