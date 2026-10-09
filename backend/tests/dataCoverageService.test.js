// tests/dataCoverageService.test.js — run: node --test tests/dataCoverageService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getFingerprint,
  cachedByFingerprint,
  clearCache,
} = require('../services/dataCoverageService');

// Minimal fake of the supabase-js query builder: records every query and
// answers from `tables`. Thenable, like the real builder.
function fakeClient(tables, { failOn = null } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const q = { table, head: false, orderBy: null, limit: null };
      const builder = {
        select(_cols, opts = {}) {
          q.head = Boolean(opts.head);
          return builder;
        },
        order(col, opts = {}) {
          q.orderBy = { col, ascending: opts.ascending !== false };
          return builder;
        },
        limit(n) {
          q.limit = n;
          return builder;
        },
        then(resolve, reject) {
          calls.push({ ...q });
          if (failOn === table) return Promise.resolve({ data: null, count: null, error: new Error(`${table} down`) }).then(resolve, reject);
          const rows = tables[table] || [];
          if (q.head) return Promise.resolve({ data: null, count: rows.length, error: null }).then(resolve, reject);
          let data = [...rows];
          if (q.orderBy) {
            const { col, ascending } = q.orderBy;
            data = data.filter((r) => r[col] != null).sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0));
            if (!ascending) data.reverse();
          }
          if (q.limit != null) data = data.slice(0, q.limit);
          return Promise.resolve({ data, count: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client;
}

function sampleTables() {
  return {
    uploads: [
      { id: 1, upload_date: '2026-10-01T09:00:00' },
      { id: 2, upload_date: '2026-10-02T09:00:00' },
    ],
    daily_sales: [{ id: 1 }, { id: 2 }, { id: 3 }],
    business_days: [
      { id: 1, confirmed_at: '2026-10-01T01:00:00Z' },
      { id: 2, confirmed_at: null },
    ],
  };
}

test('getFingerprint issues exactly 5 queries and joins their answers', async () => {
  const client = fakeClient(sampleTables());
  const fp = await getFingerprint(client);
  assert.equal(client.calls.length, 5);
  assert.deepEqual(
    client.calls.map((c) => c.table).sort(),
    ['business_days', 'business_days', 'daily_sales', 'uploads', 'uploads']
  );
  assert.equal(fp, '2|2026-10-02T09:00:00|3|2|2026-10-01T01:00:00Z');
});

test('getFingerprint changes when any covered part of the data changes', async () => {
  const base = await getFingerprint(fakeClient(sampleTables()));

  const moreSales = sampleTables();
  moreSales.daily_sales.push({ id: 4 });
  assert.notEqual(await getFingerprint(fakeClient(moreSales)), base);

  const newUpload = sampleTables();
  newUpload.uploads.push({ id: 3, upload_date: '2026-10-03T09:00:00' });
  assert.notEqual(await getFingerprint(fakeClient(newUpload)), base);

  const reconfirmed = sampleTables();
  reconfirmed.business_days[1].confirmed_at = '2026-10-05T01:00:00Z';
  assert.notEqual(await getFingerprint(fakeClient(reconfirmed)), base);

  const fewerDays = sampleTables();
  fewerDays.business_days.pop();
  assert.notEqual(await getFingerprint(fakeClient(fewerDays)), base);
});

test('getFingerprint rejects when a query fails (callers then run uncached)', async () => {
  await assert.rejects(getFingerprint(fakeClient(sampleTables(), { failOn: 'daily_sales' })), /daily_sales down/);
});

test('same fingerprint: computeFn runs once', async () => {
  clearCache();
  let runs = 0;
  const compute = async () => ({ value: ++runs });
  const a = await cachedByFingerprint('k', 'fp1', compute);
  const b = await cachedByFingerprint('k', 'fp1', compute);
  assert.equal(runs, 1);
  assert.deepEqual(a, { value: 1 });
  assert.equal(b, a);
});

test('changed fingerprint recomputes; keys are independent', async () => {
  clearCache();
  let runs = 0;
  const compute = async () => ++runs;
  assert.equal(await cachedByFingerprint('k', 'fp1', compute), 1);
  assert.equal(await cachedByFingerprint('k', 'fp2', compute), 2);
  assert.equal(await cachedByFingerprint('other', 'fp2', compute), 3);
  assert.equal(await cachedByFingerprint('k', 'fp2', compute), 2);
});

test('expiry: an entry older than maxAgeMs is recomputed', async () => {
  clearCache();
  let clock = 1000;
  const now = () => clock;
  let runs = 0;
  const compute = async () => ++runs;
  await cachedByFingerprint('k', 'fp', compute, { maxAgeMs: 500, now });
  clock += 499;
  await cachedByFingerprint('k', 'fp', compute, { maxAgeMs: 500, now });
  assert.equal(runs, 1);
  clock += 1;
  await cachedByFingerprint('k', 'fp', compute, { maxAgeMs: 500, now });
  assert.equal(runs, 2);
});

test('the default max age is 10 minutes', async () => {
  clearCache();
  let clock = 0;
  const now = () => clock;
  let runs = 0;
  const compute = async () => ++runs;
  await cachedByFingerprint('k', 'fp', compute, { now });
  clock = 10 * 60 * 1000 - 1;
  await cachedByFingerprint('k', 'fp', compute, { now });
  assert.equal(runs, 1);
  clock = 10 * 60 * 1000;
  await cachedByFingerprint('k', 'fp', compute, { now });
  assert.equal(runs, 2);
});

test('a thrown computeFn is not cached and the error propagates', async () => {
  clearCache();
  let runs = 0;
  const failing = async () => {
    runs += 1;
    throw new Error('db down');
  };
  await assert.rejects(cachedByFingerprint('k', 'fp', failing), /db down/);
  await assert.rejects(cachedByFingerprint('k', 'fp', failing), /db down/);
  assert.equal(runs, 2);
  assert.equal(await cachedByFingerprint('k', 'fp', async () => 'ok'), 'ok');
});

test('two simultaneous callers with the same fingerprint share one computation', async () => {
  clearCache();
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const compute = async () => {
    runs += 1;
    await gate;
    return 'v';
  };
  const p1 = cachedByFingerprint('k', 'fp', compute);
  const p2 = cachedByFingerprint('k', 'fp', compute);
  release();
  assert.deepEqual(await Promise.all([p1, p2]), ['v', 'v']);
  assert.equal(runs, 1);
});

// ---- Task 2.0: daily_sales_date_summary view + fallback ----

const {
  getSaleDateSummary,
  getUserSaleCoverageFromSummary,
  _resetFallbackWarning,
} = require('../services/dataCoverageService');

// Answers per table: a function (query state) -> { data, count, error }.
function scriptedClient(answers) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, head: false, filters: [], range: null };
      const b = {
        select(_c, o = {}) { q.head = Boolean(o.head); return b; },
        order() { return b; },
        eq(c, v) { q.filters.push(['eq', c, v]); return b; },
        in(c, v) { q.filters.push(['in', c, v]); return b; },
        range(f, t) { q.range = [f, t]; return b; },
        then(res, rej) {
          calls.push({ ...q });
          return Promise.resolve(answers[table](q)).then(res, rej);
        },
      };
      return b;
    },
  };
}
const page = (rows) => (q) => ({ data: q.range && q.range[0] > 0 ? [] : rows, error: null });

test('getSaleDateSummary reads the view, sorted', async () => {
  const client = scriptedClient({
    daily_sales_date_summary: page([{ sale_date: '2025-07-11', sale_rows: 3 }, { sale_date: '2025-07-10', sale_rows: 5 }]),
  });
  const { rows, source } = await getSaleDateSummary(client);
  assert.equal(source, 'view');
  assert.deepEqual(rows.map((r) => r.sale_date), ['2025-07-10', '2025-07-11']);
});

test('missing view -> falls back to the paged scan and warns once', async () => {
  _resetFallbackWarning();
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    const client = scriptedClient({
      daily_sales_date_summary: () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.daily_sales_date_summary'" } }),
      daily_sales: page([{ sale_date: '2025-07-10' }, { sale_date: '2025-07-10' }, { sale_date: '2025-07-12' }]),
    });
    const first = await getSaleDateSummary(client);
    const second = await getSaleDateSummary(client);
    assert.equal(first.source, 'scan');
    assert.deepEqual(first.rows, [{ sale_date: '2025-07-10', sale_rows: 2 }, { sale_date: '2025-07-12', sale_rows: 1 }]);
    assert.deepEqual(second.rows, first.rows);
    assert.equal(warnings.length, 1, 'warns only once');
  } finally {
    console.warn = realWarn;
  }
});

test('a real error (e.g. permission denied on the view) is thrown, not swallowed', async () => {
  const client = scriptedClient({
    daily_sales_date_summary: () => ({ data: null, error: { code: '42501', message: 'permission denied for view daily_sales_date_summary' } }),
    daily_sales: () => { throw new Error('must not fall back on a permission error'); },
  });
  await assert.rejects(getSaleDateSummary(client), (err) => err.code === '42501');
});

test('user coverage uses the view only when every sales row is this user\'s', async () => {
  const summary = page([{ sale_date: '2025-07-10', sale_rows: 2 }, { sale_date: '2025-07-12', sale_rows: 1 }]);
  const headCounts = (allCount, mineCount) => (q) => ({
    data: null,
    count: q.filters.some((f) => f[0] === 'in') ? mineCount : allCount,
    error: null,
  });

  clearCache();
  const same = await getUserSaleCoverageFromSummary(
    scriptedClient({ daily_sales: headCounts(3, 3), daily_sales_date_summary: summary }), [1, 2], 'fp-a'
  );
  assert.deepEqual(same, { distinctSaleDays: 2, earliestSaleDate: '2025-07-10' });

  clearCache();
  const differs = await getUserSaleCoverageFromSummary(
    scriptedClient({ daily_sales: headCounts(4, 3), daily_sales_date_summary: summary }), [1, 2], 'fp-b'
  );
  assert.equal(differs, null, 'caller must run its own filtered scan');
});
