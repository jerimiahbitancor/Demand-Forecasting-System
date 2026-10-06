// tests/serviceExports.test.js — run: node --test tests/serviceExports.test.js
//
// Catches the bug class behind the Oct 2026 Ingredient Management 500:
// a controller called `analyticsService.getMappedIngredientIds()`, the
// function existed in the service file, but `module.exports` did not list
// it, so every request failed with "... is not a function". Nothing caught
// it until a user opened the page.
//
// For every file in controllers/ and routes/, this finds each service it
// requires and checks the names it uses really are exported functions:
//   const svc = require('../services/x');   ->  every `svc.name(` call
//   const { a, b } = require('../services/x');  ->  `a` and `b`
//
// Services are loaded with a fake Supabase config, so no network is used.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const SCAN_DIRS = ['controllers', 'routes'];

// ---- load services without touching a real database ----
const fakeClient = { from: () => { throw new Error('fake client: no DB in this test'); } };
const configPath = require.resolve(path.join(BACKEND, 'config', 'supabase.js'));
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { supabase: fakeClient, supabaseAdmin: fakeClient, isConfigured: false },
};

// Removes block comments and whole-line `//` comments, so names mentioned in
// comments are not mistaken for calls. (Kept simple on purpose: it does not
// touch `//` inside a line, which avoids breaking URLs in strings.)
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const ALIAS_REQUIRE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.\.\/services\/[^'"]+)['"]\s*\)/g;
const DESTRUCTURED_REQUIRE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"](\.\.\/services\/[^'"]+)['"]\s*\)/g;

// Returns [{ file, servicePath, name, how }] for every service member used.
function collectUsages() {
  const usages = [];
  for (const dir of SCAN_DIRS) {
    const absDir = path.join(BACKEND, dir);
    for (const fileName of fs.readdirSync(absDir).filter((f) => f.endsWith('.js'))) {
      const file = `${dir}/${fileName}`;
      const source = stripComments(fs.readFileSync(path.join(absDir, fileName), 'utf8'));
      const resolveService = (rel) => require.resolve(path.join(absDir, rel));

      for (const m of source.matchAll(ALIAS_REQUIRE)) {
        const [, alias, rel] = m;
        const servicePath = resolveService(rel);
        const callRe = new RegExp(`(?<![\\w$.])${alias.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
        const names = new Set([...source.matchAll(callRe)].map((c) => c[1]));
        for (const name of names) usages.push({ file, servicePath, name, how: `${alias}.${name}(` });
      }

      for (const m of source.matchAll(DESTRUCTURED_REQUIRE)) {
        const [, list, rel] = m;
        const servicePath = resolveService(rel);
        for (const part of list.split(',')) {
          const key = part.split(':')[0].trim();
          if (key) usages.push({ file, servicePath, name: key, how: `{ ${key} } = require(...)` });
        }
      }
    }
  }
  return usages;
}

const usages = collectUsages();

// Known missing exports, found by this test and left for an owner decision.
// Each entry must STILL be missing (the last test checks), so fixing one
// without removing it here fails loudly. Do not add entries to hide a bug.
//
// OTP_EXPIRATION_MINUTES (found Oct 6 2026): otpService.js defines it (= 1)
// but does not export it. Effect: in routes/auth.js /create-password,
// `timeDiff > OTP_EXPIRATION_MINUTES` compares against undefined and is
// always false, so the "OTP verified too long ago" check never fires.
// Exporting it would switch on a 1-minute window between OTP verification
// and password creation — a behavior change to registration, so not fixed
// here. (passwordResetController.js imports it but never uses it.)
const KNOWN_MISSING = new Set([
  'controllers/passwordResetController.js|OTP_EXPIRATION_MINUTES',
  'routes/auth.js|OTP_EXPIRATION_MINUTES',
]);
const keyOf = (usage) => `${usage.file}|${usage.name}`;

// A constant (e.g. OTP_EXPIRATION_MINUTES) is a valid export but not a
// function; only names that are called with `(` must be functions.
function checkUsage(usage) {
  const mod = require(usage.servicePath);
  if (!(usage.name in Object(mod))) return 'not exported';
  const value = mod[usage.name];
  const calledAsFunction = usage.how.endsWith('(');
  if (calledAsFunction && typeof value !== 'function') return `exported, but is ${typeof value}, not a function`;
  return null;
}

test('the scanner finds service usages (guards against a silently empty scan)', () => {
  assert.ok(usages.length > 20, `only ${usages.length} usages found`);
  const known = usages.find((u) => u.file === 'controllers/inventoryController.js'
    && u.name === 'getMappedIngredientIds');
  assert.ok(known, 'inventoryController -> analyticsService.getMappedIngredientIds() must be found');
});

test('every service member used by controllers/ and routes/ is exported', () => {
  const problems = [];
  for (const usage of usages) {
    if (KNOWN_MISSING.has(keyOf(usage))) continue;
    const problem = checkUsage(usage);
    if (problem) {
      problems.push(`${usage.file}: ${usage.how} -> ${path.relative(BACKEND, usage.servicePath)}: ${problem}`);
    }
  }
  assert.deepEqual(problems, [], `Missing service exports:\n  ${problems.join('\n  ')}`);
});

test('every KNOWN_MISSING entry is still really missing (remove it once fixed)', () => {
  for (const key of KNOWN_MISSING) {
    const usage = usages.find((u) => keyOf(u) === key);
    assert.ok(usage, `${key} is no longer used; remove it from KNOWN_MISSING`);
    assert.ok(checkUsage(usage), `${key} is exported now; remove it from KNOWN_MISSING`);
  }
});
