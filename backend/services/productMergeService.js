// services/productMergeService.js
//
// Merge duplicate products (owner's v3 flowchart, page 4 "Merge Products").
// The merge itself is ONE database function, public.merge_products (backend/
// migrations/011_product_aliases_and_merge.sql), so it is all or nothing.
// This file only:
//   - previews a merge (counts, read-only),
//   - calls the function, then recomputes every product's status,
//   - lists modifier keywords and "possible duplicate" suggestions.

const { fetchAllRows } = require('../utils/fetchAllRows');
const { findPossibleDuplicates } = require('../utils/productDuplicates');
const { isArchivedProduct } = require('./productStatusService');

class MergeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'MergeError';
    this.status = status;
  }
}

const normalizeKeyword = (k) => String(k || '').trim().replace(/\s+/g, ' ').toUpperCase();
const isMergedAway = (product) => /^archived: merged into/i.test(product.inactive_reason || '');

async function loadProduct(client, id) {
  const { data, error } = await client
    .from('products')
    .select('id, name, status, inactive_reason')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Uppercased modifier_rules keywords. Empty if the table does not exist yet.
async function listModifierKeywords(client) {
  const { data, error } = await fetchAllRows(() => client
    .from('modifier_rules')
    .select('keyword')
    .order('keyword'));
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return [];
    throw error;
  }
  return [...new Set((data || []).map((r) => normalizeKeyword(r.keyword)).filter(Boolean))];
}

async function checkPair(client, sourceId, targetId, modifierKeyword) {
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId <= 0 || targetId <= 0) {
    throw new MergeError('Choose two products to merge.');
  }
  if (sourceId === targetId) throw new MergeError('A product cannot be merged into itself.');
  const [source, target] = await Promise.all([loadProduct(client, sourceId), loadProduct(client, targetId)]);
  if (!source) throw new MergeError(`Product ${sourceId} was not found.`, 404);
  if (!target) throw new MergeError(`Product ${targetId} was not found.`, 404);
  if (isMergedAway(source)) throw new MergeError(`"${source.name}" was already merged.`, 409);
  if (isArchivedProduct(target)) throw new MergeError(`"${target.name}" is archived. Choose another product to merge into.`, 409);

  let keyword = null;
  if (modifierKeyword !== undefined && modifierKeyword !== null && String(modifierKeyword).trim() !== '') {
    keyword = normalizeKeyword(modifierKeyword);
    const keywords = await listModifierKeywords(client);
    if (!keywords.includes(keyword)) {
      throw new MergeError(`"${keyword}" is not a modifier yet. Add it to the modifier rules first.`);
    }
  }
  return { source, target, keyword };
}

const dayOf = (v) => String(v).slice(0, 10);

/**
 * Read-only counts for merging `sourceId` into `targetId` — the same numbers
 * merge_products() reports, worked out without changing anything.
 */
async function getMergePreview(client, { sourceId, targetId, modifierKeyword = null }) {
  const { source, target, keyword } = await checkPair(client, sourceId, targetId, modifierKeyword);

  const [sourceSales, targetSales, sourceModifiers, sourceRecipe, targetRecipe, forecasts, classifications] = await Promise.all([
    fetchAllRows(() => client.from('daily_sales').select('sale_date, quantity_sold').eq('product_id', sourceId).order('sale_date')),
    fetchAllRows(() => client.from('daily_sales').select('sale_date').eq('product_id', targetId).order('sale_date')),
    client.from('daily_sales_modifiers').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    client.from('product_ingredients').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    client.from('product_ingredients').select('id', { count: 'exact', head: true }).eq('product_id', targetId),
    client.from('forecasts').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    client.from('product_classifications').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
  ]);
  for (const r of [sourceSales, targetSales, sourceRecipe, targetRecipe, forecasts, classifications]) {
    if (r.error) throw r.error;
  }
  // daily_sales_modifiers may not exist before migration 010.
  const modifierRows = sourceModifiers.error ? 0 : (sourceModifiers.count || 0);

  const targetDays = new Set((targetSales.data || []).map((r) => dayOf(r.sale_date)));
  const rows = sourceSales.data || [];
  const daysMoved = rows.length;
  const daysAddedTogether = rows.filter((r) => targetDays.has(dayOf(r.sale_date))).length;
  const platesMoved = rows.reduce((sum, r) => sum + (Number(r.quantity_sold) || 0), 0);
  const recipe = (targetRecipe.count || 0) > 0 ? 'kept_target' : ((sourceRecipe.count || 0) > 0 ? 'moved_source' : 'none');

  const recipeText = {
    kept_target: `"${target.name}" keeps its own recipe; the recipe of "${source.name}" is removed.`,
    moved_source: `"${target.name}" has no recipe, so it gets the recipe of "${source.name}".`,
    none: 'Neither product has a recipe.',
  }[recipe];

  const lines = [
    `Merge "${source.name}" into "${target.name}".`,
    `${daysMoved} day(s) of sales (${platesMoved} plates) move to "${target.name}". `
      + `${daysAddedTogether} of those days already have sales for "${target.name}"; they are added together.`,
    keyword ? `The moved plates are also counted as "${keyword}" for "${target.name}".` : null,
    modifierRows ? `${modifierRows} modifier record(s) move too.` : null,
    recipeText,
    `Forecasts for "${source.name}" are removed; the next forecast run rebuilds them for "${target.name}".`,
    `"${source.name}" is archived as "${source.name} (merged)". Future sales files that say "${source.name}" will count for "${target.name}".`,
    'This cannot be undone from the app.',
  ].filter(Boolean);

  return {
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    modifierKeyword: keyword,
    daysMoved,
    daysAddedTogether,
    platesMoved,
    modifierRowsMoved: modifierRows,
    recipe,
    forecastsDeleted: forecasts.count || 0,
    classificationsDeleted: classifications.count || 0,
    text: lines.join(' '),
    lines,
  };
}

/**
 * Runs public.merge_products (one transaction), then recomputes every
 * product's status. `afterMerge` is that recompute (injected for tests).
 */
async function mergeProducts(client, { sourceId, targetId, modifierKeyword = null, actor = null }, { afterMerge = null } = {}) {
  const { keyword } = await checkPair(client, sourceId, targetId, modifierKeyword);
  const { data, error } = await client.rpc('merge_products', {
    p_source: sourceId,
    p_target: targetId,
    p_modifier_keyword: keyword,
    p_actor: actor,
  });
  if (error) {
    const message = error.message || '';
    const functionMissing = error.code === 'PGRST202'
      || (/merge_products/.test(message) && /could not find|does not exist/i.test(message));
    if (functionMissing) {
      throw new MergeError('Merging is not set up yet: run backend/migrations/011_product_aliases_and_merge.sql first.', 503);
    }
    // The function raises with a plain message on a failed check.
    throw new MergeError(String(error.message || 'The merge failed. Nothing was changed.').replace(/^merge_products:\s*/, ''), 400);
  }
  let statusRefresh = null;
  if (afterMerge) {
    try {
      statusRefresh = await afterMerge();
    } catch (refreshError) {
      // The merge is committed; a failed status pass only means the next
      // upload fixes the statuses.
      console.error('Products merged, but the status recompute failed:', refreshError);
    }
  }
  return { result: data, statusRefresh };
}

// Suggestions for Product Management. Non-archived products only.
async function getPossibleDuplicates(client) {
  const [{ data: products, error }, keywords] = await Promise.all([
    fetchAllRows(() => client.from('products').select('id, name, status, inactive_reason').order('id')),
    listModifierKeywords(client),
  ]);
  if (error) throw error;
  const live = (products || []).map((p) => ({ ...p, archived: isArchivedProduct(p) }));
  return findPossibleDuplicates(live, { modifierKeywords: keywords });
}

module.exports = {
  getMergePreview,
  mergeProducts,
  listModifierKeywords,
  getPossibleDuplicates,
  MergeError,
};
