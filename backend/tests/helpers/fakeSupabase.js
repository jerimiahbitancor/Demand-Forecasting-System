// tests/helpers/fakeSupabase.js
//
// In-memory stand-in for the supabase-js client, just enough of the query
// builder for the upload / status / inventory code paths. No network.
// Install it in require.cache BEFORE loading any service (see installFake).
//
//   const fake = createFakeSupabase({ products: [...] });
//   fake.tables.daily_sales      -> rows written so far
//   fake.writes                  -> [{ op, table, rows }] in order
//   fake.rpcCalls                -> [{ name, args }]
//
// Views computed like Postgres would: product_sales_summary.
// A table nobody seeded reads as empty (e.g. modifier_rules).

const path = require('path');

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// 'metadata->>key' reads a JSON field as text, like PostgREST does.
const field = (row, column) => {
  const [base, key] = column.split('->>');
  if (key === undefined) return row[column];
  const value = row[base] && row[base][key];
  return value == null ? null : String(value);
};
const day = (v) => (v == null ? v : String(v).slice(0, 10));

// Columns migration 017_remove_legacy_ingredient_pack_units.sql dropped from
// the live database. A select naming one fails like Postgres does (42703),
// so code still asking for them fails in tests too, not only in production
// (Oct 24 2026: every sales upload broke this way while the tests passed).
// pack_price is not here: migration 023 added it back for purchase-pack
// pricing. options.droppedColumns overrides the list.
const DROPPED_COLUMNS = Object.freeze([
  'pack_qty', 'pack_unit', 'pack_size', 'grams_per_cup', 'density_g_per_ml',
]);

function createFakeSupabase(seed = {}, options = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const nextId = {};
  const writes = [];
  const rpcCalls = [];
  // options.rejectInsert(table, row) -> true makes an upsert/insert of that
  // row silently write nothing (like ON CONFLICT DO NOTHING returning null).
  const rejectInsert = (table, row) => (options.rejectInsert ? options.rejectInsert(table, row) : false);
  const rpcHandlers = options.rpc || {};
  // options.defaults: column defaults per table, applied on insert like
  // Postgres would (e.g. { notifications: { read: false } }).
  const defaultsFor = (table) => (options.defaults && options.defaults[table]) || {};

  const rowsOf = (table) => {
    if (table === 'product_sales_summary') {
      const byProduct = new Map();
      for (const r of tables.daily_sales || []) {
        const s = byProduct.get(r.product_id) || { product_id: r.product_id, first_sale_date: null, last_sale_date: null, sale_rows: 0 };
        const d = day(r.sale_date);
        if (!s.first_sale_date || d < s.first_sale_date) s.first_sale_date = d;
        if (!s.last_sale_date || d > s.last_sale_date) s.last_sale_date = d;
        s.sale_rows += 1;
        byProduct.set(r.product_id, s);
      }
      return [...byProduct.values()];
    }
    if (!tables[table]) tables[table] = [];
    return tables[table];
  };

  const assignId = (table, row) => {
    if (row.id !== undefined) return row;
    const existing = rowsOf(table).map((r) => Number(r.id)).filter(Number.isFinite);
    const start = nextId[table] || (existing.length ? Math.max(...existing) + 1 : 1);
    nextId[table] = start + 1;
    return { id: start, ...row };
  };

  function builder(table) {
    const st = {
      op: 'select', filters: [], orders: [], limit: null, range: null,
      single: null, head: false, count: false, values: null, upsertOpts: null, returning: false,
    };
    const b = {
      select(cols, o = {}) {
        if (st.op === 'select') { st.head = !!o.head; st.count = !!o.count; st.cols = cols; } else st.returning = true;
        return b;
      },
      insert(rows) { st.op = 'insert'; st.values = Array.isArray(rows) ? rows : [rows]; return b; },
      upsert(rows, o = {}) { st.op = 'upsert'; st.values = Array.isArray(rows) ? rows : [rows]; st.upsertOpts = o; return b; },
      update(values) { st.op = 'update'; st.values = values; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push((r) => { const x = field(r, c); return x === v || (x != null && v != null && String(x) === String(v)); }); return b; },
      neq(c, v) { st.filters.push((r) => r[c] !== v); return b; },
      in(c, vs) { const s = new Set((vs || []).map(String)); st.filters.push((r) => s.has(String(r[c]))); return b; },
      gte(c, v) { st.filters.push((r) => r[c] != null && r[c] >= v); return b; },
      gt(c, v) { st.filters.push((r) => r[c] != null && r[c] > v); return b; },
      lte(c, v) { st.filters.push((r) => r[c] != null && r[c] <= v); return b; },
      lt(c, v) { st.filters.push((r) => r[c] != null && r[c] < v); return b; },
      is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return b; },
      // Only the form the code uses: .not(col, 'is', null).
      not(c, op, v) { if (op === 'is') st.filters.push((r) => (r[c] ?? null) !== v); return b; },
      order(c, o = {}) { st.orders.push({ c, asc: o.ascending !== false }); return b; },
      limit(n) { st.limit = n; return b; },
      range(f, t) { st.range = [f, t]; return b; },
      maybeSingle() { st.single = 'maybe'; return b; },
      single() { st.single = 'one'; return b; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };

    const finish = (rows) => {
      if (st.single) {
        if (rows.length === 0 && st.single === 'one') {
          return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        }
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };

    function run() {
      // options.missingTables: tables that "do not exist yet" (a migration
      // not run): every request answers PostgREST's real PGRST205 error.
      if (options.missingTables && options.missingTables.includes(table)) {
        return {
          data: null,
          error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` },
        };
      }
      if (st.op === 'select' && typeof st.cols === 'string') {
        const dropped = (options.droppedColumns || DROPPED_COLUMNS)
          .find((column) => new RegExp(`\\b${column}\\b`).test(st.cols));
        if (dropped) {
          return { data: null, error: { code: '42703', message: `column ingredients_1.${dropped} does not exist` } };
        }
      }
      const all = rowsOf(table);
      const match = (r) => st.filters.every((f) => f(r));

      if (st.op === 'insert' || st.op === 'upsert') {
        const conflict = st.upsertOpts && st.upsertOpts.onConflict
          ? st.upsertOpts.onConflict.split(',').map((s) => s.trim()) : null;
        const written = [];
        for (const raw of st.values) {
          if (rejectInsert(table, raw)) continue;
          if (conflict) {
            const existing = all.find((r) => conflict.every((c) => String(r[c]) === String(raw[c])));
            if (existing) {
              if (st.upsertOpts.ignoreDuplicates) continue;
              Object.assign(existing, raw);
              written.push(existing);
              continue;
            }
          }
          const row = assignId(table, { ...defaultsFor(table), ...raw });
          all.push(row);
          written.push(row);
        }
        writes.push({ op: st.op, table, rows: written.map((r) => ({ ...r })) });
        return st.returning ? finish(written) : { data: null, error: null };
      }

      if (st.op === 'update') {
        const hit = all.filter(match);
        for (const r of hit) Object.assign(r, st.values);
        writes.push({ op: 'update', table, rows: hit.map((r) => ({ ...r })), values: { ...st.values } });
        return st.returning ? finish(hit) : { data: null, error: null };
      }

      if (st.op === 'delete') {
        const hit = all.filter(match);
        tables[table] = all.filter((r) => !match(r));
        writes.push({ op: 'delete', table, rows: hit.map((r) => ({ ...r })) });
        return { data: null, error: null };
      }

      let rows = all.filter(match);
      if (st.orders.length) {
        rows = [...rows].sort((x, y) => {
          for (const o of st.orders) {
            const d = cmp(x[o.c], y[o.c]) * (o.asc ? 1 : -1);
            if (d) return d;
          }
          return 0;
        });
      }
      const count = rows.length;
      if (st.head) return { data: null, count, error: null };
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.limit != null) rows = rows.slice(0, st.limit);
      rows = rows.slice(0, 1000); // Supabase Max rows
      const out = finish(rows);
      if (st.count) out.count = count;
      return out;
    }

    return b;
  }

  // Mirrors migrations/020_sales_upload_requires_stock.sql apply_sales_upload():
  // check EVERY ingredient first; if any is short, write nothing and return
  // { ok: false, shortfalls }. Otherwise insert daily_sales (unique on
  // product_id + sale_date -> 23505) and deduct each ingredient through the
  // test's own deduct_ingredient_stock handler. All or nothing: a failure part
  // way restores the tables, like a rolled-back transaction.
  // Amounts are compared with plain Number here; the real function uses
  // numeric(18,6). Tests that need exact decimals assert on the deduct
  // handler, which keeps its own Decimal maths.
  function applySalesUpload(args, tbls) {
    const sales = args.p_daily_sales || [];
    const deductions = args.p_deductions || [];
    const ingredients = tbls.ingredients || [];
    const shortfalls = [];
    for (const d of deductions) {
      const row = ingredients.find((i) => String(i.id) === String(d.ingredient_id));
      if (!row) return { data: null, error: { code: 'P0001', message: `apply_sales_upload: ingredient ${d.ingredient_id} does not exist` } };
      const available = Math.max(0, Number(row.quantity || 0));
      const required = Number(d.deduction);
      if (required > available + 1e-9) {
        shortfalls.push({
          ingredient_id: row.id,
          name: row.name,
          unit: row.unit,
          required: String(d.deduction),
          available: String(available),
          shortfall: String(+(required - available).toFixed(6)),
        });
      }
    }
    if (shortfalls.length) return { data: { ok: false, shortfalls }, error: null };

    const snapshot = JSON.parse(JSON.stringify(tbls));
    const restore = () => {
      for (const key of Object.keys(tbls)) delete tbls[key];
      Object.assign(tbls, snapshot);
    };
    const existing = rowsOf('daily_sales');
    for (const s of sales) {
      const clash = existing.some((r) => String(r.product_id) === String(s.product_id) && day(r.sale_date) === day(s.sale_date));
      if (clash) {
        restore();
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint "daily_sales_product_id_sale_date_key"' },
        };
      }
      existing.push(assignId('daily_sales', { ...s, upload_id: args.p_upload_id }));
    }
    writes.push({ op: 'insert', table: 'daily_sales', rows: sales.map((s) => ({ ...s, upload_id: args.p_upload_id })) });

    const results = [];
    const deduct = rpcHandlers.deduct_ingredient_stock;
    for (const d of [...deductions].sort((a, b) => Number(a.ingredient_id) - Number(b.ingredient_id))) {
      if (!deduct) { restore(); return { data: null, error: { message: 'no fake rpc deduct_ingredient_stock' } }; }
      const out = deduct({
        p_ingredient_id: d.ingredient_id,
        p_deduction: d.deduction,
        p_reference_type: 'upload',
        p_reference_id: args.p_upload_id,
        p_updated_by: args.p_updated_by,
        p_notes: d.notes ?? null,
        p_requested_exact: d.requested_exact ?? null,
      }, tbls);
      if (out.error) { restore(); return out; }
      const r = Array.isArray(out.data) ? out.data[0] : out.data;
      results.push({ ingredient_id: d.ingredient_id, ...r });
    }
    return { data: { ok: true, sales_rows: sales.length, deductions: results }, error: null };
  }

  return {
    tables,
    writes,
    rpcCalls,
    // Services keep the client they loaded with, so tests reuse one fake
    // and reset its contents between cases.
    reset(newSeed = {}, newOptions = {}) {
      for (const key of Object.keys(tables)) delete tables[key];
      for (const [name, rows] of Object.entries(newSeed)) tables[name] = rows.map((r) => ({ ...r }));
      for (const key of Object.keys(nextId)) delete nextId[key];
      writes.length = 0;
      rpcCalls.length = 0;
      options.rejectInsert = newOptions.rejectInsert || (() => false);
      options.missingTables = newOptions.missingTables || [];
      options.missingFunctions = newOptions.missingFunctions || [];
    },
    from: (table) => builder(table),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      const handler = rpcHandlers[name]
        || (name === 'apply_sales_upload' && !options.missingFunctions?.includes(name) ? applySalesUpload : null);
      if (handler) return handler(args, tables);
      // PostgREST's real answer for a function that does not exist yet.
      if (options.missingFunctions && options.missingFunctions.includes(name)) {
        return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } };
      }
      return { data: null, error: { message: `no fake rpc ${name}` } };
    },
    writesTo(table) { return writes.filter((w) => w.table === table); },
  };
}

// Puts `fake` behind config/supabase.js (and any extra stubs) in
// require.cache. Call before requiring a service or route.
function installFake(fake, stubs = {}) {
  const root = path.join(__dirname, '..', '..');
  const put = (rel, exportsValue) => {
    const abs = require.resolve(path.join(root, rel));
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsValue };
  };
  put('config/supabase.js', { supabase: fake, supabaseAdmin: fake, isConfigured: true });
  for (const [rel, exportsValue] of Object.entries(stubs)) put(rel, exportsValue);
}

module.exports = { createFakeSupabase, installFake };
