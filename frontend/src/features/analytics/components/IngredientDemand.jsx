// components/IngredientDemand.jsx
import { useState } from "react";
import { FiSearch, FiInfo, FiDownload, FiExternalLink, FiShoppingCart } from "react-icons/fi";
import GenerateReportModal from "../../components/Reports/GenerateReportModal.jsx";
import { buildIngredientDemandPDF, generateExcel } from "./../../../services/reportService.js";
import DatePicker from "./shared/DatePicker.jsx";
import ExpandableModal from "./shared/ExpandableModal.jsx";
import Pagination from "./shared/Pagination.jsx";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import InfoBanner from "./shared/InfoBanner.jsx";
import { authService } from "../../../services/authService.js";
import "./shared/InfoBanner.css";
import "./IngredientDemand.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// ---------------------------------------------------------------------
// Mock data — replace with real API responses
// ---------------------------------------------------------------------
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const demandGrid = [
  { ingredient: "Pork", values: [18.2, 18.2, 18.2, 18.2, 18.2, 18.2, 18.2], highDay: 4 },
  { ingredient: "Rice", values: [3.9, 3.9, 3.9, 3.9, 3.9, 3.9, 3.9], highDay: 4 },
  { ingredient: "Chicken", values: [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4], highDay: 4 },
  { ingredient: "Tomatoes", values: [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], highDay: 4 },
  { ingredient: "Soy Sauce", values: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], highDay: 4 },
];

const dailyIngredients = [
  { name: "Pork", category: "Meat & Poultry", usedIn: "Tonkatsu series", forecasted: 4.73, onStock: 1.20, unit: "kg", status: "Critical", toBuy: 3.53, marketPrice: 320, estCost: 1130 },
  { name: "Rice", category: "Grains & Starches", usedIn: "All dishes", forecasted: 21.39, onStock: 9.00, unit: "kg", status: "Low", toBuy: 12.39, marketPrice: 52, estCost: 644 },
  { name: "Chicken", category: "Meat & Poultry", usedIn: "Poppers series", forecasted: 1.75, onStock: 2.50, unit: "kg", status: "Normal", toBuy: null, marketPrice: 210, estCost: null },
  { name: "Soy Sauce", category: "Condiments & Sauces", usedIn: "Adobo, sauces", forecasted: 0.66, onStock: 3.00, unit: "L", status: "Excess", toBuy: null, marketPrice: 85, estCost: null },
  { name: "Tomatoes", category: "Vegetables & Fruits", usedIn: "Tinola", forecasted: 0.87, onStock: 0.10, unit: "kg", status: "Critical", toBuy: 0.77, marketPrice: 95, estCost: 73 },
];

const GROCERY_CATEGORIES = [
  "Meat & Poultry",
  "Seafood",
  "Vegetables & Fruits",
  "Grains & Starches",
  "Dairy & Milk Products",
  "Condiments & Sauces",
  "Herbs & Spices",
  "Beverages & Syrups",
  "Baking & Dry Goods",
  "Packaging & Supplies",
];

const groceryPreview = dailyIngredients.filter(
  (item) => item.status === "Critical" || item.status === "Low"
);

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

  dailyIngredientDemand: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Daily Ingredient Demand
      </strong>
      This shows what the system estimates you'll need to buy based on tomorrow's predicted sales.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#e05555', fontWeight: 'bold' }}>●</span>
          <span><strong>Critical</strong> — Stock is very low. Order immediately.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#FFB800', fontWeight: 'bold' }}>●</span>
          <span><strong>Low</strong> — Stock is below forecasted need. Order soon.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#0F9918', fontWeight: 'bold' }}>●</span>
          <span><strong>Normal</strong> — Stock is sufficient. No action needed.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#3354BA', fontWeight: 'bold' }}>●</span>
          <span><strong>Excess</strong> — More than enough on hand. Delay restocking.</span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Market prices sourced from DA/PSA, Puregold, or other local reference data.
        Stock thresholds are configured in Settings.
      </span>
    </div>
  ),

  groceryList: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Grocery List
      </strong>
      This is your ready-to-buy ingredient list based on tomorrow's forecast (Daily)
      or the full week's forecast (Weekly).
      <br/><br/>
      Quantities shown are what the system estimates you need to purchase after
      accounting for your current stock.
      <br/><br/>
      Tap "View Full List" to see the complete categorized list, or "Download"
      to print it and bring it to the market.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Categories follow the palengke and grocery store layout so you can shop in order.
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
  const [weeklyPage, setWeeklyPage] = useState(1);
  const [dailyPage, setDailyPage] = useState(1);
  const [groceryMode, setGroceryMode] = useState("daily");
  const [isWeeklyOpen, setIsWeeklyOpen] = useState(false);
  const [isDailyOpen, setIsDailyOpen] = useState(false);
  const [isGroceryOpen, setIsGroceryOpen] = useState(false);
  const [modalWeeklyPage, setModalWeeklyPage] = useState(1);
  const [modalDailyPage, setModalDailyPage] = useState(1);
  const ROWS_PER_PAGE = 5;

  const totalWeeklyPages = Math.max(1, Math.ceil(demandGrid.length / ROWS_PER_PAGE));
  const paginatedWeekly = demandGrid.slice(
    (weeklyPage - 1) * ROWS_PER_PAGE, weeklyPage * ROWS_PER_PAGE
  );
  const totalDailyPages = Math.max(1, Math.ceil(dailyIngredients.length / ROWS_PER_PAGE));
  const paginatedDaily = dailyIngredients.slice(
    (dailyPage - 1) * ROWS_PER_PAGE, dailyPage * ROWS_PER_PAGE
  );

  const handleDownloadGroceryList = async () => {
    const itemsToDownload = groceryPreview;
    if (itemsToDownload.length === 0) return;

    let biz = {
      business_name: "ChefDuo",
      address: "",
      business_email: "",
      business_contact_number: "",
    };

    try {
      const token = await authService.getToken();
      const profileRes = await fetch(`${API_URL}/settings/business-profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!profileRes.ok) throw new Error("Unable to fetch business profile");
      const profileData = await profileRes.json();
      biz = profileData?.data || biz;
    } catch {
      // Keep the printout usable when the profile endpoint is unavailable.
    }

    // Build a simple print-ready HTML string for the grocery list
    const dateLabel = groceryMode === "daily"
      ? "For tomorrow: Thursday, June 25, 2026"
      : "Next Week: June 29 – July 5, 2026";

    const categoryBlocks = GROCERY_CATEGORIES
      .map((cat) => itemsToDownload.filter((i) => i.category === cat))
      .filter((items) => items.length > 0)
      .map((items) => {
        const catName = items[0].category;
        const rows = items.map((i) => `
        <tr>
          <td class="chk"><span class="box"></span></td>
          <td>${i.name}</td>
          <td>${i.toBuy?.toFixed(2) ?? "—"}</td>
          <td>${i.unit}</td>
          <td>₱${i.marketPrice}</td>
          <td></td>
        </tr>`).join("");
        return `
        <div class="category-block">
          <div class="category-header">${catName} <span class="count">${items.length} item${items.length !== 1 ? "s" : ""}</span></div>
          <table>
            <thead><tr><th></th><th>Item</th><th>Qty.</th><th>Unit</th><th>Market Price</th><th>Notes</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      });

    let categoryGridHtml = "";
    for (let i = 0; i < categoryBlocks.length; i += 2) {
      categoryGridHtml += `<div class="category-row">${categoryBlocks[i]}${categoryBlocks[i + 1] || ""}</div>`;
    }

    const totalCost = itemsToDownload.reduce((sum, i) => sum + (i.estCost || 0), 0);
    const generatedTimestamp = new Date().toLocaleString("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Grocery List — ${biz.business_name || "ChefDuo"}</title>
      <style>
        @page { size: A5; margin: 14mm; }
        body { font-family: Arial, sans-serif; color: #1C2632; margin: 0; }
        .letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #7A0101; padding-bottom: 10px; margin-bottom: 14px; }
        .letterhead h1 { color: #7A0101; font-size: 18px; margin: 0 0 2px; }
        .letterhead p { font-size: 10px; color: #6c757d; margin: 0; }
        .letterhead-right { text-align: right; }
        .letterhead-right h2 { font-size: 16px; margin: 0 0 2px; }
        .letterhead-right p { font-size: 9px; color: #6c757d; margin: 0; }
        .summary-strip { display: flex; gap: 10px; margin-bottom: 14px; }
        .summary-card { flex: 1; background: #f8f9fa; border-radius: 6px; padding: 8px; text-align: center; }
        .summary-card .label { font-size: 9px; color: #6c757d; }
        .summary-card .value { font-size: 16px; font-weight: 700; }
        .category-row { display: flex; gap: 12px; margin-bottom: 10px; }
        .category-block { flex: 1; }
        .category-header { font-size: 11px; font-weight: 700; color: #7A0101; background: #fbeaea; padding: 4px 8px; border-radius: 4px 4px 0 0; display: flex; justify-content: space-between; }
        .category-header .count { font-weight: 400; color: #6c757d; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; }
        th, td { border: 1px solid #e2e2e2; padding: 3px 4px; text-align: left; }
        th { background: #f4f4f2; }
        .chk { width: 14px; text-align: center; }
        .box { display: inline-block; width: 8px; height: 8px; border: 1px solid #999; }
        .footer { font-size: 8px; color: #999; margin-top: 10px; display: flex; justify-content: space-between; }
        .page-break { page-break-before: always; }
        .blank-page-title { font-size: 12px; font-weight: 700; color: #7A0101; margin-bottom: 10px; }
      </style>
      </head><body>
      <div class="letterhead">
        <div>
          <h1>${biz.business_name || "ChefDuo"}</h1>
          <p>${biz.address || biz.business_address || ""}</p>
          <p>${biz.business_email || ""} ${biz.business_contact_number ? "· " + biz.business_contact_number : ""}</p>
        </div>
        <div class="letterhead-right">
          <h2>Grocery List</h2>
          <p>${dateLabel}</p>
          <p>Generated ${generatedTimestamp}</p>
          <p>Market Price Source: Department of Agriculture, Puregold, etc.</p>
        </div>
      </div>
      <div class="summary-strip">
        <div class="summary-card"><div class="label">Est. Total Cost</div><div class="value">₱${totalCost.toLocaleString()}</div></div>
        <div class="summary-card"><div class="label">Items to Buy</div><div class="value">${itemsToDownload.length}</div></div>
      </div>
      ${categoryGridHtml}
      <div class="footer"><span>${biz.business_name || "ChefDuo"} Forecast System</span><span>Page 1 of 2</span></div>
      <div class="page-break">
        <div class="blank-page-title">Additional Items</div>
        <div class="category-row">
          <div class="category-block"><table><thead><tr><th></th><th>Item</th><th>Qty.</th><th>Unit</th><th>Market Price</th><th>Notes</th></tr></thead>
            <tbody>${Array(15).fill('<tr><td class="chk"><span class="box"></span></td><td></td><td></td><td></td><td></td><td></td></tr>').join("")}</tbody></table></div>
          <div class="category-block"><table><thead><tr><th></th><th>Item</th><th>Qty.</th><th>Unit</th><th>Market Price</th><th>Notes</th></tr></thead>
            <tbody>${Array(15).fill('<tr><td class="chk"><span class="box"></span></td><td></td><td></td><td></td><td></td><td></td></tr>').join("")}</tbody></table></div>
        </div>
        <div class="footer"><span>${biz.business_name || "ChefDuo"} Forecast System</span><span>Page 2 of 2</span></div>
      </div>
      </body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `grocery-list-chefduo-${groceryMode}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const availableTables = [
    { id: "shopping", label: "Weekly Ingredient Demand" },
    { id: "daily", label: "Daily Ingredient Demand" },
    { id: "grocery", label: "Grocery List" },
  ];

  const handleGenerateReport = async ({ format, dateRange, selectedTableIds }) => {
    const metrics = [
      { label: "Tracked Items", value: dailyIngredients.length, caption: "ingredients" },
      { label: "High Demand", value: groceryPreview.length, caption: "items above usual" },
      { label: "Main Buy Item", value: groceryPreview[0]?.name || "—", caption: "for tomorrow" },
      { label: "High-Day Alerts", value: demandGrid.filter((row) => row.highDay === 4).length, caption: "ingredients flagged" },
    ];

    if (format === "pdf") {
      const doc = await buildIngredientDemandPDF({
        dateRange,
        business: null,
        metrics,
        insightText: `This report summarizes the ingredient demand outlook for the selected period. ${groceryPreview[0]?.name || "Pork"} is the main item to prepare for tomorrow's shopping list.`,
        shoppingListRows: groceryPreview,
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
        shopping: { sheetName: "Shopping List", rows: groceryPreview.map((row) => ({ ...row })) },
        grocery: {
          sheetName: "Grocery List",
          rows: groceryPreview.map((item) => ({
            ingredient: item.name,
            usedIn: item.usedIn,
            toBuy: item.toBuy ?? 0,
            unit: item.unit,
            marketPrice: `₱${item.marketPrice}/${item.unit}`,
            estCost: item.estCost ? `₱${item.estCost.toLocaleString()}` : "—",
            status: item.status,
          })),
        },
        heatmap: {
          sheetName: "Weekly Planner",
          rows: demandGrid.map((row) => ({
            ingredient: row.ingredient,
            values: row.values.join(" | "),
            highDay: weekDays[row.highDay] || "—",
          })),
        },
        ingredients: { sheetName: "Daily Ingredient Demand", rows: dailyIngredients.map((row) => ({ ...row })) },
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
            Weekly Ingredient Demand
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
          <button type="button" className="btn-expand-panel" onClick={() => setIsWeeklyOpen(true)} aria-label="Expand Weekly Ingredient Demand">
            <FiExternalLink size={16} />
          </button>
          </div>

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
                  {paginatedWeekly.map((row, i) => (
                    <tr key={row.ingredient}>
                      <td>{(weeklyPage - 1) * ROWS_PER_PAGE + i + 1}</td>
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

          <Pagination currentPage={weeklyPage} totalPages={totalWeeklyPages} onPageChange={setWeeklyPage} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Daily Ingredient Demand
              <Tippy content={tooltips.dailyIngredientDemand} placement="right" animation="scale" duration={200} theme="dark" arrow maxWidth={380} interactive>
                <span className="info-icon-wrapper"><FiInfo className="info-icon" /></span>
              </Tippy>
            </h2>
            <button type="button" className="btn-expand-panel" onClick={() => setIsDailyOpen(true)} aria-label="Expand Daily Ingredient Demand">
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="analytics-filter-row">
            <DatePicker value={selectedRange} onChange={setSelectedRange} mode="range" />
            <span className="filter-search"><FiSearch size={14} /> Search Product</span>
          </div>

          <p className="section-note">
            Ingredient demand — today. This shows what the system estimates you'll need based on predicted sales and your current stock.
            <a href="/inventory-management" style={{color:'var(--color-red-primary)', fontWeight:600}}> View Inventory Management</a>
          </p>

          <div className="stock-legend">
            <span className="stock-legend-pill stock-legend--excess">● Excess — delay restock</span>
            <span className="stock-legend-pill stock-legend--normal">● Normal — no action needed</span>
            <span className="stock-legend-pill stock-legend--low">● Low — order soon</span>
            <span className="stock-legend-pill stock-legend--critical">● Critical — order now</span>
          </div>

          <table className="analytics-table">
            <thead><tr><th>No.</th><th>Ingredient</th><th>Used in</th><th>Forecasted Need</th><th>On Stock</th><th>Status</th><th>To Buy</th><th>Unit</th><th>Market Price</th><th>Est. Cost</th></tr></thead>
            <tbody>
              {paginatedDaily.map((row, i) => (
                <tr key={row.name}>
                  <td>{i + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.usedIn}</td>
                  <td>{row.forecasted.toFixed(2)}</td>
                  <td>{row.onStock.toFixed(2)}</td>
                  <td><span className={`status-badge status-badge--${row.status.toLowerCase()}`}>{row.status}</span></td>
                  <td>{row.toBuy === null ? <span className="value--muted">{row.status === "Normal" ? "— no order" : "— delay restock"}</span> : row.toBuy.toFixed(2)}</td>
                  <td>{row.unit}</td>
                  <td>₱{row.marketPrice}</td>
                  <td>{row.estCost === null ? "—" : `₱${row.estCost.toLocaleString()}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination currentPage={dailyPage} totalPages={totalDailyPages} onPageChange={setDailyPage} />
        </section>
      </div>

      <div className="analytics-col-side">
        <button type="button" className="btn-generate-report" onClick={() => setIsReportModalOpen(true)}>
          Generate Report
        </button>

        <section className="analytics-card">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom:0 }}>
              <FiShoppingCart size={16} style={{ marginRight:6, verticalAlign:-2 }} />
              Grocery List
              <Tippy content={tooltips.groceryList} placement="right" animation="scale" duration={200} theme="dark" arrow maxWidth={380} interactive>
                <span className="info-icon-wrapper"><FiInfo className="info-icon" /></span>
              </Tippy>
            </h2>
            <button type="button" className="btn-expand-panel" onClick={() => setIsGroceryOpen(true)} aria-label="View full grocery list">
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="grocery-toggle">
            <button type="button" className={`grocery-toggle-btn ${groceryMode === 'weekly' ? 'active' : ''}`} onClick={() => setGroceryMode('weekly')}>Weekly</button>
            <button type="button" className={`grocery-toggle-btn ${groceryMode === 'daily' ? 'active' : ''}`} onClick={() => setGroceryMode('daily')}>Daily</button>
          </div>
          <p className="grocery-date-label">
            {groceryMode === 'daily' ? 'For tomorrow: Thursday, June 25, 2026' : 'Next Week: June 29 – July 5, 2026'}
          </p>
          <InfoBanner variant="info">
            Order quantities are based on forecasted demand minus current stock.{" "}
            <a href="/inventory-management" style={{color:'inherit', fontWeight:600, textDecoration:'underline'}}>See Inventory Management.</a>
          </InfoBanner>
          <div className="grocery-kpi-row">
            <div className="grocery-kpi-card"><p className="grocery-kpi-label">Est. Total Cost</p><p className="grocery-kpi-value">₱{groceryPreview.reduce((sum, i) => sum + (i.estCost || 0), 0).toLocaleString()}</p></div>
            <div className="grocery-kpi-card"><p className="grocery-kpi-label">Total Items to Buy</p><p className="grocery-kpi-value">{groceryPreview.length}</p></div>
          </div>
          <ul className="grocery-preview-list">
            {groceryPreview.slice(0, 5).map((item) => (
              <li key={item.name} className="grocery-preview-row">
                <div><p className="grocery-preview-name">{item.name}</p><p className="grocery-preview-sub">Used in: {item.usedIn}</p></div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}><span className={`status-badge status-badge--${item.status.toLowerCase()}`}>{item.status}</span><span className="grocery-preview-qty">{item.toBuy?.toFixed(2)} {item.unit}</span></div>
              </li>
            ))}
            {groceryPreview.length > 5 && <li className="grocery-preview-more">… and {groceryPreview.length - 5} more items</li>}
          </ul>
          <div className="grocery-action-row">
            <button type="button" className="btn-grocery-view" onClick={() => setIsGroceryOpen(true)}><FiExternalLink size={14} /> View Full List</button>
            <button type="button" className="btn-grocery-download" onClick={handleDownloadGroceryList}><FiDownload size={14} /> Download</button>
          </div>
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
      <ExpandableModal isOpen={isWeeklyOpen} onClose={() => setIsWeeklyOpen(false)} title="Weekly Ingredient Demand — Full View">
        <table className="analytics-table heatmap-table">
          <thead><tr><th>No.</th><th>Ingredient</th>{weekDays.map((day) => <th key={day}>{day}</th>)}</tr></thead>
          <tbody>{demandGrid.slice((modalWeeklyPage - 1) * 10, modalWeeklyPage * 10).map((row, i) => (
            <tr key={row.ingredient}><td>{(modalWeeklyPage - 1) * 10 + i + 1}</td><td>{row.ingredient}</td>{row.values.map((value, dayIndex) => <td key={dayIndex} className={`heatmap-cell heatmap-cell--${cellLevel(dayIndex, row.highDay)}`}>{value}</td>)}</tr>
          ))}</tbody>
        </table>
        <Pagination currentPage={modalWeeklyPage} totalPages={Math.max(1, Math.ceil(demandGrid.length / 10))} onPageChange={setModalWeeklyPage} />
      </ExpandableModal>

      <ExpandableModal isOpen={isDailyOpen} onClose={() => setIsDailyOpen(false)} title="Daily Ingredient Demand — Full View">
        <table className="analytics-table">
          <thead><tr><th>No.</th><th>Ingredient</th><th>Used in</th><th>Forecasted Need</th><th>On Stock</th><th>Status</th><th>To Buy</th><th>Unit</th><th>Market Price</th><th>Est. Cost</th></tr></thead>
          <tbody>{dailyIngredients.slice((modalDailyPage - 1) * 10, modalDailyPage * 10).map((row, i) => (
            <tr key={row.name}><td>{i + 1}</td><td>{row.name}</td><td>{row.usedIn}</td><td>{row.forecasted.toFixed(2)}</td><td>{row.onStock.toFixed(2)}</td><td><span className={`status-badge status-badge--${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.toBuy === null ? <span className="value--muted">{row.status === "Normal" ? "— no order" : "— delay restock"}</span> : row.toBuy.toFixed(2)}</td><td>{row.unit}</td><td>₱{row.marketPrice}</td><td>{row.estCost === null ? "—" : `₱${row.estCost.toLocaleString()}`}</td></tr>
          ))}</tbody>
        </table>
        <Pagination currentPage={modalDailyPage} totalPages={Math.max(1, Math.ceil(dailyIngredients.length / 10))} onPageChange={setModalDailyPage} />
      </ExpandableModal>

      <ExpandableModal isOpen={isGroceryOpen} onClose={() => setIsGroceryOpen(false)} title="Grocery List — Full View">
        <div className="grocery-toggle">
          <button type="button" className={`grocery-toggle-btn ${groceryMode === 'weekly' ? 'active' : ''}`} onClick={() => setGroceryMode('weekly')}>Weekly</button>
          <button type="button" className={`grocery-toggle-btn ${groceryMode === 'daily' ? 'active' : ''}`} onClick={() => setGroceryMode('daily')}>Daily</button>
        </div>
        <div className="grocery-kpi-row">
          <div className="grocery-kpi-card"><p className="grocery-kpi-label">Est. Total Cost</p><p className="grocery-kpi-value">₱{groceryPreview.reduce((sum, item) => sum + (item.estCost || 0), 0).toLocaleString()}</p></div>
          <div className="grocery-kpi-card"><p className="grocery-kpi-label">Total Items to Buy</p><p className="grocery-kpi-value">{groceryPreview.length}</p></div>
        </div>
        {GROCERY_CATEGORIES.map((category) => {
          const items = groceryPreview.filter((item) => item.category === category);
          if (items.length === 0) return null;
          return (
            <div className="grocery-category" key={category}>
              <p className="status-group-title">{category}</p>
              <table className="analytics-table analytics-table--compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Market Price</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.name}>
                      <td>{item.name}</td>
                      <td>{item.toBuy?.toFixed(2) ?? "—"}</td>
                      <td>{item.unit}</td>
                      <td>₱{item.marketPrice}/{item.unit}</td>
                      <td>{item.usedIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        <button type="button" className="btn-grocery-download" onClick={handleDownloadGroceryList}><FiDownload size={14} /> Download</button>
      </ExpandableModal>
    </>
  );
}

export default IngredientDemand;