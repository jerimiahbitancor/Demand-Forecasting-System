// components/IngredientDemand.jsx
import { useState } from "react";
import { FiSearch, FiInfo, FiDownload } from "react-icons/fi";
import GenerateReportModal from "../../components/Reports/GenerateReportModal.jsx";
import { buildIngredientDemandPDF, generateExcel } from "./../../../services/reportService.js";
import DatePicker from "./shared/DatePicker.jsx";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import InfoBanner from "./shared/InfoBanner.jsx";
import "./shared/InfoBanner.css";
import "./IngredientDemand.css";

// ---------------------------------------------------------------------
// Mock data — replace with real API responses
// ---------------------------------------------------------------------
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const demandGrid = [
  { ingredient: "Breaded Tonkatsu", values: [18.2, 18.2, 18.2, 18.2, 18.2, 18.2, 18.2], highDay: 4 },
  { ingredient: "Poppers & Rice", values: [3.9, 3.9, 3.9, 3.9, 3.9, 3.9, 3.9], highDay: 4 },
  { ingredient: "Rice", values: [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4], highDay: 4 },
  { ingredient: "Chicken", values: [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], highDay: 4 },
  { ingredient: "Soy Sauce", values: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], highDay: 4 },
];

const buyList = [
  { ingredient: "Pork", linkedDishes: "Breaded Tonkatsu, Coated Tonkatsu, ...", baseQty: 3.68, buffer: 0.55, total: 4, unit: "kg" },
];

const ingredientList = [
  { name: "Rice", usedIn: "All dishes", qty: "21.4", unit: "kg", isHigh: true },
  { name: "Pork", usedIn: "Tonkatsu Series", qty: "4.73", unit: "kg", isHigh: true },
  { name: "Chicken", usedIn: "Poppers Series", qty: "1.75", unit: "kg", isHigh: false },
  { name: "Tomatoes", usedIn: "Tinola", qty: "0.87", unit: "kg", isHigh: false },
  { name: "Soy Sauce", usedIn: "Adobo, Sauces", qty: "0.66", unit: "L", isHigh: false },
];

// ---------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------
const tooltips = {
  weeklyPlanner: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Weekly Ingredient Planner
      </strong>
      This shows which ingredients need the most attention across the week. Darker colors mean higher-than-usual demand — often on paydays or before holidays.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ display: 'inline-block', width: '16px', height: '16px', background: '#93c5fd', borderRadius: '4px' }}></span>
          <span><strong>Light Blue</strong> — Normal. Typical amount needed.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ display: 'inline-block', width: '16px', height: '16px', background: '#fbbf24', borderRadius: '4px' }}></span>
          <span><strong>Amber</strong> — Above normal. More than usual.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-block', width: '16px', height: '16px', background: '#ef4444', borderRadius: '4px' }}></span>
          <span><strong>Red</strong> — High demand day. Significantly above typical.</span>
        </div>
      </div>
      <br/>
      Scan across a row to see when one ingredient spikes, or down a column to see how heavy a single day will be overall.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Ingredient Needed = Σ(Forecasted Servings × Recipe Qty) × (1 + Safety Buffer%)
      </span>
    </div>
  ),
  
  dailyShoppingList: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Daily Ingredient Shopping List
      </strong>
      This is your shopping list for tomorrow, based on predicted sales and your recipe amounts.
      <br/><br/>
      A safety buffer has already been added to cover unexpected orders or staff meals.
      <br/><br/>
      <div style={{ margin: '8px 0', background: 'rgba(254, 177, 97, 0.05)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(254, 177, 97, 0.1)' }}>
        <strong style={{ color: '#fbbf24' }}>More than usual</strong>
        <br/>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
          Badge appears when today's value is above that ingredient's typical range.
        </span>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Check your actual stock before buying — the system estimates what you'll need, not what you currently have.
      </span>
    </div>
  ),
  
  calculationNote: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        How is this calculated?
      </strong>
      For each dish: forecast quantity × ingredient amount per serving.
      <br/><br/>
      All results are added up across dishes that share an ingredient (like pork in both Adobo and Menudo), then a safety buffer is added.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
          <span><strong>Basic Qty. Needed</strong></span>
          <span style={{ color: '#94a3b8' }}>Σ(Forecasted Servings × Recipe Qty)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
          <span><strong>+ Buffer</strong></span>
          <span style={{ color: '#94a3b8' }}>Basic Qty. × Safety Buffer%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span><strong>Total to Buy</strong></span>
          <span style={{ color: '#22c55e' }}>Basic Qty. + Buffer</span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        You can change the buffer percentage in Settings.
      </span>
    </div>
  ),
};

// ---------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------
function cellLevel(dayIndex, highDay) {
  return dayIndex === highDay ? "high" : dayIndex % 2 === 0 ? "above" : "normal";
}

// ---------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------
function IngredientDemand() {
  const [selectedRange, setSelectedRange] = useState([new Date(), new Date()]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const availableTables = [
    { id: "shopping", label: "Shopping List" },
    { id: "heatmap", label: "Weekly Ingredient Planner" },
    { id: "ingredients", label: "Ingredient List" },
  ];

  const handleGenerateReport = async ({ format, dateRange, selectedTableIds }) => {
    const metrics = [
      { label: "Tracked Items", value: ingredientList.length, caption: "ingredients" },
      { label: "High Demand", value: ingredientList.filter((item) => item.isHigh).length, caption: "items above usual" },
      { label: "Main Buy Item", value: buyList[0]?.ingredient || "—", caption: "for tomorrow" },
      { label: "High-Day Alerts", value: demandGrid.filter((row) => row.highDay === 4).length, caption: "ingredients flagged" },
    ];

    if (format === "pdf") {
      const doc = await buildIngredientDemandPDF({
        dateRange,
        business: null,
        metrics,
        insightText: `This report summarizes the ingredient demand outlook for the selected period. ${buyList[0]?.ingredient || "Pork"} is the main item to prepare for tomorrow's shopping list.`,
        shoppingListRows: buyList,
        highDemandRows: demandGrid.slice(0, 3).map((row) => ({
          day: weekDays[row.highDay] || "—",
          reason: "High demand day",
          affected: row.ingredient,
        })),
        disclaimer: "Disclaimer — Ingredient estimates are based on forecasted demand and should still be checked against actual stock before purchasing.",
      });
      doc.save("ingredient-demand-report.pdf");
    } else {
      const sheetMap = {
        shopping: { sheetName: "Shopping List", rows: buyList.map((row) => ({ ...row })) },
        heatmap: {
          sheetName: "Weekly Planner",
          rows: demandGrid.map((row) => ({
            ingredient: row.ingredient,
            values: row.values.join(" | "),
            highDay: weekDays[row.highDay] || "—",
          })),
        },
        ingredients: { sheetName: "Ingredient List", rows: ingredientList.map((row) => ({ ...row })) },
      };

      generateExcel(
        Object.entries(sheetMap)
          .filter(([id]) => selectedTableIds.includes(id))
          .map(([, value]) => value),
        "ingredient-demand-report.xlsx"
      );
    }

    setIsReportModalOpen(false);
  };

  return (
    <>
      <div className="analytics-col-main">
        <section className="analytics-card">
          <h2 className="analytics-card-title">
            Estimated Ingredients to Prepare
            <Tippy
              content={tooltips.weeklyPlanner}
              placement="right"
              animation="scale"
              duration={200}
              theme="dark"
              arrow={true}
              maxWidth={380}
              interactive={true}
            >
              <span className="info-icon-wrapper">
                <FiInfo className="info-icon" />
              </span>
            </Tippy>
          </h2>

          <div className="analytics-filter-row">
            <DatePicker value={selectedRange} onChange={setSelectedRange} mode="range" />
            <span className="filter-search">
              <FiSearch size={14} /> Search Product
            </span>
          </div>

          <p className="section-note">
            Ingredient demand — this week. Color shows demand level relative to each
            ingredient's typical amount. Darker = more than usual.
          </p>

          <Tippy
            content={tooltips.weeklyPlanner}
            placement="top"
            animation="scale"
            duration={200}
            theme="dark"
            arrow={true}
            maxWidth={380}
            interactive={true}
          >
            <div className="heatmap-wrapper">
              <table className="analytics-table heatmap-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Ingredient</th>
                    {weekDays.map((d) => (
                      <th key={d}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {demandGrid.map((row, i) => (
                    <tr key={row.ingredient}>
                      <td>{i === 0 ? 1 : i === 1 ? 2 : "…"}</td>
                      <td>{i < 2 ? row.ingredient : ""}</td>
                      {row.values.map((v, di) => (
                        <td key={di} className={`heatmap-cell heatmap-cell--${cellLevel(di, row.highDay)}`}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tippy>

          <div className="chart-legend">
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--normal" /> Normal
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--abovenorm" /> Above Normal
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--highday" /> High Demand Day
            </span>
          </div>

          <InfoBanner variant="info">
            This shows what the system estimates you'll need based on tomorrow's predicted
            sales. Always check your actual fridge and stock before buying — the system
            does not know what you currently have on hand.
          </InfoBanner>

          <table className="analytics-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Ingredient</th>
                <th>Linked Dishes</th>
                <th>Basic Qty. Needed</th>
                <th>+ Buffer</th>
                <th>Total to Buy</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {buyList.map((row, i) => (
                <tr key={row.ingredient}>
                  <td>{i + 1}</td>
                  <td>{row.ingredient}</td>
                  <td>{row.linkedDishes}</td>
                  <td>{row.baseQty}</td>
                  <td>+ {row.buffer}</td>
                  <td className="value--success">{row.total}</td>
                  <td>{row.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="calc-note">
            <p className="calc-note-title">
              How is this calculated?
              <Tippy
                content={tooltips.calculationNote}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                maxWidth={380}
                interactive={true}
              >
                <span className="info-icon-wrapper">
                  <FiInfo className="info-icon-small" />
                </span>
              </Tippy>
            </p>
            <p className="calc-note-body">
              For each dish: forecast quantity × ingredient amount per serving. All results
              are added up across dishes that share an ingredient (like pork in both Adobo
              and Menudo), then a safety buffer is added. You can change the buffer
              percentage in Settings.
            </p>
          </div>
        </section>
      </div>

      <div className="analytics-col-side">
        <button type="button" className="btn-generate-report" onClick={() => setIsReportModalOpen(true)}>
          Generate Report
        </button>

        <section className="analytics-card">
          <div className="ingredient-list-header">
            <h2 className="analytics-card-title">
              Ingredient List
              <Tippy
                content={tooltips.dailyShoppingList}
                placement="right"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                maxWidth={380}
                interactive={true}
              >
                <span className="info-icon-wrapper">
                  <FiInfo className="info-icon" />
                </span>
              </Tippy>
            </h2>
            <button type="button" className="btn-export">
              <FiDownload size={14} /> Export List
            </button>
          </div>

          <p className="ingredient-list-caption">
            Estimated ingredients to prepare for
            <br />
            <strong>Tomorrow, June 25 (Wednesday)</strong>
          </p>

          <InfoBanner variant="info">
            Check your actual stock before buying — the system estimates what you'll need,
            not what you currently have.
          </InfoBanner>

          <Tippy
            content={tooltips.dailyShoppingList}
            placement="top"
            animation="scale"
            duration={200}
            theme="dark"
            arrow={true}
            maxWidth={380}
            interactive={true}
          >
            <ul className="ingredient-list">
              {ingredientList.map((item) => (
                <li key={item.name} className="ingredient-list-row">
                  <div>
                    <p className="ingredient-list-name">
                      {item.name}
                      {item.isHigh && (
                        <span className="badge-high">More than usual</span>
                      )}
                    </p>
                    <p className="ingredient-list-used">Used in: {item.usedIn}</p>
                  </div>
                  <div className="ingredient-list-qty">
                    <span>{item.qty}</span>
                    <span className="ingredient-list-unit">{item.unit}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Tippy>
        </section>
      </div>
      {isReportModalOpen && (
        <GenerateReportModal
          reportTitle="Ingredient Demand Report"
          availableTables={availableTables}
          onCancel={() => setIsReportModalOpen(false)}
          onGenerate={handleGenerateReport}
        />
      )}
    </>
  );
}

export default IngredientDemand;