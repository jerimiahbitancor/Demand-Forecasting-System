// State helpers for the bulk upload screen (UploadData.jsx).
//
// Kept in a plain module (no React) for two reasons:
//   1. The knowledge "is an upload actually running right now?" has to
//      outlive the screen component. A React component can be destroyed and
//      rebuilt while an upload it started is still going — navigating to
//      another page and back does it, so does a hot reload in dev. The async
//      upload function keeps running either way, because nothing cancels it.
//      A plain module variable survives that rebuild; component state and
//      refs do not.
//   2. It can be tested with plain Node (frontend/tests/uploadRunState.test.mjs).
//
// THE BUG THIS FIXES. The screen used to read "status: loading" and the
// progress bar from sessionStorage, but kept the "N files in flight" and
// "N done" counters only in the component. After a rebuild mid-upload:
//   - the new component had empty counters, so it showed
//     "Uploading 0 at once — 0/288 done" while the bar kept moving;
//   - on mount it decided "loading can't still be true after a reload" and
//     flipped to "failed", then the still-running upload wrote "loading"
//     back a moment later, so the screen flipped again.
// Now the upload records its counters in storage as it goes, and "is it
// still running?" is answered by a variable that only a genuinely running
// upload in THIS page can set.

export const BULK_UPLOAD_STATUS_KEY = 'bulk_upload_status';

// In-memory, per page load. A real page refresh wipes it (and wipes any
// running upload with it), which is exactly the distinction we need:
//   alive === true  -> an upload started in this page is still running
//   alive === false -> any "loading" left in storage is a dead run's leftover
const liveRuns = { sales: false, menu: false };

export const isRunAlive = (type) => Boolean(liveRuns[type]);
export const setRunAlive = (type, alive) => { liveRuns[type] = Boolean(alive); };

const readAll = () => {
  try {
    return JSON.parse(sessionStorage.getItem(BULK_UPLOAD_STATUS_KEY) || '{}');
  } catch {
    return {};
  }
};

// Plain, non-mutating read — what's in storage, with no judgment about
// whether it is stale. Safe on every tick of the 500ms polling interval.
export const peekStoredUploadStatus = (type) => readAll()[type] || null;

// Mount-time-only recovery. A page load destroys any request that was in
// flight, so a persisted 'loading' can't be real by the time a FRESH page
// reads it — trusting it would disable the upload button forever. So it is
// corrected to 'error'.
//
// BUT only when no upload is alive in this page. A component rebuilt while
// its upload is still running is not a reload: the run is real, and
// "correcting" it to 'error' is what made the screen report a failure that
// hadn't happened.
//
// Must never be called from the recurring poll; use peekStoredUploadStatus.
export const getStoredUploadStatus = (type) => {
  try {
    const stored = readAll();
    const status = stored[type] || null;

    if (status && status.status === 'loading' && !isRunAlive(type)) {
      const corrected = { ...status, status: 'error' };
      stored[type] = corrected;
      try {
        sessionStorage.setItem(BULK_UPLOAD_STATUS_KEY, JSON.stringify(stored));
      } catch {
        // Storage write is best-effort — the corrected value is still
        // returned below either way.
      }
      return corrected;
    }

    return status;
  } catch {
    return null;
  }
};

export const saveUploadStatus = (type, status) => {
  try {
    const stored = readAll();
    sessionStorage.setItem(BULK_UPLOAD_STATUS_KEY, JSON.stringify({
      ...stored,
      [type]: {
        ...(stored[type] || {}),
        ...status
      }
    }));
  } catch {
    // Storage is optional; the upload itself should continue.
  }
};

export const getStoredFiles = (type) => {
  const status = getStoredUploadStatus(type);
  return (status?.files || []).map((file) => ({ ...file, isRestored: true }));
};

export const clearUploadStatus = (type) => {
  try {
    const stored = readAll();
    delete stored[type];
    sessionStorage.setItem(BULK_UPLOAD_STATUS_KEY, JSON.stringify(stored));
  } catch {
    // Storage is optional.
  }
};

// Sets and Maps don't survive JSON, so the per-file counters are stored as
// plain arrays and rebuilt on the way out.
export const packRun = ({ processing, done, failed }) => ({
  processing: [...processing],
  done: [...done],
  failed: [...failed],
});

export const unpackRun = (packed) => ({
  processing: new Set(packed?.processing || []),
  done: new Set(packed?.done || []),
  failed: new Map(packed?.failed || []),
});

// What a freshly built screen should show for the per-file counters.
// Only trusted while the run is genuinely alive: after a real reload the
// stored snapshot describes requests that no longer exist, and showing
// those files as "Uploading..." would be a lie.
export const initialRunView = (type) => (
  isRunAlive(type)
    ? unpackRun(peekStoredUploadStatus(type)?.run)
    : unpackRun(null)
);
