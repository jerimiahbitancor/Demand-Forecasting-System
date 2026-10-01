// Tests utils/productSalesSummary.js against a FAKE Supabase client that
// enforces the 1,000-row cap and counts requests.
//
// What this protects: the helper replaced a read of the whole daily_sales
// table (16+ requests per call) that ran after every upload and exhausted
// the connection pool during a bulk backfill. The tests prove (1) it now
// takes a couple of requests no matter how big daily_sales is, (2) the
// not-yet-migrated fallback returns the SAME answer as the view, (3) it
// only falls back when the view is genuinely missing, never on a real error.
//
// Run:  cd backend && node tests/productSalesSummary.test.js
// No network, no Supabase, no credentials.

const { getProductSalesSummary, _resetFallbackWarning } = require('../utils/productSalesSummary');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

const MAX_ROWS = 1000;

// A fake dataset: 40 products x 100 days = 4,000 daily_sales rows, so a
// whole-table scan needs 5 requests while the view needs 1-2.
function buildSales() {
  const rows = [];
  for (let product = 1; product <= 40; product += 1) {
    for (let day = 0; day < 100; day += 1) {
      // Product p first sells on day (p % 7), so first dates differ.
      if (day < product % 7) continue;
      const d = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      rows.push({ product_id: product, sale_date: d });
    }
  }
  return rows;
}

function expectedSummary(rows, ids) {
  const out = new Map();
  for (const r of rows) {
    if (ids && !ids.includes(r.product_id)) continue;
    const e = out.get(r.product_id);
    if (!e) out.set(r.product_id, { firstSaleDate: r.sale_date, lastSaleDate: r.sale_date });
    else {
      if (r.sale_date < e.firstSaleDate) e.firstSaleDate = r.sale_date;
      if (r.sale_date > e.lastSaleDate) e.lastSaleDate = r.sale_date;
    }
  }
  return out;
}

// Fake client. `mode`: 'view' (the view exists), 'noview' (PGRST205),
// 'broken' (view exists but the request fails for another reason).
function makeClient(salesRows, mode) {
  const state = { requests: 0, tables: [] };

  const viewRows = [...expectedSummary(salesRows, null)].map(([product_id, s]) => ({
    product_id, first_sale_date: s.firstSaleDate, last_sale_date: s.lastSaleDate,
  })).sort((a, b) => a.product_id - b.product_id);

  function query(table) {
    const q = { _ids: null, _sorts: [] };
    q.select = () => q;
    q.in = (col, ids) => { q._ids = ids; return q; };
    q.order = (col, opts = {}) => { q._sorts.push([col, opts.ascending !== false]); return q; };
    q.range = (start, end) => {
      state.requests += 1;
      state.tables.push(table);
      if (table === 'product_sales_summary') {
        if (mode === 'noview') {
          return Promise.resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.product_sales_summary' in the schema cache" } });
        }
        if (mode === 'broken') {
          return Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
        }
        let rows = viewRows;
        if (q._ids) rows = rows.filter((r) => q._ids.includes(r.product_id));
        return Promise.resolve({ data: rows.slice(start, end + 1).slice(0, MAX_ROWS), error: null });
      }
      let rows = salesRows;
      if (q._ids) rows = rows.filter((r) => q._ids.includes(r.product_id));
      rows = [...rows].sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.product_id - b.product_id);
      return Promise.resolve({ data: rows.slice(start, end + 1).slice(0, MAX_ROWS), error: null });
    };
    return q;
  }
  return { from: query, state };
}

(async () => {
  console.log('productSalesSummary.test.js');
  const sales = buildSales();
  console.log(`  (fake daily_sales: ${sales.length} rows, 40 products)`);

  const sameMaps = (a, b) => a.size === b.size && [...a].every(([k, v]) => {
    const w = b.get(k); return w && w.firstSaleDate === v.firstSaleDate && w.lastSaleDate === v.lastSaleDate;
  });

  // --- 1. With the view: correct answer, very few requests ---
  _resetFallbackWarning();
  let client = makeClient(sales, 'view');
  let { data, error } = await getProductSalesSummary(null, client);
  check('view path returns no error', error === null);
  check('view path gives the right first/last date for every product', sameMaps(data, expectedSummary(sales, null)));
  check('view path takes <= 2 requests for 40 products', client.state.requests <= 2, `got ${client.state.requests}`);
  check('view path never touches daily_sales', !client.state.tables.includes('daily_sales'));

  // --- 2. Subset of products ---
  client = makeClient(sales, 'view');
  ({ data } = await getProductSalesSummary([3, 4, 5], client));
  check('a subset returns only those products', data.size === 3 && [3, 4, 5].every((id) => data.has(id)), `size ${data.size}`);
  check('subset values are correct', sameMaps(data, expectedSummary(sales, [3, 4, 5])));

  // --- 3. Empty list means NONE, not everything ---
  client = makeClient(sales, 'view');
  ({ data } = await getProductSalesSummary([], client));
  check('an empty product list returns an empty Map (not all products)', data.size === 0, `size ${data.size}`);
  check('an empty list makes zero requests', client.state.requests === 0, `got ${client.state.requests}`);

  // --- 4. View missing: falls back, SAME answer, one warning ---
  _resetFallbackWarning();
  const warnings = [];
  const realWarn = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  client = makeClient(sales, 'noview');
  ({ data, error } = await getProductSalesSummary(null, client));
  check('missing view: no error surfaced', error === null);
  check('missing view: fallback gives the SAME answer as the view would', sameMaps(data, expectedSummary(sales, null)));
  check('missing view: fallback really scanned daily_sales', client.state.tables.includes('daily_sales'));
  await getProductSalesSummary(null, makeClient(sales, 'noview'));
  console.warn = realWarn;
  check('the fallback warns exactly ONCE across repeated calls', warnings.length === 1, `got ${warnings.length}`);
  check('the warning tells you which migration to run', /009_add_product_sales_summary_view/.test(warnings[0] || ''));

  // --- 5. A real error must NOT trigger the fallback ---
  _resetFallbackWarning();
  client = makeClient(sales, 'broken');
  ({ data, error } = await getProductSalesSummary(null, client));
  check('a real database error is returned, not swallowed', error !== null && error.code === '57014', JSON.stringify(error));
  check('a real error returns data: null', data === null);
  check('a real error does NOT fall back to the full scan', !client.state.tables.includes('daily_sales'));

  // --- 6. The point of the whole change: request count vs the old way ---
  _resetFallbackWarning();
  const quietWarn = console.warn; console.warn = () => {};
  client = makeClient(sales, 'noview');
  await getProductSalesSummary(null, client);
  console.warn = quietWarn;
  const fallbackRequests = client.state.requests;
  client = makeClient(sales, 'view');
  await getProductSalesSummary(null, client);
  check(`the view needs far fewer requests than the full scan (${client.state.requests} vs ${fallbackRequests})`,
        client.state.requests * 2 < fallbackRequests, `${client.state.requests} vs ${fallbackRequests}`);

  console.log();
  if (failures.length) { console.log(`FAILED: ${failures.length}: ${JSON.stringify(failures)}`); process.exit(1); }
  console.log('All productSalesSummary checks passed.');
})().catch((err) => { console.error('Unexpected throw:', err); process.exit(1); });
