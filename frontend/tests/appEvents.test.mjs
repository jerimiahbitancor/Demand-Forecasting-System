// Tests utils/appEvents.js: the bell's "something changed" detector and
// the window event it dispatches.
//
// Plain Node, no test runner:
//   cd frontend && node tests/appEvents.test.mjs

const {
  createChangeDetector, emitDataChanged, onDataChanged, describeChange, DATA_CHANGED_EVENT,
} = await import('../src/utils/appEvents.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

const n = (id, kind, status) => ({ id, metadata: kind ? { kind, status } : null });

console.log('change detector');
{
  const detect = createChangeDetector();
  check('first result is only a baseline', detect(n(10, 'upload')) === null);
  check('same newest -> nothing', detect(n(10, 'upload')) === null);
  const change = detect(n(11, 'forecast', 'ready'));
  check('newer watched kind -> change', change && change.kind === 'forecast' && change.id === 11 && change.status === 'ready', JSON.stringify(change));
  check('reported once', detect(n(11, 'forecast', 'ready')) === null);
  check('newer but unwatched kind (low_stock) -> nothing', detect(n(12, 'low_stock')) === null);
  check('the unwatched one still moves the baseline', detect(n(12, 'upload')) === null);
  check('older id -> nothing', detect(n(5, 'upload')) === null);
  check('no metadata -> nothing', detect(n(13)) === null);
  check('string metadata is parsed', detect({ id: 14, metadata: '{"kind":"training","status":"completed"}' })?.kind === 'training');
  check('bad metadata string -> nothing', detect({ id: 15, metadata: '{oops' }) === null);
  check('upload_failed is watched', detect(n(16, 'upload_failed'))?.kind === 'upload_failed');
}
{
  const detect = createChangeDetector();
  check('empty list as baseline', detect(null) === null);
  check('first notification after an empty baseline -> change', detect(n(1, 'upload'))?.id === 1);
}

console.log('event');
{
  const target = new EventTarget();
  const seen = [];
  const off = onDataChanged((d) => seen.push(d), target);
  emitDataChanged({ kind: 'upload', id: 3 }, target);
  check('handler receives the detail', seen.length === 1 && seen[0].id === 3);
  off();
  emitDataChanged({ kind: 'upload', id: 4 }, target);
  check('unsubscribe works', seen.length === 1);
  check('event name', DATA_CHANGED_EVENT === 'dfs:data-changed');
  check('no target -> no crash', (() => { emitDataChanged({}, null); onDataChanged(() => {}, null)(); return true; })());
}

console.log('toast text');
check('forecast', describeChange({ kind: 'forecast', status: 'ready' }).text === 'Dashboard updated — new forecast available');
check('scheduled forecast', describeChange({ kind: 'forecast', status: 'completed' }).text === 'Dashboard updated — new forecast available');
check('upload', describeChange({ kind: 'upload' }).text === 'Dashboard updated — upload finished');
check('training finished', describeChange({ kind: 'training', status: 'completed' }).text === 'Dashboard updated — training finished');
check('training started is not called finished', describeChange({ kind: 'training', status: 'started' }).text === 'Dashboard updated — training started');
check('training failed', describeChange({ kind: 'training', status: 'failed' }).failed === true);
check('upload failed', describeChange({ kind: 'upload_failed' }).text === 'Dashboard updated — an upload failed');

console.log('');
if (failures.length) { console.log(`FAILED: ${failures.length}: ${JSON.stringify(failures)}`); process.exit(1); }
console.log('All appEvents checks passed.');
