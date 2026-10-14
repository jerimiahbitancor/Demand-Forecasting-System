// utils/uploadSummary.js
//
// The upload summary (owner's v3 flowchart, page 2, "Output (upload
// summary)"), built for ONE sales file from what processSalesData() already
// has in memory. Pure: no I/O.
//
//   modifierProducts    products sold with a modifier, plates per keyword
//   sizeProducts        products whose name has Small / Medium / Large
//                       (information only, until the size work is built)
//   newProducts         products this file created
//   unmatchedNames      item names that matched no product (plates not counted)
//   aliasMatches        names matched through an alias ("OG Tapsilog" -> "Original Tapsilog")
//   possibleDuplicates  a new product whose name looks like an existing one
//   shortfalls          ingredients that ran out (stock floored at 0)

'use strict';

const { productNameKey } = require('./productNameKey');
const { findPossibleDuplicates } = require('./productDuplicates');

const SIZE_WORD = /\b(small|medium|large)\b/i;

function emptyUploadSummary() {
  return {
    modifierProducts: [],
    sizeProducts: [],
    newProducts: [],
    unmatchedNames: [],
    aliasMatches: [],
    possibleDuplicates: [],
    shortfalls: [],
  };
}

/**
 * @param {object} p
 * @param {Array<{id, name, status?, inactive_reason?}>} p.products   every product (after this file's sync)
 * @param {Array<{product_id}>} p.dailySalesRows                     what this file saved
 * @param {Array<{product_id, keyword, quantity}>} p.modifierRows      this file's modifier plates
 * @param {string[]} p.baseNames        the file's item names, modifiers removed
 * @param {Map<string, number>} p.aliasProductIds   alias_key -> product_id
 * @param {string[]} p.newProductNames  names this file created
 * @param {string[]} p.unmatchedNames
 * @param {Array<{ingredientId, name, shortfall, message}>} p.shortfalls
 * @param {string[]} p.modifierKeywords
 * @param {(p) => boolean} p.isArchived
 */
function buildUploadSummary({
  products = [], dailySalesRows = [], modifierRows = [], baseNames = [], aliasProductIds = new Map(),
  newProductNames = [], unmatchedNames = [], shortfalls = [], modifierKeywords = [], isArchived = () => false,
} = {}) {
  const summary = emptyUploadSummary();
  const byId = new Map(products.map((p) => [p.id, p]));
  const realNameKeys = new Set(products.map((p) => productNameKey(p.name)));
  const nameOf = (id) => (byId.get(id) ? byId.get(id).name : `product #${id}`);

  // Modifiers: plates per keyword, per product.
  const modifierByProduct = new Map();
  for (const row of modifierRows) {
    if (!modifierByProduct.has(row.product_id)) modifierByProduct.set(row.product_id, {});
    const plates = modifierByProduct.get(row.product_id);
    plates[row.keyword] = (plates[row.keyword] || 0) + (Number(row.quantity) || 0);
  }
  summary.modifierProducts = [...modifierByProduct]
    .map(([productId, plates]) => ({ productId, name: nameOf(productId), plates }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Size words, among the products this file sold.
  const soldIds = [...new Set(dailySalesRows.map((r) => r.product_id))];
  summary.sizeProducts = soldIds
    .filter((id) => SIZE_WORD.test(nameOf(id)))
    .map((id) => ({ productId: id, name: nameOf(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // New products, with their id when found.
  const idByKey = new Map(products.map((p) => [productNameKey(p.name), p.id]));
  summary.newProducts = [...new Set(newProductNames)]
    .map((name) => ({ productId: idByKey.get(productNameKey(name)) || null, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  summary.unmatchedNames = [...new Set(unmatchedNames)].sort();

  // Alias matches: a name that is NOT a product name but is an alias.
  const seenAlias = new Set();
  for (const name of baseNames) {
    const key = productNameKey(name);
    if (realNameKeys.has(key) || !aliasProductIds.has(key) || seenAlias.has(key)) continue;
    seenAlias.add(key);
    const productId = aliasProductIds.get(key);
    summary.aliasMatches.push({ alias: name, productId, productName: nameOf(productId) });
  }

  // Possible duplicates, only for the products this file created.
  const newIds = new Set(summary.newProducts.map((p) => p.productId).filter(Boolean));
  if (newIds.size > 0) {
    const live = products.map((p) => ({ id: p.id, name: p.name, archived: isArchived(p) }));
    for (const pair of findPossibleDuplicates(live, { modifierKeywords })) {
      const aNew = newIds.has(pair.a.id);
      const bNew = newIds.has(pair.b.id);
      if (!aNew && !bNew) continue;
      const [fresh, other] = aNew ? [pair.a, pair.b] : [pair.b, pair.a];
      summary.possibleDuplicates.push({ newProduct: fresh, looksLike: other, reason: pair.reason });
    }
  }

  summary.shortfalls = shortfalls.map((s) => ({
    ingredientId: s.ingredientId,
    ingredient: s.name || `ingredient #${s.ingredientId}`,
    shortfall: s.shortfall,
    message: s.message,
  }));

  return summary;
}

module.exports = { buildUploadSummary, emptyUploadSummary };
