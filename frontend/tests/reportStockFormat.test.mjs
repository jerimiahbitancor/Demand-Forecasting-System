// Grocery PDF quantities use the shared 3-decimal rule (L5).
//
// services/reportService.js cannot be imported in plain Node (it pulls in
// jsPDF and a React .jsx context), so this checks its source for the rule,
// and checks the exact values the grocery table will print.
//
// Plain Node, no test runner:
//   cd frontend && node tests/reportStockFormat.test.mjs

import { readFileSync } from 'node:fs';

const { formatStockQty } = await import('../src/utils/formatStockQty.js');
const source = readFileSync(new URL('../src/services/reportService.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/features/analytics/components/IngredientDemand.jsx', import.meta.url), 'utf8');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

console.log('reportStockFormat.test.mjs');

check('reportService imports formatStockQty', /import \{ formatStockQty \} from '\.\.\/utils\/formatStockQty\.js'/.test(source));
check('grocery table formats toBuy with formatStockQty', source.includes('formatStockQty(item.toBuy, item.unit)'));
check('no toBuy.toFixed left in reportService', !/toBuy\??\.toFixed/.test(source));
check('IngredientDemand no longer fakes a toFixed for the PDF', !/toFixed:\s*\(\)/.test(page));
check('IngredientDemand no longer borrows units from daily rows', !page.includes('unitByIngredient'));
check('null ratio prints a dash, not a crash', source.includes("row.ratio == null ? '—'"));

// What the grocery PDF prints for typical rows.
check('4.0999999999 kg prints 4.100', formatStockQty(4.0999999999, 'kg') === '4.100');
check('12 pcs prints 12', formatStockQty(12, 'pcs') === '12');
check('missing toBuy prints a dash', formatStockQty(null, 'kg') === '—');

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All reportStockFormat checks passed.');
