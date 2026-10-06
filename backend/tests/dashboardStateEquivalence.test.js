// tests/dashboardStateEquivalence.test.js
// run: node --test tests/dashboardStateEquivalence.test.js
//
// Proves Task 1.12 kept the dashboard's answers identical. The REFERENCE
// below is getUploadStats + getDashboardState copied word for word from
// the code before Phase 1 (tag baseline-pre-hardening, commit 5da177b), so
// this test does not depend on git. Both versions run against the same
// in-memory fake database; every field of the result must match (except
// stats.last_sync when there are no uploads, which is `new Date()` in both).
//
// It also checks the cache: a second check makes fewer calls, and after
// the data changes between two checks the new code still agrees.
//
// Do NOT "update" the reference to match new code. If the dashboard's rules
// change on purpose, change the expected states here deliberately instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.LOG_LEVEL = 'error';

// ---------- fake supabase (installed before the service loads) ----------
let db = {};
let calls = 0;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function makeBuilder(table) {
  const st = { filters: [], orders: [], limit: null, range: null, head: false, count: false, single: false };
  const b = {
    select(_c, o = {}) { st.head = !!o.head; st.count = !!o.count; return b; },
    eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
    in(c, vs) { const s = new Set(vs); st.filters.push((r) => s.has(r[c])); return b; },
    gte(c, v) { st.filters.push((r) => r[c] != null && r[c] >= v); return b; },
    order(c, o = {}) { st.orders.push({ c, asc: o.ascending !== false, nullsFirst: o.nullsFirst }); return b; },
    limit(n) { st.limit = n; return b; },
    range(f, t) { st.range = [f, t]; return b; },
    maybeSingle() { st.single = true; return b; },
    then(res, rej) {
      calls++;
      let rows = (db[table] || []).filter((r) => st.filters.every((f) => f(r)));
      if (st.orders.length) {
        rows = [...rows].sort((x, y) => {
          for (const o of st.orders) {
            const a = x[o.c];
            const z = y[o.c];
            if (a == null || z == null) {
              if (a == null && z == null) continue;
              // Postgres: NULLS LAST for ASC, NULLS FIRST for DESC, unless overridden.
              const nf = o.nullsFirst !== undefined ? o.nullsFirst : !o.asc;
              return (a == null ? -1 : 1) * (nf ? 1 : -1);
            }
            const d = cmp(a, z) * (o.asc ? 1 : -1);
            if (d) return d;
          }
          return 0;
        });
      }
      const count = rows.length;
      if (st.head) return Promise.resolve({ data: null, count, error: null }).then(res, rej);
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.limit != null) rows = rows.slice(0, st.limit);
      rows = rows.slice(0, 1000).map((r) => ({ ...r })); // Supabase Max rows
      const data = st.single ? (rows[0] || null) : rows;
      return Promise.resolve({ data, count: st.count ? count : null, error: null }).then(res, rej);
    },
  };
  return b;
}
const fake = { from: (t) => makeBuilder(t) };
const configPath = require.resolve(path.join(__dirname, '..', 'config', 'supabase.js'));
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { supabase: fake, supabaseAdmin: fake, isConfigured: true },
};

const realConsole = { log: console.log, warn: console.warn, error: console.error };
console.log = () => {};
console.warn = () => {};

const mlService = require('../services/mlService');
let trainingInFlight = false;
mlService.isTrainingInFlight = () => trainingInFlight;

const newSvc = require('../services/uploadService');
const coverage = require('../services/dataCoverageService');
const businessDayService = require('../services/businessDayService');
const { fetchAllRows } = require('../utils/fetchAllRows');
const { accuracyFromWmape, beatsBaseline, modelNeedsAttention } = require('../utils/accuracy');
const { supabaseAdmin } = require('../config/supabase');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
const PH_TZ = 'Asia/Manila';
const RETRAINING_CADENCE_DAYS = newSvc.constructor.RETRAINING_CADENCE_DAYS;

// ---------- REFERENCE: baseline code, verbatim ----------
// The only edit: `UploadService.RETRAINING_CADENCE_DAYS` reads the same
// constant through RETRAINING_CADENCE_DAYS above. Every other method these
// call (getNumericUserId, getUploadProgress, getLatestModelMetrics, ...)
// is unchanged in uploadService.js, so the reference inherits the live ones.
const reference = {
  async getUploadStats(userId = null) {
    try {
      const numericId = await this.getNumericUserId(userId);

      if (!this.isSupabaseReady()) {
        const uploads = this.memoryStore.uploads;
        const filtered = numericId ? uploads.filter(u => u.user_id === numericId) : uploads;
        const stats = {
          total_uploads: filtered.length,
          processed: filtered.filter((upload) => upload.status === 'processed').length,
          pending: filtered.filter((upload) => upload.status === 'pending').length,
          failed: filtered.filter((upload) => upload.status === 'failed').length,
          sales_records: filtered.reduce((sum, upload) => sum + (upload.row_count || 0), 0),
          days_of_history: 0,
          months_uploaded: 0,
          actual_days_uploaded: 0,
          actual_months_uploaded: 0,
          menu_items: this.memoryStore.products.length,
          last_sync: filtered[filtered.length - 1]?.upload_date || null
        };
        return stats;
      }

      let query = supabaseAdmin.from('uploads')
        .select('id, filename, status, row_count, upload_date');

      if (numericId) {
        query = query.eq('user_id', numericId);
        console.log(`Fetching stats for user_id: ${numericId}`);
      }

      const { data: uploads = [], error: uploadError } = await query;

      if (uploadError) throw uploadError;

      const uploadIds = uploads.map((upload) => upload.id).filter(Boolean);

      // Display-only numbers. NEITHER gates training any more — the
      // first-use rule lives in utils/historyGate.js (see
      // getDashboardState), and it measures the span of the uploaded data,
      // never today's date.
      //
      // - days_of_history/months_uploaded: elapsed calendar time from the
      //   earliest sale date to TODAY. Kept for existing displays only.
      //
      // - actual_days_uploaded/actual_months_uploaded ("how many distinct
      //   calendar days actually have a real sales row") is what gets
      //   shown to the owner as "how much sales data have I uploaded" —
      //   uploading a handful of sample rows from over a year ago would
      //   otherwise make days_of_history alone look like "12/12 months
      //   met" the instant today's real clock has drifted far enough past
      //   that old date, even though almost no data actually exists. The
      //   owner needs an honest count of what's actually been uploaded to
      //   track progress by, independent of the gate.
      let earliestSaleDate = null;
      let distinctSaleDays = 0;
      if (uploadIds.length > 0) {
        try {
          // PostgREST/Supabase silently caps a single .select() at 1000
          // rows — with a real account's daily_sales easily running into
          // the tens of thousands of rows, an unpaginated query here was
          // truncated to whatever the first 1000 rows happened to be,
          // collapsing a genuine 400+ distinct sale dates down to ~22 and
          // making a fully-uploaded year look almost empty. Page through
          // with .range() until a page comes back short of PAGE_SIZE.
          // Uses the shared helper, which stops on an EMPTY page rather
          // than a short one. The old inline loop broke on the first
          // short page — correct only while Supabase's Max rows is
          // exactly 1,000. If it were ever lowered, the first page would
          // come back short and this would stop early, silently
          // under-counting sale days again (the bug described above).
          const { data: saleDateRows, error: pageError } = await fetchAllRows(() => supabaseAdmin
            .from('daily_sales')
            .select('sale_date')
            .in('upload_id', uploadIds)
            .order('sale_date')
            .order('product_id'));
          if (pageError) throw pageError;

          const distinctDates = new Set();
          for (const row of saleDateRows || []) {
            if (row.sale_date) distinctDates.add(row.sale_date);
          }

          distinctSaleDays = distinctDates.size;
          if (distinctDates.size > 0) {
            earliestSaleDate = [...distinctDates].sort()[0];
          }
        } catch (salesDatesError) {
          console.warn('Could not calculate sales date coverage:', salesDatesError.message);
        }
      }

      const daysOfHistory = earliestSaleDate
        ? Math.max(0, dayjs().tz(PH_TZ).diff(dayjs(earliestSaleDate), 'day'))
        : 0;
      const monthsUploaded = Math.min(Math.floor(daysOfHistory / 30), 12);
      const actualMonthsUploaded = Math.min(Math.floor(distinctSaleDays / 30), 12);

      let menuQuery = supabaseAdmin.from('products')
        .select('*', { count: 'exact', head: true });

      let menuItemsCount = 0;
      try {
        const { count, error: productError } = await menuQuery;

        if (!productError) {
          menuItemsCount = count || 0;
        }
      } catch (err) {
        console.warn('Could not fetch menu items count:', err.message);
      }

      const stats = {
        total_uploads: uploads.length,
        processed: uploads.filter((upload) => upload.status === 'processed').length,
        pending: uploads.filter((upload) => upload.status === 'pending').length,
        failed: uploads.filter((upload) => upload.status === 'failed').length,
        sales_records: uploads.reduce((sum, upload) => sum + (upload.row_count || 0), 0),
        days_of_history: daysOfHistory,
        months_uploaded: monthsUploaded,
        actual_days_uploaded: distinctSaleDays,
        actual_months_uploaded: actualMonthsUploaded,
        menu_items: menuItemsCount || 0,
        last_sync: uploads[uploads.length - 1]?.upload_date || new Date().toISOString()
      };

      console.log('Stats calculated:', stats);
      return stats;
    } catch (error) {
      console.error('Error fetching stats:', error);
      throw error;
    }
  },

  async getDashboardState(userId = null) {
    const stats = await this.getUploadStats(userId);
    const progress = await this.getUploadProgress(userId);

    if (stats.total_uploads === 0 && stats.sales_records === 0) {
      return { state: 'no-data', stats, progress };
    }

    const latestModel = await this.getLatestModelMetrics();

    // First-use history rule (utils/historyGate.js — ml-service's /train
    // applies the identical rule via services/history_gate.py):
    //   1. last sale date − first sale date + 1 >= 365 days (closed days
    //      count; today's date does not), and
    //   2. every date in that span is open (has sales) or confirmed closed.
    //
    // Applied ONLY while no model has been trained yet — the same
    // condition ml-service uses (model_metrics has no row). Once the store
    // is operating, a single missed upload inside the span would otherwise
    // flip a working dashboard back to this onboarding screen; missed
    // uploads after that are reported through forecast_runs.stale_days.
    if (!latestModel && !mlService.isTrainingInFlight()) {
      const { gate } = await businessDayService.getHistoryCoverage();
      if (!gate.passes) {
        return {
          state: 'uploaded-insufficient',
          stats,
          progress,
          // 'span' | 'unconfirmed' | 'both' | 'no_data'
          insufficientReason: gate.insufficientReason,
          history: {
            firstSaleDate: gate.firstSaleDate,
            lastSaleDate: gate.lastSaleDate,
            spanDays: gate.spanDays,
            spanMonths: gate.spanMonths,
            requiredSpanDays: gate.requiredSpanDays,
            openDays: gate.openDays,
            closedDays: gate.closedDays,
            unconfirmedDays: gate.unconfirmedDays,
          },
        };
      }
    }

    // Actual training-in-flight signal (see mlService.isTrainingInFlight),
    // not upload-processing status — those are different things that the
    // old logic conflated (progress.status === 'processing' || stats.pending > 0).
    if (mlService.isTrainingInFlight()) {
      return { state: 'training-in-progress', stats, progress };
    }

    if (!latestModel) {
      return { state: 'ready-to-train', stats, progress };
    }

    const hasForecasts = await this.hasUpcomingForecasts();
    if (!hasForecasts) {
      // A model exists but no current forecasts yet (e.g. trained just
      // now, first /forecast run hasn't landed). No dedicated state for
      // this narrow window in the 7-state spec — training-in-progress is
      // the closest fit, since the dashboard genuinely isn't usable yet
      // for a different reason than "not trained at all". Deliberately
      // checked BEFORE the attention checks below, regardless of accuracy:
      // a system that has never yet attempted to operate (no forecast run
      // has happened at all) isn't a production problem yet — judging it
      // as one is premature. (A prior version of this function reordered
      // this check to run AFTER the attention checks specifically so a bad
      // model would surface immediately — that meant a system whose
      // accuracy never improves could get permanently stuck in
      // 'data-needs-attention' without ever reaching 'training-in-progress'
      // (post-model), 'forecasts-ready-recipes-pending', or
      // 'fully-operational', since nothing was ever wired up to actually
      // call POST /api/ml/forecast and flip hasUpcomingForecasts() to
      // true. That's fixed separately — see the Generate Forecast button
      // and the cron scheduler — which is what makes restoring this
      // original order safe again.)
      return { state: 'training-in-progress', stats, progress };
    }

    // Model trained + forecasts exist — NOW check the data-needs-attention
    // OR before deciding forecasts-ready-recipes-pending vs
    // fully-operational, since staleness/accuracy/retraining/data-quality
    // issues can happen to an otherwise-complete dashboard. This is the
    // correct moment for "an operating system just got worse," not a
    // precondition for letting it operate at all.
    const [forecastRun, dataQualityIssue] = await Promise.all([
      this.getLatestForecastRun(),
      this.getLastUploadDataQualityIssue(),
    ]);

    const staleDays = forecastRun?.stale_days || 0;
    const isStale = staleDays > 0;

    // Accuracy is WMAPE-based now, and "is it good enough?" is answered by
    // comparison, not by a threshold (owner decision, Oct 1 2026): the
    // model needs attention when it does NOT beat the 7-day average on the
    // same test rows. The old rule was accuracy = 100 - MAPE with a
    // hardcoded "< 70%" cutoff — a number nobody chose, inherited from the
    // Lewis (1982) MAPE bands, which are dropped along with MAPE.
    //
    // The rule lives in utils/accuracy.js so Analytics and this dashboard
    // can never disagree about whether the model is healthy.
    const accuracy = accuracyFromWmape(latestModel.wmape);
    const baselineAccuracy = accuracyFromWmape(latestModel.baseline_wmape);
    const beatsBaselineFlag = beatsBaseline(latestModel.wmape, latestModel.baseline_wmape);
    const isLowAccuracy = modelNeedsAttention(latestModel.wmape, latestModel.baseline_wmape);
    const daysSinceTraining = latestModel.evaluation_date
      ? Math.floor((Date.now() - new Date(latestModel.evaluation_date).getTime()) / 86400000)
      : null;
    const needsRetraining = daysSinceTraining !== null && daysSinceTraining > RETRAINING_CADENCE_DAYS;

    if (isStale || isLowAccuracy || needsRetraining || dataQualityIssue) {
      return {
        state: 'data-needs-attention',
        stats,
        progress,
        attention: {
          isStale, staleDays, lastConfirmedDate: forecastRun?.last_confirmed_date || null,
          isLowAccuracy, accuracy, baselineAccuracy, beatsBaseline: beatsBaselineFlag,
          needsRetraining, daysSinceTraining,
          dataQualityIssue,
        },
      };
    }

    const { hasUnmapped, unmappedCount, activeCount } = await this.getUnmappedActiveProductInfo();
    if (hasUnmapped) {
      return {
        state: 'forecasts-ready-recipes-pending',
        stats, progress,
        mapping: { unmappedCount, activeCount },
      };
    }

    return { state: 'fully-operational', stats, progress };
  }
};
Object.setPrototypeOf(reference, newSvc);

console.log = realConsole.log;
console.warn = realConsole.warn;

// ---------- data builders ----------
const iso = (d) => d.format('YYYY-MM-DD');
function build({ days = 0, products = 3, gapEvery = 0, closeGaps = false, start = '2025-07-10' }) {
  const t = {
    uploads: [], daily_sales: [], business_days: [], products: [], model_metrics: [],
    forecasts: [], forecast_runs: [], product_ingredients: [], user: [{ id: 7, auth_id: 'x'.repeat(36) }],
  };
  for (let p = 1; p <= products; p++) t.products.push({ id: p, status: 'active', name: 'P' + p });
  let sid = 1;
  let bid = 1;
  for (let i = 0; i < days; i++) {
    const d = iso(dayjs(start).add(i, 'day'));
    if (gapEvery && i % gapEvery === 3) {
      if (closeGaps) t.business_days.push({ id: bid++, business_date: d, status: 'confirmed_closed', is_open: false, confirmed_at: '2026-10-01T00:00:00Z' });
      continue;
    }
    const uid = t.uploads.length + 1;
    t.uploads.push({
      id: uid, user_id: 7, filename: d + '.csv', status: 'processed', row_count: products,
      upload_date: dayjs('2026-09-01T08:00:00').add(i, 'minute').format('YYYY-MM-DDTHH:mm:ss'),
      error_message: JSON.stringify({ validRows: products, invalidRows: 0, errors: [] }),
    });
    for (let p = 1; p <= products; p++) t.daily_sales.push({ id: sid++, upload_id: uid, product_id: p, sale_date: d, quantity_sold: 3 });
    t.business_days.push({ id: bid++, business_date: d, status: 'confirmed_open', is_open: true, confirmed_at: '2026-09-02T00:00:00Z' });
  }
  return t;
}
const future = iso(dayjs().add(2, 'day'));
const recent = iso(dayjs().subtract(3, 'day'));
const model = (o = {}) => ({ model_version: 'v1', evaluation_date: recent, mape: 40, wmape: 20, baseline_wmape: 25, ...o });
const withForecast = (t, o) => { t.model_metrics.push(model(o)); t.forecasts.push({ id: 1, forecast_date: future }); return t; };
const mapAll = (t, n) => { for (let p = 1; p <= n; p++) t.product_ingredients.push({ product_id: p }); return t; };

// [name, expected state, data, inFlight]
const SCENARIOS = [
  ['empty', 'no-data', () => build({})],
  ['unconfirmed gaps, >1000 sales rows', 'uploaded-insufficient', () => build({ days: 446, products: 3, gapEvery: 7 })],
  ['production size (~17.8k rows)', 'uploaded-insufficient', () => build({ days: 446, products: 52, gapEvery: 4 })],
  ['span too short', 'uploaded-insufficient', () => build({ days: 100, products: 2 })],
  ['ready to train', 'ready-to-train', () => build({ days: 400, products: 3, gapEvery: 7, closeGaps: true })],
  ['no model, training in flight', 'training-in-progress', () => build({ days: 50, products: 2 }), true],
  ['model, no forecasts yet', 'training-in-progress', () => { const t = build({ days: 50 }); t.model_metrics.push(model()); return t; }],
  ['stale forecast run', 'data-needs-attention', () => {
    const t = withForecast(build({ days: 50 }));
    t.forecast_runs.push({ run_at: '2026-10-05T01:00:00Z', stale_days: 3, last_confirmed_date: '2026-10-01' });
    return t;
  }],
  ['model loses to the 7-day average', 'data-needs-attention', () => withForecast(build({ days: 50 }), { wmape: 30, baseline_wmape: 25 })],
  ['model overdue for retraining', 'data-needs-attention', () => withForecast(build({ days: 50 }), { evaluation_date: '2026-01-01' })],
  ['data quality issue on last upload', 'data-needs-attention', () => {
    const t = withForecast(build({ days: 50 }));
    t.uploads[t.uploads.length - 1].error_message = JSON.stringify({ validRows: 1, invalidRows: 2, errors: [] });
    return t;
  }],
  ['recipes pending', 'forecasts-ready-recipes-pending', () => { const t = withForecast(build({ days: 50 })); t.product_ingredients.push({ product_id: 1 }); return t; }],
  ['fully operational', 'fully-operational', () => mapAll(withForecast(build({ days: 50 })), 3)],
  ['production size, fully operational', 'fully-operational', () => mapAll(withForecast(build({ days: 446, products: 52, gapEvery: 4 })), 52)],
  ['no baseline (unknown, not bad)', 'fully-operational', () => mapAll(withForecast(build({ days: 50 }), { baseline_wmape: null }), 3)],
];

// Owner's comparison rule ignores stats.last_sync (new Date() with no uploads).
const comparable = (r) => {
  const copy = JSON.parse(JSON.stringify(r));
  if (copy.stats && copy.stats.total_uploads === 0) delete copy.stats.last_sync;
  return copy;
};

async function run(fn) {
  const saved = console.log;
  console.log = () => {};
  console.warn = () => {};
  try {
    calls = 0;
    const result = await fn();
    return { result, calls };
  } finally {
    console.log = saved;
    console.warn = realConsole.warn;
  }
}

for (const [name, expected, make, inFlight = false] of SCENARIOS) {
  test(`same answer as baseline: ${name}`, async () => {
    for (const userId of [7, 'x'.repeat(36), null]) {
      trainingInFlight = inFlight;
      db = make();
      coverage.clearCache();
      const old = await run(() => reference.getDashboardState(userId));
      const cold = await run(() => newSvc.getDashboardState(userId));
      const warm = await run(() => newSvc.getDashboardState(userId));

      assert.equal(old.result.state, expected, `baseline state for user ${userId}`);
      assert.deepEqual(comparable(cold.result), comparable(old.result), `first check, user ${userId}`);
      assert.deepEqual(comparable(warm.result), comparable(old.result), `cached check, user ${userId}`);
      assert.ok(warm.calls <= cold.calls, 'a cached check never costs more than a cold one');
    }
    trainingInFlight = false;
  });
}

test('production size: a cached check makes far fewer Supabase calls', async () => {
  trainingInFlight = false;
  db = build({ days: 446, products: 52, gapEvery: 4 });
  coverage.clearCache();
  const old = await run(() => reference.getDashboardState(7));
  await run(() => newSvc.getDashboardState(7));
  const warm = await run(() => newSvc.getDashboardState(7));
  assert.equal(old.calls, 43, 'the baseline matches the 43 calls seen in production logs');
  assert.ok(warm.calls <= 9, `cached check used ${warm.calls} calls`);
});

const CHANGES = [
  ['all gap days marked closed', (t) => {
    const have = new Set(t.business_days.map((r) => r.business_date));
    let id = 9000;
    for (let i = 0; i < 446; i++) {
      const d = iso(dayjs('2025-07-10').add(i, 'day'));
      if (!have.has(d)) t.business_days.push({ id: id++, business_date: d, status: 'confirmed_closed', confirmed_at: '2026-10-06T00:00:00Z' });
    }
  }],
  // Same answer as before, but the cache must still recompute and agree.
  ['one business_days row added', (t) => {
    t.business_days.push({ id: 8000, business_date: '2025-07-13', status: 'unconfirmed', confirmed_at: null });
  }, false],
  ['new upload with a new sale day', (t) => {
    const id = 99999;
    t.uploads.push({ id, user_id: 7, filename: 'n.csv', status: 'processed', row_count: 1, upload_date: '2026-10-06T10:00:00', error_message: null });
    t.daily_sales.push({ id: 999999, upload_id: id, product_id: 1, sale_date: '2026-09-29', quantity_sold: 1 });
  }],
  ['an upload and its rows deleted', (t) => {
    t.uploads.shift();
    t.daily_sales = t.daily_sales.filter((r) => r.upload_id !== 1);
  }],
];

for (const [name, mutate, visible = true] of CHANGES) {
  test(`still the same answer after the data changes: ${name}`, async () => {
    trainingInFlight = false;
    db = build({ days: 446, products: 3, gapEvery: 7 });
    coverage.clearCache();
    const before = await run(() => newSvc.getDashboardState(7)); // fills the cache
    mutate(db);
    const old = await run(() => reference.getDashboardState(7));
    const now = await run(() => newSvc.getDashboardState(7));
    assert.deepEqual(comparable(now.result), comparable(old.result));
    if (visible) assert.notDeepEqual(comparable(now.result), comparable(before.result), 'the change is visible');
  });
}

// Guard against a silently broken reference: it must use the real helpers.
test('reference uses the same helpers as production code', () => {
  assert.equal(typeof fetchAllRows, 'function');
  assert.equal(typeof businessDayService.getHistoryCoverage, 'function');
  assert.equal(typeof accuracyFromWmape, 'function');
  assert.equal(typeof beatsBaseline, 'function');
  assert.equal(typeof modelNeedsAttention, 'function');
  assert.equal(supabaseAdmin, fake);
  assert.equal(typeof RETRAINING_CADENCE_DAYS, 'number');
  assert.equal(PH_TZ, 'Asia/Manila');
});
