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
// reads it — trusting it would disable the upload button forever.
//
// For SALES it becomes 'interrupted', not 'error' (Oct 24 2026): a refresh
// kills the browser's requests but not the server's work, so some of those
// files were very likely saved. "Upload failed" was a lie for them. The
// screen then asks the server which files made it
// (POST /api/upload/status-by-filename, see describeRecovery below).
// The menu flow has no such check and keeps 'error'.
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
      const corrected = { ...status, status: type === 'sales' ? 'interrupted' : 'error' };
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

// ---------------------------------------------------------------------------
// After a refresh: what happened to each file of the interrupted run.
// ---------------------------------------------------------------------------
// statuses: the server's answer, [{ filename, state, reason }] with state
// 'saved' | 'processing' | 'failed' | 'not_found' (backend
// utils/uploadRecovery.js). Matched to the stored file list by name.
//
// Returns {
//   byIndex: Map<index, { state, label, title }>,
//   counts: { saved, processing, notSaved },
//   message: one sentence for the banner,
// }
// "Not saved" covers both 'failed' and 'not_found': either way the owner has
// to select that file again (the browser cannot keep a File across a
// refresh, for security reasons). A failed file keeps its reason as a
// tooltip, e.g. "Not enough stock for 1 ingredient(s): Rice".
export const describeRecovery = (files = [], statuses = []) => {
  const byName = new Map((statuses || []).map((s) => [s.filename, s]));
  const byIndex = new Map();
  const counts = { saved: 0, processing: 0, notSaved: 0 };
  files.forEach((file, index) => {
    const s = byName.get(file && file.name);
    const state = s ? s.state : 'not_found';
    if (state === 'saved') {
      counts.saved += 1;
      byIndex.set(index, { state, label: '✓ Saved', title: 'The server saved this file before the refresh.' });
    } else if (state === 'processing') {
      counts.processing += 1;
      byIndex.set(index, { state, label: '… Still processing', title: 'The server is still working on this file. Check again in a moment.' });
    } else {
      counts.notSaved += 1;
      byIndex.set(index, {
        state: 'not_saved',
        label: 'Not saved — select it again',
        title: (s && s.reason) || 'The server never received this file.',
      });
    }
  });
  const total = files.length;
  const parts = [`${counts.saved} of ${total} file(s) were saved.`];
  if (counts.processing) parts.push(`${counts.processing} still processing — check again in a moment.`);
  if (counts.notSaved) parts.push(`Select the ${counts.notSaved} file(s) marked "Not saved" again.`);
  return { byIndex, counts, message: `Upload interrupted by a page refresh. ${parts.join(' ')}` };
};
