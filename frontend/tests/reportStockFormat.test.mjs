// Grocery PDF quantities use the Ingredient Demand rule (Oct 25 2026):
// strictly 2 decimals, whole pieces, short unit next to the value.
//
// services/reportService.js cannot be imported in plain Node (it pulls in
// jsPDF and a React .jsx context), so this checks its source for the rule,
// and checks the exact values the grocery table will print.
//
// Plain Node, no test runner:
//   cd frontend && node tests/reportStockFormat.test.mjs

import { readFileSync } from 'node:fs';

const { formatStockQty } = await import('../src/utils/formatStockQty.js');
const { formatIngredientDemandQty, formatUnitPrice, estCostFormula } = await import('../src/utils/formatIngredientDemand.js');
const source = readFileSync(new URL('../src/services/reportService.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/features/analytics/components/IngredientDemand.jsx', import.meta.url), 'utf8');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

console.log('reportStockFormat.test.mjs');

check('reportService imports the ingredient demand formatters', source.includes("from '../utils/formatIngredientDemand.js'"));
check('grocery table formats toBuy with formatIngredientDemandQty', source.includes('formatIngredientDemandQty(item.toBuy, item.unit)'));
check('grocery table prints the price with formatUnitPrice', source.includes('formatUnitPrice(item.marketPrice, item.unit)'));
check('forecast PDF has no gross profit column', !source.includes("'Est. gross profit'"));
check('2.3 kg prints 2.30 kg (short unit)', formatIngredientDemandQty(2.3, 'Kilograms (kg)') === '2.30 kg');
check('17.4 pcs prints 17 pcs', formatIngredientDemandQty(17.4, 'Pieces (pcs)') === '17 pcs');
check('price prints per short unit', formatUnitPrice(50, 'Kilograms (kg)') === '₱50/kg');
check('a tiny per-gram price keeps its digits', formatUnitPrice(0.0035, 'Grams (g)') === '₱0.0035/g');
check('est. cost formula reads like the math', estCostFormula(2.31, 'kg', 50, 115.5) === '2.31 kg × ₱50/kg = ₱115.50');
check('no toBuy.toFixed left in reportService', !/toBuy\??\.toFixed/.test(source));
check('IngredientDemand no longer fakes a toFixed for the PDF', !/toFixed:\s*\(\)/.test(page));
check('IngredientDemand no longer borrows units from daily rows', !page.includes('unitByIngredient'));
// Oct 26 2026: the PDF ratio rows are built in ProductPerformance.jsx.
const perfPage = readFileSync(new URL('../src/features/analytics/components/ProductPerformance.jsx', import.meta.url), 'utf8');
check('null ratio prints a dash, not a crash', perfPage.includes('r.ratio == null ? "—" : fmt2(r.ratio)'));

// What the grocery PDF prints for typical rows.
check('4.0999999999 kg prints 4.1', formatStockQty(4.0999999999, 'kg') === '4.1');
check('12 pcs prints 12', formatStockQty(12, 'pcs') === '12');
check('missing toBuy prints a dash', formatStockQty(null, 'kg') === '—');

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All reportStockFormat checks passed.');
