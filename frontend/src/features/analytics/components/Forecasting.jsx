// components/Forecasting.jsx
import { useState, useEffect, useMemo, useCallback } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import Swal from '../../../utils/swal';
import { FiChevronDown, FiCalendar, FiInfo, FiExternalLink } from "react-icons/fi";
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

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function formatPeso(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDisplayDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} • ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function shortDayLabel(dateStr) {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("en-US", { weekday: "short" });
}

// Shared by the live page view AND handleGenerateReport (which re-fetches
// prediction rows for the report's own chosen date range rather than
// reusing whatever range happens to be loaded on the page) — module-scope
// so both call sites use the exact same transformation.
function buildPredictionSet(predictionRows, revenueMode) {
  // Price 0 -> "No price" (revenue / gross profit left empty); no recipe ->
  // "No recipe" for cost. Never ₱0 for a value we do not know.
  // `hasPrice`/`hasRecipe` are missing on older API responses: treat as known.
  const rows = predictionRows.map((r) => {
    const noPrice = r.hasPrice === false;
    const noRecipe = r.hasRecipe === false;
    return {
      date: formatDisplayDate(r.date),
      rawDate: r.date,
      product: r.product,
      actualQty: r.actualQty ?? "—",
      forecastQty: r.closed ? "Closed" : r.forecastQty,
      actualRevenue: revenueMode ? (noPrice ? "" : formatPeso(r.actualRevenue)) : undefined,
      forecastRevenue: revenueMode ? (noPrice ? "No price" : formatPeso(r.forecastRevenue)) : undefined,
      estCost: revenueMode ? (noRecipe ? "No recipe" : formatPeso(r.estCost)) : undefined,
      estGrossProfit: revenueMode ? (noPrice || noRecipe ? "" : formatPeso(r.estGrossProfit)) : undefined,
      unit: revenueMode ? undefined : "servings",
    };
  });

  const byDate = new Map();
  for (const r of predictionRows) {
    const bucket = byDate.get(r.date) || { date: r.date, actual: 0, forecast: 0, hasActual: false };
    bucket.forecast += revenueMode ? Number(r.forecastRevenue || 0) : Number(r.forecastQty || 0);
    if (r.actualQty !== null) {
      bucket.actual += revenueMode ? Number(r.actualRevenue || 0) : Number(r.actualQty || 0);
      bucket.hasActual = true;
    }
    byDate.set(r.date, bucket);
  }
  const today = new Date().toISOString().slice(0, 10);
  const points = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((pt) => ({
      label: shortDayLabel(pt.date),
      actual: pt.hasActual ? pt.actual : 0,
      forecast: pt.forecast,
      future: pt.date > today,
    }));

  return { points, rows };
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
      This tells you how close your forecasts have been to what actually happened.
      <br/><br/>
      We check it by comparing the forecast against the simplest thing you
      could do instead: just averaging the last 7 days. If the forecast is
      closer to your real sales than that average, it is worth using.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#22c55e', fontWeight: 'bold' }}>●</span>
          <span><strong>Better than a simple average</strong> — the forecast is adding real value.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>●</span>
          <span><strong>Not yet better</strong> — upload more sales data and it should improve.</span>
        </div>
      </div>
      <br/>
      Accurate forecasts help you order ingredients closer to actual demand, reducing waste and stockouts.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Accuracy = 100% − WMAPE, where WMAPE = total servings missed ÷ total
        servings sold. Counting one total against another keeps a dish that
        sells one or two a day from swamping the number.
      </span>
    </div>
  ),
  
  demandPrediction: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Prediction
      </strong>
      This shows how many servings of each dish you're expected to sell.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '3px', background: '#22c55e', borderRadius: '2px' }}></span>
          <span><strong>Green Line</strong> = What actually sold</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '3px', background: '#60a5fa', borderRadius: '2px' }}></span>
          <span><strong>Blue Line</strong> = What the system predicted</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '3px', background: '#1e40af', borderRadius: '2px' }}></span>
          <span><strong>Purple Line</strong> = What's predicted for the coming days</span>
        </div>
      </div>
      <br/>
      When blue and green stay close together, the system is reading your business accurately.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        ŷ_i = Σ(k=1 to K) f_k(x_i) — XGBoost prediction output
      </span>
    </div>
  ),
  
  salesPrediction: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Sales Prediction
      </strong>
      This shows your expected income based on predicted servings sold, multiplied by each item's price.
      <br/><br/>
      Use this for daily and weekly financial planning.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Forecasted Revenue = ŷ_i × Unit Price
      </span>
    </div>
  ),
  
  modelInsights: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Model Insights
      </strong>
      This shows when your forecast model was last trained and when the next forecast runs.
      <br/><br/>
      Forecasts refresh automatically on a schedule (daily and weekly), or you can generate one on demand.
    </div>
  ),
  
  accuracyOverTime: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Accuracy Over Time
      </strong>
      Plots the accuracy of each training, oldest first, next to what a
      simple 7-day average scored on the same days.
      <br/><br/>
      Trainings from before the accuracy measure changed are left out rather
      than drawn as zero, so the line may start later than your first training.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Accuracy % = 100% − WMAPE
      </span>
    </div>
  ),
};

// ---------------------------------------------------------------------
// Chart Components
// ---------------------------------------------------------------------

// Path through the non-null values; a null breaks the line (a gap), it is
// never drawn as 0.
function buildGappedPath(values, xOf, yOf) {
  let path = "";
  let penDown = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) {
      penDown = false;
      return;
    }
    path += `${penDown ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(Number(v)).toFixed(1)} `;
    penDown = true;
  });
  return path.trim();
}

function shortDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// K3: fewer than 3 trainings -> two bars (model vs 7-day average) for the
// latest training; 3 or more -> a line per training, x = training time.
const ACCURACY_TREND_MIN_TRAININGS = 3;

function AccuracyChart({ history }) {
  if (!history.length) {
    return (
      <EmptyState
        title="No accuracy yet"
        message="Accuracy appears here after the first training."
      />
    );
  }

  if (history.length < ACCURACY_TREND_MIN_TRAININGS) {
    const latest = history[history.length - 1];
    const bars = [
      { label: "Forecast", value: latest.accuracy, className: "accuracy-bar-fill--model" },
      { label: "7-day average", value: latest.baselineAccuracy, className: "accuracy-bar-fill--baseline" },
    ];
    return (
      <div className="accuracy-bars">
        {latest.trainedAtText && <p className="chart-block-subtitle">Training of {latest.trainedAtText}</p>}
        {bars.map((bar) => (
          <div className="accuracy-bar-row" key={bar.label}>
            <span className="accuracy-bar-label">{bar.label}</span>
            <div className="accuracy-bar-track">
              {bar.value != null && (
                <div className={`accuracy-bar-fill ${bar.className}`} style={{ width: `${Math.max(0, Math.min(100, bar.value))}%` }} />
              )}
            </div>
            <span className="accuracy-bar-value">{bar.value != null ? `${Number(bar.value).toFixed(1)}%` : "—"}</span>
          </div>
        ))}
        <p className="chart-block-subtitle">The trend line appears after 3 or more trainings.</p>
      </div>
    );
  }

  const width = 700;
  const height = 180;
  const padBottom = 20;
  const plotH = height - padBottom;
  const all = history.flatMap((h) => [h.accuracy, h.baselineAccuracy]).filter((v) => v != null);
  const min = Math.max(0, Math.floor((Math.min(...all) - 10) / 10) * 10);
  const max = 100;
  const xOf = (i) => (history.length === 1 ? width / 2 : (i / (history.length - 1)) * width);
  const yOf = (v) => plotH - ((v - min) / (max - min || 1)) * plotH;
  const modelPath = buildGappedPath(history.map((h) => h.accuracy), xOf, yOf);
  const baselinePath = buildGappedPath(history.map((h) => h.baselineAccuracy), xOf, yOf);

  return (
    <Tippy
      content={tooltips.accuracyOverTime}
      placement="top"
      animation="scale"
      duration={200}
      theme="dark"
      arrow={true}
      maxWidth={350}
      interactive={true}
    >
      <div className="chart-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} className="accuracy-chart" preserveAspectRatio="none">
          <path d={baselinePath} className="accuracy-chart-baseline" fill="none" strokeDasharray="6 4" />
          <path d={modelPath} className="accuracy-chart-line" fill="none" />
          {history.map((h, i) => (
            <text key={h.modelVersion || i} x={xOf(i)} y={height - 4} className="sales-chart-label" textAnchor="middle">
              {/* "Oct 14, 2026, 4:56 AM" (Manila, from the backend) -> "Oct 14" */}
              {h.trainedAtText ? h.trainedAtText.split(",")[0] : shortDate(h.date)}
            </text>
          ))}
        </svg>
      </div>
    </Tippy>
  );
}

// K4: actual = solid line; forecast = dashed line (includes today, so it
// joins the actual side); closed dates = a gap with a small "Closed" label.
function LineChart({ points, revenueMode, today }) {
  const width = 700;
  const height = 260;
  const padBottom = 20;
  const plotH = height - padBottom;
  const actualOf = (p) => (revenueMode ? p.actualRevenue : p.actual);
  const forecastOf = (p) => {
    const past = revenueMode ? p.forecastRevenue : p.forecast;
    const ahead = revenueMode ? p.futureRevenue : p.future;
    return past ?? ahead ?? null;
  };
  const values = points.flatMap((p) => [actualOf(p), forecastOf(p)]).filter((v) => v != null);
  const max = (values.length ? Math.max(...values) : 1) * 1.1 || 1;
  const xOf = (i) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width);
  const yOf = (v) => plotH - (v / max) * plotH;

  const actualPath = buildGappedPath(points.map(actualOf), xOf, yOf);
  const forecastPath = buildGappedPath(points.map(forecastOf), xOf, yOf);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const todayIndex = points.findIndex((p) => p.date === today);

  return (
    <Tippy
      content={tooltips.demandPrediction}
      placement="top"
      animation="scale"
      duration={200}
      theme="dark"
      arrow={true}
      maxWidth={350}
      interactive={true}
    >
      <div className="chart-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} className="sales-chart" preserveAspectRatio="none">
          {todayIndex >= 0 && (
            <line x1={xOf(todayIndex)} x2={xOf(todayIndex)} y1={0} y2={plotH} className="sales-chart-today" />
          )}
          <path d={actualPath} className="sales-chart-line-actual" fill="none" />
          <path d={forecastPath} className="sales-chart-line-forecast" fill="none" strokeDasharray="8 6" />
          {points.map((p, i) => (p.closed ? (
            <text key={`closed-${p.date}`} x={xOf(i)} y={plotH - 4} className="sales-chart-closed" textAnchor="middle">
              Closed
            </text>
          ) : null))}
          {points.map((p, i) => (i % labelEvery === 0 || i === todayIndex ? (
            <text key={p.date} x={xOf(i)} y={height - 4} className="sales-chart-label" textAnchor="middle">
              {i === todayIndex ? "Today" : shortDate(p.date)}
            </text>
          ) : null))}
        </svg>
      </div>
    </Tippy>
  );
}

// K2: never an empty cell. Rows with no value show "—" plus why, and
// "Training records" is hidden when it is not tracked.
function TrainingInfoList({ info }) {
  const rows = [
    { label: "Model status", value: info.modelStatus, className: "value--success" },
    { label: "Last trained", value: info.lastTrained },
    info.trainingRecords != null ? { label: "Training records", value: info.trainingRecords } : null,
    { label: "Active products", value: info.activeProducts },
    { label: "Latest forecast", value: info.latestForecast },
    { label: "Next training", value: info.nextTraining },
    { label: "Next forecast", value: info.nextForecast, className: "value--success" },
  ].filter(Boolean);
  return (
    <div className="training-info">
      <p className="training-info-title">Training Information</p>
      <p className="training-info-subtitle">Current model status</p>
      <dl className="training-info-list">
        {rows.map((row) => (
          <div className="training-info-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.className}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------
function Forecasting() {
  const [mode, setMode] = useState("Sales");
  const [selectedRange, setSelectedRange] = useState([new Date(), new Date()]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isForecastAccuracyOpen, setIsForecastAccuracyOpen] = useState(false);
  const [isSalesPredictionOpen, setIsSalesPredictionOpen] = useState(false);
  const [isModelInsightsOpen, setIsModelInsightsOpen] = useState(false);
  const [modalSalesPage, setModalSalesPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [productQuery, setProductQuery] = useState('');
  const ROWS_PER_PAGE = 5;

  const [apiData, setApiData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isGeneratingForecast, setIsGeneratingForecast] = useState(false);

  // Pulled out of the mount-only effect below so handleGenerateForecast can
  // call it again after a manual forecast run completes, to refresh this
  // page's tables/charts with the rows that run just wrote.
  const fetchForecastingAnalytics = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.get(`${API_URL}/analytics/forecasting`, { headers });
      setApiData(response.data?.data || null);
    } catch (err) {
      console.error("Error fetching forecasting analytics:", err);
      if (!silent) setLoadError(err.response?.data?.error || err.message || "Failed to load forecasting data");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForecastingAnalytics();
  }, [fetchForecastingAnalytics]);

  // Manual "Generate Forecast" trigger — same POST /api/ml/forecast that a
  // scheduled cron job (backend/jobs/forecastScheduler.js) also calls, just
  // owner-initiated instead of on a timer. Training and forecasting stay
  // separate pipelines: this never touches /ml/train. Mirrors
  // ReadyToTrain.jsx's Start Training pattern — a Swal confirmation, then a
  // single toast id carried through loading -> success/error so the message
  // never claims success before the server actually confirms it.
  const handleGenerateForecast = async () => {
    const confirmation = await Swal.fire({
      title: "Generate forecast now?",
      text: "This runs a manual 7-day forecast refresh using the current trained model — " +
            "the same weekly-style run the scheduled Monday 9:00 AM job performs. It does not " +
            "retrain the model, only re-forecasts with it.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Generate forecast",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#7A0101",
    });

    if (!confirmation.isConfirmed) return;

    setIsGeneratingForecast(true);
    const toastId = toast.loading("Generating forecast…");
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.post(
        `${API_URL}/ml/forecast`,
        { horizonDays: 7 },
        { headers }
      );
      const forecastedCount = (response.data?.data?.results || []).filter(
        (r) => r.status === "forecasted"
      ).length;
      toast.success(
        forecastedCount
          ? `Forecast generated for ${forecastedCount} product${forecastedCount === 1 ? "" : "s"}.`
          : "Forecast generated.",
        { id: toastId }
      );
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
  // errorRate is WMAPE now: "off by about N% of total sales".
  const errorRate = apiData?.accuracy?.errorRate != null ? Number(apiData.accuracy.errorRate).toFixed(1) : null;
  const beatsBaseline = apiData?.accuracy?.beatsBaseline ?? null;
  // Two states, not four. The old four came from the Lewis (1982) MAPE
  // bands, which do not apply to WMAPE — "good" is now defined by beating
  // the 7-day average, so there is nothing to grade on a curve.
  const accuracyCssSuffix = beatsBaseline === false ? "warning" : "success";

  // The average number of servings missed per dish per day, so the owner
  // has something physical to hold on to next to the percentage. Derived
  // from real values only; null unless we have all three.
  const platesPerDishPerDay = (() => {
    const mae = apiData?.modelInsights?.trainingInfo?.mae;
    return mae != null ? Number(mae).toFixed(1) : null;
  })();

  // K3 lines, built from real numbers only; a missing value drops its line.
  const baselineAccuracy = apiData?.accuracy?.baselineValue ?? null;
  const baselineLine = baselineAccuracy != null
    ? `A simple 7-day average scored ${Number(baselineAccuracy).toFixed(1)}% on the same days.`
    : "No 7-day average was recorded for this model.";
  const maeLine = platesPerDishPerDay
    ? `On average the forecast was off by about ${platesPerDishPerDay} ${platesPerDishPerDay === "1.0" ? "plate" : "plates"} per product per day.`
    : null;
  const standingLabel = beatsBaseline === true
    ? "Beats the 7-day average"
    : beatsBaseline === false
      ? "Data Needs Attention — not yet better than the 7-day average"
      : "No 7-day average comparison recorded";
  const ACCURACY_CONTEXT_LINE =
    "Accuracy is measured on the most recent part of the sales history. Unusual weeks, like store closures, lower this number.";

  const predictionRows = apiData?.prediction?.rows || [];
  const predictionSeries = apiData?.prediction?.series || [];
  const predictionTotals = apiData?.prediction?.totals || null;
  const predictionToday = apiData?.prediction?.range?.today || null;
  const salesPrediction = buildPredictionSet(predictionRows, true);
  const hasForecastData = predictionRows.length > 0 || predictionSeries.some((p) => p.forecast != null || p.future != null);

  const trainingInfoData = apiData?.modelInsights?.trainingInfo;
  const isTrained = trainingInfoData?.modelStatus === "Trained";
  const trainingInfo = {
    modelStatus: trainingInfoData?.modelStatus || "Not Trained",
    lastTrained: trainingInfoData?.lastTrained
      || (isTrained ? "— time not recorded for this model" : "— not trained yet"),
    latestForecast: trainingInfoData?.latestForecastRunText
      || (trainingInfoData?.latestForecastRun ? formatDisplayDateTime(trainingInfoData.latestForecastRun) : "— no forecast has run yet"),
    // null = not tracked per training: the row is hidden, never blank.
    trainingRecords: trainingInfoData?.trainingRecords ?? null,
    activeProducts: trainingInfoData ? `${trainingInfoData.activeProducts} menu item${trainingInfoData.activeProducts === 1 ? "" : "s"}` : "— could not load",
    nextTraining: trainingInfoData?.nextTraining || "Manual (click Start Training).",
    nextForecast: trainingInfoData?.nextForecastRunText
      || (trainingInfoData?.nextForecastRun ? formatDisplayDateTime(trainingInfoData.nextForecastRun) : "Every day at 9:00 AM"),
  };

  const availableTables = [
    { id: "sales", label: "Sales Forecast Table" },
    { id: "demand", label: "Demand Forecast Table" },
    { id: "model", label: "Model Insights" },
  ];

  const handleGenerateReport = async ({ format, dateRange, selectedTableIds }) => {
    // Re-fetch for the report's OWN chosen date range — the page's
    // already-loaded data reflects whatever default range it mounted
    // with, not necessarily what the owner picked in this modal.
    const [from, to] = dateRange.map((d) => d.toISOString().slice(0, 10));
    let reportPredictionRows;
    try {
      const headers = await authService.getAuthHeaders();
      const response = await axios.get(`${API_URL}/analytics/forecasting`, { headers, params: { from, to } });
      reportPredictionRows = response.data?.data?.prediction?.rows || [];
    } catch (err) {
      console.error("Error fetching report data:", err);
      toast.error("Failed to load data for the selected date range.");
      return;
    }

    if (reportPredictionRows.length === 0) {
      toast.error("No data is available for the selected date range.");
      return;
    }

    const reportSales = buildPredictionSet(reportPredictionRows, true);
    const reportDemand = buildPredictionSet(reportPredictionRows, false);

    const accuracyText = latestAccuracy !== null ? `${latestAccuracy.toFixed(1)}%` : "N/A";
    const errorRateText = errorRate !== null ? `${errorRate}%` : "N/A";
    const metrics = [
      { label: "Forecast Accuracy", value: accuracyText, caption: "current model accuracy" },
      { label: "Error Rate (WMAPE)", value: errorRateText, caption: "share of total servings missed" },
      { label: "Forecast Days", value: reportSales.points.length, caption: "tracked sales points" },
      { label: "Demand Days", value: reportDemand.points.length, caption: "tracked demand points" },
    ];

    try {
      if (format === "pdf") {
        const doc = await buildSalesForecastPDF({
          dateRange,
          business: null,
          metrics,
          insightText: `The ${mode.toLowerCase()} forecast highlights the expected business movement for the selected period. Current model accuracy sits at ${accuracyText} with an estimated error rate of ${errorRateText}.`,
          disclaimer: "Disclaimer — Forecast values are estimates based on available history and may change as new sales data is uploaded.",
        });
        doc.save("sales-demand-forecast-report.pdf");
      } else {
        const sheetMap = {
          sales: { sheetName: "Sales Forecast", rows: reportSales.rows.map((row) => ({ ...row })) },
          demand: { sheetName: "Demand Forecast", rows: reportDemand.rows.map((row) => ({ ...row })) },
          model: {
            sheetName: "Model Insights",
            rows: [
              {
                ...trainingInfo,
              },
            ],
          },
        };

        generateExcel(
          Object.entries(sheetMap)
            .filter(([id]) => selectedTableIds.includes(id))
            .map(([, value]) => value),
          "sales-demand-forecast-report.xlsx"
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
      `Generated the Sales & Demand Forecast report (${format === 'pdf' ? 'PDF' : 'Excel'})${formatAuditDateRange(dateRange) ? ` — ${formatAuditDateRange(dateRange)}` : ''}`
    );
    setIsReportModalOpen(false);
  };

  const revenueMode = mode === "Sales";

  // Shared by the panel and the full-view modal.
  const accuracyBody = (
    <>
      <div className="accuracy-headline">
        <p className={`accuracy-headline-value metric-value--${accuracyCssSuffix}`}>
          Forecast accuracy: {latestAccuracy?.toFixed(1)}%
        </p>
        <p className="accuracy-headline-sub">{baselineLine}</p>
        {maeLine && <p className="accuracy-headline-sub">{maeLine}</p>}
        <p className={`metric-caption metric-caption--${accuracyCssSuffix}`}>{standingLabel}</p>
        <p className="accuracy-headline-note">{ACCURACY_CONTEXT_LINE}</p>
      </div>
    </>
  );

  const predictionChart = hasForecastData || predictionSeries.length > 0 ? (
    <>
      <LineChart points={predictionSeries} revenueMode={revenueMode} today={predictionToday} />
      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch legend-swatch--actual" /> {revenueMode ? "Actual Sales" : "Actual Demand"} (solid)
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch--forecast" /> {revenueMode ? "Forecasted Sales" : "Forecasted Demand"} (dashed)
        </span>
        <span className="legend-item">"Closed" = store closed that day</span>
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
  const totalsFootnote = predictionTotals && (predictionTotals.noPriceCount > 0 || predictionTotals.noRecipeCount > 0)
    ? `Totals leave out ${predictionTotals.noPriceCount} product(s) with no price and ${predictionTotals.noRecipeCount} with no recipe. Add them in Product Management.`
    : null;
  const totalsRow = showTotals ? (
    <tfoot>
      <tr className="analytics-table-total">
        <td colSpan={5}><strong>Total</strong></td>
        <td data-label="Actual Revenue">{formatPeso(predictionTotals.actualRevenue)}</td>
        <td data-label="Forecast Revenue">{formatPeso(predictionTotals.forecastRevenue)}</td>
        <td data-label="Est. Total Cost">{formatPeso(predictionTotals.estCost)}</td>
        <td data-label="Est. Gross Profit">{formatPeso(predictionTotals.estGrossProfit)}</td>
      </tr>
    </tfoot>
  ) : null;

  // Product search filters both the paged table and the full-view modal off a
  // single query, so the two never disagree. Page counters are reset in the
  // change handler rather than in an effect to avoid a stale page > 1 showing
  // an empty table after the result set shrinks.
  const filteredSalesRows = salesPrediction.rows.filter((row) =>
    (row.product || "").toLowerCase().includes(productQuery.trim().toLowerCase())
  );

  const handleProductQueryChange = (value) => {
    setProductQuery(value);
    setSalesPage(1);
    setModalSalesPage(1);
  };

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
                    <p className="accuracy-warning-title">
                      The forecast is not yet better than a simple 7-day average.
                    </p>
                    <p className="accuracy-warning-body">
                      Possible reasons: not much sales history yet, sales data not uploaded recently, or an unusual stretch (holiday, closure, weather) that no pattern could have predicted.
                    </p>
                    <p className="accuracy-warning-body">
                      <strong>What to do:</strong> Keep uploading your daily sales, then retrain. More history is what closes this gap.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="chart-block">
            <p className="chart-block-title">Accuracy by training</p>
            <AccuracyChart history={accuracyHistory} />
            {accuracyHistory.length >= ACCURACY_TREND_MIN_TRAININGS && (
              <div className="chart-legend">
                <span className="legend-item">
                  <span className="legend-swatch legend-swatch--success" /> Forecast accuracy %
                </span>
                <span className="legend-item">
                  <span className="legend-swatch legend-swatch--baseline" /> 7-day average (dashed)
                </span>
              </div>
            )}
          </div>
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
            <DatePicker value={selectedRange} onChange={setSelectedRange} mode="range" />
            <input
              className="filter-search"
              type="search"
              value={productQuery}
              onChange={(e) => handleProductQueryChange(e.target.value)}
              placeholder="Search Product"
              aria-label="Search products by name"
            />
            <select className="filter-pill filter-pill--mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="Sales">Sales</option>
              <option value="Demand">Demand</option>
            </select>
          </div>

          {isLoading ? null : !hasForecastData ? noForecastEmptyState : predictionChart}

          <div className="analytics-scroll-hint">
            Swipe the table sideways to see every column.
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Sales and forecast by date: actual and forecast quantity, revenue, cost and gross profit"
          >
          <table className="analytics-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Product</th>
                <th>Actual Qty.</th>
                <th>Forecast Qty.</th>
                <th>Actual Revenue</th>
                <th>Forecast Revenue</th>
                <th>Est. Total Cost</th>
                <th>Est. Gross Profit</th>
              </tr>
            </thead>
            <tbody>
              {filteredSalesRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-row">
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
                    <td data-label="Actual Qty.">{row.actualQty}</td>
                    <td data-label="Forecast Qty.">{row.forecastQty}</td>
                    <td data-label="Actual Revenue">{row.actualRevenue}</td>
                    <td data-label="Forecast Revenue">{row.forecastRevenue}</td>
                    <td data-label="Est. Total Cost">{row.estCost}</td>
                    <td data-label="Est. Gross Profit">{row.estGrossProfit}</td>
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
            Total Cost = Cost of Goods &nbsp;·&nbsp; Est. = Estimated
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Model Insights
              <Tippy
                content={tooltips.modelInsights}
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
              onClick={() => setIsModelInsightsOpen(true)}
              aria-label="Expand Model Insights"
            >
              <FiExternalLink size={16} />
            </button>
          </div>

          <InfoBanner variant="info">
            Forecasts refresh automatically on a schedule — no need to upload sales data
            just to get a new forecast. You can also generate one on demand with the
            Generate Forecast button.
          </InfoBanner>

          <InfoBanner variant="info">
            Daily forecasts run every morning at 9:00 AM except Monday. On Monday, a full 7-day weekly forecast is
            generated at 9:00 AM instead.
          </InfoBanner>


          <TrainingInfoList info={trainingInfo} />
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

        <div className="chart-block">
          <p className="chart-block-title">Accuracy by training</p>
          <AccuracyChart history={accuracyHistory} />
        </div>
      </ExpandableModal>

      {/* Expand: Sales and Demand Prediction */}
      <ExpandableModal
        isOpen={isSalesPredictionOpen}
        onClose={() => setIsSalesPredictionOpen(false)}
        title="Sales and Demand Prediction — Full View"
      >
        <div className="analytics-filter-row">
          <DatePicker value={selectedRange} onChange={setSelectedRange} mode="range" />
          <input
            className="filter-search"
            type="search"
            value={productQuery}
            onChange={(e) => handleProductQueryChange(e.target.value)}
            placeholder="Search Product"
            aria-label="Search products by name"
          />
          <select className="filter-pill filter-pill--mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="Sales">Sales</option>
            <option value="Demand">Demand</option>
          </select>
        </div>

        {!hasForecastData ? noForecastEmptyState : predictionChart}

        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Sales and forecast by date, full view"
        >
        <table className="analytics-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>Date</th>
              <th>Product</th>
              <th>Actual Qty.</th>
              <th>Forecast Qty.</th>
              <th>Actual Revenue</th>
              <th>Forecast Revenue</th>
              <th>Est. Total Cost</th>
              <th>Est. Gross Profit</th>
            </tr>
          </thead>
          <tbody>
            {filteredSalesRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-row">
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
                  <td data-label="Actual Qty.">{row.actualQty}</td>
                  <td data-label="Forecast Qty.">{row.forecastQty}</td>
                  <td data-label="Actual Revenue">{row.actualRevenue}</td>
                  <td data-label="Forecast Revenue">{row.forecastRevenue}</td>
                  <td data-label="Est. Total Cost">{row.estCost}</td>
                  <td data-label="Est. Gross Profit">{row.estGrossProfit}</td>
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

      {/* Expand: Model Insights */}
      <ExpandableModal
        isOpen={isModelInsightsOpen}
        onClose={() => setIsModelInsightsOpen(false)}
        title="Model Insights — Full View"
      >
        <InfoBanner variant="info">
          Forecasts refresh automatically on a schedule — no need to upload sales data
          just to get a new forecast. You can also generate one on demand with the
          Generate Forecast button.
        </InfoBanner>

        <InfoBanner variant="info">
          Daily forecasts run every morning at 9:00 AM except Monday. On Monday, a full 7-day weekly forecast is
          generated at 9:00 AM instead.
        </InfoBanner>


        <TrainingInfoList info={trainingInfo} />
      </ExpandableModal>
    </>
  );
}

export default Forecasting;