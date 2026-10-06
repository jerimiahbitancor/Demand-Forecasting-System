// services/dataCoverageService.js
//
// Lets the dashboard skip re-reading every daily_sales.sale_date row on
// each check. A "fingerprint" made of 5 cheap queries changes whenever the
// uploaded sales or the business-day marks change; the expensive result is
// recomputed only when it does.
//
// What the fingerprint covers, and why that is enough:
//   - uploads row count + newest upload_date: every new upload adds a row
//     with the current time; deleting one lowers the count.
//   - daily_sales row count: rows come and go with their upload.
//   - business_days row count + newest confirmed_at: every write in
//     businessDayService (open after upload, bulk close) sets
//     confirmed_at to now; deletes lower the count.
// A 10-minute maximum age is a second safety net on top.
//
// IMPORTANT: the cache is in-memory, per process. That is valid because
// Railway runs this API as 1 replica. With 2+ replicas each instance would
// hold its own copy (still correct, since each checks the fingerprint, but
// each pays for its own first computation).
//
// Callers must read the fingerprint BEFORE computing. If data changes
// in between, the cached value is newer than its fingerprint and simply
// gets recomputed on the next check. The other order could store old
// numbers under a new fingerprint.

const { fetchAllRows } = require('../utils/fetchAllRows');
const { evaluateHistoryGate } = require('../utils/historyGate');

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

const cache = new Map(); // key -> { fingerprint, value, storedAt }
const inFlight = new Map(); // key -> { fingerprint, promise }

function unwrap({ data, count, error }, pick) {
  if (error) throw error;
  return pick({ data, count });
}

async function getFingerprint(client) {
  const [uploadCount, newestUpload, salesCount, dayCount, newestConfirm] = await Promise.all([
    client.from('uploads').select('id', { count: 'exact', head: true })
      .then((r) => unwrap(r, ({ count }) => count ?? 0)),
    client.from('uploads').select('upload_date').order('upload_date', { ascending: false }).limit(1)
      .then((r) => unwrap(r, ({ data }) => data?.[0]?.upload_date ?? '')),
    client.from('daily_sales').select('id', { count: 'exact', head: true })
      .then((r) => unwrap(r, ({ count }) => count ?? 0)),
    client.from('business_days').select('id', { count: 'exact', head: true })
      .then((r) => unwrap(r, ({ count }) => count ?? 0)),
    client.from('business_days').select('confirmed_at').order('confirmed_at', { ascending: false, nullsFirst: false }).limit(1)
      .then((r) => unwrap(r, ({ data }) => data?.[0]?.confirmed_at ?? '')),
  ]);
  return [uploadCount, newestUpload, salesCount, dayCount, newestConfirm].join('|');
}

async function cachedByFingerprint(key, fingerprint, computeFn, { maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now } = {}) {
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fingerprint && now() - hit.storedAt < maxAgeMs) {
    return hit.value;
  }

  // Two checks at the same moment share one computation.
  const running = inFlight.get(key);
  if (running && running.fingerprint === fingerprint) return running.promise;

  const promise = (async () => {
    const value = await computeFn();
    cache.set(key, { fingerprint, value, storedAt: now() });
    return value;
  })();
  inFlight.set(key, { fingerprint, promise });
  try {
    return await promise;
  } finally {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  }
}

function clearCache() {
  cache.clear();
  inFlight.clear();
}

// ---------------------------------------------------------------------------
// "Which dates have sales?" from the daily_sales_date_summary view
// (backend/sql/2026-10-06_daily_sales_date_summary.sql): one row per sale
// date, ~450 rows in 1 page, instead of paging all ~17,800 daily_sales rows.
//
// FALLBACK (same pattern as utils/productSalesSummary.js): if the view does
// not exist yet (PGRST205 / 42P01), use the old paged scan and warn ONCE, so
// the code can ship before the SQL is run. Any OTHER error is thrown.
// ---------------------------------------------------------------------------

let warnedAboutFallback = false;

// Codes only: PostgREST's "table not in schema cache" and Postgres's
// "relation does not exist". Matching the view NAME in the message would
// also catch "permission denied for view ...", which must fail loudly.
function isMissingViewError(error) {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01';
}

async function summaryFromView(client) {
  return fetchAllRows(() => client
    .from('daily_sales_date_summary')
    .select('sale_date, sale_rows')
    .order('sale_date'));
}

// The slow path the view replaces. Remove once the SQL is applied everywhere.
async function summaryFromFullScan(client) {
  const { data, error } = await fetchAllRows(() => client
    .from('daily_sales')
    .select('sale_date')
    .order('sale_date')
    .order('product_id'));
  if (error) return { data: null, error };
  const counts = new Map();
  for (const row of data || []) {
    if (row.sale_date) counts.set(row.sale_date, (counts.get(row.sale_date) || 0) + 1);
  }
  return {
    data: [...counts.entries()].map(([sale_date, sale_rows]) => ({ sale_date, sale_rows })),
    error: null,
  };
}

// Returns { rows: [{ sale_date, sale_rows }] sorted by date, source }.
// source is 'view' or 'scan'. Throws on a real error.
async function getSaleDateSummary(client) {
  let source = 'view';
  let result = await summaryFromView(client);
  if (result.error && isMissingViewError(result.error)) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(
        'daily_sales_date_summary view not found -- falling back to a full daily_sales scan, '
        + 'so the dashboard is slow after a cache refill. Run backend/sql/2026-10-06_daily_sales_date_summary.sql.'
      );
    }
    source = 'scan';
    result = await summaryFromFullScan(client);
  }
  if (result.error) throw result.error;
  const rows = [...(result.data || [])]
    .filter((r) => r.sale_date)
    .sort((a, b) => (a.sale_date < b.sale_date ? -1 : a.sale_date > b.sale_date ? 1 : 0));
  return { rows, source };
}

// Same, but shared within a dashboard check (and across checks) by the data
// fingerprint, so the stats and the history rule read it once.
function getSaleDateSummaryCached(client, fingerprint) {
  if (!fingerprint) return getSaleDateSummary(client);
  return cachedByFingerprint('saleDateSummary', fingerprint, () => getSaleDateSummary(client));
}

// For uploadService.getUploadStats: distinct sale days + earliest sale date,
// counted over daily_sales rows whose upload_id is in `uploadIds`.
//
// The view counts ALL daily_sales rows. That is only the same answer when
// every row belongs to one of these uploads, so this checks it first with
// two head counts (all rows vs this user's rows). Equal -> the view's date
// set is exactly the filtered date set. Not equal (another user's uploads,
// or rows with no upload_id) -> returns null and the caller runs its old
// filtered scan.
async function getUserSaleCoverageFromSummary(client, uploadIds, fingerprint) {
  const [all, mine] = await Promise.all([
    client.from('daily_sales').select('id', { count: 'exact', head: true }),
    client.from('daily_sales').select('id', { count: 'exact', head: true }).in('upload_id', uploadIds),
  ]);
  if (all.error) throw all.error;
  if (mine.error) throw mine.error;
  if ((all.count ?? -1) !== (mine.count ?? -2)) return null;

  const { rows } = await getSaleDateSummaryCached(client, fingerprint);
  return {
    distinctSaleDays: rows.length,
    earliestSaleDate: rows.length > 0 ? rows[0].sale_date : null,
  };
}

// For the dashboard's 12-month history rule. Same result as
// businessDayService.getHistoryCoverage() (which stays as it is: /gaps and
// bulk-close use it to validate writes), but the sale dates come from the
// view. Both read ALL daily_sales rows, with no user filter.
async function getHistoryCoverageFromSummary(client, fingerprint) {
  const [summary, closed] = await Promise.all([
    getSaleDateSummaryCached(client, fingerprint),
    fetchAllRows(() => client
      .from('business_days')
      .select('business_date')
      .eq('status', 'confirmed_closed')
      .order('business_date')),
  ]);
  if (closed.error) throw closed.error;

  const saleDates = [...new Set(summary.rows.map((r) => r.sale_date).filter(Boolean))].sort();
  const closedDates = [...new Set((closed.data || []).map((r) => r.business_date).filter(Boolean))].sort();
  return { saleDates, closedDates, gate: evaluateHistoryGate({ saleDates, closedDates }) };
}

// Test hook: lets a test reset the "warn once" latch.
function _resetFallbackWarning() { warnedAboutFallback = false; }

module.exports = {
  getFingerprint,
  cachedByFingerprint,
  clearCache,
  getSaleDateSummary,
  getSaleDateSummaryCached,
  getUserSaleCoverageFromSummary,
  getHistoryCoverageFromSummary,
  _resetFallbackWarning,
  DEFAULT_MAX_AGE_MS,
};
