// utils/productNameKey.js
//
// The one rule for comparing product names: trim, collapse inner whitespace
// to one space, lower-case. Must stay identical to public.product_name_key()
// in backend/migrations/011_product_aliases_and_merge.sql, because
// product_aliases.alias_key is stored with that SQL function and looked up
// with this one.

function productNameKey(name) {
  return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}

module.exports = { productNameKey };
