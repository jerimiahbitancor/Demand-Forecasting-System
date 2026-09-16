// components/IngredientDemand.jsx
import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { FiSearch, FiInfo, FiDownload, FiExternalLink, FiShoppingCart } from "react-icons/fi";
import GenerateReportModal from "../../components/Reports/GenerateReportModal.jsx";
import { buildIngredientDemandPDF, buildGroceryListPDF, generateExcel } from "./../../../services/reportService.js";
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

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatLongDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// API cell levels ('normal' | 'above_normal' | 'high') -> the CSS
// suffix this file's heatmap-cell classes already use.
function apiLevelToCssSuffix(level) {
  if (level === "high") return "high";
  if (level === "above_normal") return "above";
  return "normal";
}

// Shared by the live page view AND handleGenerateReport (which re-fetches
// for the report's own chosen date) — module-scope so both call sites
// use the exact same transformation.
function buildDemandGrid(apiRows) {
  return (apiRows || []).map((r) => ({
    ingredient: r.ingredient,
    values: r.values.map((v) => Math.round(v * 100) / 100),
    highDay: r.highDay,
    levels: r.levels,
  }));
}

function buildDailyIngredients(apiRows) {
  return (apiRows || []).map((r) => ({
    name: r.name,
    category: r.category,
    usedIn: r.usedIn || "—",
    forecasted: r.forecastedNeed,
    onStock: r.onStock,
    unit: r.unit,
    status: r.status,
    toBuy: r.toBuy,
    marketPrice: r.marketPrice,
    estCost: r.estCost,
  }));
}

function buildGroceryList(apiAllItems) {
  return (apiAllItems || []).map((item) => ({
    name: item.name,
    category: item.category,
    usedIn: item.usedIn || "—",
    unit: item.unit,
    status: item.status,
    toBuy: item.toBuy,
    marketPrice: item.marketPrice,
    estCost: item.estCost,
  }));
}

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

  const [apiData, setApiData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchIngredientDemand() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const headers = await authService.getAuthHeaders();
        const response = await axios.get(`${API_URL}/analytics/ingredient-demand`, { headers });
        if (!cancelled) setApiData(response.data?.data || null);
      } catch (err) {
        console.error("Error fetching ingredient demand analytics:", err);
        if (!cancelled) setLoadError(err.response?.data?.error || err.message || "Failed to load ingredient demand data");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchIngredientDemand();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Derive the same shapes the JSX below already expects. ---
  const demandGrid = buildDemandGrid(apiData?.weekly?.rows);
  const cellLevel = (row, dayIndex) =>
    row.levels ? apiLevelToCssSuffix(row.levels[dayIndex]) : dayIndex === row.highDay ? "high" : "normal";

  const dailyIngredients = buildDailyIngredients(apiData?.daily?.rows);
  const groceryPreview = buildGroceryList(apiData?.groceryList?.all);
  const safetyBufferPercentage = apiData?.safetyBufferPercentage ?? 15;

  const dailyDateLabel = formatLongDate(apiData?.daily?.date);
  const weeklyRangeLabel = apiData?.weekly
    ? `${apiData.weekly.weekStart} – ${apiData.weekly.weekEnd}`
    : "—";

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
    if (itemsToDownload.length === 0) {
      toast.error("No data is available for the selected date range.");
      return;
    }

    // Fetch business profile — same pattern used by the Generate Report handler above
    let biz = {
      name: "ChefDuo",
      address: "",
      email: "",
      contact: "",
    };

    try {
      const token = await authService.getToken();
      const profileRes = await fetch(`${API_URL}/settings/business-profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!profileRes.ok) throw new Error("Unable to fetch business profile");
      const profileData = await profileRes.json();
      const d = profileData?.data;
      if (d) {
        biz = {
          name: d.business_name || "ChefDuo",
          address: d.address || d.business_address || "",
          email: d.business_email || "",
          contact: d.business_contact_number || "",
        };
      }
    } catch {
      // Keep the PDF usable even if the profile fetch fails
    }

    const dateLabel =
      groceryMode === "daily"
        ? `Today · ${dailyDateLabel}`
        : `Week of ${apiData?.weekly?.weekStart || "—"} – ${apiData?.weekly?.weekEnd || "—"}`;

    try {
      const doc = await buildGroceryListPDF({
        dateLabel,
        business: biz,
        groceryMode,
        itemsToDownload,
        GROCERY_CATEGORIES,
      });

      const filename = `grocery-list-chefduo-${groceryMode}.pdf`;
      doc.save(filename);
      toast.success("Report generated successfully!");
    } catch (err) {
      console.error("Error building grocery list PDF:", err);
      toast.error("Failed to generate report.");
    }
  };

  const availableTables = [
    { id: "weekly", label: "Weekly Ingredient Demand" },
    { id: "daily", label: "Daily Ingredient Demand" },
    // Grocery List is a print document (categorized, palengke-ordered) —
    // excluded from Excel per spec ("Grocery List is excluded and cannot
    // be exported as xlsx"). Still fully available as PDF (its own
    // dedicated Download button uses buildGroceryListPDF directly).
    { id: "grocery", label: "Grocery List", excelExcluded: true },
  ];

  const handleGenerateReport = async ({ format, dateRange, selectedTableIds }) => {
    // Ingredient demand doesn't have an arbitrary date-RANGE concept on
    // the backend (it's always exactly one week + one day) — map the
    // modal's range onto that: weekStart from the range start, the daily
    // snapshot from the range end.
    const [from, to] = dateRange.map((d) => d.toISOString().slice(0, 10));
    let reportDemandGrid, reportDailyIngredients, reportBufferPct;
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.get(`${API_URL}/analytics/ingredient-demand`, {
        headers,
        params: { date: to, weekStart: from },
      });
      const data = response.data?.data;
      reportDemandGrid = buildDemandGrid(data?.weekly?.rows);
      reportDailyIngredients = buildDailyIngredients(data?.daily?.rows);
      reportBufferPct = data?.safetyBufferPercentage ?? 15;
    } catch (err) {
      console.error("Error fetching report data:", err);
      toast.error("Failed to load data for the selected date range.");
      return;
    }

    if (reportDemandGrid.length === 0 && reportDailyIngredients.length === 0) {
      toast.error("No data is available for the selected date range.");
      return;
    }

    const bufferMultiplier = 1 + reportBufferPct / 100;
    // buildIngredientDemandPDF's Shopping List table wants the need
    // broken into Base Qty (pre-buffer) + Buffer + Total — the API only
    // returns the post-buffer forecastedNeed, so back it out here rather
    // than changing what the live Daily Ingredient Demand table shows.
    const shoppingListRows = reportDailyIngredients
      .filter((item) => item.status === "Critical" || item.status === "Low")
      .map((item) => {
        const total = item.forecasted;
        const baseQty = bufferMultiplier > 0 ? total / bufferMultiplier : total;
        return {
          ingredient: item.name,
          linkedDishes: item.usedIn,
          baseQty: baseQty.toFixed(2),
          buffer: (total - baseQty).toFixed(2),
          total: total.toFixed(2),
          unit: item.unit,
        };
      });

    try {
      if (format === "pdf") {
        const doc = await buildIngredientDemandPDF({
          dateRange,
          business: null,
          metrics: [
            { label: "Tracked Items", value: reportDailyIngredients.length, caption: "ingredients" },
            { label: "Need to Buy", value: shoppingListRows.length, caption: "items critical or low" },
            { label: "Main Buy Item", value: shoppingListRows[0]?.ingredient || "—", caption: "for this period" },
            { label: "High-Day Alerts", value: reportDemandGrid.filter((row) => row.levels?.includes("high")).length, caption: "ingredients flagged" },
          ],
          insightText: `This report summarizes the ingredient demand outlook for the selected period. ${shoppingListRows[0]?.ingredient || reportDailyIngredients[0]?.name || "—"} is the main item to prepare for this period's shopping list.`,
          shoppingListRows,
          highDemandRows: reportDemandGrid
            .filter((row) => row.levels?.includes("high"))
            .slice(0, 3)
            .map((row) => ({
              day: weekDays[row.levels.indexOf("high")] || "—",
              reason: "High demand day",
              affected: row.ingredient,
            })),
          disclaimer: "Disclaimer — Ingredient estimates are based on forecasted demand and should still be checked against actual stock before purchasing.",
        });
        doc.save("ingredient-demand-report.pdf");
      } else {
      const sheetMap = {
        weekly: {
          sheetName: "Weekly Ingredient Demand",
          rows: reportDemandGrid.map((row) => ({
            ingredient: row.ingredient,
            ...Object.fromEntries(weekDays.map((d, i) => [d, row.values[i]])),
          })),
        },
        daily: { sheetName: "Daily Ingredient Demand", rows: reportDailyIngredients.map((row) => ({ ...row })) },
      };

      generateExcel(
        Object.entries(sheetMap)
          .filter(([id]) => selectedTableIds.includes(id))
          .map(([, value]) => value),
        "ingredient-demand-report.xlsx"
      );
      }
      toast.success("Report generated successfully!");
    } catch (err) {
      console.error("Error building report:", err);
      toast.error("Failed to generate report.");
      return;
    }

    setIsReportModalOpen(false);
  };

  return (
    <>
      <div className="analytics-col-main">
        {loadError && (
          <InfoBanner variant="info">
            Couldn't load ingredient demand data: {loadError}
          </InfoBanner>
        )}
        {isLoading && !apiData && <p className="table-footnote">Loading ingredient demand data…</p>}
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
                        <td key={di} className={`heatmap-cell heatmap-cell--${cellLevel(row, di)}`}>
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
                  <td>{row.marketPrice === null ? "—" : `₱${row.marketPrice}`}</td>
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
            {groceryMode === 'daily' ? `For today: ${dailyDateLabel}` : `This Week: ${weeklyRangeLabel}`}
          </p>
          <InfoBanner variant="info">
            Order quantities are based on forecasted demand (plus a {safetyBufferPercentage}% safety buffer) minus current stock.{" "}
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
            <tr key={row.ingredient}><td>{(modalWeeklyPage - 1) * 10 + i + 1}</td><td>{row.ingredient}</td>{row.values.map((value, dayIndex) => <td key={dayIndex} className={`heatmap-cell heatmap-cell--${cellLevel(row, dayIndex)}`}>{value}</td>)}</tr>
          ))}</tbody>
        </table>
        <Pagination currentPage={modalWeeklyPage} totalPages={Math.max(1, Math.ceil(demandGrid.length / 10))} onPageChange={setModalWeeklyPage} />
      </ExpandableModal>

      <ExpandableModal isOpen={isDailyOpen} onClose={() => setIsDailyOpen(false)} title="Daily Ingredient Demand — Full View">
        <table className="analytics-table">
          <thead><tr><th>No.</th><th>Ingredient</th><th>Used in</th><th>Forecasted Need</th><th>On Stock</th><th>Status</th><th>To Buy</th><th>Unit</th><th>Market Price</th><th>Est. Cost</th></tr></thead>
          <tbody>{dailyIngredients.slice((modalDailyPage - 1) * 10, modalDailyPage * 10).map((row, i) => (
            <tr key={row.name}><td>{i + 1}</td><td>{row.name}</td><td>{row.usedIn}</td><td>{row.forecasted.toFixed(2)}</td><td>{row.onStock.toFixed(2)}</td><td><span className={`status-badge status-badge--${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.toBuy === null ? <span className="value--muted">{row.status === "Normal" ? "— no order" : "— delay restock"}</span> : row.toBuy.toFixed(2)}</td><td>{row.unit}</td><td>{row.marketPrice === null ? "—" : `₱${row.marketPrice}`}</td><td>{row.estCost === null ? "—" : `₱${row.estCost.toLocaleString()}`}</td></tr>
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
                      <td>{item.marketPrice === null ? "—" : `₱${item.marketPrice}/${item.unit}`}</td>
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