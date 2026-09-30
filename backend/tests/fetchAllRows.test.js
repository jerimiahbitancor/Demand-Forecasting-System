// Tests utils/fetchAllRows.js against a FAKE Supabase query that enforces a
// row cap, the way the real project does (Max rows = 1,000, kept on purpose
// as a safety limit).
//
// Why this matters: a plain Supabase query that matches more than 1,000 rows
// does NOT fail. It silently returns the first 1,000. daily_sales already
// holds well over that, so the unpaged queries this helper replaced were
// already returning truncated data.
//
// Run:  cd backend && node tests/fetchAllRows.test.js
// No network, no Supabase, no credentials.

const assert = require('assert');
const { fetchAllRows } = require('../utils/fetchAllRows');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}  ${detail}`);
    failures.push(label);
  }
}

// Mimics the bits of a supabase-js query that fetchAllRows uses. PostgREST
// returns at most maxRows even when a wider range is requested, and a range
// past the end returns an empty array rather than an error.
function makeBuilder(rows, maxRows, calls, errorOnCall = -1) {
  return () => ({
    range(start, end) {
      calls.push([start, end]);
      if (calls.length - 1 === errorOnCall) {
        return Promise.resolve({ data: null, error: { message: 'simulated failure' } });
      }
      const window = rows.slice(start, end + 1).slice(0, maxRows);
      return Promise.resolve({ data: window, error: null });
    },
  });
}

(async () => {
  console.log('fetchAllRows.test.js');

  const rows = Array.from({ length: 2500 }, (_, i) => ({ i }));

  // --- 1. More rows than the cap ---
  let calls = [];
  let { data, error } = await fetchAllRows(makeBuilder(rows, 1000, calls));
  check('2500 rows with a 1000 cap returns all 2500', data.length === 2500, `got ${data && data.length}`);
  check('no error', error === null);
  check('order preserved, no duplicates', data.every((r, idx) => r.i === idx));
  check('3 full pages + 1 empty page = 4 requests', calls.length === 4, `got ${calls.length}`);

  // --- 2. Exactly one full page still needs a second request ---
  calls = [];
  ({ data } = await fetchAllRows(makeBuilder(rows.slice(0, 1000), 1000, calls)));
  check('exactly 1000 rows returns 1000', data.length === 1000, `got ${data.length}`);
  check('exactly 1000 rows needs 2 requests', calls.length === 2, `got ${calls.length}`);

  // --- 3. Cap lowered to 500: the reason we stop on empty, not short ---
  calls = [];
  ({ data } = await fetchAllRows(makeBuilder(rows, 500, calls)));
  check('2500 rows still all read when the cap is 500', data.length === 2500, `got ${data.length}`);
  check('no duplicates with the lower cap', new Set(data.map((r) => r.i)).size === 2500);

  // --- 4. Empty table ---
  calls = [];
  ({ data } = await fetchAllRows(makeBuilder([], 1000, calls)));
  check('empty table returns []', Array.isArray(data) && data.length === 0);
  check('empty table makes exactly 1 request', calls.length === 1, `got ${calls.length}`);

  // --- 5. An error on a later page must surface, not be swallowed ---
  calls = [];
  ({ data, error } = await fetchAllRows(makeBuilder(rows, 1000, calls, 1)));
  check('error on page 2 is returned', error !== null && error.message === 'simulated failure');
  check('error path returns data: null', data === null);

  console.log();
  if (failures.length) {
    console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
    process.exit(1);
  }
  console.log('All fetchAllRows checks passed.');
})().catch((err) => {
  console.error('Unexpected throw:', err);
  process.exit(1);
});
