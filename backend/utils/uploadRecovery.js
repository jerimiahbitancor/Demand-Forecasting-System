// utils/uploadRecovery.js
//
// "Which of these files were actually saved?" — the answer the upload screen
// needs after the page was refreshed in the middle of a bulk upload
// (POST /api/upload/status-by-filename).
//
// A refresh kills the browser's requests, but NOT the server's work: a file
// whose bytes had fully arrived keeps processing and is saved; a file still
// being sent, or not yet started, never is. So the browser's own memory
// ("loading" in sessionStorage) cannot know the outcome. The uploads table
// can. Pure: no I/O.

const MAX_FILENAMES = 500;
const MAX_FILENAME_LENGTH = 255;

// Validates the request body. Returns { ok, filenames } or { ok: false, error }.
function parseFilenames(body) {
  const list = body && body.filenames;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, error: 'filenames must be a non-empty array' };
  }
  if (list.length > MAX_FILENAMES) {
    return { ok: false, error: `at most ${MAX_FILENAMES} filenames per request` };
  }
  const filenames = [];
  for (const name of list) {
    if (typeof name !== 'string' || !name.trim() || name.length > MAX_FILENAME_LENGTH) {
      return { ok: false, error: 'every filename must be a non-empty string of at most 255 characters' };
    }
    filenames.push(name);
  }
  return { ok: true, filenames: [...new Set(filenames)] };
}

// uploads.error_message holds either the validation summary (JSON, written
// when the row is created) or a plain failure reason (written on failure).
// Only the plain reason is useful to the owner.
function failureReason(errorMessage) {
  if (typeof errorMessage !== 'string' || !errorMessage.trim()) return null;
  const text = errorMessage.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      JSON.parse(text);
      return null;
    } catch {
      // not JSON after all: fall through and show it
    }
  }
  return text.slice(0, 300);
}

/**
 * @param {string[]} filenames  as the browser stored them
 * @param {object[]} rows       uploads rows for those names (any order):
 *                              { id, filename, status, upload_date, error_message }
 * @returns {{ filename, state, uploadId, uploadDate, reason }[]} one per filename, same order
 *   state: 'saved'      — status 'processed': the sales are in
 *          'processing' — status 'pending': the server is still working on it
 *          'failed'     — status 'failed': nothing was saved (reason says why)
 *          'not_found'  — the server never received it: select it again
 * The NEWEST row per filename wins (a file may have been tried before).
 */
function summarizeUploadStatuses(filenames = [], rows = []) {
  const newest = new Map();
  for (const row of rows || []) {
    if (!row || typeof row.filename !== 'string') continue;
    const current = newest.get(row.filename);
    const newer = !current
      || String(row.upload_date || '') > String(current.upload_date || '')
      || (String(row.upload_date || '') === String(current.upload_date || '') && Number(row.id) > Number(current.id));
    if (newer) newest.set(row.filename, row);
  }
  return filenames.map((filename) => {
    const row = newest.get(filename);
    if (!row) return { filename, state: 'not_found', uploadId: null, uploadDate: null, reason: null };
    const state = row.status === 'processed' ? 'saved'
      : row.status === 'pending' ? 'processing'
        : 'failed';
    return {
      filename,
      state,
      uploadId: row.id ?? null,
      uploadDate: row.upload_date ?? null,
      reason: state === 'failed' ? failureReason(row.error_message) : null,
    };
  });
}

module.exports = { parseFilenames, summarizeUploadStatuses, failureReason, MAX_FILENAMES };
