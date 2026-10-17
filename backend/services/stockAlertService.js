// services/stockAlertService.js
//
// ONE stock-status rule for the Ingredient Management page, the bell's
// stock alerts and the restock email (Oct 17 2026). Before this, the page
// used forecast need (analyticsService.computeStockStatus) while the
// alerts used quantity <= min_stock, so a Critical ingredient with
// min_stock 0 never alerted.
//
//   classifyStock()   the status of one ingredient (page label included)
//   alertGroupOf()    which alert group it belongs to, if any:
//                       out       quantity 0
//                       critical  stock < 50% of the forecast need
//                       low       stock < 100% of the forecast need, or
//                                 (no forecast for it) quantity <= min_stock
//   buildRestockItems() / summarizeRestock()   the restock list (pure)
//   loadRestockList() reads everything and returns that list
//
// The need is analyticsService.getIngredientDailyNeedDetails(): the same
// number the page shows (forecast plates x recipe amount x safety buffer,
// summed over all products). To buy and est. cost follow the Grocery List
// (getIngredientDemandAnalytics): to buy = max(0, need - stock), rounded
// UP for count units (utils/recipeUnits.js toBuyQuantity),
// est. cost = to buy x latest market price.

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { supabaseAdmin } = require('../config/supabase');
const { fetchAllRows } = require('../utils/fetchAllRows');
const analyticsService = require('./analyticsService');
const { toBuyQuantity } = require('../utils/recipeUnits');

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TZ = 'Asia/Manila';
const GROUP_ORDER = ['out', 'critical', 'low'];
const GROUP_LABEL = { out: 'Out of stock', critical: 'Critical', low: 'Low' };
const MAX_USED_IN = 3;

/**
 * Status of one ingredient. The Ingredient Management page shows
 * `pageLabel` (unchanged from before: out of stock reads "Critical Stock").
 * level: 'archived' | 'out' | 'critical' | 'low' | 'normal' | 'excess' | 'no_forecast'
 */
function classifyStock({ quantity, isArchived = false, need }) {
  if (isArchived) return { level: 'archived', pageLabel: 'Archived' };
  const qty = Number(quantity) || 0;
  // Out of stock is always urgent, whether or not a forecast exists.
  if (qty === 0) return { level: 'out', pageLabel: 'Critical Stock' };
  const status = analyticsService.computeStockStatus(qty, Number(need) || 0);
  if (status === 'No Forecast') return { level: 'no_forecast', pageLabel: 'No Forecast' };
  return { level: status.toLowerCase(), pageLabel: `${status} Stock` };
}

// 'out' | 'critical' | 'low' | null. No Forecast keeps the min_stock rule.
function alertGroupOf(classification, { quantity, minStock }) {
  const { level } = classification;
  if (level === 'out' || level === 'critical' || level === 'low') return level;
  if (level === 'no_forecast') {
    const qty = Number(quantity) || 0;
    return qty <= (Number(minStock) || 0) ? 'low' : null;
  }
  return null;
}

// Stock as a % of the need, capped at 100. null when there is no need.
function coveragePct(stock, need) {
  const n = Number(need) || 0;
  if (n <= 0) return null;
  const pct = ((Number(stock) || 0) / n) * 100;
  return Math.max(0, Math.min(100, pct));
}

// Higher est. cost first; no cost last; then by name.
function compareItems(a, b) {
  const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
  if (g) return g;
  const ca = a.estCost == null ? -1 : a.estCost;
  const cb = b.estCost == null ? -1 : b.estCost;
  if (cb !== ca) return cb - ca;
  return String(a.name).localeCompare(String(b.name));
}

/**
 * The restock list. Pure.
 * @param ingredients  [{ id, name, quantity, min_stock, unit, is_archived }]
 * @param needs        Map ingredientId -> { need, byProduct: Map productId -> part }
 * @param prices       Map ingredientId -> { price }   (latest market price)
 * @param productNames Map productId -> name
 */
function buildRestockItems({ ingredients = [], needs = new Map(), prices = new Map(), productNames = new Map() }) {
  const items = [];
  for (const ing of ingredients) {
    const entry = needs.get(ing.id);
    const need = entry ? Number(entry.need) || 0 : 0;
    const stock = Number(ing.quantity) || 0;
    const minStock = Number(ing.min_stock) || 0;
    const classification = classifyStock({ quantity: stock, isArchived: ing.is_archived, need });
    const group = alertGroupOf(classification, { quantity: stock, minStock });
    if (!group) continue;

    // min_stock rule: no forecast need, so nothing to compute a "to buy" from.
    const rule = need > 0 ? 'forecast' : 'min_stock';
    const toBuy = rule === 'forecast' ? toBuyQuantity(need, stock, ing.unit) : null;
    const priceRow = prices.get(ing.id);
    const price = priceRow && priceRow.price != null && Number.isFinite(Number(priceRow.price)) ? Number(priceRow.price) : null;
    const estCost = toBuy != null && toBuy > 0 && price !== null ? toBuy * price : null;
    const usedIn = entry && entry.byProduct
      ? [...entry.byProduct.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([pid]) => productNames.get(pid))
        .filter(Boolean)
        .slice(0, MAX_USED_IN)
      : [];

    items.push({
      ingredientId: ing.id,
      name: ing.name || `Ingredient #${ing.id}`,
      unit: ing.unit || '',
      group,
      status: GROUP_LABEL[group],
      rule,
      stock,
      need: rule === 'forecast' ? need : null,
      minStock,
      toBuy,
      coveragePct: coveragePct(stock, need),
      price,
      estCost,
      usedIn,
    });
  }
  return items.sort(compareItems);
}

function summarizeRestock(items) {
  const counts = { out: 0, critical: 0, low: 0, total: items.length };
  let totalEstCost = 0;
  let unpricedCount = 0;
  for (const it of items) {
    counts[it.group] += 1;
    if (it.estCost != null) totalEstCost += it.estCost;
    if (it.price === null) unpricedCount += 1;
  }
  return { counts, totalEstCost, unpricedCount };
}

/**
 * Reads ingredients, needs, prices and product names, and returns the
 * restock list for `date` (default: today in Manila, the same date the
 * Ingredient Management page uses). Read-only.
 */
async function loadRestockList({ client = supabaseAdmin, now = new Date(), date = null } = {}) {
  const forDate = date || dayjs(now).tz(PH_TZ).format('YYYY-MM-DD');
  const [details, priceMap, ingredientsRes, productsRes] = await Promise.all([
    analyticsService.getIngredientDailyNeedDetails(forDate),
    analyticsService.getLatestMarketPriceMap(),
    fetchAllRows(() => client.from('ingredients')
      .select('id, name, quantity, min_stock, unit, is_archived')
      .eq('is_archived', false)
      .order('id')),
    fetchAllRows(() => client.from('products').select('id, name').order('id')),
  ]);
  if (ingredientsRes.error) throw ingredientsRes.error;
  if (productsRes.error) throw productsRes.error;

  const productNames = new Map((productsRes.data || []).map((p) => [p.id, p.name]));
  const items = buildRestockItems({
    ingredients: ingredientsRes.data || [],
    needs: details.entries,
    prices: priceMap,
    productNames,
  });
  return {
    forDate,
    safetyBufferPct: details.safetyBufferPct,
    stockAt: new Date(now).toISOString(),
    items,
    ...summarizeRestock(items),
  };
}

module.exports = {
  classifyStock,
  alertGroupOf,
  coveragePct,
  buildRestockItems,
  summarizeRestock,
  loadRestockList,
  GROUP_ORDER,
  GROUP_LABEL,
};
