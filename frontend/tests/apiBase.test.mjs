// Tests config/resolveApiBase.js: a deployed build must never silently
// fall back to localhost.
//
// Plain Node, no test runner:
//   cd frontend && node tests/apiBase.test.mjs

const { resolveApiBase, DEV_FALLBACK_API_URL, MISSING_API_URL_MESSAGE } = await import('../src/config/resolveApiBase.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

const PROD_URL = 'https://api.example.up.railway.app/api';

{
  const r = resolveApiBase({ DEV: false, VITE_API_URL: PROD_URL });
  check('production with VITE_API_URL -> uses it', r.url === PROD_URL && r.error === null, JSON.stringify(r));
}
{
  const r = resolveApiBase({ DEV: true, VITE_API_URL: PROD_URL });
  check('development with VITE_API_URL -> uses it (not localhost)', r.url === PROD_URL);
}
{
  const r = resolveApiBase({ DEV: true });
  check('development without VITE_API_URL -> localhost', r.url === DEV_FALLBACK_API_URL && r.error === null);
  check('the dev fallback is http://localhost:5000/api', DEV_FALLBACK_API_URL === 'http://localhost:5000/api');
}
{
  const r = resolveApiBase({ DEV: false });
  check('production without VITE_API_URL -> NO url', r.url === null, JSON.stringify(r));
  check('production without VITE_API_URL -> clear error', r.error === MISSING_API_URL_MESSAGE);
  check('the message tells the owner what to do',
    MISSING_API_URL_MESSAGE === 'VITE_API_URL is not set for this build — set it in Vercel for this environment and redeploy');
}
{
  const r = resolveApiBase({ DEV: false, VITE_API_URL: '   ' });
  check('blank VITE_API_URL counts as missing', r.url === null && r.error !== null);
}
{
  const r = resolveApiBase({ DEV: false, VITE_API_URL: '  https://x.app/api  ' });
  check('surrounding spaces are trimmed', r.url === 'https://x.app/api');
}
{
  const r = resolveApiBase({ DEV: 'true', VITE_API_URL: undefined });
  check('only DEV === true allows the localhost fallback', r.url === null);
}
check('no arguments -> treated as a deployed build with no URL', resolveApiBase().url === null);

console.log('');
if (failures.length) { console.log(`FAILED: ${failures.length}: ${JSON.stringify(failures)}`); process.exit(1); }
console.log('All apiBase checks passed.');
