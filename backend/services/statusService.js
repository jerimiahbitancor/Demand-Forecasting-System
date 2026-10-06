// services/statusService.js
//
// One answer to "is every part of the system OK right now?", for
// GET /api/status and the /admin/health page.
//
// - All checks run in parallel, each with its own timeout. A slow or
//   broken check fails ON ITS OWN ({ status: 'fail', reason }); it never
//   delays or breaks the others.
// - The whole result is cached for 15 s, so refreshing the page or several
//   viewers cannot hammer the database. Two calls at the same moment share
//   one run.
// - Each check returns { status: 'ok'|'warn'|'fail', checkedAt, latencyMs,
//   details, reason }.
// - Overall: 'down' if the database check fails; 'degraded' if any check
//   warns or fails; otherwise 'ok'.
// - Never includes secrets, keys, full URLs, emails or stack traces.
//
// In-memory numbers (request stats, scheduler runs) reset when the process
// restarts; their `since` fields say when that was.

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TZ = 'Asia/Manila';

// Every threshold in one place (docs/observability.md is written from these).
const THRESHOLDS = Object.freeze({
  cacheMs: 15000,
  checkTimeoutMs: 3000,
  server: Object.freeze({
    memoryLimitMbDefault: 512, // MEMORY_LIMIT_MB overrides (Railway: 0.5 GB per service)
    memoryWarnPct: 80,
    p95WarnMs: 2000,
    errors5xxWarn: 1, // any 5xx in the last 5 minutes
  }),
  database: Object.freeze({
    warnMs: 500,
    failMs: 1500,
  }),
  mlService: Object.freeze({
    timeoutMs: 3000,
  }),
  uploads: Object.freeze({
    failedTodayWarn: 1,
    pendingWarnMinutes: 60,
  }),
});

const STATUS_RANK = { ok: 0, warn: 1, fail: 2 };

// Reasons must never leak a URL (hostnames, credentials in query strings).
function cleanReason(reason) {
  if (reason == null) return null;
  return String(reason).replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]').slice(0, 300);
}

function worst(statuses) {
  return statuses.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a), 'ok');
}

function overallOf(checks) {
  if (checks.database && checks.database.status === 'fail') return 'down';
  return Object.values(checks).some((c) => c.status !== 'ok') ? 'degraded' : 'ok';
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'CHECK_TIMEOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} opts
 * @param {Record<string, () => Promise<{status, details?, reason?}>>} opts.checks
 */
function createStatusService({ checks, cacheMs = THRESHOLDS.cacheMs, timeoutMs = THRESHOLDS.checkTimeoutMs, now = Date.now }) {
  let cached = null; // { value, storedAt }
  let inFlight = null;

  async function runCheck(name, fn) {
    const started = now();
    let outcome;
    try {
      outcome = await withTimeout(Promise.resolve().then(fn), timeoutMs);
    } catch (err) {
      outcome = {
        status: 'fail',
        details: {},
        reason: err && err.code === 'CHECK_TIMEOUT' ? err.message : `check failed: ${(err && err.message) || err}`,
      };
    }
    const status = STATUS_RANK[outcome && outcome.status] !== undefined ? outcome.status : 'fail';
    return [name, {
      status,
      checkedAt: new Date(now()).toISOString(),
      latencyMs: Math.max(0, Math.round(now() - started)),
      details: (outcome && outcome.details) || {},
      reason: cleanReason(outcome && outcome.reason),
    }];
  }

  async function runAll() {
    const names = Object.keys(checks);
    const settled = await Promise.allSettled(names.map((n) => runCheck(n, checks[n])));
    const results = {};
    settled.forEach((s, i) => {
      // runCheck never throws, but stay safe.
      results[names[i]] = s.status === 'fulfilled'
        ? s.value[1]
        : { status: 'fail', checkedAt: new Date(now()).toISOString(), latencyMs: 0, details: {}, reason: 'check crashed' };
    });
    return {
      overall: overallOf(results),
      checkedAt: new Date(now()).toISOString(),
      cacheSeconds: Math.round(cacheMs / 1000),
      checks: results,
    };
  }

  async function getStatus() {
    if (cached && now() - cached.storedAt < cacheMs) return cached.value;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const value = await runAll();
        cached = { value, storedAt: now() };
        return value;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { getStatus, _clear: () => { cached = null; } };
}

// ---------------------------------------------------------------------------
// The six real checks. Dependencies are injectable for tests.
// ---------------------------------------------------------------------------

const timed = async (fn, nowFn = Date.now) => {
  const started = nowFn();
  const result = await fn();
  return { result, ms: Math.round(nowFn() - started) };
};

const fmtPct = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : null);

// ML_SERVICE_URL -> 'private' (Railway private network), 'local' (dev), or
// 'public'. Only the CATEGORY is ever reported, never the URL.
function classifyMlUrl(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith('.railway.internal')) return 'private';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return 'local';
  return 'public';
}

function buildDefaultChecks(deps = {}) {
  const client = deps.client || require('../config/supabase').supabaseAdmin;
  const requestStats = deps.requestStats || require('../utils/requestStats');
  const getSchedulerStatus = deps.getSchedulerStatus || (() => require('../jobs/forecastScheduler').getSchedulerStatus());
  const isTrainingInFlight = deps.isTrainingInFlight || (() => require('./mlService').isTrainingInFlight());
  const getMissingOperatingDays = deps.getMissingOperatingDays
    || ((args) => require('./dataCoverageService').getMissingOperatingDays(client, args));
  const { beatsBaseline } = require('../utils/accuracy');
  const fetchImpl = deps.fetchImpl || ((...args) => fetch(...args));
  const env = deps.env || process.env;
  const proc = deps.process || process;
  const nowFn = deps.now || Date.now;
  const todayPh = () => dayjs(nowFn()).tz(PH_TZ).format('YYYY-MM-DD');

  return {
    async server() {
      const t = THRESHOLDS.server;
      const limitMb = Number(env.MEMORY_LIMIT_MB) > 0 ? Number(env.MEMORY_LIMIT_MB) : t.memoryLimitMbDefault;
      const rssMb = Math.round(proc.memoryUsage().rss / (1024 * 1024));
      const memoryPct = Math.round((rssMb / limitMb) * 100);
      const requests = requestStats.snapshot();
      const reasons = [];
      if (memoryPct > t.memoryWarnPct) reasons.push(`memory ${rssMb} MB is ${memoryPct}% of ${limitMb} MB`);
      if (requests.p95Ms != null && requests.p95Ms > t.p95WarnMs) reasons.push(`slow requests: p95 ${requests.p95Ms} ms`);
      if (requests.errors5xx >= t.errors5xxWarn) reasons.push(`${requests.errors5xx} server error(s) (5xx) in the last 5 minutes`);
      const sha = env.RAILWAY_GIT_COMMIT_SHA;
      return {
        status: reasons.length ? 'warn' : 'ok',
        reason: reasons.join('; ') || null,
        details: {
          uptimeSec: Math.round(proc.uptime()),
          rssMb,
          memoryLimitMb: limitMb,
          memoryPct,
          nodeVersion: proc.version,
          nodeEnv: env.NODE_ENV || 'development',
          commit: sha ? String(sha).slice(0, 7) : 'unknown',
          requests,
        },
      };
    },

    async database() {
      const t = THRESHOLDS.database;
      const { result, ms } = await timed(() => client.from('forecast_config').select('id').limit(1), nowFn);
      if (result.error) {
        return { status: 'fail', reason: `query failed: ${result.error.code || ''} ${result.error.message || ''}`.trim(), details: { latencyMs: ms } };
      }
      if (ms > t.failMs) return { status: 'fail', reason: `very slow: ${ms} ms (limit ${t.failMs} ms)`, details: { latencyMs: ms } };
      if (ms > t.warnMs) return { status: 'warn', reason: `slow: ${ms} ms (over ${t.warnMs} ms)`, details: { latencyMs: ms } };
      return { status: 'ok', details: { latencyMs: ms } };
    },

    async mlService() {
      const rawUrl = (env.ML_SERVICE_URL || 'http://localhost:5001').replace(/\/+$/, '');
      const networkType = classifyMlUrl(rawUrl);
      if (!networkType) return { status: 'fail', reason: 'ML_SERVICE_URL is not a valid URL', details: { networkType: null } };

      let httpStatus = null;
      let ms = null;
      try {
        const timedFetch = await timed(
          () => fetchImpl(`${rawUrl}/health`, { signal: AbortSignal.timeout(THRESHOLDS.mlService.timeoutMs) }),
          nowFn
        );
        httpStatus = timedFetch.result.status;
        ms = timedFetch.ms;
      } catch (err) {
        const code = (err && err.cause && err.cause.code) || (err && err.name) || 'error';
        return { status: 'fail', reason: `not reachable (${code})`, details: { networkType } };
      }
      const details = { networkType, httpStatus, latencyMs: ms };
      if (httpStatus !== 200) return { status: 'fail', reason: `health check returned HTTP ${httpStatus}`, details };
      if (networkType === 'public') {
        return { status: 'warn', reason: 'public URL: long ML calls can be cut by the edge after ~60 s', details };
      }
      return { status: 'ok', details };
    },

    async uploads() {
      const t = THRESHOLDS.uploads;
      // uploads.upload_date stores Philippine wall-clock time (no zone).
      const today = todayPh();
      const [todayRows, oldestPending] = await Promise.all([
        require('../utils/fetchAllRows').fetchAllRows(() => client
          .from('uploads')
          .select('status')
          .gte('upload_date', `${today}T00:00:00`)
          .order('id')),
        client.from('uploads').select('upload_date').eq('status', 'pending').order('upload_date', { ascending: true }).limit(1),
      ]);
      if (todayRows.error) throw todayRows.error;
      if (oldestPending.error) throw oldestPending.error;

      const today_ = { processed: 0, pending: 0, failed: 0, other: 0 };
      for (const row of todayRows.data || []) {
        if (today_[row.status] !== undefined) today_[row.status] += 1;
        else today_.other += 1;
      }
      const pendingAt = oldestPending.data && oldestPending.data[0] ? oldestPending.data[0].upload_date : null;
      const oldestPendingMinutes = pendingAt
        ? Math.max(0, dayjs(nowFn()).diff(dayjs.tz(String(pendingAt).slice(0, 19), PH_TZ), 'minute'))
        : null;

      const reasons = [];
      if (today_.failed >= t.failedTodayWarn) reasons.push(`${today_.failed} upload(s) failed today`);
      if (oldestPendingMinutes != null && oldestPendingMinutes > t.pendingWarnMinutes) {
        reasons.push(`an upload has been pending for ${oldestPendingMinutes} minutes (since ${String(pendingAt).slice(0, 16).replace('T', ' ')})`);
      }
      return {
        status: reasons.length ? 'warn' : 'ok',
        reason: reasons.join('; ') || null,
        details: { date: today, today: today_, oldestPendingMinutes },
      };
    },

    async mlPipeline() {
      const today = todayPh();
      const [metrics, run, forecastsToday] = await Promise.all([
        client.from('model_metrics')
          .select('model_version, evaluation_date, wmape, baseline_wmape')
          .order('evaluation_date', { ascending: false })
          .limit(1),
        client.from('forecast_runs')
          .select('run_at, run_type, stale_days, last_confirmed_date')
          .order('run_at', { ascending: false })
          .limit(1),
        client.from('forecasts').select('id', { count: 'exact', head: true }).eq('forecast_date', today),
      ]);
      for (const r of [metrics, run, forecastsToday]) if (r.error) throw r.error;

      const m = metrics.data && metrics.data[0] ? metrics.data[0] : null;
      const lastRun = run.data && run.data[0] ? run.data[0] : null;
      const missing = await getMissingOperatingDays({
        lastConfirmedDate: lastRun ? lastRun.last_confirmed_date : null,
        today,
      });
      const beats = m ? beatsBaseline(m.wmape, m.baseline_wmape) : null;

      const details = {
        model: m ? {
          version: m.model_version,
          evaluationDate: m.evaluation_date,
          wmape: m.wmape == null ? null : Number(m.wmape),
          baselineWmape: m.baseline_wmape == null ? null : Number(m.baseline_wmape),
          beatsBaseline: beats,
        } : null,
        latestRun: lastRun ? {
          runAt: lastRun.run_at,
          runType: lastRun.run_type,
          rawStaleDays: lastRun.stale_days,
          lastConfirmedDate: lastRun.last_confirmed_date,
        } : null,
        missingOperatingDays: missing.missingOperatingDays,
        missingDates: missing.missingDates,
        operatingDaysSource: missing.operatingDaysSource,
        forecastsToday: forecastsToday.count || 0,
        trainingInFlight: Boolean(isTrainingInFlight()),
      };

      const reasons = [];
      if (!m) reasons.push('no model trained yet');
      if (missing.missingOperatingDays > 0) {
        reasons.push(`${missing.missingOperatingDays} operating day(s) with no upload or closed mark since ${lastRun.last_confirmed_date}`);
      }
      if (beats === false) {
        reasons.push(`model does not beat the 7-day average (${fmtPct(m.wmape)}% vs ${fmtPct(m.baseline_wmape)}% WMAPE)`);
      }
      if (m && details.forecastsToday === 0) reasons.push(`no forecasts for today (${today})`);

      return { status: reasons.length ? 'warn' : 'ok', reason: reasons.join('; ') || null, details };
    },

    async scheduler() {
      const status = getSchedulerStatus();
      const failed = Object.entries(status.lastRuns || {})
        .filter(([, r]) => r && r.status === 'failed')
        .map(([name, r]) => `${name} run failed at ${r.finishedAt}${r.error ? `: ${r.error}` : ''}`);
      return {
        status: failed.length ? 'warn' : 'ok',
        reason: failed.join('; ') || null,
        details: status,
      };
    },
  };
}

let defaultService = null;
function getDefaultStatusService() {
  if (!defaultService) defaultService = createStatusService({ checks: buildDefaultChecks() });
  return defaultService;
}

module.exports = {
  createStatusService,
  buildDefaultChecks,
  getDefaultStatusService,
  classifyMlUrl,
  cleanReason,
  overallOf,
  worst,
  THRESHOLDS,
};
