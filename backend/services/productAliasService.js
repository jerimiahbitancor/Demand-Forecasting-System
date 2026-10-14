// services/productAliasService.js
//
// product_aliases: other names a product is known by (its names before a
// merge or a rename). Sales uploads match a Loyverse item name against
// product names first, then aliases. Table: migration
// backend/migrations/011_product_aliases_and_merge.sql.
//
// Safe before that migration runs: a missing table reads as "no aliases"
// (one warning) and alias writes are skipped, so uploads and renames keep
// working exactly as before.

const { fetchAllRows } = require('../utils/fetchAllRows');
const { productNameKey } = require('../utils/productNameKey');

let warnedMissing = false;

function isMissingAliasTable(error) {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || /product_aliases/.test(error.message || '');
}

function warnMissingOnce() {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn('[productAliases] product_aliases table not found — aliases are off until backend/migrations/011_product_aliases_and_merge.sql is run.');
}

// Map<alias_key, product_id>. Empty when the table does not exist yet.
async function loadAliasMap(client) {
  const { data, error } = await fetchAllRows(() => client
    .from('product_aliases')
    .select('alias_key, product_id')
    .order('id'));
  if (error) {
    if (isMissingAliasTable(error)) {
      warnMissingOnce();
      return new Map();
    }
    throw error;
  }
  return new Map((data || []).map((row) => [row.alias_key, row.product_id]));
}

/**
 * Records `name` as an alias of `productId` (insert, or re-point an existing
 * alias with the same key). Returns { saved, skipped } — skipped when the
 * table does not exist yet or the name is empty.
 */
async function addAlias(client, name, productId) {
  const key = productNameKey(name);
  if (!key || !productId) return { saved: false, skipped: 'empty' };
  const { error } = await client
    .from('product_aliases')
    .upsert({ alias_name: String(name).trim(), alias_key: key, product_id: productId }, { onConflict: 'alias_key' });
  if (error) {
    if (isMissingAliasTable(error)) {
      warnMissingOnce();
      return { saved: false, skipped: 'no_table' };
    }
    throw error;
  }
  return { saved: true, skipped: null };
}

module.exports = { loadAliasMap, addAlias, isMissingAliasTable };
