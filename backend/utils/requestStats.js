// utils/requestStats.js
//
// In-memory record of the last 5 minutes of requests, for the status page.
// Counters reset when the process restarts, and each replica keeps its own
// (Railway runs 1 replica today).

const WINDOW_MS = 5 * 60 * 1000;
// Hard cap so a request flood can never grow this without bound.
const MAX_ENTRIES = 50000;
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

function createRequestStats({ now = () => Date.now(), windowMs = WINDOW_MS, since = PROCESS_STARTED_AT } = {}) {
  let entries = [];

  function prune() {
    const cutoff = now() - windowMs;
    let firstKept = 0;
    while (firstKept < entries.length && entries[firstKept].ts < cutoff) firstKept += 1;
    if (firstKept > 0) entries = entries.slice(firstKept);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  }

  function record({ durationMs, status }) {
    entries.push({ ts: now(), durationMs, status });
    prune();
  }

  // Nearest-rank percentile on a sorted array.
  function percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
  }

  function snapshot() {
    prune();
    const durations = entries.map((e) => e.durationMs).sort((a, b) => a - b);
    const round = (v) => (v === null ? null : Math.round(v));
    return {
      since,
      windowMinutes: windowMs / 60000,
      count: entries.length,
      errors5xx: entries.filter((e) => e.status >= 500).length,
      rateLimited429: entries.filter((e) => e.status === 429).length,
      p50Ms: round(percentile(durations, 50)),
      p95Ms: round(percentile(durations, 95)),
      maxMs: round(durations.length ? durations[durations.length - 1] : null),
    };
  }

  function reset() {
    entries = [];
  }

  return { record, snapshot, reset };
}

// The one shared instance the app uses.
const defaultStats = createRequestStats();

module.exports = {
  createRequestStats,
  record: defaultStats.record,
  snapshot: defaultStats.snapshot,
  reset: defaultStats.reset,
  PROCESS_STARTED_AT,
};
