#!/usr/bin/env node
// scripts/verify.mjs — regression check for the DFS repo (no repo writes).
// CI runs: node scripts/verify.mjs --compare .github/test-baseline.json --quick
//   node verify.mjs --save baseline.json [--quick]   before the patch
//   node verify.mjs --compare baseline.json          after the patch
// Runs backend tests, frontend tests, the frontend build and (unless
// --quick) ml-service pytest, in parallel. Output: ~15 lines. Full logs go
// to <os temp>/dfs-verify/, never the repo.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const quick = args.includes('--quick');
const root = resolve(opt('--root') || process.cwd());
const logDir = join(tmpdir(), 'dfs-verify');
mkdirSync(logDir, { recursive: true });

function run(name, cmd, cmdArgs, cwd) {
  return new Promise((done) => {
    const started = Date.now();
    let out = '';
    let child;
    try { child = spawn(cmd, cmdArgs, { cwd, shell: false, env: { ...process.env, CI: '1' } }); }
    catch (e) { return done({ name, code: -1, out: String(e), secs: 0 }); }
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => { out += String(e); });
    child.on('close', (code) => {
      writeFileSync(join(logDir, `${name}.log`), out);
      done({ name, code, out, secs: Math.round((Date.now() - started) / 1000) });
    });
  });
}

const nodeTests = (dir) => run(`${dir}-tests`, process.execPath, ['--test', 'tests/*.test.js', 'tests/*.test.mjs'], join(root, dir));
const jobs = [
  nodeTests('backend'),
  run('frontend-tests', process.execPath, ['--test', 'tests/*.test.mjs'], join(root, 'frontend')),
  run('frontend-build', process.execPath, [join(root, 'frontend/node_modules/vite/bin/vite.js'), 'build', '--outDir', join(logDir, 'dist'), '--emptyOutDir'], join(root, 'frontend')),
];
// ml-service tests are plain Python scripts (ml-service/tests/README.md), not
// pytest: run each tests/test_*.py on its own; a file that exits non-zero
// counts as one failure, named by its file.
async function mlTests() {
  const dir = join(root, 'ml-service');
  const files = readdirSync(join(dir, 'tests')).filter((f) => /^test_.*\.py$/.test(f)).sort();
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const started = Date.now();
  let out = '';
  const failed = [];
  for (const f of files) {
    const r = await run(`ml-${f}`, py, [join('tests', f)], dir);
    out += `\n=== ${f}\n${r.out}`;
    if (r.code !== 0) failed.push(`tests/${f}`);
  }
  writeFileSync(join(logDir, 'ml-tests.log'), out);
  return { name: 'ml-tests', code: failed.length ? 1 : 0, out, secs: Math.round((Date.now() - started) / 1000), ml: { failed, total: files.length } };
}
if (!quick) jobs.push(mlTests());

const results = await Promise.all(jobs);
const summary = {};
for (const r of results) {
  // Windows prints test paths with backslashes (TAP escapes them as \\):
  // one name per test on every OS, so a baseline made on Linux compares.
  const sameName = (name) => name.trim().replace(/\\+/g, '/');
  const failed = r.ml ? r.ml.failed : [...r.out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => sameName(m[1]));
  const pass = (r.out.match(/^# pass (\d+)/m) || [])[1];
  const total = (r.out.match(/^# tests (\d+)/m) || [])[1];
  const pyFail = [...r.out.matchAll(/^FAILED (\S+)/gm)].map((m) => m[1]);
  const pySum = (r.out.match(/(\d+) passed/) || [])[1];
  summary[r.name] = r.ml
    ? { code: r.code, failed, pass: r.ml.total - failed.length, total: r.ml.total, secs: r.secs }
    : { code: r.code, failed: failed.length ? failed : pyFail, pass: pass ?? pySum ?? null, total: total ?? null, secs: r.secs };
  const line = r.name === 'frontend-build'
    ? `${r.name.padEnd(15)} ${r.code === 0 ? 'ok' : 'FAILED'} (${r.secs}s)`
    : `${r.name.padEnd(15)} ${summary[r.name].pass ?? '?'}/${summary[r.name].total ?? '?'} passed, ${summary[r.name].failed.length} failing (${r.secs}s)`;
  console.log(line);
  for (const f of summary[r.name].failed) console.log(`   - ${f}`);
}

const save = opt('--save');
if (save) { writeFileSync(save, JSON.stringify(summary, null, 2)); console.log(`saved baseline -> ${save}`); }
const compare = opt('--compare');
if (compare) {
  if (!existsSync(compare)) { console.log(`REGRESSION: cannot compare, ${compare} not found`); process.exit(2); }
  const base = JSON.parse(readFileSync(compare, 'utf8'));
  const regressions = [];
  for (const [name, now] of Object.entries(summary)) {
    const before = base[name];
    if (!before) continue;
    const known = new Set((before.failed || []).map((f) => f.replace(/\\+/g, '/')));
    for (const f of now.failed) if (!known.has(f)) regressions.push(`${name}: ${f}`);
    if (name === 'frontend-build' && before.code === 0 && now.code !== 0) regressions.push('frontend-build: build now fails');
  }
  console.log(`REGRESSION: ${regressions.length ? regressions.join('; ') : 'none'}`);
  const fixed = Object.entries(summary).flatMap(([name, now]) => (base[name]?.failed || []).map((f) => f.replace(/\\+/g, '/')).filter((f) => !now.failed.includes(f)).map((f) => `${name}: ${f}`));
  if (fixed.length) console.log(`NOW PASSING: ${fixed.join('; ')}`);
  console.log(`logs: ${logDir}`);
  process.exit(regressions.length ? 1 : 0);
}
console.log(`logs: ${logDir}`);
