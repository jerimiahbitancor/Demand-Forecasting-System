// Tests the bulk-upload screen's state helpers (uploadRunState.js) against a
// fake sessionStorage, reproducing the reported bug:
//
//   "the upload failed, then suddenly 'Uploading 0 at once — 0/288 done'
//    and it stops working, but the progress bar is still uploading"
//
// What happened: the screen component was rebuilt while its upload kept
// running in the background. The new component had empty counters, decided
// on mount that the "loading" in storage was stale and flipped to "failed",
// then the still-running upload wrote "loading" back.
//
// The frontend has no test runner, so this is plain Node:
//   cd frontend && node tests/uploadRunState.test.mjs

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const mod = await import('../src/features/datamanagement/utils/uploadRunState.js');
const {
  isRunAlive, setRunAlive, peekStoredUploadStatus, getStoredUploadStatus,
  saveUploadStatus, getStoredFiles, clearUploadStatus, packRun, unpackRun, initialRunView,
} = mod;

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const reset = () => { store.clear(); setRunAlive('sales', false); setRunAlive('menu', false); };

// A tiny stand-in for what handleSalesConfirm does: write the running
// upload's counters to storage the way the real worker does.
function makeRun(total) {
  const run = { processing: new Set(), done: new Set(), failed: new Map() };
  const write = (extra = {}) => saveUploadStatus('sales', { run: packRun(run), updatedAt: Date.now(), ...extra });
  return {
    run,
    start() {
      setRunAlive('sales', true);
      saveUploadStatus('sales', {
        status: 'loading', progress: 0, uploadedCount: 0,
        run: packRun(run), updatedAt: Date.now(),
        files: Array.from({ length: total }, (_, i) => ({ name: `f${i}.csv`, size: 1, type: 'text/csv' })),
      });
    },
    fileStarted(i) { run.processing.add(i); write(); },
    fileSucceeded(i) { run.done.add(i); },
    fileFailed(i, status) { run.failed.set(i, { status, message: 'x' }); },
    fileSettled(i, completed) {
      run.processing.delete(i);
      write({ status: 'loading', progress: Math.round((completed / total) * 100), uploadedCount: run.done.size });
    },
    finish(status) {
      saveUploadStatus('sales', { status, progress: 100, uploadedCount: run.done.size });
      setRunAlive('sales', false);
    },
  };
}

console.log('uploadRunState.test.mjs');

// ---------------------------------------------------------------
// 1. THE REPORTED BUG: screen rebuilt mid-upload
// ---------------------------------------------------------------
reset();
const up = makeRun(288);
up.start();
for (let i = 0; i < 40; i += 1) { up.fileStarted(i); up.fileSucceeded(i); up.fileSettled(i, i + 1); }
up.fileStarted(40); up.fileStarted(41); up.fileStarted(42);   // 3 files in flight right now

// --- the screen is destroyed and rebuilt here (navigate away and back) ---
check('the run is still alive after the screen is rebuilt', isRunAlive('sales'));

const mounted = getStoredUploadStatus('sales');
check('REBUILT SCREEN: status is still "loading", NOT corrected to "error"',
      mounted.status === 'loading', `got ${mounted.status}`);

const view = initialRunView('sales');
check('REBUILT SCREEN: shows the 3 files really in flight, not 0',
      view.processing.size === 3, `got ${view.processing.size}`);
check('REBUILT SCREEN: shows 40 done, not 0/288',
      view.done.size === 40 && mounted.uploadedCount === 40, `done=${view.done.size} count=${mounted.uploadedCount}`);
check('REBUILT SCREEN: the file list is restored (288 files)',
      getStoredFiles('sales').length === 288);

// the upload keeps going and the screen keeps seeing it
up.fileSucceeded(40); up.fileSettled(40, 41);
const later = peekStoredUploadStatus('sales');
check('the screen sees progress continue after the rebuild',
      later.uploadedCount === 41 && unpackRun(later.run).processing.size === 2,
      `count=${later.uploadedCount} inflight=${unpackRun(later.run).processing.size}`);

// ---------------------------------------------------------------
// 2. The "done" counter must be LIVE (it used to read 0 the whole run)
// ---------------------------------------------------------------
reset();
const live = makeRun(10);
live.start();
const seen = [];
for (let i = 0; i < 10; i += 1) {
  live.fileStarted(i); live.fileSucceeded(i); live.fileSettled(i, i + 1);
  seen.push(peekStoredUploadStatus('sales').uploadedCount);
}
check('uploadedCount climbs 1..10 during the run (it used to stay 0)',
      JSON.stringify(seen) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), JSON.stringify(seen));

// ---------------------------------------------------------------
// 3. A REAL page reload must still recover a dead run
// ---------------------------------------------------------------
reset();
const dead = makeRun(288);
dead.start();
dead.fileStarted(0); dead.fileStarted(1);
setRunAlive('sales', false);   // a reload wipes in-memory state AND the run itself

const afterReload = getStoredUploadStatus('sales');
check('RELOAD: a leftover "loading" is corrected to "error"', afterReload.status === 'error', `got ${afterReload.status}`);
check('RELOAD: the correction is written back to storage',
      peekStoredUploadStatus('sales').status === 'error');
check('RELOAD: dead run\'s files are NOT shown as "Uploading..."',
      initialRunView('sales').processing.size === 0, `got ${initialRunView('sales').processing.size}`);

// ---------------------------------------------------------------
// 4. The poll must not re-assert a dead run's "loading"
//    (this mirrors the exact condition used in UploadData.jsx's poll)
// ---------------------------------------------------------------
const wouldPollReassertLoading = (type) => {
  const s = peekStoredUploadStatus(type);
  return Boolean(s) && s.status === 'loading' && !isRunAlive(type) ? false : (s && s.status === 'loading');
};
reset();
saveUploadStatus('sales', { status: 'loading', progress: 40, uploadedCount: 0 });
check('dead run: poll refuses to treat a stored "loading" as real',
      !wouldPollReassertLoading('sales'));
setRunAlive('sales', true);
check('live run: poll accepts a stored "loading"', Boolean(wouldPollReassertLoading('sales')));

// ---------------------------------------------------------------
// 5. The re-entrancy guard: a second Upload click mid-run is refused,
//    even from a rebuilt screen whose own ref was reset
// ---------------------------------------------------------------
reset();
setRunAlive('sales', true);
const refFromRebuiltScreen = false;                    // a brand-new ref
const clickRefused = refFromRebuiltScreen || isRunAlive('sales');
check('a second Upload click is refused while a run is alive, even after a rebuild', clickRefused);

// and the flag is released when the run ends, including on failure
const ended = makeRun(3);
ended.start();
ended.finish('error');
check('the alive flag is released when the run ends', !isRunAlive('sales'));
check('so the NEXT upload is allowed', !(refFromRebuiltScreen || isRunAlive('sales')));

// ---------------------------------------------------------------
// 6. Storage round-trip of Sets/Maps (they do not survive JSON natively)
// ---------------------------------------------------------------
const packed = JSON.parse(JSON.stringify(packRun({
  processing: new Set([1, 2]), done: new Set([3]), failed: new Map([[4, { status: 'duplicate', message: 'm' }]]),
})));
const unpacked = unpackRun(packed);
check('Sets and Maps survive a JSON round trip',
      unpacked.processing.has(2) && unpacked.done.has(3) && unpacked.failed.get(4).status === 'duplicate');
check('unpackRun(undefined) is safe and empty',
      unpackRun(undefined).processing.size === 0 && unpackRun(null).failed.size === 0);

// ---------------------------------------------------------------
// 7. Menu flow is unaffected (its upload never marks itself alive)
// ---------------------------------------------------------------
reset();
saveUploadStatus('menu', { status: 'loading', progress: 10 });
check('menu: a stored "loading" is still corrected to "error" on mount (old behaviour kept)',
      getStoredUploadStatus('menu').status === 'error');

clearUploadStatus('sales');

console.log();
if (failures.length) { console.log(`FAILED: ${failures.length}: ${JSON.stringify(failures)}`); process.exit(1); }
console.log('All uploadRunState checks passed.');
