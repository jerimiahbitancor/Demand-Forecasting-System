// backend/tests/dailyPriceIndex.test.js
//
// Runs the DA "Daily Price Index" parser against the real text pdf.js extracts
// from a published sheet (fixtures/dailyPriceIndex.ncr.txt — the October 8,
// 2026 NCR "Daily Price Index" PDF, one visual line per LF).
//
// Run:  cd backend && node tests/dailyPriceIndex.test.js
// No network, no Supabase, no credentials, no PDF library.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  isDailyPriceIndex,
  parseDailyPriceIndex,
} = require('../utils/dailyPriceIndex');

const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'dailyPriceIndex.ncr.txt'),
  'utf8'
);

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

// ---- detection -------------------------------------------------------------
check('detects the DA Daily Price Index sheet', isDailyPriceIndex(fixture) === true);
check(
  'does not mistake a grocery receipt for a DA sheet',
  isDailyPriceIndex('ONION 89.50\nPORK 240.00 - 280.00') === false
);

// ---- parse -----------------------------------------------------------------
const { records, skipped } = parseDailyPriceIndex(fixture);
const priced = records.filter((r) => r.price !== null);
const has = (name, price) => records.some((r) => r.name === name && r.price === price);

check('extracts every priced commodity', priced.length === 155, `got ${priced.length}`);
check('counts the n/a commodities', skipped === 49, `got ${skipped}`);
check('keeps n/a commodities out of the priced set', records.length === priced.length + skipped);

// ---- the awkward layouts that motivated a dedicated parser -----------------
const cases = [
  ['Basmati Rice', 170],
  ['Well Milled 1-19% bran streak', 48.44], // percent sign survived
  ['Mango (Carabao) Ripe, 3-4 pcs/kg', 254.85], // parentheses + range
  ['Chicken Egg (White, Medium) 56-60 grams/pc', 8.23], // numeric spec, not price
  ['Chicken Breast, Local Magnolia', 222.89], // brand specification
  ['Pork Picnic Shoulder (Kasim) Local', 312.75], // standalone price, tail below
  ['Tambakol (Yellow-Fin Tuna), Medium, Fresh or Chilled Local', 280.78], // wrapped name + tail
  ['Cooking Oil (Palm Olein, Jolly 1 Liter/bottle Brand)', 160.89], // wrapped, last row
];
for (const [name, price] of cases) {
  check(`"${name}" -> ${price}`, has(name, price));
}

// Price-before-name ("n/a" printed above its commodity) keeps the association.
check('"Duck Meat, Imported" keeps its n/a', has('Duck Meat, Imported', null));
check('"Peckin Duck, Local" keeps its n/a', has('Peckin Duck, Local', null));
check('"Local" was not glued onto the next commodity', has('Local Duck Meat, Imported', null) === false);

// ---- noise never becomes a commodity ---------------------------------------
const noisy = /^(?:page\s+\d|covered|note|murphy|agora|alabang|salt and sugar|eggs:|cooking oil:)/i;
check(
  'preamble, page footers, notes and the market list are excluded',
  records.every((r) => !noisy.test(r.name)),
  records.find((r) => noisy.test(r.name))?.name || ''
);
check('the fixture title is not a commodity', has('DAILY PRICE INDEX', 0) === false && records.every((r) => r.name !== 'DAILY PRICE INDEX'));

// ---- empty / non-DA input is safe ------------------------------------------
check('empty text yields no records', parseDailyPriceIndex('').records.length === 0);

if (failures.length) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll Daily Price Index checks passed');
