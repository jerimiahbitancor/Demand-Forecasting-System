// REGRESSION GUARD for the owner's Oct 25 2026 concern list (frontend side).
// One check per concern, named by its code (F = Forecast, ID = Ingredient
// Demand, IM = Ingredient Management, S = Settings, W = wording). The pages
// cannot be rendered in plain Node, so most checks read the page source for
// the rule; the formatters are run for real.
//   cd frontend && node tests/concernsOct25.regression.test.mjs
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const forecasting = read('features/analytics/components/Forecasting.jsx');
const demand = read('features/analytics/components/IngredientDemand.jsx');
const settings = read('features/settings/components/ForecastConfig.jsx');
const ingredientMgmt = read('features/inventory/pages/IngredientManagement.jsx');
const report = read('services/reportService.js');
const { formatIngredientDemandQty, formatUnitPrice, estCostFormula, formatIngredientDemandMoney } = await import('../src/utils/formatIngredientDemand.js');

const failures = [];
function check(label, condition) {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}`); failures.push(label); }
}
console.log('concernsOct25.regression.test.mjs');

// Forecast
check('F1: a note explains why Actual Qty. or Forecast Qty. shows "—"', forecasting.includes('Why some cells show') && forecasting.includes('Sales for this date are not uploaded yet'));
check('F2: Demand is the default view', /useState\("Demand"\)/.test(forecasting));
check('F4: every data column is sortable', ['date', 'product', 'actualQty', 'forecastQty', 'actualRevenue', 'forecastRevenue', 'estCost'].every((k) => forecasting.includes(`key: "${k}"`)));
check('F4: highest and lowest first both offered', forecasting.includes('highest first') && forecasting.includes('lowest first'));
check('F5: no Gross Profit on the page or in its reports', !/gross profit/i.test(forecasting.replace(/\/\/.*$/gm, '')) && !report.includes("'Est. gross profit'"));
check('F6: the cost hover shows items × COGS', forecasting.includes('COGS per item (Product Management)'));
check('F7: the chart is rebuilt from the searched rows', forecasting.includes('buildSeriesFromRows(searchedRows)') && forecasting.includes('series={chartSeries}'));

// Ingredient Demand
check('ID1: 2 decimals with the short unit', formatIngredientDemandQty(2.3, 'Kilograms (kg)') === '2.30 kg');
check('ID1: pieces are whole numbers', formatIngredientDemandQty(17.6, 'Pieces (pcs)') === '18 pcs');
check('ID2: Safety Buffer column shows its %', demand.includes('Safety Buffer (+{safetyBufferPercentage}%)'));
check('ID3/ID7: value and unit drawn together in one cell', demand.includes('className="qty-unit"') && demand.includes('<Qty value={v} unit={row.unit} />'));
check('ID4: price per unit and cost formula', formatUnitPrice(55, 'Kilograms (kg)') === '₱55.00/kg' && estCostFormula(4.38, 'kg', 55, 240.9) === '4.38 kg × ₱55.00/kg = ₱240.90' && formatIngredientDemandMoney(0) === '₱0.00');
check('ID6: legend uses the Predicted Stock Level Status words only', demand.includes('● Critical Shortage') && !demand.includes('● Critical —') && !demand.includes('● Low —'));
check('ID8: grocery PDF uses the smaller font', /fontSize: 6\.5/.test(report));

// Ingredient Management
check('IM2: the list shows the CURRENT status only', ingredientMgmt.includes("params.statusField = 'current'") && !ingredientMgmt.includes('predicted_stock_status'));

// Settings
check('S1: Settings lists the four Current statuses', ['STATUS_LABELS.out', 'STATUS_LABELS.low', 'STATUS_LABELS.normal', 'STATUS_LABELS.excess'].every((k) => settings.includes(k)));
check('S1: Settings lists the four Forecast statuses', ['PREDICTED_LABELS.critical', 'PREDICTED_LABELS.insufficient', 'PREDICTED_LABELS.sufficient', 'PREDICTED_LABELS.above'].every((k) => settings.includes(k)));
check('S1: the Excess Stock % is editable', settings.includes("pctInput('current_excess_pct'"));

// Wording: "plates" confused the owner; screens say "predicted items sold".
const strip = (src) => src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('W1: no "plate" wording on the Analytics screens', ![forecasting, demand].some((src) => /\bplates?\b/i.test(strip(src))));

if (failures.length) {
  console.log(`FAILED: ${failures.length} check(s): ${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log('All Oct 25 concern checks passed.');
