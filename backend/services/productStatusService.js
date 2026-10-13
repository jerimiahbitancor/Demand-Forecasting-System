// services/productStatusService.js
//
// Product status (owner's v3 flowchart, page 2, "Product Status"), checked
// in this order:
//   1. Archived      set by the owner; never changed by an upload.
//   2. Discontinued  the last sale was more than 28 OPEN days ago: count
//                    business_days confirmed_open strictly after the last
//                    sale date, up to today (Asia/Manila). Closed and
//                    unconfirmed days do not count.
//   3. New           fewer than 42 sales days (daily_sales rows with
//                    quantity_sold > 0).
//   4. Active        everything else.
//
// deriveProductStatus() is the pure rule. loadStatusInputs() reads what it
// needs for many products at once with paged reads (never one query per
// product); statusInputsFor() turns that into the rule's inputs.
//
// Changing these rules changes which products are Active, and so which are
// trained and forecast (ml-service reads products.is_active).

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { PRODUCT_STATUS_NOTES } = require('./productStatusConstants');
const { fetchAllRows } = require('../utils/fetchAllRows');

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TZ = 'Asia/Manila';
const DISCONTINUED_AFTER_OPEN_DAYS = 28; // more than this -> Discontinued
const NEW_UNTIL_SALES_DAYS = 42;         // fewer than this -> New

// Dev-only "as-of date" override for local testing against historical
// snapshots whose latest sale date has fallen behind real wall-clock
// time (e.g. a 12-month CSV dump that stops months before today) —
// without it, the open-days window below always evaluates against real
// "now". Never honored when NODE_ENV is 'production', regardless of
// what's in the environment.
function getEffectiveNow() {
  const override = process.env.DEV_NOW_OVERRIDE;
  if (override && process.env.NODE_ENV !== 'production') {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// Today's calendar date in Asia/Manila, 'YYYY-MM-DD'.
function todayManila(now = getEffectiveNow()) {
  return dayjs(now).tz(PH_TZ).format('YYYY-MM-DD');
}

// Archived is the owner's decision, never derived from sales. status =
// 'archived' is the source of truth; the "Archived: ..." reason prefix is
// only a fallback for rows written before status existed. Uploads must
// leave such a product alone (its sales rows are still saved): writing
// deriveProductStatus()'s `note` back as inactive_reason strips that
// prefix, and the next status pass then un-archived the product.
function isArchivedProduct(product) {
  if (!product) return false;
  if (product.status === 'archived') return true;
  return /^archived\b/i.test(product.inactive_reason || '');
}

/**
 * The status rule. Pure.
 *
 * @param {object} p
 * @param {boolean} p.archived                  the owner archived it
 * @param {number}  p.salesDays                 days with quantity_sold > 0
 * @param {number|null} p.openDaysSinceLastSale confirmed-open days strictly
 *                                              after the last sale, up to
 *                                              today; null = never sold
 * @param {string|null} [p.inactiveReason]      only to show the owner's
 *                                              archive reason
 * @returns {{ status: 'archived'|'inactive'|'new'|'active', label, note, isActive, isArchived }}
 *   status uses the short display names; PRODUCT_DB_STATUS_BY_DERIVED maps
 *   them to the products.status enum.
 */
function deriveProductStatus({ archived = false, salesDays = 0, openDaysSinceLastSale = null, inactiveReason = null } = {}) {
  if (archived) {
    // Strip the "Archived: " sentinel mappingService.archiveProduct()
    // writes back off before showing the reason to the owner — they
    // picked "Seasonal item", not "Archived: Seasonal item".
    const displayReason = (inactiveReason || '').replace(/^archived:?\s*/i, '').trim();
    return {
      status: 'archived',
      label: 'ARCHIVED',
      note: displayReason || inactiveReason || null,
      isActive: false,
      isArchived: true,
    };
  }

  if (openDaysSinceLastSale !== null && openDaysSinceLastSale > DISCONTINUED_AFTER_OPEN_DAYS) {
    return {
      status: 'inactive',
      label: 'INACTIVE (DISCONTINUED)',
      note: PRODUCT_STATUS_NOTES.STALE,
      isActive: false,
      isArchived: false,
    };
  }

  if ((Number(salesDays) || 0) < NEW_UNTIL_SALES_DAYS) {
    return {
      status: 'new',
      label: 'INACTIVE (NEW)',
      note: (Number(salesDays) || 0) === 0 ? PRODUCT_STATUS_NOTES.NEVER_SOLD : PRODUCT_STATUS_NOTES.NEW_PRODUCT,
      isActive: false,
      isArchived: false,
    };
  }

  return {
    status: 'active',
    label: 'ACTIVE',
    note: PRODUCT_STATUS_NOTES.ACTIVE,
    isActive: true,
    isArchived: false,
  };
}

// How many dates in `sortedOpenDates` (ascending 'YYYY-MM-DD') come strictly
// after `date`. null when there is no date (never sold).
function countOpenDaysAfter(sortedOpenDates, date) {
  if (!date) return null;
  const d = String(date).slice(0, 10);
  let lo = 0;
  let hi = sortedOpenDates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedOpenDates[mid] <= d) lo = mid + 1;
    else hi = mid;
  }
  return sortedOpenDates.length - lo;
}

const isMissingView = (error) => Boolean(error) && (
  error.code === 'PGRST205' || error.code === '42P01' || /product_sales_summary/.test(error.message || '')
);

let warnedMissingView = false;

/**
 * Everything the status rule needs, for many products at once.
 * Paged reads only (Supabase returns at most 1,000 rows per request):
 *   - product_sales_summary view: rows, first and last sale date per product
 *   - daily_sales rows with quantity_sold <= 0 (few): not sales days
 *   - business_days confirmed_open up to today
 * Only a product whose newest row is a 0-quantity row needs one extra
 * query, for its newest real sale.
 *
 * @param {object} client                 Supabase client
 * @param {object} [options]
 * @param {number[]|null} [options.productIds] null = all products
 * @param {string} [options.today]        'YYYY-MM-DD' Asia/Manila
 * @returns {Promise<{ today, openDates: string[], byProduct: Map<number, { salesDays, firstSaleDate, lastSaleDate }> }>}
 */
async function loadStatusInputs(client, { productIds = null, today = todayManila() } = {}) {
  const ids = Array.isArray(productIds) ? productIds : null;
  const byProduct = new Map();
  const empty = { today, openDates: [], byProduct };
  if (ids && ids.length === 0) return empty;

  const scoped = (query) => (ids ? query.in('product_id', ids) : query);

  const view = await fetchAllRows(() => scoped(client
    .from('product_sales_summary')
    .select('product_id, first_sale_date, last_sale_date, sale_rows'))
    .order('product_id'));

  if (view.error && !isMissingView(view.error)) throw view.error;

  if (view.error) {
    // Migration 009 not applied: fall back to reading the sales rows.
    if (!warnedMissingView) {
      warnedMissingView = true;
      console.warn('[productStatus] product_sales_summary view missing — reading daily_sales directly. Apply ml-service/migrations/009_add_product_sales_summary_view.sql.');
    }
    const scan = await fetchAllRows(() => scoped(client
      .from('daily_sales')
      .select('product_id, sale_date, quantity_sold'))
      .order('sale_date')
      .order('product_id'));
    if (scan.error) throw scan.error;
    for (const row of scan.data || []) {
      const day = String(row.sale_date).slice(0, 10);
      const entry = byProduct.get(row.product_id) || { salesDays: 0, firstSaleDate: day, lastSaleDate: null };
      if (Number(row.quantity_sold) > 0) {
        entry.salesDays += 1;
        entry.lastSaleDate = day;
      }
      byProduct.set(row.product_id, entry);
    }
  } else {
    const zeroRows = await fetchAllRows(() => scoped(client
      .from('daily_sales')
      .select('product_id, sale_date')
      .lte('quantity_sold', 0))
      .order('product_id')
      .order('sale_date'));
    if (zeroRows.error) throw zeroRows.error;
    const zeroDates = new Map();
    for (const row of zeroRows.data || []) {
      if (!zeroDates.has(row.product_id)) zeroDates.set(row.product_id, new Set());
      zeroDates.get(row.product_id).add(String(row.sale_date).slice(0, 10));
    }

    for (const row of view.data || []) {
      const zeros = zeroDates.get(row.product_id) || new Set();
      const last = row.last_sale_date ? String(row.last_sale_date).slice(0, 10) : null;
      let lastSaleDate = last;
      if (last && zeros.has(last)) {
        // Newest row sold 0 (refunds cancelled it): find the newest real sale.
        const { data, error } = await client
          .from('daily_sales')
          .select('sale_date')
          .eq('product_id', row.product_id)
          .gt('quantity_sold', 0)
          .order('sale_date', { ascending: false })
          .limit(1);
        if (error) throw error;
        lastSaleDate = data && data[0] ? String(data[0].sale_date).slice(0, 10) : null;
      }
      byProduct.set(row.product_id, {
        salesDays: Math.max(0, (Number(row.sale_rows) || 0) - zeros.size),
        firstSaleDate: row.first_sale_date ? String(row.first_sale_date).slice(0, 10) : null,
        lastSaleDate,
      });
    }
  }

  const open = await fetchAllRows(() => client
    .from('business_days')
    .select('business_date')
    .eq('status', 'confirmed_open')
    .lte('business_date', today)
    .order('business_date'));
  if (open.error) throw open.error;
  const openDates = [...new Set((open.data || []).map((r) => String(r.business_date).slice(0, 10)))].sort();

  return { today, openDates, byProduct };
}

// The rule's inputs for one product, from loadStatusInputs().
function statusInputsFor(product, loaded) {
  const entry = (loaded && loaded.byProduct.get(product.id)) || { salesDays: 0, firstSaleDate: null, lastSaleDate: null };
  return {
    archived: isArchivedProduct(product),
    salesDays: entry.salesDays,
    openDaysSinceLastSale: countOpenDaysAfter(loaded ? loaded.openDates : [], entry.lastSaleDate),
    inactiveReason: product.inactive_reason || null,
    firstSaleDate: entry.firstSaleDate,
    lastSaleDate: entry.lastSaleDate,
  };
}

function getStatusText(status) {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'inactive':
      return 'INACTIVE (DISCONTINUED)';
    case 'new':
    default:
      return 'INACTIVE (NEW)';
  }
}

module.exports = {
  deriveProductStatus,
  isArchivedProduct,
  loadStatusInputs,
  statusInputsFor,
  countOpenDaysAfter,
  todayManila,
  getStatusText,
  DISCONTINUED_AFTER_OPEN_DAYS,
  NEW_UNTIL_SALES_DAYS,
};
