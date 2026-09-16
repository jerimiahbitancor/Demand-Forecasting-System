// services/productCategoryService.js
const { supabaseAdmin } = require('../config/supabase');

// Ensure a product category exists in the product_categories table so that
// categories discovered from uploaded sales/menu data are visible in
// Settings → Forecast Config → Category → Product Management.
// Non-fatal: on any failure it logs and returns null so upload flows continue.
async function ensureProductCategory(name) {
  const categoryName = typeof name === 'string' ? name.trim() : '';
  if (!categoryName || categoryName.toLowerCase() === 'uncategorized') {
    return null;
  }

  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    return null;
  }

  try {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('product_categories')
      .select('id, name')
      .ilike('name', categoryName)
      .order('name')
      .limit(1);

    if (lookupError) {
      console.error('Error looking up product category:', lookupError);
      return null;
    }

    if (existing && existing.length > 0) {
      return existing[0];
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('product_categories')
      .insert([{ name: categoryName }])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505' || /duplicate|already exists/i.test(insertError.message || '')) {
        const { data: raced } = await supabaseAdmin
          .from('product_categories')
          .select('id, name')
          .ilike('name', categoryName)
          .limit(1);
        return raced?.[0] || null;
      }
      console.error('Error inserting product category:', insertError);
      return null;
    }

    return inserted;
  } catch (error) {
    console.error('Error registering product category:', error);
    return null;
  }
}

// Register a list of categories at once (deduplicated, case-insensitive).
async function ensureProductCategories(categories = []) {
  const unique = [];
  const seen = new Set();
  for (const raw of categories) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    const key = name.toLowerCase();
    if (!name || name.toLowerCase() === 'uncategorized' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(name);
  }
  const registered = [];
  for (const name of unique) {
    const result = await ensureProductCategory(name);
    if (result) {
      registered.push(result);
    }
  }
  return registered;
}

// Backfill: register every distinct non-"Uncategorized" category already
// present on products so the settings config reflects existing data even if
// it predates auto-registration. Idempotent and non-fatal.
async function syncProductCategoriesFromProducts() {
  try {
    if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
      return [];
    }
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('category');
    if (error) {
      console.error('Error fetching product categories for sync:', error);
      return [];
    }
    const categories = (data || [])
      .map((row) => row.category)
      .filter((c) => typeof c === 'string' && c.trim() && c.trim().toLowerCase() !== 'uncategorized');
    if (categories.length === 0) {
      return [];
    }
    return await ensureProductCategories(categories);
  } catch (error) {
    console.error('Error syncing product categories from products:', error);
    return [];
  }
}

module.exports = { ensureProductCategory, ensureProductCategories, syncProductCategoriesFromProducts };