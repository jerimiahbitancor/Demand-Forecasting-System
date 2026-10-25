// components/IngredientDemand.jsx
import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { FiInfo, FiDownload, FiExternalLink, FiShoppingCart, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import GenerateReportModal from "../../components/Reports/GenerateReportModal.jsx";
import { buildIngredientDemandPDF, buildGroceryListPDF, generateExcel } from "./../../../services/reportService.js";
import { logAuditEvent, formatAuditDateRange } from "../../../services/auditClient.js";
import DatePicker from "./shared/DatePicker.jsx";
import ExpandableModal from "./shared/ExpandableModal.jsx";
import Pagination from "./shared/Pagination.jsx";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import InfoBanner from "./shared/InfoBanner.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import { formatIngredientDemandQty, formatIngredientDemandMoney } from "../../../utils/formatIngredientDemand.js";
import { useNavigate } from "react-router-dom";
import { authService } from "../../../services/authService.js";
import { toYmd, fromYmd, mondayOf } from "../../../utils/localDate.js";
import { manilaToday, addDays, shortDateLabel } from "../../dashboard/utils/dashboardPanels.js";
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
    values: r.values.map((v) => Number(v) || 0),
    unit: r.unit || null,
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
    rawForecasted: r.rawForecastedNeed,
    safetyBuffer: r.safetyBuffer,
    onStock: r.onStock,
    unit: r.unit,
    status: r.status,
    predictedStatus: r.predictedStatus || r.status,
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
    predictedStatus: item.predictedStatus || item.status,
    toBuy: item.toBuy,
    marketPrice: item.marketPrice,
    estCost: item.estCost,
  }));
}

// "Used in" can list every product an ingredient appears in, which is far too
// long for one table cell and wraps the row into an uneven tower. Show the
// first product and fold the rest behind a "+N more" that reveals the full
// list on hover.
const USED_IN_PREVIEW = 1;

function UsedInCell({ value }) {
  const text = value && value !== "—" ? String(value) : "";
  const names = text ? text.split(/\s*,\s*/).filter(Boolean) : [];
  if (names.length <= USED_IN_PREVIEW) {
    return <>{value || "—"}</>;
  }
  const shown = names.slice(0, USED_IN_PREVIEW).join(", ");
  const more = names.length - USED_IN_PREVIEW;
  return (
    <Tippy
      content={names.join(", ")}
      placement="top"
      animation="scale"
      duration={200}
      theme="dark"
      maxWidth={320}
      interactive
    >
      <span className="used-in-cell" tabIndex={0} aria-label={`Used in: ${names.join(", ")}`}>
        <span className="used-in-text">{shown}</span>
        <span className="used-in-more"> +{more} more</span>
      </span>
    </Tippy>
  );
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
const GROCERY_OTHER = "Other";
const GROCERY_GROUPS = [...GROCERY_CATEGORIES, GROCERY_OTHER];

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
        Weekly demand = Σ(Forecasted Servings × Recipe Qty); no safety buffer is applied.
      </span>
    </div>
  ),
  
  dailyShoppingList: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Daily Ingredient Shopping List
      </strong>
      This is your shopping list for the day shown, based on predicted sales and your recipe amounts.
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
      This shows what the system estimates you'll need to buy based on the predicted sales for the day shown.
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
      This is your ready-to-buy ingredient list based on the forecast for the day shown (Daily)
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
  // Two separate controls: the daily table is one day ("YYYY-MM-DD"), the
  // weekly heatmap is a fixed Mon–Sun week (its Monday). query = null on
  // first load: the backend picks (today, or the next open forecast day when
  // today is closed: daily.shiftedFromClosedDay) and the controls show what
  // it used. After a pick, both dates are sent.
  const [query, setQuery] = useState(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [weeklyPage, setWeeklyPage] = useState(1);
  const [dailyPage, setDailyPage] = useState(1);
  const [weeklyQuery, setWeeklyQuery] = useState('');
  const [dailyQuery, setDailyQuery] = useState('');
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
  const navigate = useNavigate();
  const goToProductManagement = () => navigate("/inventory-management?tab=product");

  // Refetch on either control. `cancelled` drops the answer of a request
  // that a newer pick replaced, so a slow old response never wins.
  useEffect(() => {
    let cancelled = false;

    async function fetchIngredientDemand() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const headers = await authService.getAuthHeaders();
        const response = await axios.get(`${API_URL}/analytics/ingredient-demand`, {
          headers,
          params: query || undefined,
        });
        if (!cancelled) {
          setApiData(response.data?.data || null);
          setWeeklyPage(1);
          setDailyPage(1);
          setModalWeeklyPage(1);
          setModalDailyPage(1);
        }
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
  }, [query]);

  // The dates on screen: the last pick, else the dates the backend used.
  const shownDaily = query?.date || apiData?.daily?.date || null;
  const shownWeekStart = query?.weekStart || apiData?.weekly?.weekStart || null;
  const shiftWeek = (weeks) => {
    if (!shownWeekStart) return;
    setQuery({ date: shownDaily || manilaToday(), weekStart: addDays(shownWeekStart, weeks * 7) });
  };
  const handleDailyDateChange = (date) => {
    const ymd = toYmd(date);
    setQuery({ date: ymd, weekStart: shownWeekStart || mondayOf(ymd) });
  };
  // While the default is in use: "Closed today. Showing Monday, Oct 19."
  // when today's rows are all closed-day rows, "No forecast for today yet.
  // Showing …" when today has none (backend daily.shiftReason).
  const shiftReason = !query ? apiData?.daily?.shiftReason : null;
  const closedTodayNote = shiftReason && apiData?.daily?.date
    ? `${shiftReason === "closed" ? "Closed today." : "No forecast for today yet."} Showing ${fromYmd(apiData.daily.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.`
    : null;

  // --- Derive the same shapes the JSX below already expects. ---
  const demandGrid = buildDemandGrid(apiData?.weekly?.rows);
  const cellLevel = (row, dayIndex) =>
    row.levels ? apiLevelToCssSuffix(row.levels[dayIndex]) : dayIndex === row.highDay ? "high" : "normal";

  const dailyIngredients = buildDailyIngredients(apiData?.daily?.rows);
  // ONE list for the preview card, the KPI cards, the full view and the
  // download: the selected mode's own (daily = the picked day, weekly = the
  // heatmap's week).
  const groceryApi = groceryMode === "weekly" ? apiData?.groceryListWeekly : apiData?.groceryList;
  const groceryPreview = buildGroceryList(groceryApi?.all);
  // The full view and the PDF group by category. An ingredient whose
  // category is not one of the groups goes under "Other" instead of
  // silently dropping out (the KPI cards count it).
  const groceryGrouped = groceryPreview.map((item) => (
    GROCERY_CATEGORIES.includes(item.category) ? item : { ...item, category: GROCERY_OTHER }
  ));
  const safetyBufferPercentage = apiData?.safetyBufferPercentage ?? 15;

  // K6: say WHY a section is empty. No forecast rows -> wait for the 9:00 AM
  // run; forecasts exist but no demand -> no recipe linked yet.
  const loaded = !isLoading && !!apiData;
  const noForecastWeek = (
    <EmptyState
      title="No forecast for this week yet"
      message="No forecast for this week yet. Forecasts run every day at 9:00 AM."
    />
  );
  const noForecastDay = (
    <EmptyState
      title="No forecast for this day yet"
      message="No forecast for this week yet. Forecasts run every day at 9:00 AM."
    />
  );
  const noRecipe = (
    <EmptyState
      title="No recipe linked yet"
      message="No recipe linked to these products yet."
      actionLabel="Go to Product Management"
      onAction={goToProductManagement}
    />
  );
  const weeklyEmpty = loaded && demandGrid.length === 0;
  const weeklyEmptyState = apiData?.weekly?.hasForecasts ? noRecipe : noForecastWeek;
  const dailyEmpty = loaded && dailyIngredients.length === 0;
  const dailyEmptyState = apiData?.daily?.hasForecasts ? noRecipe : noForecastDay;

  const dailyDateLabel = formatLongDate(apiData?.daily?.date);
  const weeklyRangeLabel = apiData?.weekly
    ? `${shortDateLabel(apiData.weekly.weekStart)} – ${shortDateLabel(apiData.weekly.weekEnd)}`
    : "—";
  // Grocery label from the API's own dates (never the browser clock):
  // "For Oct 18" / "For the week of Oct 12 – 18".
  const groceryDateLabel = (() => {
    if (groceryMode === "daily") {
      return apiData?.daily?.date ? `For ${shortDateLabel(apiData.daily.date)}` : "—";
    }
    const ws = apiData?.groceryListWeekly?.weekStart;
    const we = apiData?.groceryListWeekly?.weekEnd;
    if (!ws || !we) return "—";
    const end = ws.slice(0, 7) === we.slice(0, 7) ? String(Number(we.slice(8, 10))) : shortDateLabel(we);
    return `For the week of ${shortDateLabel(ws)} – ${end}`;
  })();
  const groceryFileDate = groceryMode === "daily" ? apiData?.daily?.date : apiData?.groceryListWeekly?.weekStart;

  // Week stepper label: the API's own week once it has answered for this
  // Monday, otherwise the picked week.
  const weekLabel = !shownWeekStart
    ? "—"
    : apiData?.weekly?.weekStart === shownWeekStart
      ? weeklyRangeLabel
      : `${shortDateLabel(shownWeekStart)} – ${shortDateLabel(addDays(shownWeekStart, 6))}`;

  // Two independent searches: the weekly heatmap grid is keyed on
  // `ingredient`, the daily table on `name`. Each has its own query so typing
  // in one card never empties the other. Page counters reset in the change
  // handler rather than an effect, so a stale page > 1 can't show empty.
  const filteredDemandGrid = demandGrid.filter((row) =>
    (row.ingredient || "").toLowerCase().includes(weeklyQuery.trim().toLowerCase())
  );
  const filteredDailyIngredients = dailyIngredients.filter((row) =>
    (row.name || "").toLowerCase().includes(dailyQuery.trim().toLowerCase())
  );

  const handleWeeklyQueryChange = (value) => {
    setWeeklyQuery(value);
    setWeeklyPage(1);
    setModalWeeklyPage(1);
  };

  const handleDailyQueryChange = (value) => {
    setDailyQuery(value);
    setDailyPage(1);
    setModalDailyPage(1);
  };

  const totalWeeklyPages = Math.max(1, Math.ceil(filteredDemandGrid.length / ROWS_PER_PAGE));
  const paginatedWeekly = filteredDemandGrid.slice(
    (weeklyPage - 1) * ROWS_PER_PAGE, weeklyPage * ROWS_PER_PAGE
  );
  const totalDailyPages = Math.max(1, Math.ceil(filteredDailyIngredients.length / ROWS_PER_PAGE));
  const paginatedDaily = filteredDailyIngredients.slice(
    (dailyPage - 1) * ROWS_PER_PAGE, dailyPage * ROWS_PER_PAGE
  );

  const handleDownloadGroceryList = async () => {
    // Exactly the list on screen (same mode, same items, same groups).
    const itemsToDownload = groceryGrouped;
    if (itemsToDownload.length === 0) {
      toast.error(groceryMode === "weekly" ? "Nothing to buy for this week." : "Nothing to buy for this day.");
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

    const dateLabel = groceryDateLabel;

    try {
      const doc = await buildGroceryListPDF({
        dateLabel,
        business: biz,
        groceryMode,
        itemsToDownload,
        estTotalCost: groceryApi?.totals?.estTotalCost,
        GROCERY_CATEGORIES: GROCERY_GROUPS,
      });

      const filename = `grocery-list-chefduo-${groceryMode}${groceryFileDate ? `-${groceryFileDate}` : ""}.pdf`;
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
    // Local calendar dates: toISOString() would shift them a day back in Manila.
    const [from, to] = dateRange.map((d) => toYmd(d));
    let reportDemandGrid, reportDailyIngredients, reportDailyDate;
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.get(`${API_URL}/analytics/ingredient-demand`, {
        headers,
        params: { date: to, weekStart: from },
      });
      const data = response.data?.data;
      reportDemandGrid = buildDemandGrid(data?.weekly?.rows);
      reportDailyIngredients = buildDailyIngredients(data?.daily?.rows);
      reportDailyDate = data?.daily?.date || to;
    } catch (err) {
      console.error("Error fetching report data:", err);
      toast.error("Failed to load data for the selected date range.");
      return;
    }

    if (reportDemandGrid.length === 0 && reportDailyIngredients.length === 0) {
      toast.error("No data is available for the selected date range.");
      return;
    }

    const shoppingListRows = reportDailyIngredients
      .filter((item) => item.status === "Critical" || item.status === "Low")
      .map((item) => {
        return {
          ingredient: item.name,
          linkedDishes: item.usedIn,
          baseQty: formatIngredientDemandQty(item.rawForecasted, item.unit),
          buffer: formatIngredientDemandQty(item.safetyBuffer, item.unit),
          total: formatIngredientDemandQty(item.forecasted, item.unit),
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
          shoppingDateLabel: fromYmd(reportDailyDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        });
        doc.save("ingredient-demand-report.pdf");
      } else {
      const sheetMap = {
        weekly: {
          sheetName: "Weekly Ingredient Demand",
          rows: reportDemandGrid.map((row) => ({
            ingredient: row.ingredient,
            ...Object.fromEntries(weekDays.map((d, i) => [d, formatIngredientDemandQty(row.values[i], row.unit)])),
          })),
        },
        daily: {
          sheetName: "Daily Ingredient Demand",
          rows: reportDailyIngredients.map((row) => ({
            ingredient: row.name,
            usedIn: row.usedIn,
            rawForecast: formatIngredientDemandQty(row.rawForecasted, row.unit),
            safetyBuffer: formatIngredientDemandQty(row.safetyBuffer, row.unit),
            forecastedNeed: formatIngredientDemandQty(row.forecasted, row.unit),
            onStock: formatIngredientDemandQty(row.onStock, row.unit),
            predictedStockLevelStatus: row.predictedStatus,
            toBuy: row.toBuy == null ? "—" : formatIngredientDemandQty(row.toBuy, row.unit),
            pricePerUnit: row.marketPrice == null ? "—" : `${formatIngredientDemandMoney(row.marketPrice)}/${row.unit}`,
            estimatedCost: formatIngredientDemandMoney(row.estCost),
          })),
        },
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

    logAuditEvent(
      'report_generated',
      `Generated the Ingredient Demand report (${format === 'pdf' ? 'PDF' : 'Excel'})${formatAuditDateRange(dateRange) ? ` — ${formatAuditDateRange(dateRange)}` : ''}`
    );
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
          <button type="button" className="btn-expand-panel" onClick={() => setIsWeeklyOpen(true)} aria-label="Expand Weekly Ingredient Demand">
            <FiExternalLink size={16} />
          </button>
          </div>

          <div className="analytics-filter-row">
            <div className="week-stepper" role="group" aria-label="Choose the week">
              <button type="button" className="filter-pill" onClick={() => shiftWeek(-1)} aria-label="Previous week" disabled={!shownWeekStart}>
                <FiChevronLeft size={14} />
              </button>
              <span className="filter-pill week-stepper-label" aria-live="polite">{weekLabel}</span>
              <button type="button" className="filter-pill" onClick={() => shiftWeek(1)} aria-label="Next week" disabled={!shownWeekStart}>
                <FiChevronRight size={14} />
              </button>
            </div>
            <input
                className="filter-search"
                type="search"
                value={weeklyQuery}
                onChange={(e) => handleWeeklyQueryChange(e.target.value)}
                placeholder="Search Ingredient"
                aria-label="Search ingredients in the weekly demand heatmap"
              />
          </div>

          {closedTodayNote && <p className="section-note value--muted">{closedTodayNote}</p>}
          <p className="section-note">
            Ingredient demand for the week of {weekLabel}. Quantities are unbuffered predicted demand.
                Color shows demand level relative to each ingredient's typical amount. Darker = more than usual.
          </p>

          {weeklyEmpty ? weeklyEmptyState : (
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
                      <td>{row.ingredient}</td>
                      {row.values.map((v, di) => (
                        <td key={di} className={`heatmap-cell heatmap-cell--${cellLevel(row, di)}`}>
                          {formatIngredientDemandQty(v, row.unit)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tippy>
          )}

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
              <Tippy content={tooltips.dailyIngredientDemand} placement="bottom" animation="scale" duration={200} theme="dark" arrow maxWidth={380} interactive>
                <span className="info-icon-wrapper"><FiInfo className="info-icon" /></span>
              </Tippy>
            </h2>
            <button type="button" className="btn-expand-panel" onClick={() => setIsDailyOpen(true)} aria-label="Expand Daily Ingredient Demand">
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="analytics-filter-row">
            <DatePicker value={fromYmd(shownDaily || manilaToday())} onChange={handleDailyDateChange} mode="single" />
            <input
              className="filter-search"
              type="search"
              value={dailyQuery}
              onChange={(e) => handleDailyQueryChange(e.target.value)}
              placeholder="Search Ingredient"
              aria-label="Search ingredients in daily demand"
            />
          </div>

          {closedTodayNote && <p className="section-note value--muted">{closedTodayNote}</p>}
          <p className="section-note">
            Ingredient demand for {dailyDateLabel}. Daily forecasted need includes the safety buffer; weekly demand is unbuffered.
            <a href="/inventory-management" style={{color:'var(--color-red-primary)', fontWeight:600}}> View Inventory Management</a>
          </p>

          <div className="stock-legend">
            <span className="stock-legend-pill stock-legend--excess">● Excess — delay restock</span>
            <span className="stock-legend-pill stock-legend--normal">● Normal — no action needed</span>
            <span className="stock-legend-pill stock-legend--low">● Low — order soon</span>
            <span className="stock-legend-pill stock-legend--critical">● Critical — order now</span>
          </div>

          {dailyEmpty ? dailyEmptyState : (<>
          <div className="analytics-scroll-hint">
            Swipe the table sideways to see every column.
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Daily ingredient demand: need, stock, status, quantity to buy and cost by ingredient"
          >
          <table className="analytics-table daily-demand-table">
            <thead><tr><th>No.</th><th>Ingredient</th><th>Used in</th><th>Raw Forecast</th><th>Safety Buffer</th><th>Forecasted Need</th><th>On Stock</th><th>Predicted Stock Level Status</th><th>To Buy</th><th>Price / Unit</th><th>Est. Cost</th></tr></thead>
            <tbody>
              {paginatedDaily.map((row, i) => (
                <tr key={row.name}>
                  <td data-label="No.">{(dailyPage - 1) * ROWS_PER_PAGE + i + 1}</td>
                  <td data-label="Ingredient">{row.name}</td>
                  <td data-label="Used in" className="used-in-col"><UsedInCell value={row.usedIn} /></td>
                  <td data-label="Raw Forecast">{formatIngredientDemandQty(row.rawForecasted, row.unit)}</td>
                  <td data-label="Safety Buffer">{formatIngredientDemandQty(row.safetyBuffer, row.unit)}</td>
                  <td data-label="Forecasted Need">{formatIngredientDemandQty(row.forecasted, row.unit)}</td>
                  <td data-label="On Stock">{formatIngredientDemandQty(row.onStock, row.unit)}</td>
                  <td data-label="Predicted Stock Level Status"><span className={`status-badge status-badge--${row.predictedStatus.toLowerCase().replace(/\s+/g, "-")}`}>{row.predictedStatus}</span></td>
                  <td data-label="To Buy">{row.toBuy === null ? <span className="value--muted">{row.status === "Normal" ? "— no order" : "— delay restock"}</span> : formatIngredientDemandQty(row.toBuy, row.unit)}</td>
                  <td data-label="Price / Unit">{row.marketPrice === null ? "—" : `${formatIngredientDemandMoney(row.marketPrice)}/${row.unit}`}</td>
                  <td data-label="Est. Cost">{formatIngredientDemandMoney(row.estCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </>)}
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
              <Tippy content={tooltips.groceryList} placement="bottom" animation="scale" duration={200} theme="dark" arrow maxWidth={380} interactive>
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
            {groceryDateLabel}
          </p>
          <InfoBanner variant="info">
            Order quantities are based on forecasted demand plus a {safetyBufferPercentage}% safety buffer, minus current stock.{" "}
            <a href="/inventory-management" style={{color:'inherit', fontWeight:600, textDecoration:'underline'}}>See Inventory Management.</a>
          </InfoBanner>
          <div className="grocery-kpi-row">
            <div className="grocery-kpi-card"><p className="grocery-kpi-label">Est. Total Cost</p><p className="grocery-kpi-value">{formatIngredientDemandMoney(groceryApi?.totals?.estTotalCost)}</p></div>
            <div className="grocery-kpi-card"><p className="grocery-kpi-label">Total Items to Buy</p><p className="grocery-kpi-value">{groceryPreview.length}</p></div>
          </div>
          {loaded && groceryPreview.length === 0 && (
            (groceryMode === "weekly" ? demandGrid.length > 0 : dailyIngredients.length > 0)
              ? <EmptyState title="Nothing to buy" message="Nothing to buy: stock covers the forecast." />
              : (groceryMode === "weekly" ? weeklyEmptyState : dailyEmptyState))}
          <ul className="grocery-preview-list">
            {groceryPreview.slice(0, 5).map((item) => (
              <li key={item.name} className="grocery-preview-row">
                <div><p className="grocery-preview-name">{item.name}</p><p className="grocery-preview-sub">Used in: {item.usedIn}</p></div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}><span className={`status-badge status-badge--${item.predictedStatus.toLowerCase().replace(/\s+/g, "-")}`}>{item.predictedStatus}</span><span className="grocery-preview-qty">{formatIngredientDemandQty(item.toBuy, item.unit)}</span></div>
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
        <div className="heatmap-wrapper">
          <table className="analytics-table heatmap-table">
            <thead><tr><th>No.</th><th>Ingredient</th>{weekDays.map((day) => <th key={day}>{day}</th>)}</tr></thead>
            <tbody>{filteredDemandGrid.slice((modalWeeklyPage - 1) * 10, modalWeeklyPage * 10).map((row, i) => (
              <tr key={row.ingredient}><td>{(modalWeeklyPage - 1) * 10 + i + 1}</td><td>{row.ingredient}</td>{row.values.map((value, dayIndex) => <td key={dayIndex} className={`heatmap-cell heatmap-cell--${cellLevel(row, dayIndex)}`}>{formatIngredientDemandQty(value, row.unit)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <Pagination currentPage={modalWeeklyPage} totalPages={Math.max(1, Math.ceil(filteredDemandGrid.length / 10))} onPageChange={setModalWeeklyPage} />
      </ExpandableModal>

      <ExpandableModal isOpen={isDailyOpen} onClose={() => setIsDailyOpen(false)} title="Daily Ingredient Demand — Full View">
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Daily ingredient demand, full view"
        >
        <table className="analytics-table daily-demand-table">
          <thead><tr><th>No.</th><th>Ingredient</th><th>Used in</th><th>Raw Forecast</th><th>Safety Buffer</th><th>Forecasted Need</th><th>On Stock</th><th>Predicted Stock Level Status</th><th>To Buy</th><th>Price / Unit</th><th>Est. Cost</th></tr></thead>
          <tbody>{filteredDailyIngredients.slice((modalDailyPage - 1) * 10, modalDailyPage * 10).map((row, i) => (
            <tr key={row.name}><td data-label="No.">{(modalDailyPage - 1) * 10 + i + 1}</td><td data-label="Ingredient">{row.name}</td><td data-label="Used in" className="used-in-col"><UsedInCell value={row.usedIn} /></td><td data-label="Raw Forecast">{formatIngredientDemandQty(row.rawForecasted, row.unit)}</td><td data-label="Safety Buffer">{formatIngredientDemandQty(row.safetyBuffer, row.unit)}</td><td data-label="Forecasted Need">{formatIngredientDemandQty(row.forecasted, row.unit)}</td><td data-label="On Stock">{formatIngredientDemandQty(row.onStock, row.unit)}</td><td data-label="Predicted Stock Level Status"><span className={`status-badge status-badge--${row.predictedStatus.toLowerCase().replace(/\s+/g, "-")}`}>{row.predictedStatus}</span></td><td data-label="To Buy">{row.toBuy === null ? <span className="value--muted">{row.status === "Normal" ? "— no order" : "— delay restock"}</span> : formatIngredientDemandQty(row.toBuy, row.unit)}</td><td data-label="Price / Unit">{row.marketPrice === null ? "—" : `${formatIngredientDemandMoney(row.marketPrice)}/${row.unit}`}</td><td data-label="Est. Cost">{formatIngredientDemandMoney(row.estCost)}</td></tr>
          ))}</tbody>
        </table>
        </div>
        <Pagination currentPage={modalDailyPage} totalPages={Math.max(1, Math.ceil(filteredDailyIngredients.length / 10))} onPageChange={setModalDailyPage} />
      </ExpandableModal>

      <ExpandableModal isOpen={isGroceryOpen} onClose={() => setIsGroceryOpen(false)} title="Grocery List — Full View">
        <div className="grocery-list-full-view">
        <div className="grocery-toggle">
          <button type="button" className={`grocery-toggle-btn ${groceryMode === 'weekly' ? 'active' : ''}`} onClick={() => setGroceryMode('weekly')}>Weekly</button>
          <button type="button" className={`grocery-toggle-btn ${groceryMode === 'daily' ? 'active' : ''}`} onClick={() => setGroceryMode('daily')}>Daily</button>
        </div>
        <p className="grocery-date-label">{groceryDateLabel}</p>
        <div className="grocery-kpi-row">
          <div className="grocery-kpi-card"><p className="grocery-kpi-label">Est. Total Cost</p><p className="grocery-kpi-value">{formatIngredientDemandMoney(groceryApi?.totals?.estTotalCost)}</p></div>
          <div className="grocery-kpi-card"><p className="grocery-kpi-label">Total Items to Buy</p><p className="grocery-kpi-value">{groceryPreview.length}</p></div>
        </div>
        {GROCERY_GROUPS.map((category) => {
          const items = groceryGrouped.filter((item) => item.category === category);
          if (items.length === 0) return null;
          return (
            <div className="grocery-category" key={category}>
              <p className="status-group-title">{category}</p>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label={`Grocery list: ${category}`}
              >
              <table className="analytics-table analytics-table--compact grocery-list-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty to Buy</th>
                    <th>Price / Unit</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.name}>
                      <td data-label="Item">{item.name}</td>
                      <td data-label="Qty to Buy">{formatIngredientDemandQty(item.toBuy, item.unit)}</td>
                      <td data-label="Price / Unit">{item.marketPrice === null ? "—" : `${formatIngredientDemandMoney(item.marketPrice)}/${item.unit}`}</td>
                      <td data-label="Notes">{item.usedIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn-grocery-download" onClick={handleDownloadGroceryList}><FiDownload size={14} /> Download</button>
        </div>
      </ExpandableModal>
    </>
  );
}

export default IngredientDemand;