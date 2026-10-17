// components/ProductPerformance.jsx
import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { FiChevronDown, FiCalendar, FiInfo, FiExternalLink } from "react-icons/fi";
import GenerateReportModal from "../../components/Reports/GenerateReportModal.jsx";
import { buildProductPerformancePDF, generateExcel } from "./../../../services/reportService.js";
import { logAuditEvent, formatAuditDateRange } from "../../../services/auditClient.js";
import DatePicker from "./shared/DatePicker.jsx";
import ExpandableModal from "./shared/ExpandableModal.jsx";
import Pagination from "./shared/Pagination.jsx";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import InfoBanner from "./shared/InfoBanner.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import { ratioBarGeometry, ratioBarMax } from "./shared/ratioBar.js";
import "./shared/InfoBanner.css";
import "./ProductPerformance.css";
import { authService } from "../../../services/authService.js";
import { roundItems, formatItemsSold } from "../../../utils/formatItemsSold.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function formatPeso(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatDDMMYYYY(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

// High Demand -> high zone, Medium -> medium, Low -> low, unclassified
// (no product_classifications row yet) falls back to "low" so the bar
// still renders something rather than crashing on an unknown key.
function zoneFromDemandLevel(demandLevel) {
  if (demandLevel === "High Demand") return "high";
  if (demandLevel === "Medium Demand") return "medium";
  return "low";
}

// Shared by the live page view AND handleGenerateReport (which re-fetches
// for the report's own chosen date range) — module-scope so both call
// sites use the exact same transformation.
function buildDemandRows(apiRows) {
  return (apiRows || []).map((r) => ({
    product: r.product,
    date: formatDDMMYYYY(r.date),
    forecastQty: r.forecastQty,
    zone: zoneFromDemandLevel(r.demandLevel),
    demandLevel: r.demandLevel || "Unclassified",
    bottleneckIngredient: r.bottleneckIngredient,
    bottleneckStatus: r.bottleneckStatus,
  }));
}

function buildPerformanceRows(apiRows) {
  return (apiRows || []).map((r) => ({
    rank: r.rank,
    product: r.product,
    qtySold: r.quantitySold,
    // null = nothing sold in range, or price 0: shown as "—", never ₱0.
    revenue: r.revenue == null && r.hasPrice === false && r.quantitySold > 0 ? "No price" : formatPeso(r.revenue),
    // null = no rolling_7 for this product: shown as "—", never as 0.00.
    ratio: r.performanceRatio ?? null,
    actionSignal: r.actionSignal,
  }));
}

function ratioText(ratio) {
  if (ratio === null || ratio === undefined) return "—";
  return `${ratio.toFixed(2)} ${ratio >= 1 ? "▲" : "▼"}`;
}

function ratioClass(ratio) {
  if (ratio === null || ratio === undefined) return "value--muted";
  return ratio >= 1 ? "value--success" : "value--error";
}

// Local calendar date (not toISOString, which shifts to UTC and gives the
// previous day before 8 AM in Manila).
function toYmd(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromYmd(ymd) {
  return ymd ? new Date(`${ymd}T00:00:00`) : null;
}

// ---------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------
const tooltips = {
  demandClassification: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Demand Classification
      </strong>
      The system automatically sorts each dish into High, Medium, or Low demand — based on that dish's own sales history, not a fixed number. A dish selling 20 servings might be "High" if it rarely sells that much.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>●</span>
          <span><strong>High Demand</strong> — Prepare extra stock</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>●</span>
          <span><strong>Medium Demand</strong> — Standard preparation</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#22c55e', fontWeight: 'bold' }}>●</span>
          <span><strong>Low Demand</strong> — Reduce preparation</span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        High if Forecast &gt; P80 • Medium if P40 ≤ Forecast ≤ P80 • Low if Forecast &lt; P40
      </span>
      <br/>
      Action signals also consider current ingredient stock levels, so you know exactly which ingredient is the most important.
    </div>
  ),
  
  performanceRatio: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Performance Ratio Analysis
      </strong>
      This compares each dish's sales to your store's average. The center line is your store average.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#22c55e', fontWeight: 'bold' }}>→</span>
          <span><strong>Bars to the right</strong> = Selling better than average — keep these on the menu</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>→</span>
          <span><strong>Bars to the left</strong> = Selling below average — consider a promo or reviewing the dish</span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Performance Ratio = this product's 7-day average ÷ the average 7-day average of all active products
      </span>
    </div>
  ),
  
  productStatus: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Product Status
      </strong>
      <div style={{ margin: '8px 0' }}>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#22c55e' }}>Active Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            These products have enough sales history and are actively being forecasted.
          </span>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#fbbf24' }}>Inactive (Not enough data)</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Fewer than 42 days with sales so far. Forecasting starts once a product has 42 days with sales.
          </span>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#ef4444' }}>Inactive Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Auto-flagged after 0 sales for 28 consecutive days. Excluded from forecast until sales resume.
          </span>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#94a3b8' }}>Archived Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Permanently removed from the menu, or temporarily off the menu and will return (Seasonal).
          </span>
        </div>
        <div>
          <strong style={{ color: '#94a3b8' }}>Unmapped Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            No ingredient recipe configured. Forecasting works, but ingredient demand estimation is unavailable until a recipe is added.
          </span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Flags products with no sales in the last 28 open days • Products need 42 days with sales before forecasting
      </span>
    </div>
  ),
};

const zoneClass = { high: "bar--high", medium: "bar--medium", low: "bar--low" };
const pillClass = {
  "High Demand": "pill--high",
  "Medium Demand": "pill--medium",
  "Low Demand": "pill--low",
};

// ---------------------------------------------------------------------
// Chart Components
// ---------------------------------------------------------------------
function DemandBar({ label, qty, maxQty, zone }) {
  // maxQty is 0 when every product forecasts 0 servings, which would make
  // qty/maxQty NaN and hand the browser an invalid "NaN%" width that silently
  // collapses the fill to nothing. Floor the divisor so those rows still draw
  // their minimum sliver.
  const widthPct = maxQty > 0 ? Math.max((qty / maxQty) * 100, 6) : 6;
  return (
    <div className="demand-bar-row">
      <span className="demand-bar-label">{label}</span>
      <div className="demand-bar-track">
        <div className={`demand-bar-fill ${zoneClass[zone]}`} style={{ width: `${widthPct}%` }} />
      </div>
      {/* Outside the track, not inside the fill: the fill is only as wide as
          this product's share of the maximum, so a low-demand product left the
          white label spilling onto the light track where it was unreadable.
          As its own column it is always legible and always the same distance
          from the bar, so the numbers line up down the chart. */}
      {/* Whole number for display only; the bar width above uses the raw
          forecast (an expected value, so a decimal). */}
      <span className="demand-bar-value">{formatItemsSold(qty, { withUnit: true })}</span>
    </div>
  );
}

// Each side of the centre line is half the track; bars never leave it (see
// shared/ratioBar.js). Green = above average, red = below, same as the legend.
// The value sits at the end of the bar, inside the track: inside the bar
// when the bar is wide, just past its end when it is short.
const RATIO_LABEL_INSIDE_MIN_PCT = 30;

function RatioBar({ label, ratio, maxRatio }) {
  const geometry = ratioBarGeometry(ratio, maxRatio);
  if (!geometry) return null;
  const { isAbove, leftPct, widthPct } = geometry;
  const inside = widthPct >= RATIO_LABEL_INSIDE_MIN_PCT;
  const endPct = isAbove ? leftPct + widthPct : leftPct; // outer end of the bar
  const valueStyle = isAbove
    ? (inside ? { right: `${100 - endPct}%` } : { left: `${endPct}%` })
    : (inside ? { left: `${endPct}%` } : { right: `${100 - endPct}%` });

  return (
    <div className="ratio-bar-row">
      <span className="ratio-bar-label">{label}</span>
      <div className="ratio-bar-track">
        <div className="ratio-bar-center-line" />
        <div
          className={`ratio-bar-fill ${isAbove ? "ratio-bar-fill--above" : "ratio-bar-fill--below"}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
        <span
          className={`ratio-bar-value ${inside ? "ratio-bar-value--inside" : "ratio-bar-value--outside"}`}
          style={valueStyle}
        >
          {Number(ratio).toFixed(2)} ×
        </span>
      </div>
    </div>
  );
}

const ACTION_SIGNAL_MATRIX = {
  "High Demand": {
    Critical: "Urgent: high demand but {ing} stock critical — order immediately",
    Low: "Prepare extra — {ing} stock low, order soon",
    Normal: "Prepare extra stock — ingredients sufficient",
    Excess: "Prepare extra — good time to use excess stock",
  },
  "Medium Demand": {
    Critical: "Order soon — {ing} stock critical, monitor closely",
    Low: "Order soon — {ing} stock below forecasted need",
    Normal: "No action needed — ingredients sufficient",
    Excess: "Delay restock",
  },
  "Low Demand": {
    Critical: "Order small amount — minimal demand but critically low {ing}",
    Low: "Monitor — low demand, restock if needed",
    Normal: "No action needed — ingredients sufficient",
    Excess: "Reduce prep — delay restocking {ing} (overstock)",
  },
};

function getActionSignal(demandLevel, bottleneckIngredient, bottleneckStatus) {
  const template = ACTION_SIGNAL_MATRIX[demandLevel]?.[bottleneckStatus];
  if (!template) return "No action needed";
  return template.replace("{ing}", bottleneckIngredient);
}


// ---------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------
function ProductPerformance() {
  const [apiData, setApiData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedRange, setSelectedRange] = useState([new Date(), new Date()]);
  // null = let the backend pick: Performance Ratio = the 7 days ending on the
  // latest sale date; Demand Classification = today.
  const [rangeParams, setRangeParams] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);

  // A full range picked in the calendar refetches with that range.
  const handleRangeChange = (value) => {
    setSelectedRange(value);
    if (Array.isArray(value) && value[0] && value[1]) {
      setRangeParams({ from: toYmd(value[0]), to: toYmd(value[1]) });
    }
  };

  // "Last 7 days" = back to the backend default (7 days ending on the latest
  // sale date — today's sales are uploaded tomorrow, so "today" is empty).
  const applyLast7Days = () => {
    setRangeParams(null);
    setFetchKey((k) => k + 1);
  };
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  // Modal open states
  const [isDemandClassOpen, setIsDemandClassOpen] = useState(false);
  const [isRatioOpen, setIsRatioOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);

  // Pagination — panel (5 rows each)
  const [demandPage, setDemandPage] = useState(1);
  const [ratioPage, setRatioPage] = useState(1);
  const [demandQuery, setDemandQuery] = useState('');
  const [ratioQuery, setRatioQuery] = useState('');
  const [activeStatusPage, setActiveStatusPage] = useState(1);
  const [newStatusPage, setNewStatusPage] = useState(1);
  const [inactiveStatusPage, setInactiveStatusPage] = useState(1);
  const [archivedStatusPage, setArchivedStatusPage] = useState(1);

  // Pagination — horizontal bar charts (5 bars each)
  const [demandChartPage, setDemandChartPage] = useState(1);
  const [ratioChartPage, setRatioChartPage] = useState(1);

  const [modalDemandPage, setModalDemandPage] = useState(1);
  const [modalRatioPage, setModalRatioPage] = useState(1);
  const [modalActiveStatusPage, setModalActiveStatusPage] = useState(1);
  const [modalNewStatusPage, setModalNewStatusPage] = useState(1);
  const [modalInactiveStatusPage, setModalInactiveStatusPage] = useState(1);
  const [modalArchivedStatusPage, setModalArchivedStatusPage] = useState(1);

  // Pagination — modal bar charts (10 bars each)
  const [modalDemandChartPage, setModalDemandChartPage] = useState(1);
  const [modalRatioChartPage, setModalRatioChartPage] = useState(1);

  const ROWS_PER_PAGE = 5;

  useEffect(() => {
    let cancelled = false;

    async function fetchProductPerformance() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const headers = await authService.getAuthHeaders();
        const response = await axios.get(`${API_URL}/analytics/product-performance`, {
          headers,
          params: rangeParams || undefined,
        });
        const data = response.data?.data || null;
        if (!cancelled) {
          setApiData(data);
          // Show the range the backend chose in the date picker.
          const ratioRange = data?.performanceRatio?.range;
          if (!rangeParams && ratioRange?.from && ratioRange?.to) {
            setSelectedRange([fromYmd(ratioRange.from), fromYmd(ratioRange.to)]);
          }
        }
      } catch (err) {
        console.error("Error fetching product performance analytics:", err);
        if (!cancelled) setLoadError(err.response?.data?.error || err.message || "Failed to load product performance data");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchProductPerformance();
    return () => {
      cancelled = true;
    };
  }, [rangeParams, fetchKey]);

  // --- Derive the same shapes the JSX below already expects. ---
  const demandRows = buildDemandRows(apiData?.demandClassification);
  const maxQty = demandRows.length ? Math.max(...demandRows.map((r) => r.forecastQty)) : 1;
  const performanceRows = buildPerformanceRows(apiData?.performanceRatio?.rows);
  // Bars only for products that have a ratio; the table lists every row.
  const ratioChartRows = performanceRows.filter((r) => r.ratio !== null);
  const hasSalesInRange = performanceRows.some((r) => r.qtySold > 0);
  const ratioAsOf = apiData?.performanceRatio?.ratioAsOf || null;
  const demandDateLabel = (() => {
    const range = apiData?.demandRange;
    if (!range?.from) return null;
    const fmt = (ymd) => fromYmd(ymd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`;
  })();

  const statusCounts = apiData?.productStatus?.counts || { active: 0, new: 0, inactive: 0, archived: 0 };
  const activeProducts = apiData?.productStatus?.active || [];
  const newProducts = apiData?.productStatus?.new || [];
  const inactiveProducts = apiData?.productStatus?.inactive || [];
  const archivedProducts = apiData?.productStatus?.archived || [];

  const availableTables = [
    { id: "demand", label: "Demand Classification" },
    { id: "ratio", label: "Performance Ratio Analysis" },
    { id: "status", label: "Product Status (Active/New/Inactive)" },
  ];

  // Note: selectedTableIds must be destructured here — the modal passes it
  // alongside format and dateRange, and the Excel branch below depends on it.
  const handleGenerateReport = async ({ format, dateRange, selectedTableIds }) => {
    // Re-fetch for the report's OWN chosen date range — demand
    // classification and performance ratio are both date-scoped on the
    // backend; product status is always "now" regardless of the report
    // period, so that part reuses the page's already-loaded values.
    const [from, to] = dateRange.map((d) => d.toISOString().slice(0, 10));
    let reportDemandRows, reportPerformanceRows;
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.get(`${API_URL}/analytics/product-performance`, { headers, params: { from, to } });
      reportDemandRows = buildDemandRows(response.data?.data?.demandClassification);
      reportPerformanceRows = buildPerformanceRows(response.data?.data?.performanceRatio?.rows);
    } catch (err) {
      console.error("Error fetching report data:", err);
      toast.error("Failed to load data for the selected date range.");
      return;
    }

    if (reportDemandRows.length === 0 && reportPerformanceRows.length === 0) {
      toast.error("No data is available for the selected date range.");
      return;
    }

    const topPerformers = reportPerformanceRows.filter((r) => r.ratio >= 1).slice(0, 2);
    // null = no ratio yet (null < 1 is true in JS, so check it first).
    const needsReview = reportPerformanceRows.filter((r) => r.ratio !== null && r.ratio < 1).slice(0, 2);

    try {
    if (format === "pdf") {
      const doc = await buildProductPerformancePDF({
        dateRange,
        business: null, // wire to your business_profile fetch — see prior note
        metrics: [
          { label: "Active Products", value: activeProducts.length, caption: "menu products" },
          { label: "High Demand", value: reportDemandRows.filter(r => r.demandLevel === "High Demand").length, caption: "products" },
          { label: "Below Average", value: reportPerformanceRows.filter(r => r.ratio !== null && r.ratio < 1).length, valueColor: [15, 153, 24], caption: "products" },
          { label: "Not Enough Data", value: newProducts.length, caption: "product" },
        ],
        statusBullets: [
          `${activeProducts.length} active menu`,
          `${newProducts.length} with not enough data yet (e.g. ${newProducts[0]?.product}: ${newProducts[0]?.forecastStatus})`,
          `${inactiveProducts.length} inactive (${inactiveProducts[0]?.product}, last sale ${inactiveProducts[0]?.lastSale})`,
        ],
        narrativeText: `${topPerformers[0]?.product || "—"} was the top performer this period. ${needsReview[0]?.product || "No products"} underperformed and may need a promo or menu review.`,
        topPerformers, needsReview, demandRows: reportDemandRows,
        disclaimer: "Disclaimer \u2014 Performance ratio compares each product's sales against the store average across all active products.",
      });
      doc.save("product-performance-report.pdf");
    } else {
      const sheetMap = {
        // Whole numbers in the spreadsheet; the rows themselves keep the raw
        // forecast because the bar chart sizes its bars from it.
        demand: { sheetName: "Demand Classification", rows: reportDemandRows.map((r) => ({ ...r, forecastQty: roundItems(r.forecastQty) })) },
        ratio: { sheetName: "Performance Ratio", rows: reportPerformanceRows },
        status: { sheetName: "Product Status", rows: [...activeProducts, ...newProducts, ...inactiveProducts] },
      };
      generateExcel(
        Object.entries(sheetMap).filter(([id]) => selectedTableIds.includes(id)).map(([, v]) => v),
        "product-performance-report.xlsx"
      );
    }

    logAuditEvent(
      'report_generated',
      `Generated the Product Performance report (${format === 'pdf' ? 'PDF' : 'Excel'})${formatAuditDateRange(dateRange) ? ` — ${formatAuditDateRange(dateRange)}` : ''}`
    );
      toast.success("Report generated successfully!");
    } catch (err) {
      console.error("Error building report:", err);
      toast.error("Failed to generate report.");
      return;
    }
    setIsReportModalOpen(false);
  };



  // Product search. Two independent queries: one feeds the Demand
  // Classification table, the other the Performance Ratio table, so typing in
  // one card does not silently empty the other. Chart series are left
  // unfiltered so the visual still shows overall shape. Page counters reset in
  // the change handler, not an effect, to avoid a stale page showing empty.
  const matchesQuery = (row, query) =>
    (row.product || "").toLowerCase().includes(query.trim().toLowerCase());

  const filteredDemandRows = demandRows.filter((row) => matchesQuery(row, demandQuery));
  const filteredPerformanceRows = performanceRows.filter((row) => matchesQuery(row, ratioQuery));

  const handleDemandQueryChange = (value) => {
    setDemandQuery(value);
    setDemandPage(1);
    setModalDemandPage(1);
  };

  const handleRatioQueryChange = (value) => {
    setRatioQuery(value);
    setRatioPage(1);
    setModalRatioPage(1);
  };

  const totalDemandPages = Math.max(1, Math.ceil(filteredDemandRows.length / ROWS_PER_PAGE));
  const paginatedDemandRows = filteredDemandRows.slice(
    (demandPage - 1) * ROWS_PER_PAGE, demandPage * ROWS_PER_PAGE
  );

  const totalRatioPages = Math.max(1, Math.ceil(filteredPerformanceRows.length / ROWS_PER_PAGE));
  const paginatedRatioRows = filteredPerformanceRows.slice(
    (ratioPage - 1) * ROWS_PER_PAGE, ratioPage * ROWS_PER_PAGE
  );

  // Bar chart pagination — 5 bars per page in the panel
  const totalDemandChartPages = Math.max(1, Math.ceil(demandRows.length / ROWS_PER_PAGE));
  const paginatedDemandChartRows = demandRows.slice(
    (demandChartPage - 1) * ROWS_PER_PAGE, demandChartPage * ROWS_PER_PAGE
  );

  const totalRatioChartPages = Math.max(1, Math.ceil(ratioChartRows.length / ROWS_PER_PAGE));
  const paginatedRatioChartRows = ratioChartRows.slice(
    (ratioChartPage - 1) * ROWS_PER_PAGE, ratioChartPage * ROWS_PER_PAGE
  );

  const paginatedActiveProducts = activeProducts.slice(
    (activeStatusPage - 1) * ROWS_PER_PAGE, activeStatusPage * ROWS_PER_PAGE
  );
  const paginatedNewProducts = newProducts.slice(
    (newStatusPage - 1) * ROWS_PER_PAGE, newStatusPage * ROWS_PER_PAGE
  );
  const paginatedInactiveProducts = inactiveProducts.slice(
    (inactiveStatusPage - 1) * ROWS_PER_PAGE, inactiveStatusPage * ROWS_PER_PAGE
  );
  const paginatedArchivedProducts = archivedProducts.slice(
    (archivedStatusPage - 1) * ROWS_PER_PAGE, archivedStatusPage * ROWS_PER_PAGE
  );

  const modalDemandRows = filteredDemandRows.slice((modalDemandPage - 1) * 10, modalDemandPage * 10);
  const modalRatioRows = filteredPerformanceRows.slice((modalRatioPage - 1) * 10, modalRatioPage * 10);
  const modalDemandChartRows = demandRows.slice((modalDemandChartPage - 1) * 10, modalDemandChartPage * 10);
  const modalRatioChartRows = ratioChartRows.slice((modalRatioChartPage - 1) * 10, modalRatioChartPage * 10);
  // Scale = the largest ratio on the page being shown (at least 2).
  const pageRatioMax = ratioBarMax(paginatedRatioChartRows.map((r) => r.ratio));
  const modalRatioMax = ratioBarMax(modalRatioChartRows.map((r) => r.ratio));
  const modalActiveProducts = activeProducts.slice((modalActiveStatusPage - 1) * 10, modalActiveStatusPage * 10);
  const modalNewProducts = newProducts.slice((modalNewStatusPage - 1) * 10, modalNewStatusPage * 10);
  const modalInactiveProducts = inactiveProducts.slice((modalInactiveStatusPage - 1) * 10, modalInactiveStatusPage * 10);
  const modalArchivedProducts = archivedProducts.slice((modalArchivedStatusPage - 1) * 10, modalArchivedStatusPage * 10);

  return (
    <>
      <div className="analytics-col-main">
        {loadError && (
          <InfoBanner variant="info">
            Couldn't load product performance data: {loadError}
          </InfoBanner>
        )}
        {isLoading && !apiData && <p className="table-footnote">Loading product performance data…</p>}
        {/* Demand Classification */}
        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Demand Classification
              <Tippy
                content={tooltips.demandClassification}
                placement="bottom"
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
            <button type="button" className="btn-expand-panel" onClick={() => setIsDemandClassOpen(true)} aria-label="Expand Demand Classification">
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="analytics-filter-row">
            <DatePicker value={selectedRange} onChange={handleRangeChange} mode="range" />
            <input
              className="filter-search"
              type="search"
              value={demandQuery}
              onChange={(e) => handleDemandQueryChange(e.target.value)}
              placeholder="Search Product"
              aria-label="Search products in demand classification"
            />
          </div>

          <p className="section-note">
            Demand level per product{demandDateLabel ? ` — ${demandDateLabel}` : ""}. The bar shows the forecast.
            Colored zones show what's normal vs. above normal for each product.
          </p>

          {!isLoading && demandRows.length === 0 && (
            <EmptyState
              title="No forecast in this date range"
              message="No sales in this date range, so there is nothing to classify. Forecasts run every day at 9:00 AM."
              actionLabel="Last 7 days"
              onAction={applyLast7Days}
            />
          )}

          <div className="demand-bar-chart">
            {paginatedDemandChartRows.map((row) => (
              <DemandBar
                key={row.product}
                label={row.product}
                qty={row.forecastQty}
                maxQty={maxQty}
                zone={row.zone}
              />
            ))}
          </div>

          <Pagination currentPage={demandChartPage} totalPages={totalDemandChartPages} onPageChange={setDemandChartPage} />

          <div className="chart-legend">
            <span className="legend-item"><span className="legend-swatch legend-swatch--low" /> Low Zone</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--medium" /> Medium Zone</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--high" /> High Zone</span>
          </div>

          <div className="table-scroll" tabIndex={0} role="region" aria-label="Demand classification: forecast quantity, demand level and action signal by product">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Forecast Qty. (Tomorrow)</th>
                  <th>Demand Level</th>
                  <th>Action Signal</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDemandRows.map((row, i) => (
                  <tr key={row.product}>
                    <td data-label="No.">{i + 1}</td>
                    <td data-label="Date">{row.date}</td>
                    <td data-label="Product">{row.product}</td>
                    <td data-label="Forecast Qty. (Tomorrow)">{formatItemsSold(row.forecastQty, { withUnit: true })}</td>
                    <td data-label="Demand Level">
                      <span className={`pill ${pillClass[row.demandLevel]}`}>{row.demandLevel}</span>
                    </td>
                    <td data-label="Action Signal" className="action-signal">{getActionSignal(row.demandLevel, row.bottleneckIngredient, row.bottleneckStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={demandPage} totalPages={totalDemandPages} onPageChange={setDemandPage} />
        </section>

        {/* Product Performance Ratio Analysis */}
        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Product Performance Ratio Analysis
              <Tippy
                content={tooltips.performanceRatio}
                placement="bottom"
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
            <button type="button" className="btn-expand-panel" onClick={() => setIsRatioOpen(true)} aria-label="Expand Product Performance Ratio Analysis">
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="analytics-filter-row">
            <DatePicker value={selectedRange} onChange={handleRangeChange} mode="range" />
            <input
              className="filter-search"
              type="search"
              value={ratioQuery}
              onChange={(e) => handleRatioQueryChange(e.target.value)}
              placeholder="Search Product"
              aria-label="Search products in performance ratio"
            />
            <button
              type="button"
              className="filter-pill"
              onClick={applyLast7Days}
              title="The 7 days ending on your latest uploaded sales"
            >
              Last 7 Days <FiChevronDown size={14} />
            </button>
          </div>

          <p className="section-note">
            How each dish compares to your store average. The center line is your store's
            average. Bars going right = selling better than average. Bars going left =
            selling below average.
          </p>

          {ratioAsOf && (
            <p className="section-note">Ratio as of {fromYmd(ratioAsOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} (latest forecast).</p>
          )}

          {!isLoading && !hasSalesInRange && (
            <EmptyState
              title="No sales in this date range"
              message="No sales in this date range. Pick another range, or go back to the last 7 days with sales."
              actionLabel="Last 7 days"
              onAction={applyLast7Days}
            />
          )}

          <div className="ratio-bar-chart">
            {paginatedRatioChartRows.map((row) => (
              <RatioBar key={row.product} label={row.product} ratio={row.ratio} maxRatio={pageRatioMax} />
            ))}
            <div className="ratio-bar-axis">
              <span>← Below Average</span>
              <span>Store Average (1.0)</span>
              <span>Above Average →</span>
            </div>
          </div>

          <Pagination currentPage={ratioChartPage} totalPages={totalRatioChartPages} onPageChange={setRatioChartPage} />

          <div className="chart-legend">
            <span className="legend-item"><span className="legend-swatch legend-swatch--above" /> Above Average (ratio &gt; 1.0)</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--below" /> Below Average (ratio &lt; 1.0)</span>
          </div>

          <div className="table-scroll" tabIndex={0} role="region" aria-label="Product performance ratio: rank, quantity sold, revenue and ratio versus store average">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Product</th>
                  <th>Quantity Sold</th>
                  <th>Revenue</th>
                  <th>Performance Ratio</th>
                  <th>Action Signal</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRatioRows.map((row) => (
                  <tr key={row.product}>
                    <td data-label="Rank">{row.rank}</td>
                    <td data-label="Product">{row.product}</td>
                    <td data-label="Quantity Sold">{row.qtySold}</td>
                    <td data-label="Revenue">{row.revenue}</td>
                    <td data-label="Performance Ratio" className={ratioClass(row.ratio)}>
                      {ratioText(row.ratio)}
                    </td>
                    <td data-label="Action Signal" className="action-signal">{row.actionSignal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination currentPage={ratioPage} totalPages={totalRatioPages} onPageChange={setRatioPage} />

          <p className="table-footnote">
            Ratio above 1.0 = outperforming store average · Ratio below 1.0 = underperforming
          </p>
        </section>
      </div>

      <div className="analytics-col-side">
        <button type="button" className="btn-generate-report" onClick={() => setIsReportModalOpen(true)}>
          Generate Report
        </button>

        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Product Status
              <Tippy
                content={tooltips.productStatus}
                placement="bottom"
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
            <button type="button" className="btn-expand-panel" onClick={() => setIsStatusOpen(true)} aria-label="Expand Product Status">
              <FiExternalLink size={16} />
            </button>
          </div>

          <InfoBanner variant="info">
            Products with no sales in the last 28 days the store was open are marked Inactive (Discontinued).
            Products with fewer than 42 days with sales are Inactive (Not enough data) until they reach 42.
          </InfoBanner>

          <div className="status-group">
            <p className="status-group-title">Active Product</p>
            <p className="status-group-subtitle">There {statusCounts.active === 1 ? "is" : "are"} {statusCounts.active} menu item{statusCounts.active === 1 ? "" : "s"} active</p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Active products: days on menu and forecast status">
              <table className="analytics-table analytics-table--compact">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Product</th>
                    <th>Days on Menu</th>
                    <th>Forecast Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedActiveProducts.map((row, i) => (
                    <tr key={row.product}>
                      <td data-label="No.">{i + 1}</td>
                      <td data-label="Product">{row.product}</td>
                      <td data-label="Days on Menu">{row.daysOnMenu}</td>
                      <td data-label="Forecast Status" className="value--success">{row.forecastStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={activeStatusPage} totalPages={Math.max(1, Math.ceil(activeProducts.length / ROWS_PER_PAGE))} onPageChange={setActiveStatusPage} />
          </div>

          <div className="status-group">
            <p className="status-group-title">Inactive (Not enough data)</p>
            <p className="status-group-subtitle">
              Fewer than 42 days with sales. Forecasting starts at 42.
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Products with not enough data: days on menu and forecast status">
              <table className="analytics-table analytics-table--compact">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Product</th>
                    <th>Days on Menu</th>
                    <th>Forecast Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedNewProducts.map((row, i) => (
                    <tr key={row.product}>
                      <td data-label="No.">{i + 1}</td>
                      <td data-label="Product">{row.product}</td>
                      <td data-label="Days on Menu">{row.daysOnMenu}</td>
                      <td data-label="Forecast Status" className="value--warning">{row.forecastStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={newStatusPage} totalPages={Math.max(1, Math.ceil(newProducts.length / ROWS_PER_PAGE))} onPageChange={setNewStatusPage} />
          </div>

          <div className="status-group">
            <p className="status-group-title">Inactive Product</p>
            <p className="status-group-subtitle">
              System auto-flags product inactive with 0 sales for 28 consecutive days
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Inactive products: last sale and forecast status">
              <table className="analytics-table analytics-table--compact">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Product</th>
                    <th>Last Sale</th>
                    <th>Forecast Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedInactiveProducts.map((row, i) => (
                    <tr key={row.product}>
                      <td data-label="No.">{i + 1}</td>
                      <td data-label="Product">{row.product}</td>
                      <td data-label="Last Sale">{row.lastSale}</td>
                      <td data-label="Forecast Status" className="value--error">{row.forecastStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={inactiveStatusPage} totalPages={Math.max(1, Math.ceil(inactiveProducts.length / ROWS_PER_PAGE))} onPageChange={setInactiveStatusPage} />
          </div>

          <div className="status-group">
            <p className="status-group-title">Archived Product</p>
            <p className="status-group-subtitle">
              Permanently removed from the menu, or temporarily off the menu and will return.
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Archived products: last sale and forecast status">
              <table className="analytics-table analytics-table--compact">
                <thead>
                  <tr>
                    <th>No.</th><th>Product</th><th>Last Sale</th><th>Forecast Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedArchivedProducts.map((row, i) => (
                    <tr key={row.product}>
                      <td data-label="No.">{(archivedStatusPage - 1) * ROWS_PER_PAGE + i + 1}</td>
                      <td data-label="Product">{row.product}</td>
                      <td data-label="Last Sale">{row.lastSale}</td>
                      <td data-label="Forecast Status" className="value--error">{row.forecastStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={archivedStatusPage}
              totalPages={Math.max(1, Math.ceil(archivedProducts.length / ROWS_PER_PAGE))}
              onPageChange={setArchivedStatusPage}
            />
          </div>
        </section>
      </div>
    {isReportModalOpen && (
        <GenerateReportModal
          reportTitle="Product Performance Report"
          availableTables={availableTables}
          onCancel={() => setIsReportModalOpen(false)}
          onGenerate={handleGenerateReport}
        />
      )}

      <ExpandableModal
        isOpen={isDemandClassOpen}
        onClose={() => setIsDemandClassOpen(false)}
        title="Demand Classification — Full View"
      >
        <div className="demand-bar-chart">
          {modalDemandChartRows.map((row) => (
            <DemandBar key={row.product} label={row.product} qty={row.forecastQty} maxQty={maxQty} zone={row.zone} />
          ))}
        </div>
        <Pagination
          currentPage={modalDemandChartPage}
          totalPages={Math.max(1, Math.ceil(demandRows.length / 10))}
          onPageChange={setModalDemandChartPage}
        />
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-swatch legend-swatch--low" /> Low Zone</span>
          <span className="legend-item"><span className="legend-swatch legend-swatch--medium" /> Medium Zone</span>
          <span className="legend-item"><span className="legend-swatch legend-swatch--high" /> High Zone</span>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Demand classification: forecast quantity, demand level and action signal by product (full view)">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>No.</th><th>Date</th><th>Product</th><th>Forecast Qty. (Tomorrow)</th><th>Demand Level</th><th>Action Signal</th>
              </tr>
            </thead>
            <tbody>
              {modalDemandRows.map((row, i) => (
                <tr key={row.product}>
                  <td>{(modalDemandPage - 1) * 10 + i + 1}</td>
                  <td>{row.date}</td>
                  <td>{row.product}</td>
                  <td>{formatItemsSold(row.forecastQty, { withUnit: true })}</td>
                  <td><span className={`pill ${pillClass[row.demandLevel]}`}>{row.demandLevel}</span></td>
                  <td className="action-signal">{getActionSignal(row.demandLevel, row.bottleneckIngredient, row.bottleneckStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={modalDemandPage}
          totalPages={Math.max(1, Math.ceil(filteredDemandRows.length / 10))}
          onPageChange={setModalDemandPage}
        />
      </ExpandableModal>

      <ExpandableModal
        isOpen={isRatioOpen}
        onClose={() => setIsRatioOpen(false)}
        title="Product Performance Ratio Analysis — Full View"
      >
        <div className="ratio-bar-chart">
          {modalRatioChartRows.map((row) => (
            <RatioBar key={row.product} label={row.product} ratio={row.ratio} maxRatio={modalRatioMax} />
          ))}
          <div className="ratio-bar-axis">
            <span>← Below Average</span>
            <span>Store Average (1.0)</span>
            <span>Above Average →</span>
          </div>
        </div>
        <Pagination
          currentPage={modalRatioChartPage}
          totalPages={Math.max(1, Math.ceil(ratioChartRows.length / 10))}
          onPageChange={setModalRatioChartPage}
        />
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-swatch legend-swatch--above" /> Above Average (ratio &gt; 1.0)</span>
          <span className="legend-item"><span className="legend-swatch legend-swatch--below" /> Below Average (ratio &lt; 1.0)</span>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Product performance ratio: rank, quantity sold, revenue and ratio versus store average (full view)">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Rank</th><th>Product</th><th>Quantity Sold</th><th>Revenue</th><th>Performance Ratio</th><th>Action Signal</th>
              </tr>
            </thead>
            <tbody>
              {modalRatioRows.map((row) => (
                <tr key={row.product}>
                  <td>{row.rank}</td>
                  <td>{row.product}</td>
                  <td>{row.qtySold}</td>
                  <td>{row.revenue}</td>
                  <td className={ratioClass(row.ratio)}>{ratioText(row.ratio)}</td>
                  <td className="action-signal">{row.actionSignal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={modalRatioPage}
          totalPages={Math.max(1, Math.ceil(filteredPerformanceRows.length / 10))}
          onPageChange={setModalRatioPage}
        />
      </ExpandableModal>

      <ExpandableModal
        isOpen={isStatusOpen}
        onClose={() => setIsStatusOpen(false)}
        title="Product Status — Full View"
      >
        <InfoBanner variant="info">
          Products with no sales in the last 28 days the store was open are marked Inactive (Discontinued).
          Products with fewer than 42 days with sales are Inactive (Not enough data) until they reach 42.
        </InfoBanner>

        <div className="status-group">
          <p className="status-group-title">Active Product</p>
          <p className="status-group-subtitle">There {statusCounts.active === 1 ? "is" : "are"} {statusCounts.active} menu item{statusCounts.active === 1 ? "" : "s"} active</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Active products: days on menu and forecast status (full view)">
            <table className="analytics-table analytics-table--compact">
              <thead><tr><th>No.</th><th>Product</th><th>Days on Menu</th><th>Forecast Status</th></tr></thead>
              <tbody>{modalActiveProducts.map((row, i) => (
                <tr key={row.product}><td>{(modalActiveStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.daysOnMenu}</td><td className="value--success">{row.forecastStatus}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination currentPage={modalActiveStatusPage} totalPages={Math.max(1, Math.ceil(activeProducts.length / 10))} onPageChange={setModalActiveStatusPage} />
        </div>

        <div className="status-group">
          <p className="status-group-title">Inactive (Not enough data)</p>
          <p className="status-group-subtitle">Fewer than 42 days with sales. Forecasting starts at 42.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Products with not enough data: days on menu and forecast status (full view)">
            <table className="analytics-table analytics-table--compact">
              <thead><tr><th>No.</th><th>Product</th><th>Days on Menu</th><th>Forecast Status</th></tr></thead>
              <tbody>{modalNewProducts.map((row, i) => (
                <tr key={row.product}><td>{(modalNewStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.daysOnMenu}</td><td className="value--warning">{row.forecastStatus}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination currentPage={modalNewStatusPage} totalPages={Math.max(1, Math.ceil(newProducts.length / 10))} onPageChange={setModalNewStatusPage} />
        </div>

        <div className="status-group">
          <p className="status-group-title">Inactive Product</p>
          <p className="status-group-subtitle">System auto-flags product inactive with 0 sales for 28 consecutive days</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Inactive products: last sale and forecast status (full view)">
            <table className="analytics-table analytics-table--compact">
              <thead><tr><th>No.</th><th>Product</th><th>Last Sale</th><th>Forecast Status</th></tr></thead>
              <tbody>{modalInactiveProducts.map((row, i) => (
                <tr key={row.product}><td>{(modalInactiveStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.lastSale}</td><td className="value--error">{row.forecastStatus}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination currentPage={modalInactiveStatusPage} totalPages={Math.max(1, Math.ceil(inactiveProducts.length / 10))} onPageChange={setModalInactiveStatusPage} />
        </div>

        <div className="status-group">
          <p className="status-group-title">Archived Product</p>
          <p className="status-group-subtitle">Permanently removed from the menu, or temporarily off the menu and will return.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Archived products: last sale and forecast status (full view)">
            <table className="analytics-table analytics-table--compact">
              <thead><tr><th>No.</th><th>Product</th><th>Last Sale</th><th>Forecast Status</th></tr></thead>
              <tbody>{modalArchivedProducts.map((row, i) => (
                <tr key={row.product}><td>{(modalArchivedStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.lastSale}</td><td className="value--error">{row.forecastStatus}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination currentPage={modalArchivedStatusPage} totalPages={Math.max(1, Math.ceil(archivedProducts.length / 10))} onPageChange={setModalArchivedStatusPage} />
        </div>
      </ExpandableModal>
    </> 
  );
}

export default ProductPerformance;