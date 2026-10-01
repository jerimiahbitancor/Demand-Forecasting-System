// "When did each product first and last sell?" -- in one place.
//
// Five places need this (mappingService x3, analyticsService, uploadService)
// and they used to answer it by downloading EVERY daily_sales row and
// walking it in JavaScript. That was ~16 requests per call at today's size,
// growing forever, and it runs after every sales upload -- across a 288-file
// backfill with 5 uploads in flight it exhausted the connection pool
// ("TypeError: fetch failed" / HTTP 500).
//
// Now the database does the grouping. The view product_sales_summary
// (ml-service/migrations/009_add_product_sales_summary_view.sql) returns one
// row per product, so this is ~2 requests regardless of how many sales rows
// exist.
//
// FALLBACK: if the view has not been created yet (PGRST205 / 42P01), this
// falls back to the old paged scan and logs ONE warning. That is deliberate:
// the code can be deployed before the SQL is run without breaking uploads --
// they just stay slow until the migration is applied. Any OTHER error is
// thrown, never swallowed, because a silent fallback on a real failure would
// hide it.
//
// Returns Map<product_id, { firstSaleDate, lastSaleDate }> with
// 'YYYY-MM-DD' strings, exactly the two values every caller was already
// deriving from the full row list. A product with no sales is simply absent.

const { fetchAllRows } = require('./fetchAllRows');

let warnedAboutFallback = false;

function isMissingViewError(error) {
  if (!error) return false;
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || /product_sales_summary/.test(error.message || '');
}

async function fromView(client, productIds) {
  return fetchAllRows(() => {
    let query = client
      .from('product_sales_summary')
      .select('product_id, first_sale_date, last_sale_date');
    if (productIds && productIds.length) query = query.in('product_id', productIds);
    return query.order('product_id');
  });
}

// The slow path the view replaces. Kept only as the not-yet-migrated
// fallback; remove it once 009 has been applied everywhere.
async function fromFullScan(client, productIds) {
  const { data, error } = await fetchAllRows(() => {
    let query = client.from('daily_sales').select('product_id, sale_date');
    if (productIds && productIds.length) query = query.in('product_id', productIds);
    return query.order('sale_date', { ascending: true }).order('product_id');
  });
  if (error) return { data: null, error };

  // Oldest-first, so the first row seen per product is its first sale and
  // the last row seen is its most recent.
  const byProduct = new Map();
  for (const row of data || []) {
    const entry = byProduct.get(row.product_id);
    if (entry) entry.last_sale_date = row.sale_date;
    else byProduct.set(row.product_id, {
      product_id: row.product_id, first_sale_date: row.sale_date, last_sale_date: row.sale_date,
    });
  }
  return { data: [...byProduct.values()], error: null };
}

/**
 * @param {number[]|null} productIds  limit to these products, or null for all
 * @param {object} [client]           a Supabase client; defaults to supabaseAdmin
 * @returns {Promise<{ data: Map<number, {firstSaleDate: string, lastSaleDate: string}>|null, error: object|null }>}
 *   Same { data, error } shape as a normal Supabase call, so call sites keep
 *   their existing "if (error) throw error" handling.
 */
async function getProductSalesSummary(productIds = null, client = null) {
  // null = "all products"; an EMPTY list = "none". Without this guard an
  // empty list would skip the .in() filter and return every product, the
  // opposite of what the old .in('product_id', []) did.
  if (Array.isArray(productIds) && productIds.length === 0) {
    return { data: new Map(), error: null };
  }

  const db = client || require('../config/supabase').supabaseAdmin;

  let result = await fromView(db, productIds);
  if (result.error && isMissingViewError(result.error)) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(
        'product_sales_summary view not found -- falling back to a full daily_sales scan, '
        + 'which is slow during bulk uploads. Run ml-service/migrations/009_add_product_sales_summary_view.sql.'
      );
    }
    result = await fromFullScan(db, productIds);
  }
  if (result.error) return { data: null, error: result.error };

  const summary = new Map();
  for (const row of result.data || []) {
    summary.set(row.product_id, {
      firstSaleDate: row.first_sale_date,
      lastSaleDate: row.last_sale_date,
    });
  }
  return { data: summary, error: null };
}

// Test hook: lets a test reset the "warn once" latch.
function _resetFallbackWarning() { warnedAboutFallback = false; }

module.exports = { getProductSalesSummary, _resetFallbackWarning };
