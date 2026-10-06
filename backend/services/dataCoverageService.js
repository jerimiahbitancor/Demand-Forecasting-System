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

module.exports = { getFingerprint, cachedByFingerprint, clearCache, DEFAULT_MAX_AGE_MS };
