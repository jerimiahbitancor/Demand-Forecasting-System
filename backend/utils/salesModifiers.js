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
 * For every plate of a deducting product with a recipe, the full recipe is
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
 *
 * deductingProductIds: the products that deduct. Since v3 that is every
 * product in the file that is not archived (New and Discontinued dishes used
 * real ingredients too); a product without a recipe simply adds nothing.
 * `activeProductIds` is the old name, still accepted.
 *
 * Returns Map<ingredient_id, Map<sale_date 'YYYY-MM-DD', amount>> — per day,
 * because each day is checked against the ingredient's last stock count
 * (shouldDeduct) before anything is taken from stock.
 */
function computeStockDeductionsByDate({
  dailySalesRows = [],
  modifierRows = [],
  recipeRows = [],
  deductingProductIds,
  activeProductIds = new Set(),
  ingredientIdByKeyword = new Map(),
  perServingFor,
}) {
  const deducting = deductingProductIds || activeProductIds;
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

  const byIngredient = new Map();
  for (const sale of dailySalesRows) {
    if (!deducting.has(sale.product_id)) continue;
    const day = String(sale.sale_date).slice(0, 10);
    for (const recipe of recipesByProduct.get(sale.product_id) || []) {
      const without = platesWithoutIngredient.get(`${sale.product_id}|${sale.sale_date}|${recipe.ingredient_id}`) || 0;
      const plates = Math.max(0, Number(sale.quantity_sold) - without);
      const amount = Number(perServingFor(recipe)) * plates;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!byIngredient.has(recipe.ingredient_id)) byIngredient.set(recipe.ingredient_id, new Map());
      const byDay = byIngredient.get(recipe.ingredient_id);
      byDay.set(day, (byDay.get(day) || 0) + amount);
    }
  }
  return byIngredient;
}

// Same as computeStockDeductionsByDate, summed over the days:
// Map<ingredient_id, amount>.
function computeStockDeductions(args) {
  const totals = new Map();
  for (const [ingredientId, byDay] of computeStockDeductionsByDate(args)) {
    let sum = 0;
    for (const amount of byDay.values()) sum += amount;
    totals.set(ingredientId, sum);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Stock counts and shortfalls (owner's v3 flowchart, page 2).
// All times are Asia/Manila, UTC+8 with no daylight saving, so a fixed
// "+08:00" offset is exact.
// ---------------------------------------------------------------------------

const MANILA_OFFSET = '+08:00';

const toTime = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

// The business day for sale_date D ends at D+1 03:00 Asia/Manila (the night
// runs 3 PM to 3 AM and Loyverse files it under the day it opened).
function businessDayEnd(saleDate) {
  const day = String(saleDate).slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const iso = next.toISOString().slice(0, 10);
  return new Date(`${iso}T03:00:00${MANILA_OFFSET}`);
}

// The ingredient's last stock count: the newest of its latest 'adjustment'
// (an Edit of the stock) and its created_at (creating it with a quantity is a
// count). A 'restock' is a delivery, not a count, so it is never passed here.
function lastStockCountAt({ createdAt = null, latestAdjustmentAt = null } = {}) {
  const times = [toTime(createdAt), toTime(latestAdjustmentAt)].filter((t) => t !== null);
  return times.length ? new Date(Math.max(...times)) : null;
}

// Deduct a day's plates only if that day ENDED after the last stock count.
// A count taken at or after the end already includes those plates.
// No count known -> deduct.
function shouldDeduct(saleDate, lastCountAt) {
  const countTime = toTime(lastCountAt);
  if (countTime === null) return true;
  return businessDayEnd(saleDate).getTime() > countTime;
}

// 'Kilograms (kg)' -> 'kg'; 'kg' -> 'kg'.
function unitLabel(unit) {
  const text = String(unit || '').trim();
  const inner = text.match(/\(([^)]+)\)\s*$/);
  return inner ? inner[1].trim() : text;
}

// Up to 3 decimals for display, trailing zeros dropped: 9.07, 0, 1.234.
// The database keeps the full value.
function formatAmount(value) {
  const n = Number(value) || 0;
  return String(Number(n.toFixed(3)));
}

/**
 * The shortfall when a deduction is bigger than the stock it found.
 * Returns null when there was enough. Stock itself still floors at 0
 * (deduct_ingredient_stock does that).
 */
function describeShortfall({ ingredientName, unit, requested, inStock }) {
  const requestedN = Number(requested) || 0;
  const stockN = Math.max(0, Number(inStock) || 0);
  const shortfall = requestedN - stockN;
  if (!(shortfall > 0)) return null;
  const u = unitLabel(unit);
  const amount = (n) => (u ? `${formatAmount(n)} ${u}` : formatAmount(n));
  const name = ingredientName || 'This ingredient';
  return {
    shortfall,
    notes: `Requested ${amount(requestedN)}, only ${amount(stockN)} in stock. Shortfall ${amount(shortfall)}.`,
    // Not "Low stock": that reads like the separate low/out-of-stock alert.
    title: `Stock shortfall: ${name}`,
    message: `${name}: ${amount(requestedN)} used but ${amount(stockN)} in stock. Please monitor it.`,
  };
}

module.exports = {
  normalizeKeyword,
  splitModifiers,
  aggregateSalesRecords,
  computeStockDeductions,
  computeStockDeductionsByDate,
  businessDayEnd,
  lastStockCountAt,
  shouldDeduct,
  unitLabel,
  formatAmount,
  describeShortfall,
};
