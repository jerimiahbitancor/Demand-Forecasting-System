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
//   computeStockDeductionsByDate() how much of each ingredient one upload used
//
// QUANTITY PRECISION (hardening task): every quantity is a decimal.js
// Decimal. Postgres numerics arrive as strings and are parsed into Decimal,
// never through Number(); arithmetic is exact until the single final
// rounding in roundQuantity().

const Decimal = require('decimal.js');

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

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

// Plates are whole numbers: "3.5 sold" means 4 plates sold.
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
 * CANONICAL base unit, as a Decimal (uploadService passes the
 * unitService.resolve() result). Returning a number is still accepted for
 * compatibility with older callers, but a Decimal is exact.
 *
 * deductingProductIds: the products that deduct. Since v3 that is every
 * product in the file that is not archived (New and Discontinued dishes used
 * real ingredients too); a product without a recipe simply adds nothing.
 * `activeProductIds` is the old name, still accepted.
 *
 * Returns Map<ingredient_id, {
 *   exact: Decimal,            // the exact total over every day
 *   byDate: Map<sale_date, Decimal>,  // the exact amount per day
 *   skippedDates: string[],    // days the timing rule skipped
 *   unitWarnings: object[],    // units that could not be resolved
 * }>
 *
 * A recipe whose unit cannot be resolved (no density, no pack size, an
 * unknown unit) makes the WHOLE ingredient unconvertible: the total would
 * otherwise be silently short. Such an ingredient is removed from the map
 * and reported in the returned `unconvertible` list, so the caller can warn
 * the owner instead of deducting a wrong amount.
 *
 * The exact total is NOT rounded here: the rounding happens ONCE, at the end,
 * in roundQuantity() (see the hardening task, U4). The per-date values are
 * kept so the "not deducted for <days>" note can still be written.
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
  const platesWithoutIngredient = new Map(); // product|date|ingredient -> Decimal
  for (const modifier of modifierRows) {
    const ingredientId = ingredientIdByKeyword.get(normalizeKeyword(modifier.keyword));
    if (ingredientId === undefined || ingredientId === null) continue;
    const key = `${modifier.product_id}|${modifier.sale_date}|${ingredientId}`;
    platesWithoutIngredient.set(
      key,
      (platesWithoutIngredient.get(key) || new Decimal(0)).plus(new Decimal(modifier.quantity || 0))
    );
  }

  const recipesByProduct = new Map();
  for (const recipe of recipeRows) {
    if (!recipesByProduct.has(recipe.product_id)) recipesByProduct.set(recipe.product_id, []);
    recipesByProduct.get(recipe.product_id).push(recipe);
  }

  // ingredient_id -> { exact, byDate, skippedDates, unitWarnings, unconvertible }
  const byIngredient = new Map();
  const entryFor = (ingredientId) => {
    if (!byIngredient.has(ingredientId)) {
      byIngredient.set(ingredientId, {
        exact: new Decimal(0),
        byDate: new Map(),
        skippedDates: [],
        unitWarnings: [],
        unconvertible: false,
      });
    }
    return byIngredient.get(ingredientId);
  };

  // A recipe is resolved once, not once per sale date.
  const resolvedCache = new Map();
  const resolveRecipe = (recipe) => {
    if (resolvedCache.has(recipe)) return resolvedCache.get(recipe);
    let result;
    try {
      const perServing = perServingFor(recipe);
      if (perServing instanceof Decimal) {
        result = { baseAmount: perServing };
      } else if (perServing && perServing.baseAmount instanceof Decimal) {
        // A unitService.resolve() result: { baseAmount, baseUnit }.
        result = { baseAmount: perServing.baseAmount, baseUnit: perServing.baseUnit };
      } else if (perServing == null) {
        result = { baseAmount: null };
      } else {
        result = { baseAmount: new Decimal(perServing) };
      }
    } catch (error) {
      result = {
        baseAmount: null,
        error,
        code: error && error.code ? error.code : 'UNIT_CONVERSION_FAILED',
        reason: error && error.message ? error.message : String(error),
      };
    }
    resolvedCache.set(recipe, result);
    return result;
  };

  for (const sale of dailySalesRows) {
    if (!deducting.has(sale.product_id)) continue;
    const day = String(sale.sale_date).slice(0, 10);
    for (const recipe of recipesByProduct.get(sale.product_id) || []) {
      const without = platesWithoutIngredient.get(`${sale.product_id}|${sale.sale_date}|${recipe.ingredient_id}`) || new Decimal(0);
      const plates = new Decimal(sale.quantity_sold || 0).minus(without);
      if (!plates.gt(0)) continue;

      const resolved = resolveRecipe(recipe);
      if (resolved.error) {
        const entry = entryFor(recipe.ingredient_id);
        entry.unconvertible = true;
        entry.unitWarnings.push({
          ingredient_id: recipe.ingredient_id,
          product_id: recipe.product_id,
          recipe_id: recipe.id != null ? recipe.id : null,
          from_unit: recipe.unit || null,
          code: resolved.code,
          reason: resolved.reason,
        });
        continue;
      }

      const perServingDecimal = resolved.baseAmount;
      if (perServingDecimal == null) continue;
      if (!perServingDecimal.isFinite() || perServingDecimal.lte(0)) continue;

      const entry = entryFor(recipe.ingredient_id);
      const amount = perServingDecimal.mul(plates);

      entry.exact = entry.exact.plus(amount);
      entry.byDate.set(day, (entry.byDate.get(day) || new Decimal(0)).plus(amount));
    }
  }

  // An ingredient with ONE unresolvable recipe must not be deducted from a
  // total that is missing part of its usage: take it out of the map and
  // report it instead.
  const unconvertible = [];
  for (const [ingredientId, entry] of byIngredient) {
    if (!entry.unconvertible) continue;
    entry.exact = new Decimal(0);
    entry.byDate.clear();
    unconvertible.push({
      ingredient_id: ingredientId,
      warnings: entry.unitWarnings,
    });
  }

  byIngredient.unconvertible = unconvertible;
  return byIngredient;
}

// Same as computeStockDeductionsByDate, summed over the days:
// Map<ingredient_id, Decimal>.
function computeStockDeductions(args) {
  const totals = new Map();
  for (const [ingredientId, entry] of computeStockDeductionsByDate(args)) {
    if (entry.unconvertible) continue;
    totals.set(ingredientId, entry.exact);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Rounding — the ONE place a quantity is rounded (U4).
//
//   mass / volume  -> half-up to stock_scale (default 3)
//   count, allow_fractional = false -> CEIL to a whole piece (egg, pack)
//   count, allow_fractional = true  -> half-up to stock_scale
//
// Returns a Decimal. A rounded amount of 0 means "do not deduct at all".
// ---------------------------------------------------------------------------
function roundQuantity(exact, ingredient = {}) {
  const value = exact instanceof Decimal ? exact : new Decimal(exact == null ? 0 : exact);
  if (!value.isFinite() || value.lte(0)) return new Decimal(0);

  const family = String(ingredient.unit_family || '').trim().toLowerCase();
  const allowFractional = ingredient.allow_fractional === false ? false : true;
  const scale = Number.isInteger(ingredient.stock_scale) && ingredient.stock_scale >= 0
    ? ingredient.stock_scale
    : 3;

  if (family === 'count' && allowFractional === false) {
    // A discrete unit cannot be split: 1.5 eggs means 2 eggs.
    return value.toDecimalPlaces(0, Decimal.ROUND_CEIL);
  }
  return value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
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

/**
 * The ingredient's last stock count: the newest 'adjustment' row
 * (transaction_type = 'adjustment') in inventory_transactions.
 *
 * 'restock' is a delivery, not a count, so it is never counted here.
 *
 * ingredients.created_at is NOT part of the maximum any more (U7): a row that
 * was created with a quantity is not a count — the adjustment row written at
 * the same moment already is one — and mixing the two made the result depend
 * on when the ingredient row happened to be inserted. With no adjustment row
 * there is no known count, and shouldDeduct() then deducts.
 */
function lastStockCountAt({ latestAdjustmentAt = null } = {}) {
  const countTime = toTime(latestAdjustmentAt);
  return countTime === null ? null : new Date(countTime);
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
// The database keeps the full value. No float is involved: the Decimal is
// formatted, never converted to a number.
function formatAmount(value) {
  const n = value instanceof Decimal ? value : new Decimal(value == null ? 0 : value);
  if (!n.isFinite()) return '0';
  return n.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toString();
}

/**
 * The shortfall when a deduction is bigger than the stock it found.
 * Returns null when there was enough. Stock itself still floors at 0
 * (deduct_ingredient_stock does that).
 *
 * `requested` and `inStock` are Decimals (or numeric strings): both are
 * reported, so the owner sees how much was asked for and how much was there.
 *
 * `shortfall` stays a number because it is part of the existing notification
 * and summary payload. `shortfallExact` carries the unrounded decimal as a
 * string, so no precision is lost for callers that care.
 */
function describeShortfall({ ingredientName, unit, requested, required = requested, inStock }) {
  const requestedN = requested instanceof Decimal ? requested : new Decimal(requested == null ? 0 : requested);
  const requiredN = required instanceof Decimal ? required : new Decimal(required == null ? requestedN : required);
  const stockN = inStock instanceof Decimal ? inStock : new Decimal(inStock == null ? 0 : inStock);
  const stock = stockN.isFinite() && stockN.gt(0) ? stockN : new Decimal(0);
  const shortfall = requiredN.minus(stock);
  if (!shortfall.gt(0)) return null;
  const u = unitLabel(unit);
  const amount = (n) => (u ? `${formatAmount(n)} ${u}` : formatAmount(n));
  const name = ingredientName || 'This ingredient';
  const roundedText = requiredN.eq(requestedN) ? '' : ` (rounded to ${amount(requiredN)})`;
  const message = stock.isZero()
    ? `${name}: ${amount(requestedN)} requested${roundedText}, but no stock was available. None of this usage could be deducted; record the usage and restock.`
    : `${name}: ${amount(requestedN)} requested${roundedText}, ${amount(stock)} available; ${amount(shortfall)} could not be deducted.`;
  return {
    shortfall: shortfall.toNumber(),
    shortfallExact: shortfall.toString(),
    notes: `Requested ${amount(requestedN)}${roundedText}, only ${amount(stock)} in stock. Shortfall ${amount(shortfall)}.`,
    // Not "Low stock": that reads like the separate low/out-of-stock alert.
    title: `Stock shortfall: ${name}`,
    message,
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
  roundQuantity,
  Decimal,
};
