// Tests the first-use history rule (utils/historyGate.js), the
// mark-as-closed validation, and the real /api/business-days endpoints.
//
// No network, no Supabase, no credentials: the database, the JWT check and
// the audit log are replaced with in-memory fakes BEFORE the route file is
// loaded. Nothing here can write to the live database.
//
// Run:  cd backend && node tests/historyGate.test.js
// Dump mode (used by ml-service/tests/test_history_gate.py to compare the
// JS and Python answers):  node tests/historyGate.test.js --dump

const path = require('path');
const fs = require('fs');
const http = require('http');

const CASES_PATH = path.join(__dirname, '..', '..', 'ml-service', 'tests', 'fixtures', 'history_gate_cases.json');
const { cases } = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Case expansion — must match expand_case() in test_history_gate.py exactly.
// ---------------------------------------------------------------------------
const DAY = 86400000;
const toN = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const fromN = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const isSunday = (s) => new Date(toN(s) * DAY).getUTCDay() === 0;
const rangeDates = ([a, b]) => { const out = []; for (let n = toN(a); n <= toN(b); n += 1) out.push(fromN(n)); return out; };

function expandCase(c) {
  const sales = new Set();
  for (const r of c.sales_ranges || []) rangeDates(r).forEach((d) => sales.add(d));
  for (const d of c.sales_dates || []) sales.add(d);
  for (const d of c.sales_exclude || []) sales.delete(d);
  for (const r of c.sales_exclude_ranges || []) rangeDates(r).forEach((d) => sales.delete(d));
  if (c.sales_exclude_sundays) for (const d of [...sales]) if (isSunday(d)) sales.delete(d);

  const closed = new Set(c.closed_dates || []);
  for (const r of c.closed_ranges || []) rangeDates(r).forEach((d) => closed.add(d));
  if (c.closed_sundays_in) rangeDates(c.closed_sundays_in).filter(isSunday).forEach((d) => closed.add(d));

  // Keep input order messy on purpose: the rule must not depend on it.
  return { saleDates: [...sales], closedDates: [...closed] };
}

// camelCase result -> the snake_case keys the fixture and Python use.
const toSnake = (r) => ({
  passes: r.passes,
  insufficient_reason: r.insufficientReason,
  first_sale_date: r.firstSaleDate,
  last_sale_date: r.lastSaleDate,
  span_days: r.spanDays,
  open_days: r.openDays,
  closed_days: r.closedDays,
  unconfirmed_days: r.unconfirmedDays,
  unconfirmed_dates: r.unconfirmedDates,
});

const {
  evaluateHistoryGate, validateClosableDates, MAX_CLOSE_BATCH,
} = require('../utils/historyGate');

if (process.argv.includes('--dump')) {
  const out = {};
  for (const c of cases) out[c.name] = toSnake(evaluateHistoryGate(expandCase(c)));
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------------------
const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

// ---------------------------------------------------------------------------
// In-memory stand-in for the parts of supabase-js the service uses.
// Enforces a 1,000-row cap per request like the real project, so paging is
// exercised too.
// ---------------------------------------------------------------------------
class FakeQuery {
  constructor(db, table) {
    this.db = db; this.table = table; this.filters = []; this.orders = []; this.rangeArgs = null; this.mode = 'select';
  }
  select() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  in(col, vals) { const s = new Set(vals); this.filters.push((r) => s.has(r[col])); return this; }
  gte(col, val) { this.filters.push((r) => r[col] >= val); return this; }
  lte(col, val) { this.filters.push((r) => r[col] <= val); return this; }
  order(col, opts = {}) { this.orders.push([col, opts.ascending !== false]); return this; }
  range(a, b) { this.rangeArgs = [a, b]; return this.exec(); }
  upsert(rows, { onConflict } = {}) {
    const list = Array.isArray(rows) ? rows : [rows];
    const store = this.db.tables[this.table];
    for (const row of list) {
      const idx = store.findIndex((r) => r[onConflict] === row[onConflict]);
      if (idx >= 0) store[idx] = { ...store[idx], ...row };
      else store.push({ ...row });
    }
    this.db.writes += 1;
    return Promise.resolve({ data: null, error: null });
  }
  exec() {
    let rows = this.db.tables[this.table].filter((r) => this.filters.every((f) => f(r)));
    for (const [col, asc] of [...this.orders].reverse()) {
      rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rangeArgs) rows = rows.slice(this.rangeArgs[0], this.rangeArgs[1] + 1);
    rows = rows.slice(0, 1000);
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
}

class FakeSupabase {
  constructor({ sales = [], businessDays = [] } = {}) {
    this.tables = { daily_sales: sales, business_days: businessDays };
    this.writes = 0;
  }
  from(table) { return new FakeQuery(this, table); }
}

// ~40 products per open day, so a year of sales is well over 1,000 rows.
function salesRows(dates, perDay = 40) {
  const rows = [];
  for (const d of dates) for (let p = 1; p <= perDay; p += 1) rows.push({ sale_date: d, product_id: p });
  return rows;
}

// ---------------------------------------------------------------------------
// Stub auth + audit in require.cache BEFORE loading the routes, so the real
// router runs with no JWT and no audit_logs writes.
// ---------------------------------------------------------------------------
function stubModule(relPath, exportsValue) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const auditCalls = [];
stubModule('../middleware/auth', (req, res, next) => { req.user = { name: 'Test Owner' }; next(); });
stubModule('../services/auditService', { logAction: async (...args) => { auditCalls.push(args); } });

const { BusinessDayService } = require('../services/businessDayService');

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('historyGate.test.js');

  // --- 1. The rule, against the shared cases ---
  console.log('\n[rule] shared cases (also run by the Python test)');
  for (const c of cases) {
    const got = toSnake(evaluateHistoryGate(expandCase(c)));
    for (const [key, want] of Object.entries(c.expect)) {
      check(`${c.name}: ${key} = ${JSON.stringify(want)}`, got[key] === want, `got ${JSON.stringify(got[key])}`);
    }
  }

  // --- 2. Today's date has no effect ---
  console.log('\n[rule] today has no effect');
  const base = cases.find((c) => c.name === 'span_364_fails');
  const before = JSON.stringify(evaluateHistoryGate(expandCase(base)));
  const RealDate = Date;
  class FarFuture extends RealDate {
    constructor(...args) { if (args.length === 0) super('2099-12-31T00:00:00Z'); else super(...args); }
    static now() { return new RealDate('2099-12-31T00:00:00Z').getTime(); }
  }
  global.Date = FarFuture;
  const after = JSON.stringify(evaluateHistoryGate(expandCase(base)));
  global.Date = RealDate;
  check('span_364 still fails with the clock set to 2099', before === after);

  // --- 3. Mark-closed validation (pure) ---
  console.log('\n[validation] validateClosableDates');
  const sales = rangeDates(['2025-07-10', '2026-07-09']).filter((d) => d !== '2025-12-25' && d !== '2026-01-01');
  const today = '2026-09-30';
  const v = (dates) => validateClosableDates(dates, { saleDates: sales, today });
  check('accepts gap dates', v(['2025-12-25', '2026-01-01']).ok);
  check('dedupes and sorts', JSON.stringify(v(['2026-01-01', '2025-12-25', '2026-01-01']).dates) === JSON.stringify(['2025-12-25', '2026-01-01']));
  check('rejects a date with sales', !v(['2025-12-24']).ok && /sales/.test(v(['2025-12-24']).errors[0].reason));
  check('rejects a future date', !v(['2026-10-01']).ok && /Future/.test(v(['2026-10-01']).errors[0].reason));
  check('rejects before the first sale', !v(['2025-07-09']).ok && /Outside/.test(v(['2025-07-09']).errors[0].reason));
  check('rejects after the last sale (past, not future)', !v(['2026-08-01']).ok && /Outside/.test(v(['2026-08-01']).errors[0].reason));
  check('rejects a malformed date', !v(['2026-02-30']).ok && !v(['hello']).ok && !v([20251225]).ok);
  check('rejects an empty list', !v([]).ok && !v(undefined).ok);
  check(`rejects more than ${MAX_CLOSE_BATCH} dates`, !v(new Array(MAX_CLOSE_BATCH + 1).fill('2025-12-25')).ok);
  const mixed = v(['2025-12-25', '2025-12-24']);
  check('one bad date rejects the whole request', !mixed.ok && mixed.errors.length === 1);

  // --- 4. The real endpoints over HTTP ---
  console.log('\n[endpoints] /api/business-days (real router, fake database)');
  const express = require('express');
  const fake = new FakeSupabase({ sales: salesRows(sales) });
  const service = new BusinessDayService({ client: fake, configured: true, audit: async () => {} });
  service.today = () => today;
  stubModule('../services/businessDayService', service);
  const router = require('../routes/businessDays');
  const app = express();
  app.use(express.json());
  app.use('/api/business-days', router);
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const gaps = await request(port, 'GET', '/api/business-days/gaps');
    check('GET /gaps -> 200', gaps.status === 200);
    check('GET /gaps lists exactly the 2 gap dates (paged past 1,000 rows)',
      JSON.stringify(gaps.body.data.gapDates.map((g) => g.date)) === JSON.stringify(['2025-12-25', '2026-01-01']),
      JSON.stringify(gaps.body.data.gapDates));
    check('GET /gaps includes the weekday', gaps.body.data.gapDates[0].weekday === 'Thursday');
    check('GET /gaps reports span 365 / open 363 / unconfirmed 2',
      gaps.body.data.spanDays === 365 && gaps.body.data.openDays === 363 && gaps.body.data.unconfirmedDays === 2);

    const writesBefore = fake.writes;
    const withSales = await request(port, 'POST', '/api/business-days/bulk-close', { dates: ['2025-12-24'] });
    check('POST /bulk-close rejects a date with sales -> 400', withSales.status === 400);
    const future = await request(port, 'POST', '/api/business-days/bulk-close', { dates: ['2026-10-01'] });
    check('POST /bulk-close rejects a future date -> 400', future.status === 400);
    const outside = await request(port, 'POST', '/api/business-days/bulk-close', { dates: ['2025-07-01'] });
    check('POST /bulk-close rejects a date outside the span -> 400', outside.status === 400);
    const mixedReq = await request(port, 'POST', '/api/business-days/bulk-close', { dates: ['2025-12-25', '2025-12-24'] });
    check('POST /bulk-close with one bad date -> 400', mixedReq.status === 400);
    check('rejected requests wrote nothing', fake.writes === writesBefore);
    check('no audit entry for rejected requests', auditCalls.length === 0);

    const first = await request(port, 'POST', '/api/business-days/bulk-close', { dates: ['2025-12-25', '2026-01-01'] });
    check('POST /bulk-close valid -> 200', first.status === 200);
    check('first call closes both', first.body.data.closed.length === 2 && first.body.data.alreadyClosed.length === 0);
    check('one audit entry written', auditCalls.length === 1 && auditCalls[0][0] === 'business_days_bulk_closed');
    const rowsAfterFirst = JSON.stringify(fake.tables.business_days.map(({ confirmed_at, ...r }) => r).sort((a, b) => a.business_date.localeCompare(b.business_date)));

    const second = await request(port, 'POST', '/api/business-days/bulk-close', { dates: ['2025-12-25', '2026-01-01'] });
    check('repeat call -> 200 (idempotent)', second.status === 200);
    check('repeat call reports them as already closed', second.body.data.closed.length === 0 && second.body.data.alreadyClosed.length === 2);
    const rowsAfterSecond = JSON.stringify(fake.tables.business_days.map(({ confirmed_at, ...r }) => r).sort((a, b) => a.business_date.localeCompare(b.business_date)));
    check('repeat call leaves business_days unchanged', rowsAfterFirst === rowsAfterSecond);
    check('repeat call writes no second audit entry', auditCalls.length === 1);
    check('rows are confirmed_closed / manual_confirmation / is_open false',
      fake.tables.business_days.every((r) => r.status === 'confirmed_closed' && r.source === 'manual_confirmation' && r.is_open === false));

    const gapsAfter = await request(port, 'GET', '/api/business-days/gaps');
    check('after closing, no gaps left', gapsAfter.body.data.gapDates.length === 0 && gapsAfter.body.data.closedDays === 2);
    const coverage = await service.getHistoryCoverage();
    check('after closing, the history rule passes', coverage.gate.passes === true);

    const single = await request(port, 'POST', '/api/business-days/close', { date: '2025-12-24' });
    check('POST /close (single date) also refuses a date with sales -> 400', single.status === 400);

    // --- 5. Late upload wins over a closed mark, and the flip is logged ---
    console.log('\n[late upload] a sales upload for a closed date reopens it');
    const flipAudit = [];
    service.audit = async (...args) => { flipAudit.push(args); };
    fake.tables.daily_sales.push(...salesRows(['2025-12-25'], 3));
    const reopenResult = await service.confirmOpenDates(['2025-12-25', '2025-12-26']);
    const row = fake.tables.business_days.find((r) => r.business_date === '2025-12-25');
    check('date becomes confirmed_open', row.status === 'confirmed_open' && row.is_open === true && row.source === 'sales_upload');
    check('reopened list names only the flipped date', JSON.stringify(reopenResult.reopened) === JSON.stringify(['2025-12-25']));
    check('the flip is written to the audit log', flipAudit.length === 1 && flipAudit[0][0] === 'business_day_reopened_by_upload');
  } finally {
    server.close();
  }

  console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll history-gate checks passed.');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
