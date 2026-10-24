// Tests the upload-summary helpers (features/datamanagement/utils/uploadSummary.js):
// merging the per-file summaries of a multi-file sales upload, and reading
// the per-cell errors of a rejected file.
//
// Plain Node (the frontend has no test runner):
//   cd frontend && node tests/uploadSummary.test.mjs

const {
  mergeUploadSummaries, hasSummaryContent, collectCellErrors, collectStockRefusals, formatPlates, emptySummary,
} = await import('../src/features/datamanagement/utils/uploadSummary.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('uploadSummary.test.mjs');

const day1 = {
  modifierProducts: [{ productId: 1, name: 'Marinated Porksilog', plates: { 'NO EGG': 3, 'NO RICE': 1 } }],
  sizeProducts: [{ productId: 2, name: 'Pansit Bihon Small' }],
  newProducts: [{ productId: 9, name: 'Cheesy Spicy Hunggarian' }],
  unmatchedNames: ['Ghost Dish'],
  aliasMatches: [{ alias: 'OG Tapsilog', productId: 3, productName: 'Original Tapsilog' }],
  possibleDuplicates: [{ newProduct: { id: 9, name: 'Cheesy Spicy Hunggarian' }, looksLike: { id: 4, name: 'Cheesy Spicy Hungarian' }, reason: 'typo' }],
  shortfalls: [{ ingredientId: 101, ingredient: 'Egg', shortfall: 2, message: 'Egg: 4 pcs used but 2 pcs in stock. Please monitor it.' }],
};
const day2 = {
  modifierProducts: [{ productId: 1, name: 'Marinated Porksilog', plates: { 'NO EGG': 2 } }],
  sizeProducts: [{ productId: 2, name: 'Pansit Bihon Small' }],
  newProducts: [{ productId: 9, name: 'Cheesy  Spicy Hunggarian' }],
  unmatchedNames: ['ghost dish', 'Other'],
  aliasMatches: [{ alias: 'og tapsilog', productId: 3, productName: 'Original Tapsilog' }],
  possibleDuplicates: [{ newProduct: { id: 9, name: 'Cheesy Spicy Hunggarian' }, looksLike: { id: 4, name: 'Cheesy Spicy Hungarian' }, reason: 'typo' }],
  shortfalls: [{ ingredientId: 101, ingredient: 'Egg', shortfall: 5, message: 'Egg: 5 pcs used but 0 pcs in stock. Please monitor it.' }],
};

const merged = mergeUploadSummaries([day1, null, day2]);
check('modifier plates are added up per keyword', same(merged.modifierProducts, [{ productId: 1, name: 'Marinated Porksilog', plates: { 'NO EGG': 5, 'NO RICE': 1 } }]), JSON.stringify(merged.modifierProducts));
check('size products listed once', merged.sizeProducts.length === 1);
check('new products de-duplicated by name (spacing and case ignored)', merged.newProducts.length === 1);
check('unmatched names de-duplicated', same(merged.unmatchedNames, ['Ghost Dish', 'Other']), JSON.stringify(merged.unmatchedNames));
check('alias matches listed once', merged.aliasMatches.length === 1 && merged.aliasMatches[0].productName === 'Original Tapsilog');
check('possible duplicates listed once', merged.possibleDuplicates.length === 1);
check('shortfalls grouped per ingredient: total and file count',
  same(merged.shortfalls, [{ ingredientId: 101, ingredient: 'Egg', shortfall: 7, files: 2, message: 'Egg: 5 pcs used but 0 pcs in stock. Please monitor it.' }]),
  JSON.stringify(merged.shortfalls));
check('hasSummaryContent: true with content', hasSummaryContent(merged));
{
  const merged = mergeUploadSummaries([
    { stockNotDeducted: [{ ingredientId: 1, ingredient: 'Rice', reason: 'counted_after', days: ['2026-10-10'], message: 'a' }], followUpErrors: ['boom'] },
    { stockNotDeducted: [{ ingredientId: 1, ingredient: 'Rice', reason: 'counted_after', days: ['2026-10-09'], message: 'b' }], followUpErrors: ['boom'] },
  ]);
  check('not-deducted ingredients merge per ingredient and reason, days combined',
    merged.stockNotDeducted.length === 1 && same(merged.stockNotDeducted[0].days, ['2026-10-09', '2026-10-10']));
  check('follow-up errors are de-duplicated', same(merged.followUpErrors, ['boom']));
  check('a not-deducted ingredient alone is content worth showing', hasSummaryContent(merged));
}
check('hasSummaryContent: false for an empty summary', !hasSummaryContent(emptySummary()) && !hasSummaryContent(null));
check('merging nothing gives the empty shape', same(mergeUploadSummaries([]), emptySummary()));

const cells = collectCellErrors('day-1.csv', {
  success: false,
  errors: [
    { row: 3, column: 'Items sold', message: 'Items sold is empty' },
    { row: 7, column: 'Net sales', message: 'Net sales must be a valid number' },
    'junk',
  ],
});
check('per-cell errors: file, row, column, message', same(cells, [
  { file: 'day-1.csv', row: 3, column: 'Items sold', message: 'Items sold is empty' },
  { file: 'day-1.csv', row: 7, column: 'Net sales', message: 'Net sales must be a valid number' },
]), JSON.stringify(cells));
check('no errors array -> []', same(collectCellErrors('x.csv', { error: 'Duplicate upload' }), []) && same(collectCellErrors('x.csv', undefined), []));
check('formatPlates', formatPlates({ 'NO RICE': 1, 'NO EGG': 5 }) === 'NO EGG 5, NO RICE 1');

// 422 "Not enough stock" (migration 017): one row per short ingredient.
const refusals = collectStockRefusals('day-2.csv', {
  success: false,
  insufficientStock: true,
  shortfalls: [
    { ingredientId: 40, name: 'Rice', unit: 'Kilograms (kg)', required: '2', available: '1', shortfall: '1' },
    null,
  ],
});
check('stock refusals: file, ingredient, amounts as sent', same(refusals, [
  { file: 'day-2.csv', ingredientId: 40, ingredient: 'Rice', unit: 'Kilograms (kg)', required: '2', available: '1', shortfall: '1' },
]), JSON.stringify(refusals));
check('stock refusals: only for an insufficientStock response',
  same(collectStockRefusals('x.csv', { duplicate: true, shortfalls: [{ name: 'Rice' }] }), [])
  && same(collectStockRefusals('x.csv', undefined), []));

console.log();
if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All upload summary checks passed.');
