// features/admin/pages/HealthPage.jsx
//
// /admin/health — one page that shows, at a glance, whether each part of
// the system is OK and, if not, why. Data: GET /api/status (backend
// services/statusService.js), polled every 30 s through the shared client.
// The backend caches the report for 15 s, so refreshing faster than that
// shows the same "checked at" time.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../../components/Navbar/Navbar.jsx';
import ConnectionProblem from '../../dashboard/states/ConnectionProblem.jsx';
import apiClient from '../../../services/apiClient';
import usePolling from '../../../hooks/usePolling';
import './HealthPage.css';

const HEALTH_POLL_MS = 30000;

const loadStatus = async (signal) => {
  const response = await apiClient.get('/status', { signal });
  return response.data.data;
};

const CHECK_TITLES = {
  database: 'Database',
  mlService: 'ML service',
  mlPipeline: 'Model and forecasts',
  uploads: 'Sales uploads',
  scheduler: 'Forecast schedule',
  server: 'API server',
};
const CHECK_ORDER = ['database', 'mlService', 'mlPipeline', 'uploads', 'scheduler', 'server'];

const OVERALL_TEXT = {
  ok: { title: 'All systems OK', tone: 'ok' },
  degraded: { title: 'Working, with warnings', tone: 'warn' },
  down: { title: 'Database unreachable — the system is down', tone: 'fail' },
};

const STATUS_LABEL = { ok: 'OK', warn: 'Warning', fail: 'Failed' };

const fmtTime = (iso) => (iso
  ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');
const fmtClock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const fmtMs = (ms) => (ms == null ? '—' : `${ms} ms`);
const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : 'Unknown');
const fmtDuration = (sec) => {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

// Key values per check, as [label, value] rows.
function rowsFor(name, d = {}) {
  switch (name) {
    case 'database':
      return [['Response time', fmtMs(d.latencyMs)]];
    case 'mlService':
      return [
        ['Network', d.networkType === 'private' ? 'Private (Railway internal)' : d.networkType === 'public' ? 'Public URL' : d.networkType === 'local' ? 'Local (development)' : '—'],
        ['Health check', d.httpStatus ? `HTTP ${d.httpStatus}` : '—'],
        ['Response time', fmtMs(d.latencyMs)],
      ];
    case 'mlPipeline':
      return [
        ['Model', d.model ? d.model.version : 'None trained yet'],
        ['Trained on', d.model ? d.model.evaluationDate : '—'],
        ['Model WMAPE', d.model ? fmtPct(d.model.wmape) : '—'],
        ['7-day average WMAPE', d.model ? fmtPct(d.model.baselineWmape) : '—'],
        ['Beats the 7-day average', d.model ? yesNo(d.model.beatsBaseline) : '—'],
        ['Last forecast run', d.latestRun ? `${d.latestRun.runType || '—'}, ${fmtTime(d.latestRun.runAt)}` : 'None yet'],
        ['Last confirmed sales day', d.latestRun ? d.latestRun.lastConfirmedDate || '—' : '—'],
        ['Missing operating days', d.missingOperatingDays ?? '—'],
        ['Operating days', d.operatingDaysSource === 'configured' ? 'From Business Profile' : d.operatingDaysSource === 'default' ? 'Default (Mon–Fri) — not set' : '—'],
        ['Stale days (raw, from forecast run)', d.latestRun ? d.latestRun.rawStaleDays ?? '—' : '—'],
        ['Forecast rows for today', d.forecastsToday ?? '—'],
        ['Training running now', d.trainingInFlight ? 'Yes' : 'No'],
      ];
    case 'uploads':
      return [
        ['Today (Manila)', d.date || '—'],
        ['Processed today', d.today ? d.today.processed : '—'],
        ['Pending today', d.today ? d.today.pending : '—'],
        ['Failed today', d.today ? d.today.failed : '—'],
        ['Oldest pending upload', d.oldestPendingMinutes == null ? 'None' : `${d.oldestPendingMinutes} min ago`],
      ];
    case 'scheduler': {
      const run = (r) => (r ? `${r.status}${r.finishedAt ? `, ${fmtTime(r.finishedAt)}` : ''}${r.forecastedCount != null ? ` (${r.forecastedCount} forecasted)` : ''}` : 'Not run since restart');
      return [
        ['Daily 9:00 AM', run(d.lastRuns && d.lastRuns.daily)],
        ['Weekly Monday 9:00 AM', run(d.lastRuns && d.lastRuns.weekly)],
      ];
    }
    case 'server': {
      const r = d.requests || {};
      return [
        ['Up for', fmtDuration(d.uptimeSec)],
        ['Memory', d.rssMb != null ? `${d.rssMb} MB of ${d.memoryLimitMb} MB (${d.memoryPct}%)` : '—'],
        ['Requests (last 5 min)', r.count ?? '—'],
        ['Response time p50 / p95 / max', r.count ? `${r.p50Ms} / ${r.p95Ms} / ${r.maxMs} ms` : '—'],
        ['Server errors (5xx) / rate limited (429)', r.count != null ? `${r.errors5xx} / ${r.rateLimited429}` : '—'],
        ['Version', `${d.commit || 'unknown'} · Node ${d.nodeVersion || '—'} · ${d.nodeEnv || '—'}`],
      ];
    }
    default:
      return [];
  }
}

const HealthPage = () => {
  const { data, error, lastSuccessAt, lastErrorAt, isRefreshing, refresh } = usePolling(loadStatus, HEALTH_POLL_MS);

  // A 1-second clock for "checked N s ago" (set only from timers, never
  // during render).
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const checkedAtMs = data ? Date.parse(data.checkedAt) : null;
  const agoSec = checkedAtMs && now ? Math.max(0, Math.round((now - checkedAtMs) / 1000)) : null;
  const overall = data ? OVERALL_TEXT[data.overall] || OVERALL_TEXT.degraded : null;
  const showProblem = Boolean(error) && (!lastSuccessAt || (lastErrorAt && lastErrorAt > lastSuccessAt));
  const restartedAt = data?.checks?.server?.details?.requests?.since;

  return (
    <div className="health-wrapper">
      <Navbar />
      <main className="health-main">
        <div className="health-header">
          <div>
            <p className="health-breadcrumb"><Link to="/settings">Settings</Link> / System Health</p>
            <h1 className="page-title">System Health</h1>
            <p className="page-subtitle">Is every part of the system working right now? Checked every 30 seconds.</p>
          </div>
          <button type="button" className="health-refresh" onClick={refresh} disabled={isRefreshing}>
            {isRefreshing ? 'Checking…' : 'Refresh'}
          </button>
        </div>

        {showProblem && (
          <ConnectionProblem
            mode="banner"
            inline
            error={error}
            onRetry={refresh}
            lastSuccessAt={lastSuccessAt}
            lastErrorAt={lastErrorAt}
          />
        )}

        {!data && !error && <div className="health-placeholder">Checking the system…</div>}

        {data && (
          <>
            <section className={`health-overall tone-${overall.tone}`} aria-live="polite">
              <span className="health-dot" aria-hidden="true" />
              <div>
                <h2>{overall.title}</h2>
                <p>
                  Checked {agoSec == null ? 'just now' : `${agoSec} s ago`} ({fmtClock(data.checkedAt)}).
                  {restartedAt && <> Counters since last restart at {fmtClock(restartedAt)}.</>}
                </p>
              </div>
            </section>

            <div className="health-grid">
              {CHECK_ORDER.filter((name) => data.checks[name]).map((name) => {
                const check = data.checks[name];
                return (
                  <article key={name} className={`health-card status-${check.status}`}>
                    <header className="health-card-header">
                      <h3>{CHECK_TITLES[name] || name}</h3>
                      <span className={`health-pill status-${check.status}`}>{STATUS_LABEL[check.status] || check.status}</span>
                    </header>
                    {check.reason && <p className="health-reason">{check.reason}</p>}
                    <dl className="health-values">
                      {rowsFor(name, check.details).map(([label, value]) => (
                        <div key={label} className="health-row">
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="health-card-foot">Checked in {fmtMs(check.latencyMs)}</p>
                  </article>
                );
              })}
            </div>

            <section className="health-note">
              <h3>Known risk: training time (lastTraining)</h3>
              <p>
                The last training run took <strong>88 s</strong> against the ML service&apos;s <strong>120 s</strong> request
                limit (measured from the browser on Oct 6, 2026). More sales data makes training slower, so a future run
                could be cut off. The fix is the ML start command in <code>docs/deployment.md</code> (timeout 900 s).
                In-memory numbers on this page (requests, schedule runs) reset when the API restarts.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default HealthPage;
