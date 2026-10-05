// utils/appEvents.js
//
// A small "something changed" signal, so the dashboard can refresh itself
// right away instead of waiting for its 60 s poll.
//
// The notification bell already checks the newest notification every 30 s.
// When a NEW one about an upload, training or a forecast appears, the bell
// dispatches ONE window event:
//
//   window CustomEvent('dfs:data-changed', { detail: { kind, id, status } })
//
// and the dashboard listens for it. Pure apart from the window target,
// which tests can replace.

export const DATA_CHANGED_EVENT = 'dfs:data-changed';
export const DATA_CHANGE_KINDS = Object.freeze(['upload', 'upload_failed', 'training', 'forecast']);

function readMetadata(notification) {
  const raw = notification && notification.metadata;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

// Returns a function you call with the NEWEST notification (or null) after
// each check. The first call only records a baseline and never reports.
// Later calls report { kind, id, status } when a notification newer than any
// seen before has a watched kind; otherwise null.
export function createChangeDetector(kinds = DATA_CHANGE_KINDS) {
  const watched = new Set(kinds);
  let highestId = null;

  return function detect(newest) {
    const id = newest && Number(newest.id);
    const hasId = Number.isFinite(id);

    if (highestId === null) {
      highestId = hasId ? id : 0;
      return null;
    }
    if (!hasId || id <= highestId) return null;

    highestId = id;
    const { kind, status } = readMetadata(newest);
    if (!watched.has(kind)) return null;
    return { kind, id, status: status || null };
  };
}

export function emitDataChanged(detail, target = globalThis.window) {
  if (!target || typeof target.dispatchEvent !== 'function') return;
  target.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail }));
}

// Subscribes; returns the unsubscribe function (handy as an effect cleanup).
export function onDataChanged(handler, target = globalThis.window) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const listener = (event) => handler(event.detail || {});
  target.addEventListener(DATA_CHANGED_EVENT, listener);
  return () => target.removeEventListener(DATA_CHANGED_EVENT, listener);
}

// Short toast text for a change. `failed` says whether to style it as an error.
export function describeChange({ kind, status } = {}) {
  const failed = status === 'failed' || kind === 'upload_failed';
  let what;
  if (kind === 'forecast') {
    what = failed ? 'a forecast run failed' : 'new forecast available';
  } else if (kind === 'training') {
    if (failed) what = 'training failed';
    else if (status === 'started' || status === 'deferred') what = 'training started';
    else what = 'training finished';
  } else if (kind === 'upload_failed') {
    what = 'an upload failed';
  } else {
    what = 'upload finished';
  }
  return { text: `Dashboard updated — ${what}`, failed };
}
