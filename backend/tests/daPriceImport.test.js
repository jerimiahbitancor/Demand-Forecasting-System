// backend/tests/daPriceImport.test.js
//
// Pure-logic tests for services/daPriceImportService.js. The scheduled run
// itself needs network + Supabase, so everything testable without either is
// pinned here: sheet-date parsing from filenames, candidate-link extraction
// from the monitoring page HTML, newest-link selection, the PH-dated fallback
// URL guesses, and the DA-name -> ingredient matching confidence bar.
//
// Run: node tests/daPriceImport.test.js
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const {
  AUTOSAVE_CONFIDENCE,
  parseSheetDateFromFilename,
  parseSheetDateFromText,
  extractPriceIndexCandidates,
  selectLatestPriceIndexLink,
  guessedUrlsFor,
  findConfidentIngredient,
  aggregateDailyRows,
} = require('../services/daPriceImportService');
const { isDailyPriceIndex, parseDailyPriceIndex } = require('../utils/dailyPriceIndex');

const FIXTURE = path.join(__dirname, 'fixtures', 'dailyPriceIndex.ncr.txt');

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`  ok — ${name}`);
};

(function testSheetDateFromFilename() {
  console.log('\nparseSheetDateFromFilename');
  assert.strictEqual(parseSheetDateFromFilename('Daily-Price-Index-October-8-2026.pdf'), '2026-10-08');
  ok('canonical NCR filename');
  assert.strictEqual(parseSheetDateFromFilename('Revised-Daily-Price-Index-April-16-2026.pdf'), '2026-04-16');
  ok('Revised- variant');
  assert.strictEqual(parseSheetDateFromFilename('September-18-2026-DPI-AFC.pdf'), '2026-09-18');
  ok('DPI-AFC naming');
  assert.strictEqual(parseSheetDateFromFilename('Daily-Price-Index-October-1-2026-1.pdf'), '2026-10-01');
  ok('WordPress -1 dedup suffix');
  assert.strictEqual(parseSheetDateFromFilename('https://www.da.gov.ph/wp-content/uploads/2026/10/Daily-Price-Index-October-8-2026.pdf'), '2026-10-08');
  ok('full URL');
  assert.strictEqual(parseSheetDateFromFilename('README.txt'), null);
  ok('non-date filename -> null');
})();

(function testSheetDateFromText() {
  console.log('\nparseSheetDateFromText');
  assert.strictEqual(parseSheetDateFromText('Released: October 8, 2026'), '2026-10-08');
  ok('phrase with comma');
  assert.strictEqual(parseSheetDateFromText('(Thursday, October 8 2026)'), '2026-10-08');
  ok('no comma between day and year');
  assert.strictEqual(parseSheetDateFromText('no date here'), null);
  ok('no date -> null');
})();

(function testExtractCandidates() {
  console.log('\nextractPriceIndexCandidates');
  const html = `
    <a href="https://www.da.gov.ph/wp-content/uploads/2026/10/Daily-Price-Index-October-8-2026.pdf">dpi</a>
    <a href="https://www.da.gov.ph/wp-content/uploads/2026/10/Revised-Daily-Price-Index-October-7-2026.pdf">rev</a>
    <a href="https://www.da.gov.ph/wp-content/uploads/2026/09/September-18-2026-DPI-AFC.pdf">afc</a>
    <a href="https://www.da.gov.ph/wp-content/uploads/2026/10/Daily-Cigarette-Price-Monitoring-October-8-2026.pdf">cig</a>
    <a href="https://www.da.gov.ph/wp-content/uploads/2026/10/Weekly-Average-Prices-September-28-October-4-2026.pdf">week</a>
    <a href="https://www.da.gov.ph/wp-content/uploads/2026/10/Price-Monitoring-October-8-2026.pdf">monitor</a>`;
  const candidates = extractPriceIndexCandidates(html);
  assert.strictEqual(candidates.length, 3, 'only the three price-index sheets');
  ok('cigarette / weekly / plain price-monitoring sheets are filtered out');
  const dates = candidates.map((c) => c.date).sort();
  assert.deepStrictEqual(dates, ['2026-09-18', '2026-10-07', '2026-10-08']);
  ok('dates parsed');
})();

(function testSelectLatestLink() {
  console.log('\nselectLatestPriceIndexLink');
  const now = new Date('2026-10-09T00:00:00Z');
  const c = (date, name) => ({ url: `https://x/${name}.pdf`, name, date });

  const newest = selectLatestPriceIndexLink(
    [c('2026-10-05', 'Daily-Price-Index-October-5-2026'), c('2026-10-08', 'Daily-Price-Index-October-8-2026')],
    { now }
  );
  assert.strictEqual(newest.url, 'https://x/Daily-Price-Index-October-8-2026.pdf');
  ok('newest date wins');

  const revised = selectLatestPriceIndexLink(
    [c('2026-10-08', 'Daily-Price-Index-October-8-2026'), c('2026-10-08', 'Revised-Daily-Price-Index-October-8-2026')],
    { now }
  );
  assert.strictEqual(newest.name.includes('Revised'), false);
  assert.strictEqual(revised.name.startsWith('Revised'), true);
  ok('same-date tie prefers the revised correction');

  const none = selectLatestPriceIndexLink([c('2028-01-01', 'Daily-Price-Index-January-1-2028')], { now });
  assert.strictEqual(none, null);
  ok('unreasonably future date is rejected');

  assert.strictEqual(selectLatestPriceIndexLink([]), null);
  ok('empty list -> null');
})();

(function testGuessedUrls() {
  console.log('\nguessedUrlsFor (PH date math, UTC-free)');
  const now = new Date('2026-10-08T20:00:00Z'); // 4:00 AM Oct 9 in Manila
  const guesses = guessedUrlsFor(now);
  assert.strictEqual(guesses.length, 4);
  assert.strictEqual(
    guesses[0],
    'https://www.da.gov.ph/wp-content/uploads/2026/10/Daily-Price-Index-October-9-2026.pdf'
  );
  assert.strictEqual(
    guesses[1],
    'https://www.da.gov.ph/wp-content/uploads/2026/10/Daily-Price-Index-October-8-2026.pdf'
  );
  ok('constructs the canonical {YYYY}/{MM}/Daily-Price-Index-{Month}-{Day}-{YYYY} paths');
})();

(function testFixturePipelineAndConfidence() {
  console.log('\nfixture text -> DA records -> confident ingredient matches');
  const text = fs.readFileSync(FIXTURE, 'utf8');
  assert.strictEqual(isDailyPriceIndex(text), true);

  const { records, skipped } = parseDailyPriceIndex(text);
  const priced = records.filter((r) => r.price !== null);
  assert.ok(priced.length > 100, `expected >100 priced rows, got ${priced.length}`);
  assert.ok(skipped > 0, 'sheet has n/a rows to skip');

  const ingredients = [
    { id: 1, name: 'Rice', unit: 'kg' },
    { id: 2, name: 'Mungbean', unit: 'kg' },
    { id: 3, name: 'Bangus', unit: 'kg' },
    { id: 4, name: 'Corn', unit: 'kg' },
    { id: 5, name: 'Chicken', unit: 'kg' },
    { id: 6, name: 'Chicken Egg', unit: 'pcs' },
    { id: 7, name: 'Pork', unit: 'kg' },
    { id: 8, name: 'Pork Belly', unit: 'kg' },
    { id: 9, name: 'Milkfish', unit: 'kg' },
    { id: 10, name: 'Carrot', unit: 'kg' },
    { id: 11, name: 'Tuna', unit: 'kg' },
    { id: 12, name: 'Brown Sugar', unit: 'kg' },
  ];

  const expectations = [
    // DA sheet commodity -> ingredient (specificity wins: Belly over Pork)
    ['Basmati Rice', 'Rice'],
    ['Glutinous Rice', 'Rice'],
    ['Corn (Yellow) Cob, Sweet Corn', 'Corn'],
    ['Mungbean', 'Mungbean'],
    ['Bangus, Large Large (1-2 pcs)', 'Bangus'],
    ['Chicken Breast, Local Magnolia', 'Chicken'],
    ['Chicken Egg (White, Medium) 56-60 grams/pc', 'Chicken Egg'],
    ['Pork Belly (Liempo), Local', 'Pork Belly'],
    ['Pork Chop, Local', 'Pork'],
    // plural sheet name -> singular inventory name
    ['Carrots, Local 8-10 pcs/kg', 'Carrot'],
    // the common name lives in the DA parenthetical ("... (Yellow-Fin Tuna)")
    ['Tambakol (Yellow-Fin Tuna) Medium (4-6 pcs/kg), Local', 'Tuna'],
    // reordered name; Fuse sees no substring, the token-overlap fallback does
    ['Sugar (Brown)', 'Brown Sugar'],
  ];
  for (const [daName, ingredientName] of expectations) {
    const hit = findConfidentIngredient(daName, ingredients);
    assert.ok(hit, `${daName} must match something`);
    assert.strictEqual(hit.ingredient.name, ingredientName, `${daName} should land on ${ingredientName}`);
    assert.ok(hit.confidence >= AUTOSAVE_CONFIDENCE,
      `${daName} confidence ${hit.confidence.toFixed(3)} must clear ${AUTOSAVE_CONFIDENCE}`);
  }
  ok('DA commodity names clear the auto-save bar and hit the most specific ingredient');

  // Chicken Feet is real chicken meat: an inventory that only knows "Chicken
  // Egg" must NOT receive feet prices, and a name like "Milkfish" must never
  // catch the sheet's mislabeled ginger/lady-finger rows.
  const eggOnly = ingredients.filter((i) => i.name === 'Chicken Egg');
  assert.strictEqual(findConfidentIngredient('Chicken Feet, Local', eggOnly), null);
  assert.strictEqual(findConfidentIngredient('Fresh, Loose, Medium Ginger, Local', ingredients), null);
  assert.strictEqual(findConfidentIngredient('No Such Commodity Here', ingredients), null);
  ok('word containment rejects wrong-category and stray-commodity matches');
})();

(function testAggregateDailyRows() {
  console.log('\naggregateDailyRows (one trend point per ingredient per day)');
  const base = {
    source: 'da_reference',
    unit: 'kg',
    is_manual_entry: false,
    receipt_url: 'https://x/sheet.pdf',
    scraped_at: '2026-10-08T00:00:00',
  };
  const out = aggregateDailyRows([
    { ...base, ingredient_id: 92, price: 170, ocr_confidence: 0.992 },
    { ...base, ingredient_id: 92, price: 60.33, ocr_confidence: 0.992 },
    { ...base, ingredient_id: 92, price: 48.44, ocr_confidence: 0.954 },
    { ...base, ingredient_id: 7, price: 312.75, ocr_confidence: 0.9 },
  ]);

  assert.strictEqual(out.length, 2, 'many commodity matches collapse per ingredient');
  const rice = out.find((r) => r.ingredient_id === 92);
  assert.strictEqual(rice.price, Number(((170 + 60.33 + 48.44) / 3).toFixed(3)));
  assert.strictEqual(rice.ocr_confidence, Number(((0.992 + 0.992 + 0.954) / 3).toFixed(3)));
  assert.strictEqual(out.find((r) => r.ingredient_id === 7).price, 312.75);
  assert.ok(!('_priceSum' in rice) && !('_count' in rice), 'scratch fields stripped');
  ok('per-ingredient mean is the single day over day comparable point');
})();

console.log(`\n${passed} assertion group(s) passed.`);
process.exit(0);