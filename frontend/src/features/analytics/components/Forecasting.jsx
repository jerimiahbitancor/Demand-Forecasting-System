// components/Forecasting.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import Swal from '../../../utils/swal';
import { FiInfo, FiExternalLink } from "react-icons/fi";
import GenerateReportModal from "../../components/Reports/GenerateReportModal.jsx";
import { buildSalesForecastPDF, generateExcel } from "./../../../services/reportService.js";
import { logAuditEvent, formatAuditDateRange } from "../../../services/auditClient.js";
import DatePicker from "./shared/DatePicker.jsx";
import ExpandableModal from "./shared/ExpandableModal.jsx";
import Pagination from "./shared/Pagination.jsx";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import InfoBanner from "./shared/InfoBanner.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import "./shared/InfoBanner.css";
import "./Forecasting.css";
import { authService } from "../../../services/authService.js";
import { roundItems, formatItemsSold } from "../../../utils/formatItemsSold.js";
import { toYmd, fromYmd } from "../../../utils/localDate.js";
import { accuracyPercent, accuracyVerdict, accuracyOffByLine, ACCURACY_HELP_SENTENCES } from "../../../utils/accuracyText.js";
import { shortDateLabel } from "../../dashboard/utils/dashboardPanels.js";
import { peso } from "../../../utils/formatNumber.js";
import {
  FORECAST_START_DIALOG_HTML, buildForecastRequest, readForecastStartDialog, forecastWindowLabel,
} from "../../../utils/forecastStartChoice.js";
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// Money: ₱ with 2 decimals, so "12 × ₱45.50 = ₱546.00" reads the same in
// the table, the totals and the reports (Oct 25 2026).
function formatPeso(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return peso(value);
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr)) ? fromYmd(dateStr) : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDisplayDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} • ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

// Shared by the live page view AND handleGenerateReport (which re-fetches
// prediction rows for the report's own chosen date range rather than
// reusing whatever range happens to be loaded on the page) — module-scope
// so both call sites use the exact same transformation.
function buildPredictionSet(predictionRows, revenueMode) {
  // Price 0 -> "No price" (revenue left empty); no recipe -> "No recipe" for
  // cost. Never ₱0 for a value we do not know. The backend only sends
  // products WITH a recipe and whole plates (Oct 25 2026); gross profit was
  // removed. `raw` keeps the numbers for sorting and for the chart.
  const rows = predictionRows.map((r) => {
    const noPrice = r.hasPrice === false;
    const noRecipe = r.hasRecipe === false;
    const hasForecast = r.closed ? false : r.forecastQty !== null && r.forecastQty !== undefined;
    return {
      date: formatDisplayDate(r.date),
      rawDate: r.date,
      productId: r.productId,
      product: r.product,
      closed: Boolean(r.closed),
      actualQty: r.actualQty ?? "—",
      forecastQty: r.closed ? "Closed" : hasForecast ? roundItems(r.forecastQty) : "—",
      actualRevenue: revenueMode ? (noPrice ? "" : formatPeso(r.actualRevenue)) : undefined,
      forecastRevenue: revenueMode ? (noPrice ? "No price" : formatPeso(r.forecastRevenue)) : undefined,
      estCost: revenueMode ? (noRecipe ? "No recipe" : formatPeso(r.estCost)) : undefined,
      // "12 plates × ₱45.50 COGS (Product Management) = ₱546.00"
      estCostTitle: hasForecast && r.cogsPerUnit != null
        ? `${roundItems(r.forecastQty)} predicted items sold × ${formatPeso(r.cogsPerUnit)} COGS per item (Product Management) = ${formatPeso(r.estCost)}`
        : undefined,
      forecastRevenueTitle: hasForecast && r.price != null
        ? `${roundItems(r.forecastQty)} × ${formatPeso(r.price)} price = ${formatPeso(r.forecastRevenue)}`
        : undefined,
      unit: revenueMode ? undefined : "servings",
      raw: {
        date: r.date,
        product: r.product || "",
        actualQty: r.actualQty ?? null,
        forecastQty: hasForecast ? Number(r.forecastQty) : null,
        actualRevenue: r.actualRevenue ?? null,
        forecastRevenue: r.forecastRevenue ?? null,
        estCost: r.estCost ?? null,
      },
    };
  });

  return { rows };
}

// The chart, rebuilt from the table rows on screen, so a product search
// changes the chart too (Oct 25 2026). Per date: actual = sum of actual
// plates, forecast = sum of whole forecast plates; a date with only closed
// rows is a gap.
function buildSeriesFromRows(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const date = r.raw.date;
    let b = byDate.get(date);
    if (!b) {
      b = { date, actual: 0, actualRevenue: 0, hasActual: false, forecast: 0, forecastRevenue: 0, hasForecast: false, closed: false };
      byDate.set(date, b);
    }
    if (r.raw.actualQty !== null) {
      b.actual += Number(r.raw.actualQty) || 0;
      b.actualRevenue += Number(r.raw.actualRevenue) || 0;
      b.hasActual = true;
    }
    if (r.closed) b.closed = true;
    if (r.raw.forecastQty !== null) {
      b.forecast += r.raw.forecastQty;
      b.forecastRevenue += Number(r.raw.forecastRevenue) || 0;
      b.hasForecast = true;
    }
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => ({
      date: b.date,
      actual: b.hasActual ? b.actual : null,
      actualRevenue: b.hasActual ? b.actualRevenue : null,
      forecast: b.hasForecast ? b.forecast : null,
      forecastRevenue: b.hasForecast ? b.forecastRevenue : null,
      future: null,
      futureRevenue: null,
      closed: b.closed && !b.hasForecast,
    }));
}

// Every column can be sorted highest-first or lowest-first by clicking its
// header (Oct 25 2026). The separate Sort dropdown was removed (Oct 26 2026).
// Empty values ("—", "No price") always go last.
const SORT_COLUMNS = [
  { key: "date", label: "Date", text: false },
  { key: "product", label: "Product", text: true },
  { key: "actualQty", label: "Actual Qty." },
  { key: "forecastQty", label: "Forecast Qty." },
  { key: "actualRevenue", label: "Actual Revenue" },
  { key: "forecastRevenue", label: "Forecast Revenue" },
  { key: "estCost", label: "Est. Total Cost" },
];

function sortPredictionRows(rows, sort) {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a.raw[sort.key];
    const bv = b.raw[sort.key];
    const aMissing = av === null || av === undefined || av === "";
    const bMissing = bv === null || bv === undefined || bv === "";
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return cmp * dir || a.raw.date.localeCompare(b.raw.date) || a.raw.product.localeCompare(b.raw.product);
  });
}


// ---------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------
const tooltips = {
  forecastAccuracy: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Forecast Accuracy
      </strong>
      {ACCURACY_HELP_SENTENCES.join(' ')}
    </div>
  ),

  salesPrediction: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Sales and Demand Prediction
      </strong>
      <strong>Demand</strong> shows how many items of your products are expected to sell.
      {' '}<strong>Sales</strong> shows what those items are worth (items × price).
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '3px', background: '#0F9918', borderRadius: '2px' }}></span>
          <span><strong>Green, solid</strong> = what actually sold</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '3px', background: '#3354BA', borderRadius: '2px' }}></span>
          <span><strong>Blue, dashed</strong> = the forecast</span>
        </div>
      </div>
      Hover over the chart to see the numbers for a day. A gap means the store was closed.
      <br/><br/>
      <strong>Table:</strong> only products with an ingredient recipe. Forecast Qty. = predicted items sold, rounded to a whole number. Forecast Revenue = Forecast Qty. × price. Est. Total Cost = Forecast Qty. × COGS per item (Product Management). &quot;—&quot; = no uploaded sales or no forecast for that date. Click a column header to sort it.
    </div>
  ),
};

// ---------------------------------------------------------------------
// Chart Components
// ---------------------------------------------------------------------

// "2026-10-18" -> "Sun, Oct 18, 2026" for chart hover boxes.
function longDateLabel(ymd) {
  const d = fromYmd(ymd);
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : String(ymd);
}

// The accuracy line appears from 3 trainings on; with fewer, the card shows
// just the number.
const ACCURACY_TREND_MIN_TRAININGS = 3;

function AccuracyPointTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-hover-box">
      <p className="chart-hover-title">Training of {point.when}</p>
      <p>Accuracy: {point.accuracy != null ? `${point.accuracy}%` : "—"}</p>
    </div>
  );
}

// One line: accuracy after each training, oldest first (Recharts, with a
// hover box per point). No comparison line.
function AccuracyChart({ history }) {
  if (history.length < ACCURACY_TREND_MIN_TRAININGS) return null;
  const data = history.map((h, i) => ({
    key: h.modelVersion || String(i),
    // "Oct 14, 2026, 4:56 AM" (Manila, from the backend) -> "Oct 14"
    label: h.trainedAtText ? h.trainedAtText.split(",")[0] : shortDateLabel(h.date),
    when: h.trainedAtText || shortDateLabel(h.date),
    accuracy: accuracyPercent(h.accuracy),
  }));
  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="100%" height={200}>
        <RechartsLineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis domain={[0, 100]} stroke="#6b7280" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<AccuracyPointTooltip />} />
          <Line type="monotone" dataKey="accuracy" name="Accuracy" stroke="#0F9918" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

const pesoText = (value) => `₱${Math.round(Number(value)).toLocaleString("en-PH")}`;

function PredictionPointTooltip({ active, payload, revenueMode }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload;
  const show = (v) => (v == null ? "—" : revenueMode ? pesoText(v) : formatItemsSold(v, { withUnit: true }));
  return (
    <div className="chart-hover-box">
      <p className="chart-hover-title">{longDateLabel(point.date)}{point.isToday ? " (today)" : ""}</p>
      {point.closed ? (
        <p>Store closed</p>
      ) : (
        <>
          <p style={{ color: "#0F9918" }}>Actual: {show(point.actual)}</p>
          <p style={{ color: "#3354BA" }}>Forecast: {show(point.forecast)}</p>
        </>
      )}
    </div>
  );
}

// Actual = solid green, forecast = dashed blue (past and coming days in one
// line, so it joins the actual line at today), a marker at today. Closed
// days have no values: the lines break there (a gap), never a drop to 0.
function PredictionChart({ series, revenueMode, today }) {
  const data = series.map((p) => {
    const past = revenueMode ? p.forecastRevenue : p.forecast;
    const ahead = revenueMode ? p.futureRevenue : p.future;
    return {
      date: p.date,
      actual: revenueMode ? p.actualRevenue : p.actual,
      forecast: past ?? ahead ?? null,
      closed: Boolean(p.closed),
      isToday: p.date === today,
    };
  });
  const hasToday = data.some((p) => p.isToday);
  const yTick = (v) => (revenueMode
    ? `₱${Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : Math.round(Number(v))}`
    : Math.round(Number(v)).toLocaleString("en-US"));
  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="100%" height={280}>
        <RechartsLineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            stroke="#6b7280"
            tick={{ fontSize: 11 }}
            tickFormatter={shortDateLabel}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} tickFormatter={yTick} width={56} />
          <Tooltip content={<PredictionPointTooltip revenueMode={revenueMode} />} />
          {hasToday && (
            <ReferenceLine x={today} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: "Today", position: "top", fill: "#6b7280", fontSize: 11 }} />
          )}
          <Line type="monotone" dataKey="actual" name="Actual" stroke="#0F9918" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} connectNulls={false} />
          <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#3354BA" strokeWidth={2.5} strokeDasharray="8 6" dot={{ r: 3 }} activeDot={{ r: 6 }} connectNulls={false} />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------
function Forecasting() {
  // Demand (items sold) is the default view (owner decision, Oct 25 2026).
  const [mode, setMode] = useState("Demand");
  // { key, dir: 'desc' | 'asc' } or null (date order from the server).
  const [sort, setSort] = useState(null);
  // The picker shows the range the backend actually used (set on load);
  // rangeParams = null means "the default": last 30 days + next 7.
  const [selectedRange, setSelectedRange] = useState([null, null]);
  const [rangeParams, setRangeParams] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isForecastAccuracyOpen, setIsForecastAccuracyOpen] = useState(false);
  const [isSalesPredictionOpen, setIsSalesPredictionOpen] = useState(false);
  const [modalSalesPage, setModalSalesPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [productQuery, setProductQuery] = useState('');
  const ROWS_PER_PAGE = 5;

  const [apiData, setApiData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isGeneratingForecast, setIsGeneratingForecast] = useState(false);

  // Only the newest request may update the page: a slow answer for an
  // older range must never overwrite a newer one.
  const requestIdRef = useRef(0);

  // Also called by handleGenerateForecast after a manual run, to refresh
  // the page with the rows that run just wrote (same range).
  const fetchForecastingAnalytics = useCallback(async ({ silent = false } = {}) => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    if (!silent) {
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.get(`${API_URL}/analytics/forecasting`, {
        headers,
        params: rangeParams || undefined,
      });
      if (requestId !== requestIdRef.current) return;
      const data = response.data?.data || null;
      setApiData(data);
      // New rows: back to page 1, or a page that no longer exists shows empty.
      setSalesPage(1);
      setModalSalesPage(1);
      // Default range: show the dates the backend chose in the picker.
      const range = data?.prediction?.range;
      if (!rangeParams && range?.from && range?.to) {
        setSelectedRange([fromYmd(range.from), fromYmd(range.to)]);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error("Error fetching forecasting analytics:", err);
      if (!silent) setLoadError(err.response?.data?.error || err.message || "Failed to load forecasting data");
    } finally {
      if (!silent && requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [rangeParams]);

  useEffect(() => {
    fetchForecastingAnalytics();
  }, [fetchForecastingAnalytics, fetchKey]);

  // The DatePicker calls onChange once both ends are picked.
  const handleRangeChange = (value) => {
    setSelectedRange(value);
    if (Array.isArray(value) && value[0] && value[1]) {
      setRangeParams({ from: toYmd(value[0]), to: toYmd(value[1]) });
    }
  };

  // Back to the default range (last 30 days + next 7).
  const resetRange = () => {
    setRangeParams(null);
    setFetchKey((k) => k + 1);
  };

  // Manual "Generate Forecast" trigger — same POST /api/ml/forecast that a
  // scheduled cron job (backend/jobs/forecastScheduler.js) also calls, just
  // owner-initiated instead of on a timer. Training and forecasting stay
  // separate pipelines: this never touches /ml/train. Mirrors
  // ReadyToTrain.jsx's Start Training pattern — a Swal confirmation, then a
  // single toast id carried through loading -> success/error so the message
  // never claims success before the server actually confirms it.
  // Oct 26 2026: the dialog also offers a start date (see
  // utils/forecastStartChoice.js) so an accuracy test can start right after
  // the latest uploaded sales instead of today.
  const handleGenerateForecast = async () => {
    const confirmation = await Swal.fire({
      title: "Generate forecast now?",
      html: FORECAST_START_DIALOG_HTML,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Generate forecast",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#7A0101",
      focusConfirm: false,
      preConfirm: () => {
        const request = buildForecastRequest(readForecastStartDialog(Swal.getPopup()));
        if (request.error) {
          Swal.showValidationMessage(request.error);
          return false;
        }
        return request.body;
      },
    });

    if (!confirmation.isConfirmed || !confirmation.value) return;

    setIsGeneratingForecast(true);
    const toastId = toast.loading("Generating forecast… (the first run after a quiet period can take about a minute)");
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.post(
        `${API_URL}/ml/forecast`,
        confirmation.value,
        { headers }
      );
      const forecastedCount = (response.data?.data?.results || []).filter(
        (r) => r.status === "forecasted"
      ).length;
      const windowLabel = forecastWindowLabel(response.data?.data);
      toast.success(
        (forecastedCount
          ? `Forecast generated for ${forecastedCount} product${forecastedCount === 1 ? "" : "s"}`
          : "Forecast generated") + (windowLabel ? `, ${windowLabel}.` : "."),
        { id: toastId }
      );
      (response.data?.data?.warnings || []).forEach((w) => toast(w, { duration: 8000 }));
      // Refresh this page's charts/tables with the rows the run just wrote.
      await fetchForecastingAnalytics({ silent: true });
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to generate forecast", { id: toastId });
    } finally {
      setIsGeneratingForecast(false);
    }
  };

  // --- Derive the same shapes the JSX below already expects, so the
  // render tree needs minimal changes from the old mock-data version. ---
  const accuracyHistory = useMemo(
    () => (apiData?.accuracy?.history || []).filter((h) => h.accuracy !== null),
    [apiData]
  );
  const latestAccuracy = apiData?.accuracy?.value ?? null;
  const beatsBaseline = apiData?.accuracy?.beatsBaseline ?? null;
  // Amber when the forecast is known NOT to beat the weekly average.
  const accuracyCssSuffix = beatsBaseline === false ? "warning" : "success";
  // Plain wording shared with the Dashboard card (utils/accuracyText.js).
  const accuracyWhole = accuracyPercent(latestAccuracy);
  const accuracyVerdictLine = accuracyVerdict(beatsBaseline);
  const accuracyOffBy = accuracyOffByLine(latestAccuracy);

  const predictionRows = apiData?.prediction?.rows || [];
  const predictionSeries = apiData?.prediction?.series || [];
  const predictionTotals = apiData?.prediction?.totals || null;
  const predictionToday = apiData?.prediction?.range?.today || null;
  const salesPrediction = buildPredictionSet(predictionRows, true);
  const hasForecastData = predictionRows.length > 0 || predictionSeries.some((p) => p.forecast != null || p.future != null);

  const trainingInfoData = apiData?.modelInsights?.trainingInfo;
  const forecastUpdates = {
    lastUpdated: trainingInfoData?.latestForecastRunText
      || (trainingInfoData?.latestForecastRun ? formatDisplayDateTime(trainingInfoData.latestForecastRun) : (isLoading ? "Loading…" : "— no forecast has run yet")),
    nextUpdate: trainingInfoData?.nextForecastRunText
      || (trainingInfoData?.nextForecastRun ? formatDisplayDateTime(trainingInfoData.nextForecastRun) : "Every day at 9:00 AM"),
    productsForecast: trainingInfoData ? trainingInfoData.activeProducts : (isLoading ? "Loading…" : "— could not load"),
  };

  const availableTables = [
    { id: "sales", label: "Expected Sales (₱)" },
    { id: "demand", label: "Expected Items Sold" },
  ];

  // What is expected to sell, and what it is worth, for the dates picked.
  const handleGenerateReport = async ({ format, dateRange, selectedTableIds }) => {
    // Re-fetch for the report's OWN dates (local calendar dates:
    // toISOString() would shift them a day back in Manila).
    const [from, to] = dateRange.map((d) => toYmd(d));
    let reportRows;
    let reportTotals;
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.get(`${API_URL}/analytics/forecasting`, { headers, params: { from, to } });
      reportRows = response.data?.data?.prediction?.rows || [];
      reportTotals = response.data?.data?.prediction?.totals || null;
    } catch (err) {
      console.error("Error fetching report data:", err);
      toast.error("Failed to load data for the selected date range.");
      return;
    }

    if (reportRows.length === 0) {
      toast.error("There's no forecast for these dates yet. Forecasts cover the next 7 days.");
      return;
    }

    const wantSales = selectedTableIds.includes("sales");
    const wantDemand = selectedTableIds.includes("demand");

    // Add up raw forecasts first, round once (utils/formatItemsSold.js).
    const openRows = reportRows.filter((r) => !r.closed && r.forecastQty != null);
    const itemsByDate = new Map();
    const itemsByProduct = new Map();
    for (const r of openRows) {
      const qty = Number(r.forecastQty) || 0;
      itemsByDate.set(r.date, (itemsByDate.get(r.date) || 0) + qty);
      itemsByProduct.set(r.product, (itemsByProduct.get(r.product) || 0) + qty);
    }
    const expectedItemsTotal = [...itemsByDate.values()].reduce((sum, q) => sum + q, 0);
    const busiest = [...itemsByDate.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const topProducts = [...itemsByProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const summaryText = busiest
      ? `The busiest day is expected to be ${longDateLabel(busiest[0])}, with about ${formatItemsSold(busiest[1], { withUnit: true })}. `
        + `Top products: ${topProducts.map(([name, qty]) => `${name} (${formatItemsSold(qty)})`).join(", ")}.`
      : "The store is marked closed on every day in these dates.";

    const metrics = [
      { label: "Expected sales", value: reportTotals ? formatPeso(reportTotals.forecastRevenue) : "—", caption: "forecast, priced products" },
      { label: "Expected items sold", value: formatItemsSold(expectedItemsTotal), caption: "all products" },
      { label: "Forecast accuracy", value: accuracyWhole !== null ? `${accuracyWhole}%` : "—", caption: "latest training" },
      { label: "Days covered", value: itemsByDate.size, caption: "open days with a forecast" },
    ];

    // Same labels as the page table: "No price" / "No recipe", "Closed".
    const salesRows = buildPredictionSet(reportRows, true).rows;
    const demandRows = buildPredictionSet(reportRows, false).rows;
    const itemsCell = (row) => (row.forecastQty === "Closed" || row.forecastQty === "—" ? row.forecastQty : formatItemsSold(row.forecastQty));

    try {
      if (format === "pdf") {
        const doc = await buildSalesForecastPDF({
          dateRange,
          business: null,
          metrics,
          summaryText,
          salesTable: wantSales ? {
            body: salesRows.map((row) => [row.date, row.product, itemsCell(row), row.forecastRevenue, row.estCost]),
            totals: [
              "Total", "", formatItemsSold(expectedItemsTotal),
              reportTotals ? formatPeso(reportTotals.forecastRevenue) : "—",
              reportTotals ? formatPeso(reportTotals.estCost) : "—",
            ],
          } : null,
          demandTable: wantDemand ? {
            body: demandRows.map((row) => [row.date, row.product, row.actualQty === "—" ? "—" : formatItemsSold(row.actualQty), itemsCell(row)]),
          } : null,
          disclaimer: "Forecasts are estimates based on your past sales. They can change as new sales are uploaded.",
        });
        doc.save("sales-demand-forecast-report.pdf");
      } else {
        // Numbers stay numbers in Excel; unknown values keep the page's labels.
        const sheets = [];
        if (wantSales) {
          sheets.push({
            sheetName: "Expected Sales",
            rows: [
              ...reportRows.map((r) => ({
                "Date": formatDisplayDate(r.date),
                "Product": r.product,
                "Expected items": r.closed ? "Closed" : (r.forecastQty == null ? "—" : roundItems(r.forecastQty)),
                "Expected sales (₱)": r.hasPrice === false ? "No price" : (r.forecastRevenue ?? ""),
                "Est. cost (₱)": r.hasRecipe === false ? "No recipe" : (r.estCost ?? ""),
              })),
              {
                "Date": "Total",
                "Product": "",
                "Expected items": roundItems(expectedItemsTotal),
                "Expected sales (₱)": reportTotals ? reportTotals.forecastRevenue : "",
                "Est. cost (₱)": reportTotals ? reportTotals.estCost : "",
              },
            ],
          });
        }
        if (wantDemand) {
          sheets.push({
            sheetName: "Expected Items Sold",
            rows: reportRows.map((r) => ({
              "Date": formatDisplayDate(r.date),
              "Product": r.product,
              "Actual items (if known)": r.actualQty ?? "—",
              "Expected items": r.closed ? "Closed" : (r.forecastQty == null ? "—" : roundItems(r.forecastQty)),
            })),
          });
        }
        generateExcel(sheets, "sales-demand-forecast-report.xlsx");
      }
      toast.success("Report generated successfully!");
    } catch (err) {
      console.error("Error building report:", err);
      toast.error("Failed to generate report.");
      return;
    }

    logAuditEvent(
      'report_generated',
      `Generated the Sales & Demand Forecast report (${format === 'pdf' ? 'PDF' : 'Excel'})${formatAuditDateRange(dateRange) ? ` — ${formatAuditDateRange(dateRange)}` : ''}`
    );
    setIsReportModalOpen(false);
  };

  const revenueMode = mode === "Sales";

  // Shared by the panel and the full-view modal: the number, one verdict
  // line (none when no comparison was recorded), one plain explanation.
  const accuracyBody = (
    <div className="accuracy-headline">
      <p className={`accuracy-headline-value metric-value--${accuracyCssSuffix}`}>
        Forecast accuracy: {accuracyWhole}%
      </p>
      {accuracyVerdictLine && (
        <p className={`metric-caption metric-caption--${accuracyCssSuffix}`}>{accuracyVerdictLine}</p>
      )}
      {accuracyOffBy && <p className="accuracy-headline-sub">{accuracyOffBy}</p>}
    </div>
  );

  // 3+ trainings: one line, accuracy after each training.
  const accuracyTrend = accuracyHistory.length >= ACCURACY_TREND_MIN_TRAININGS ? (
    <div className="chart-block">
      <p className="chart-block-title">Accuracy after each training</p>
      <AccuracyChart history={accuracyHistory} />
    </div>
  ) : null;

  const searchedRows = salesPrediction.rows.filter((row) =>
    (row.product || "").toLowerCase().includes(productQuery.trim().toLowerCase())
  );
  const filteredSalesRows = sortPredictionRows(searchedRows, sort);
  // The chart follows the search: same rows as the table.
  const chartSeries = productQuery.trim() ? buildSeriesFromRows(searchedRows) : predictionSeries;

  const predictionChart = hasForecastData || predictionSeries.length > 0 ? (
    <>
      <PredictionChart series={chartSeries} revenueMode={revenueMode} today={predictionToday} />
      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch legend-swatch--actual" /> {revenueMode ? "Actual Sales" : "Actual Demand"} (solid)
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch--forecast" /> {revenueMode ? "Forecasted Sales" : "Forecasted Demand"} (dashed)
        </span>
        <span className="legend-item">A gap = store closed that day</span>
      </div>
    </>
  ) : null;

  const noForecastEmptyState = (
    <EmptyState
      title="No forecast yet"
      message="No forecast yet. It runs every day at 9:00 AM, or click Generate Forecast."
      actionLabel={isGeneratingForecast ? undefined : "Generate Forecast"}
      onAction={handleGenerateForecast}
    />
  );

  // K4 totals row: only when the table is not filtered by a search, since
  // the totals cover every product in the range.
  const showTotals = predictionTotals && !productQuery.trim() && salesPrediction.rows.length > 0;
  const totalsFootnote = predictionTotals && predictionTotals.noPriceCount > 0
    ? `Revenue totals leave out ${predictionTotals.noPriceCount} product(s) with no price. Add the price in Product Management.`
    : null;
  const totalsRow = showTotals ? (
    <tfoot>
      <tr className="analytics-table-total">
        <td colSpan={5}><strong>Total</strong></td>
        <td data-label="Actual Revenue">{formatPeso(predictionTotals.actualRevenue)}</td>
        <td data-label="Forecast Revenue">{formatPeso(predictionTotals.forecastRevenue)}</td>
        <td data-label="Est. Total Cost">{formatPeso(predictionTotals.estCost)}</td>
      </tr>
    </tfoot>
  ) : null;

  // Product search filters both the paged table and the full-view modal off a
  // single query, so the two never disagree. Page counters are reset in the
  // change handler rather than in an effect to avoid a stale page > 1 showing
  // an empty table after the result set shrinks.

  const toggleSort = (key) => {
    setSort((prev) => (prev?.key === key
      ? (prev.dir === "desc" ? { key, dir: "asc" } : null)
      : { key, dir: "desc" }));
    setSalesPage(1);
    setModalSalesPage(1);
  };
  const sortHeader = (column) => {
    const active = sort?.key === column.key;
    const arrow = active ? (sort.dir === "desc" ? " ▼" : " ▲") : " ⇅";
    return (
      <th
        key={column.key}
        aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
      >
        <button
          type="button"
          className="th-sort-btn"
          onClick={() => toggleSort(column.key)}
          title={active ? (sort.dir === "desc" ? "Showing highest first. Click for lowest first." : "Showing lowest first. Click to clear.") : "Click to sort highest first"}
        >
          {column.label}<span className="th-sort-arrow" aria-hidden="true">{arrow}</span>
        </button>
      </th>
    );
  };
  const tableHead = (
    <thead>
      <tr>
        <th>No.</th>
        {SORT_COLUMNS.map(sortHeader)}
      </tr>
    </thead>
  );

  const handleProductQueryChange = (value) => {
    setProductQuery(value);
    setSalesPage(1);
    setModalSalesPage(1);
  };

  // Why a row shows "—": Actual Qty. exists only for dates with uploaded
  // sales, Forecast Qty. only for dates the model forecast (Oct 25 2026).
  const salesDates = salesPrediction.rows.filter((r) => r.raw.actualQty !== null).map((r) => r.raw.date).sort();
  const forecastDates = salesPrediction.rows.filter((r) => r.raw.forecastQty !== null).map((r) => r.raw.date).sort();
  const bothCount = salesPrediction.rows.filter((r) => r.raw.actualQty !== null && r.raw.forecastQty !== null).length;
  const actualQtyNote = salesPrediction.rows.length === 0 ? null : (
    <InfoBanner variant="info">
      <strong>Why some cells show &quot;—&quot;:</strong> Actual Qty. appears only for dates whose sales are uploaded; Forecast Qty. only for dates the system forecast.
      {bothCount === 0 && salesDates.length > 0 && forecastDates.length > 0 && (
        <> Your uploaded sales end on {formatDisplayDate(salesDates[salesDates.length - 1])} and the forecast starts on {formatDisplayDate(forecastDates[0])}, so no date has both yet. They will once you upload sales for a forecast date.</>
      )}
    </InfoBanner>
  );
  const actualTitle = (row) => (row.actualQty === "—" ? "Sales for this date are not uploaded yet" : undefined);
  const forecastTitle = (row) => (row.forecastQty === "—" ? "No forecast was made for this date" : undefined);

  const totalSalesPages = Math.max(1, Math.ceil(filteredSalesRows.length / ROWS_PER_PAGE));
  const paginatedSalesRows = filteredSalesRows.slice(
    (salesPage - 1) * ROWS_PER_PAGE,
    salesPage * ROWS_PER_PAGE
  );
  const modalSalesRows = filteredSalesRows.slice((modalSalesPage - 1) * 10, modalSalesPage * 10);
  const modalSalesTotalPages = Math.max(1, Math.ceil(filteredSalesRows.length / 10));

  return (
    <>
      <div className="analytics-col-main">
        {loadError && (
          <InfoBanner variant="info">
            Couldn't load forecasting data: {loadError}
          </InfoBanner>
        )}
        {/* Forecast Accuracy */}
        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Forecast Accuracy
              <Tippy
                content={tooltips.forecastAccuracy}
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
            <button
              type="button"
              className="btn-expand-panel"
              onClick={() => setIsForecastAccuracyOpen(true)}
              aria-label="Expand Forecast Accuracy"
            >
              <FiExternalLink size={16} />
            </button>
          </div>

          {isLoading ? (
            <p className="table-footnote">Loading forecast accuracy…</p>
          ) : latestAccuracy === null ? (
            <InfoBanner variant="info">
              No trained model yet — forecast accuracy will appear here after the first training run.
            </InfoBanner>
          ) : (
            <>
              {accuracyBody}

              {beatsBaseline === false && (
                <div className="accuracy-warning-banner">
                  <span className="accuracy-warning-icon">⚠️</span>
                  <div>
                    <p className="accuracy-warning-title">Use the forecast as a guide for now.</p>
                    <p className="accuracy-warning-body">More days of sales history will make it better.</p>
                  </div>
                </div>
              )}
            </>
          )}

          {accuracyTrend}
        </section>

        {/* Sales and Demand Prediction */}
        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Sales and Demand Prediction
              <Tippy
                content={tooltips.salesPrediction}
                placement="bottom"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                maxWidth={350}
                interactive={true}
              >
                <span className="info-icon-wrapper">
                  <FiInfo className="info-icon" />
                </span>
              </Tippy>
            </h2>
            <button
              type="button"
              className="btn-expand-panel"
              onClick={() => setIsSalesPredictionOpen(true)}
              aria-label="Expand Sales and Demand Prediction"
            >
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="analytics-filter-row">
            <DatePicker value={selectedRange} onChange={handleRangeChange} mode="range" />
            <button
              type="button"
              className="filter-pill"
              onClick={resetRange}
              title="Last 30 days and the next 7 days"
            >
              Reset to default
            </button>
            <input
              className="filter-search"
              type="search"
              value={productQuery}
              onChange={(e) => handleProductQueryChange(e.target.value)}
              placeholder="Search Product"
              aria-label="Search products by name"
            />
            <select className="filter-pill filter-pill--mode" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Chart: demand or sales">
              <option value="Demand">Demand</option>
              <option value="Sales">Sales</option>
            </select>
          </div>

          {isLoading ? null : !hasForecastData ? noForecastEmptyState : predictionChart}

          {actualQtyNote}
          <div className="analytics-scroll-hint">
            Swipe the table sideways to see every column.
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Sales and forecast by date: actual and forecast quantity, revenue and cost"
          >
          <table className="analytics-table forecast-table">
            {tableHead}
            <tbody>
              {filteredSalesRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-row">
                    {salesPrediction.rows.length === 0
                      ? "No forecast yet. It runs every day at 9:00 AM, or click Generate Forecast."
                      : `No products match "${productQuery.trim()}".`}
                  </td>
                </tr>
              ) : (
                paginatedSalesRows.map((row, i) => (
                  <tr key={i}>
                    <td data-label="No.">{(salesPage - 1) * ROWS_PER_PAGE + i + 1}</td>
                    <td data-label="Date">{row.date}</td>
                    <td data-label="Product">{row.product}</td>
                    <td data-label="Actual Qty." title={actualTitle(row)}>{row.actualQty}</td>
                    <td data-label="Forecast Qty." title={forecastTitle(row)}>{row.forecastQty === "Closed" || row.forecastQty === "—" ? row.forecastQty : formatItemsSold(row.forecastQty)}</td>
                    <td data-label="Actual Revenue">{row.actualRevenue}</td>
                    <td data-label="Forecast Revenue" title={row.forecastRevenueTitle}>{row.forecastRevenue}</td>
                    <td data-label="Est. Total Cost" title={row.estCostTitle}>{row.estCost}</td>
                  </tr>
                ))
              )}
            </tbody>
            {totalsRow}
          </table>
          </div>
          <Pagination
            currentPage={salesPage}
            totalPages={totalSalesPages}
            onPageChange={setSalesPage}
          />
          <p className="table-footnote">
            Only products with an ingredient recipe are listed. Forecast Qty. = predicted items sold, rounded to a whole number. Forecast Revenue = Forecast Qty. × price; Est. Total Cost = Forecast Qty. × COGS per item from Product Management (hover a cost to see it). Est. = Estimated.
          </p>
          {totalsFootnote && <p className="table-footnote">{totalsFootnote}</p>}
        </section>
      </div>

      <div className="analytics-col-side">
        <button type="button" className="btn-generate-report" onClick={() => setIsReportModalOpen(true)}>
          Generate Report
        </button>
        <button
          type="button"
          className="btn-generate-forecast"
          onClick={handleGenerateForecast}
          disabled={isGeneratingForecast}
        >
          {isGeneratingForecast ? "Generating…" : "Generate Forecast"}
        </button>

        <section className="analytics-card">
          <h2 className="analytics-card-title">Forecast Updates</h2>
          <dl className="training-info-list">
            <div className="training-info-row">
              <dt>Last updated</dt>
              <dd>{forecastUpdates.lastUpdated}</dd>
            </div>
            <div className="training-info-row">
              <dt>Next update</dt>
              <dd className="value--success">{forecastUpdates.nextUpdate}</dd>
            </div>
            <div className="training-info-row">
              <dt>Products being forecast</dt>
              <dd>{forecastUpdates.productsForecast}</dd>
            </div>
          </dl>
          <p className="table-footnote">
            The forecast refreshes automatically every morning. Use <strong>Generate Forecast</strong> if you need it now.
          </p>
        </section>
      </div>
      {isReportModalOpen && (
        <GenerateReportModal
          reportTitle="Forecasting Report"
          availableTables={availableTables}
          onCancel={() => setIsReportModalOpen(false)}
          onGenerate={handleGenerateReport}
        />
      )}

      {/* Expand: Forecast Accuracy */}
      <ExpandableModal
        isOpen={isForecastAccuracyOpen}
        onClose={() => setIsForecastAccuracyOpen(false)}
        title="Forecast Accuracy — Full View"
      >
        {latestAccuracy === null ? (
          <InfoBanner variant="info">
            No trained model yet — forecast accuracy will appear here after the first training run.
          </InfoBanner>
        ) : (
          <>
            {accuracyBody}
          </>
        )}

        {accuracyTrend}
      </ExpandableModal>

      {/* Expand: Sales and Demand Prediction */}
      <ExpandableModal
        isOpen={isSalesPredictionOpen}
        onClose={() => setIsSalesPredictionOpen(false)}
        title="Sales and Demand Prediction — Full View"
      >
        <div className="analytics-filter-row">
          <DatePicker value={selectedRange} onChange={handleRangeChange} mode="range" />
          <button
            type="button"
            className="filter-pill"
            onClick={resetRange}
            title="Last 30 days and the next 7 days"
          >
            Reset to default
          </button>
          <input
            className="filter-search"
            type="search"
            value={productQuery}
            onChange={(e) => handleProductQueryChange(e.target.value)}
            placeholder="Search Product"
            aria-label="Search products by name"
          />
          <select className="filter-pill filter-pill--mode" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Chart: demand or sales">
            <option value="Demand">Demand</option>
            <option value="Sales">Sales</option>
          </select>
        </div>

        {!hasForecastData ? noForecastEmptyState : predictionChart}
        {actualQtyNote}

        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Sales and forecast by date, full view"
        >
        <table className="analytics-table forecast-table">
          {tableHead}
          <tbody>
            {filteredSalesRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-row">
                  {salesPrediction.rows.length === 0
                    ? "No forecast yet. It runs every day at 9:00 AM, or click Generate Forecast."
                    : `No products match "${productQuery.trim()}".`}
                </td>
              </tr>
            ) : (
              modalSalesRows.map((row, i) => (
                <tr key={i}>
                  <td data-label="No.">{(modalSalesPage - 1) * 10 + i + 1}</td>
                  <td data-label="Date">{row.date}</td>
                  <td data-label="Product">{row.product}</td>
                  <td data-label="Actual Qty." title={actualTitle(row)}>{row.actualQty}</td>
                  <td data-label="Forecast Qty." title={forecastTitle(row)}>{row.forecastQty === "Closed" || row.forecastQty === "—" ? row.forecastQty : formatItemsSold(row.forecastQty)}</td>
                  <td data-label="Actual Revenue">{row.actualRevenue}</td>
                  <td data-label="Forecast Revenue" title={row.forecastRevenueTitle}>{row.forecastRevenue}</td>
                  <td data-label="Est. Total Cost" title={row.estCostTitle}>{row.estCost}</td>
                </tr>
              ))
            )}
          </tbody>
          {totalsRow}
        </table>
        </div>
        <Pagination
          currentPage={modalSalesPage}
          totalPages={modalSalesTotalPages}
          onPageChange={setModalSalesPage}
        />
        {totalsFootnote && <p className="table-footnote">{totalsFootnote}</p>}
      </ExpandableModal>

    </>
  );
}

export default Forecasting;