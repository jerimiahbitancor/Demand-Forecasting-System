// REGRESSION GUARD for the owner's Oct 26 2026 concern list (frontend side).
// Codes: G = general, F = Forecast, PP = Product Performance, ID =
// Ingredient Demand. Ask the owner before changing a check.
//   cd frontend && node tests/concernsOct26.regression.test.mjs
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const forecasting = read('features/analytics/components/Forecasting.jsx');
const forecastingCss = read('features/analytics/components/Forecasting.css');
const perf = read('features/analytics/components/ProductPerformance.jsx');
const demand = read('features/analytics/components/IngredientDemand.jsx');
const report = read('services/reportService.js');
const { fmt2, peso } = await import('../src/utils/formatNumber.js');
const { formatIngredientDemandQty, formatIngredientDemandMoney } = await import('../src/utils/formatIngredientDemand.js');

const failures = [];
function check(label, condition) {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}`); failures.push(label); }
}
console.log('concernsOct26.regression.test.mjs');

// General
check('G1: tooltips state the current formulas', demand.includes('Raw Forecast + Safety Buffer') && perf.includes('Store avg / day') && !perf.includes('Unmapped Products'));
check('G2: 9.00 shows 9, 9.5 shows 9.50', fmt2(9) === '9' && fmt2('9.00') === '9' && fmt2(9.5) === '9.50' && fmt2(1234.5) === '1,234.50');
check('G2: money and quantities follow it', peso(9) === '₱9' && formatIngredientDemandMoney(115.5) === '₱115.50' && formatIngredientDemandQty(9, 'Kilograms (kg)') === '9 kg');
check('G3: every report reads the business profile', (report.match(/business = await resolveReportBusiness\(business\);/g) || []).length >= 5 && report.includes('business_address') && report.includes('business_contact_number'));

// Forecast
check('F1: no sort dropdown; header sorting stays', !forecasting.includes('aria-label="Sort the table"') && forecasting.includes('th-sort-btn'));
check('F1: the table pans sideways with room per column', forecastingCss.includes('.forecast-table') && /min-width: 960px/.test(forecastingCss));
check('F2: totals row keeps the ₱ font (set after bold)', /fontStyle = 'bold';[\s\S]{0,200}?\}\s*pesoCell\(data\);/.test(report));

// Product Performance
check('PP2: demand level filter', perf.includes('DEMAND_FILTERS') && perf.includes('demandLevelSelect'));
check('PP3: ratio breakdown shown', perf.includes('How the ratio is calculated') && perf.includes('ratioMath('));
check('PP4: report summary is built from the data (no example names)', !perf.includes('newProducts[0]?.product') && !perf.includes('inactiveProducts[0]?.product') && perf.includes('ratioTable:'));
check('PP5: Excel ratio sheet has the breakdown columns', perf.includes('"Avg / Day"') && perf.includes('"Store Avg / Day"') && perf.includes('"Open Days"'));

// Ingredient Demand
check('ID2: daily status and weekly level filters', demand.includes('dailyFilterSelect') && demand.includes('weeklyFilterSelect'));
check('ID3: no View Full List button', !demand.includes('View Full List'));
check('ID4: grocery list shows Need and On Stock next to Qty to Buy', demand.includes("Week's Need") && demand.includes('data-label="On Stock"><Qty value={item.onStock}'));
check('ID5: report cards shrink long names to fit', report.includes('getTextWidth(raw) > maxWidth'));
check('ID6: report includes the weekly ingredient demand', demand.includes('weeklyTable:') && report.includes('weeklyTable.rows'));
check('ID7: previous / next day buttons', demand.includes('aria-label="Previous day"') && demand.includes('aria-label="Next day"'));

// Forecast start date (redemonstration, Oct 26 2026)
check('F5: Generate Forecast can start after the latest sales (accuracy test), not only today', forecasting.includes('html: FORECAST_START_DIALOG_HTML') && forecasting.includes('confirmation.value') && !forecasting.includes('{ horizonDays: 7 },\n'));

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All Oct 26 concern checks passed.');
