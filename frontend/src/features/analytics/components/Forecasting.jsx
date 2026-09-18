// components/Forecasting.jsx
import { useState, useEffect, useMemo, useCallback } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import Swal from "sweetalert2";
import "../../../utils/swalTheme.css";
import { FiChevronDown, FiSearch, FiCalendar, FiInfo, FiZap, FiExternalLink } from "react-icons/fi";
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
  const rows = predictionRows.map((r) => ({
    date: formatDisplayDate(r.date),
    rawDate: r.date,
    product: r.product,
    actualQty: r.actualQty ?? "—",
    forecastQty: r.forecastQty,
    actualRevenue: revenueMode ? formatPeso(r.actualRevenue) : undefined,
    forecastRevenue: revenueMode ? formatPeso(r.forecastRevenue) : undefined,
    estCost: revenueMode ? formatPeso(r.estCost) : undefined,
    estGrossProfit: revenueMode ? formatPeso(r.estGrossProfit) : undefined,
    unit: revenueMode ? undefined : "servings",
  }));

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
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#22c55e', fontWeight: 'bold' }}>●</span>
          <span><strong>Above 90%</strong> — Excellent. You can rely on these numbers.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>●</span>
          <span><strong>80-90%</strong> — Good. Still useful for planning.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>●</span>
          <span><strong>70-80%</strong> — Fair. Use with caution.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>●</span>
          <span><strong>Below 70%</strong> — Low. Consider uploading more sales data.</span>
        </div>
      </div>
      <br/>
      Accurate forecasts help you order ingredients closer to actual demand, reducing waste and stockouts.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        MAPE = (1/n) × Σ |(Actual − Forecast) / Actual| × 100
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
      This shows what factors most influence your forecasts — like whether it's a payday, a weekend, or based on recent sales trends. It also shows when your forecast model was last updated.
      <br/><br/>
      Forecasts refresh automatically on a schedule (daily and weekly), or you can generate one on demand.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Feature importance derived from XGBoost gain-based scoring
      </span>
    </div>
  ),
  
  accuracyOverTime: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Accuracy Over Time
      </strong>
      Plots daily or weekly accuracy across a rolling window (last 30 days).
      <br/><br/>
      The <strong style={{ color: '#fbbf24' }}>80% threshold line</strong> marks the boundary between "Good" and "Fair" performance.
      <br/><br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Accuracy % = 100% − MAPE
      </span>
    </div>
  ),
  
  featureImportance: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Feature Importance
      </strong>
      Shows which factors most influence your forecasts.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Is payday</span>
          <span style={{ color: '#22c55e' }}>92%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Holiday</span>
          <span style={{ color: '#22c55e' }}>84%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Day of Week</span>
          <span style={{ color: '#22c55e' }}>76%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Sales Lag (7 days)</span>
          <span style={{ color: '#22c55e' }}>68%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Sales Lag (1 day)</span>
          <span style={{ color: '#22c55e' }}>45%</span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Day of Week has the strongest influence on sales. Paydays (15th and 30th) also significantly boost demand.
      </span>
    </div>
  ),
};

// ---------------------------------------------------------------------
// Chart Components
// ---------------------------------------------------------------------
function buildLinePath(values, width, height, min, max) {
  const stepX = width / (values.length - 1);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function AccuracyChart({ data }) {
  const width = 700;
  const height = 180;
  const min = 60;
  const max = 100;
  const linePath = buildLinePath(data, width, height, min, max);
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const thresholdY = height - ((80 - min) / (max - min)) * height;
  const excellentY = height - ((90 - min) / (max - min)) * height;

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
          <path d={areaPath} className="accuracy-chart-area" />
          <path d={linePath} className="accuracy-chart-line" />
          <line
            x1="0"
            y1={thresholdY}
            x2={width}
            y2={thresholdY}
            className="accuracy-chart-threshold"
          />
          <line
            x1="0"
            y1={excellentY}
            x2={width}
            y2={excellentY}
            className="accuracy-chart-excellent"
          />
        </svg>
      </div>
    </Tippy>
  );
}

function LineChart({ points }) {
  const width = 700;
  const height = 260;
  const values = points.flatMap((p) => [p.actual, p.forecast]);
  const min = 0;
  const max = Math.max(...values) * 1.1;

  const actualPath = buildLinePath(points.map((p) => p.actual), width, height, min, max);
  const forecastPath = buildLinePath(points.map((p) => p.forecast), width, height, min, max);
  const stepX = width / (points.length - 1);

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
          <path d={actualPath} className="sales-chart-line-actual" />
          <path d={forecastPath} className="sales-chart-line-forecast" />
          {points.map((p, i) => (
            <text key={p.label} x={i * stepX} y={height - 4} className="sales-chart-label">
              {p.label}
            </text>
          ))}
        </svg>
      </div>
    </Tippy>
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
    () => (apiData?.accuracy?.history || []).map((h) => h.accuracy).filter((v) => v !== null),
    [apiData]
  );
  const latestAccuracy = apiData?.accuracy?.value ?? null;
  const errorRate = apiData?.accuracy?.errorRate != null ? Number(apiData.accuracy.errorRate).toFixed(1) : null;
  const accuracyTierLabel = apiData?.accuracy?.tier?.label || null;
  // Lewis 1982 tier captions, matching the system module spec's table
  // (Forecasting > 1.1 Forecast Accuracy) exactly — not hardcoded to
  // always say "Excellent" regardless of the real number.
  const TIER_CAPTIONS = {
    Excellent: { css: "success", accuracy: "Excellent — reliable for planning", error: "Excellent — below 10% threshold" },
    Good: { css: "success", accuracy: "Good — reliable with minor safety buffer recommended", error: "Good — minor safety buffer recommended" },
    Fair: { css: "warning", accuracy: "Fair — use as rough guide, increase safety buffer", error: "Fair — increase safety buffer" },
    Low: { css: "danger", accuracy: "Low — upload more sales data to improve", error: "Low — upload more sales data to improve" },
  };
  const tierInfo = accuracyTierLabel ? TIER_CAPTIONS[accuracyTierLabel] : null;
  const accuracyCssSuffix = tierInfo?.css || "success";

  const predictionRows = apiData?.prediction?.rows || [];
  const salesPrediction = buildPredictionSet(predictionRows, true);
  const demandPrediction = buildPredictionSet(predictionRows, false);

  const featureImportance = (apiData?.modelInsights?.featureImportance || []).map((f) => ({
    label: f.label,
    value: Math.round(f.value * 10) / 10,
  }));
  const topFeature = featureImportance[0]?.label;

  const trainingInfoData = apiData?.modelInsights?.trainingInfo;
  const trainingInfo = {
    modelStatus: trainingInfoData?.modelStatus || "Not Trained",
    lastTrained: trainingInfoData?.lastTrained ? formatDisplayDate(trainingInfoData.lastTrained) : "—",
    latestForecast: trainingInfoData?.latestForecastRun ? formatDisplayDateTime(trainingInfoData.latestForecastRun) : "—",
    trainingRecords: trainingInfoData?.trainingRecords ?? "Not tracked per run",
    activeProducts: trainingInfoData ? `${trainingInfoData.activeProducts} menu item${trainingInfoData.activeProducts === 1 ? "" : "s"}` : "—",
    nextTraining: trainingInfoData?.nextTraining || "—",
    nextForecast: trainingInfoData?.nextForecastRun ? formatDisplayDateTime(trainingInfoData.nextForecastRun) : "—",
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
      { label: "Error Rate", value: errorRateText, caption: "average forecast error" },
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
                featureImportance: featureImportance.map((item) => `${item.label}: ${item.value}%`).join(" | "),
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

  const chartPoints = mode === "Sales" ? salesPrediction.points : demandPrediction.points;
  const totalSalesPages = Math.max(1, Math.ceil(salesPrediction.rows.length / ROWS_PER_PAGE));
  const paginatedSalesRows = salesPrediction.rows.slice(
    (salesPage - 1) * ROWS_PER_PAGE,
    salesPage * ROWS_PER_PAGE
  );
  const modalSalesRows = salesPrediction.rows.slice((modalSalesPage - 1) * 10, modalSalesPage * 10);
  const modalSalesTotalPages = Math.ceil(salesPrediction.rows.length / 10);

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
              <div className="metric-pair">
                <div className="metric-box">
                  <p className="metric-label">Forecast Accuracy</p>
                  <p className={`metric-value metric-value--${accuracyCssSuffix}`}>{latestAccuracy.toFixed(1)}%</p>
                  <p className={`metric-caption metric-caption--${accuracyCssSuffix}`}>
                    {tierInfo?.accuracy}
                  </p>
                </div>
                <div className="metric-box">
                  <p className="metric-label">Forecast error rate</p>
                  <p className={`metric-value metric-value--${accuracyCssSuffix}`}>{errorRate}%</p>
                  <p className={`metric-caption metric-caption--${accuracyCssSuffix}`}>
                    {tierInfo?.error}
                  </p>
                </div>
              </div>

              {latestAccuracy < 80 && (
                <div className="accuracy-warning-banner">
                  <span className="accuracy-warning-icon">⚠️</span>
                  <div>
                    <p className="accuracy-warning-title">Accuracy is below the reliable threshold.</p>
                    <p className="accuracy-warning-body">
                      Possible reasons: fewer than 28 days of sales history (new product), sales data not uploaded recently, or an unusual event (holiday, closure, weather) affected recent sales.
                    </p>
                    <p className="accuracy-warning-body">
                      <strong>What to do:</strong> Upload your most recent sales data to retrain the model.
                    </p>
                  </div>
                </div>
              )}

              <InfoBanner variant="info">
                <strong>What is this metric?</strong> This percentage tells you how close your
                forecasts are to real-world results on average. Your current error rate of {errorRate}% means your
                predictions are typically accurate to within {latestAccuracy.toFixed(1)}% of the actual
                totals, whether the guess was slightly too high or too low.
              </InfoBanner>
            </>
          )}

          <div className="chart-block">
            <p className="chart-block-title">Accuracy over time</p>
            <p className="chart-block-subtitle">Accuracy improves as more data is uploaded</p>
            <AccuracyChart data={accuracyHistory} />
            <div className="chart-legend">
              <span className="legend-item">
                <span className="legend-swatch legend-swatch--success" /> Accuracy %
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch--warning" /> Good threshold (80%)
              </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch--excellent" /> Excellent threshold (90%)
              </span>
            </div>
          </div>
        </section>

        {/* Sales and Demand Prediction */}
        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Sales and Demand Prediction
              <Tippy
                content={tooltips.salesPrediction}
                placement="right"
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
            <span className="filter-search">
              <FiSearch size={14} /> Search Product
            </span>
            <select className="filter-pill" style={{ width: '120px' }} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="Sales">Sales</option>
              <option value="Demand">Demand</option>
            </select>
          </div>

          <LineChart points={chartPoints} />
          <div className="chart-legend">
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--actual" /> {mode === "Sales" ? "Actual Sales" : "Actual Demand"}
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--forecast" /> {mode === "Sales" ? "Forecasted Sales" : "Forecasted Demand"}
            </span>
          </div>

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
              {salesPrediction.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-row">
                    Upload sales data to populate this table.
                  </td>
                </tr>
              ) : (
                paginatedSalesRows.map((row, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{row.date}</td>
                    <td>{row.product}</td>
                    <td>{row.actualQty}</td>
                    <td>{row.forecastQty}</td>
                    <td>{row.actualRevenue}</td>
                    <td>{row.forecastRevenue}</td>
                    <td>{row.estCost}</td>
                    <td>{row.estGrossProfit}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination
            currentPage={salesPage}
            totalPages={totalSalesPages}
            onPageChange={setSalesPage}
          />
          <p className="table-footnote">
            Total Cost = Cost of Goods &nbsp;·&nbsp; Est. = Estimated
          </p>
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
                placement="right"
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
            Daily forecasts run every morning at 9:00 AM. A full 7-day weekly forecast is
            generated every Monday at 9:00 AM.
          </InfoBanner>

          <div className="feature-importance">
            <p className="feature-importance-title">
              Feature Importance
              <Tippy
                content={tooltips.featureImportance}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                maxWidth={350}
                interactive={true}
              >
                <span className="info-icon-wrapper">
                  <FiInfo className="info-icon-small" />
                </span>
              </Tippy>
            </p>
            <p className="feature-importance-subtitle">
              What factors influence your forecasts the most?
            </p>
            <ul className="feature-list">
              {featureImportance.length === 0 ? (
                <li className="feature-row">
                  <span>Not available yet — appears after the next training run.</span>
                </li>
              ) : (
                featureImportance.map((f) => (
                  <li key={f.label} className="feature-row">
                    <span>{f.label}</span>
                    <span className="feature-value">{f.value}%</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          {topFeature && (
            <InfoBanner variant="tip" icon={<FiZap size={14} />}>
              {topFeature} has the strongest influence on sales.
            </InfoBanner>
          )}

          <div className="training-info">
            <p className="training-info-title">Training Information</p>
            <p className="training-info-subtitle">Current model status</p>
            <dl className="training-info-list">
              <div className="training-info-row">
                <dt>Model status</dt>
                <dd className="value--success">{trainingInfo.modelStatus}</dd>
              </div>
              <div className="training-info-row">
                <dt>Last trained</dt>
                <dd>{trainingInfo.lastTrained}</dd>
              </div>
              <div className="training-info-row">
                <dt>Training records</dt>
                <dd>{trainingInfo.trainingRecords}</dd>
              </div>
              <div className="training-info-row">
                <dt>Active products</dt>
                <dd>{trainingInfo.activeProducts}</dd>
              </div>
              <div className="training-info-row">
                <dt>Latest forecast</dt>
                <dd>{trainingInfo.latestForecast}</dd>
              </div>
              <div className="training-info-row">
                <dt>Next training</dt>
                <dd>{trainingInfo.nextTraining}</dd>
              </div>
              <div className="training-info-row">
                <dt>Next forecast</dt>
                <dd className="value--success">{trainingInfo.nextForecast}</dd>
              </div>
            </dl>
          </div>
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
            <div className="metric-pair">
              <div className="metric-box">
                <p className="metric-label">Forecast Accuracy</p>
                <p className={`metric-value metric-value--${accuracyCssSuffix}`}>{latestAccuracy.toFixed(1)}%</p>
                <p className={`metric-caption metric-caption--${accuracyCssSuffix}`}>{tierInfo?.accuracy}</p>
              </div>
              <div className="metric-box">
                <p className="metric-label">Forecast error rate</p>
                <p className={`metric-value metric-value--${accuracyCssSuffix}`}>{errorRate}%</p>
                <p className={`metric-caption metric-caption--${accuracyCssSuffix}`}>{tierInfo?.error}</p>
              </div>
            </div>

            <InfoBanner variant="info">
              <strong>What is this metric?</strong> This percentage tells you how close your
              forecasts are to real-world results on average. Your current error rate of {errorRate}% means your
              predictions are typically accurate to within {latestAccuracy.toFixed(1)}% of the actual
              totals, whether the guess was slightly too high or too low.
            </InfoBanner>
          </>
        )}

        <div className="chart-block">
          <p className="chart-block-title">Accuracy over time</p>
          <p className="chart-block-subtitle">Accuracy improves as more data is uploaded</p>
          <AccuracyChart data={accuracyHistory} />
          <div className="chart-legend">
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--success" /> Accuracy %
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--warning" /> Good threshold (80%)
            </span>
              <span className="legend-item">
                <span className="legend-swatch legend-swatch--excellent" /> Excellent threshold (90%)
              </span>
          </div>
        </div>
        <p className="chart-block-subtitle">Accuracy improves as more sales data is uploaded.</p>
      </ExpandableModal>

      {/* Expand: Sales and Demand Prediction */}
      <ExpandableModal
        isOpen={isSalesPredictionOpen}
        onClose={() => setIsSalesPredictionOpen(false)}
        title="Sales and Demand Prediction — Full View"
      >
        <div className="analytics-filter-row">
          <DatePicker value={selectedRange} onChange={setSelectedRange} mode="range" />
          <span className="filter-search">
            <FiSearch size={14} /> Search Product
          </span>
          <select className="filter-pill" style={{ width: '120px' }} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="Sales">Sales</option>
            <option value="Demand">Demand</option>
          </select>
        </div>

        <LineChart points={chartPoints} />
        <div className="chart-legend">
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--actual" /> {mode === "Sales" ? "Actual Sales" : "Actual Demand"}
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--forecast" /> {mode === "Sales" ? "Forecasted Sales" : "Forecasted Demand"}
          </span>
        </div>

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
            {salesPrediction.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-row">
                  Upload sales data to populate this table.
                </td>
              </tr>
            ) : (
              modalSalesRows.map((row, i) => (
                <tr key={i}>
                  <td>{(modalSalesPage - 1) * 10 + i + 1}</td>
                  <td>{row.date}</td>
                  <td>{row.product}</td>
                  <td>{row.actualQty}</td>
                  <td>{row.forecastQty}</td>
                  <td>{row.actualRevenue}</td>
                  <td>{row.forecastRevenue}</td>
                  <td>{row.estCost}</td>
                  <td>{row.estGrossProfit}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination
          currentPage={modalSalesPage}
          totalPages={modalSalesTotalPages}
          onPageChange={setModalSalesPage}
        />
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
          Daily forecasts run every morning at 9:00 AM. A full 7-day weekly forecast is
          generated every Monday at 9:00 AM.
        </InfoBanner>

        <div className="feature-importance">
          <p className="feature-importance-title">
            Feature Importance
            <Tippy
              content={tooltips.featureImportance}
              placement="top"
              animation="scale"
              duration={200}
              theme="dark"
              arrow={true}
              maxWidth={350}
              interactive={true}
            >
              <span className="info-icon-wrapper">
                <FiInfo className="info-icon-small" />
              </span>
            </Tippy>
          </p>
          <p className="feature-importance-subtitle">
            What factors influence your forecasts the most?
          </p>
          <ul className="feature-list">
            {featureImportance.length === 0 ? (
              <li className="feature-row">
                <span>Not available yet — appears after the next training run.</span>
              </li>
            ) : (
              featureImportance.map((f) => (
                <li key={f.label} className="feature-row">
                  <span>{f.label}</span>
                  <span className="feature-value">{f.value}%</span>
                </li>
              ))
            )}
          </ul>
        </div>

        {topFeature && (
          <InfoBanner variant="tip" icon={<FiZap size={14} />}>
            {topFeature} has the strongest influence on sales.
          </InfoBanner>
        )}

        <div className="training-info">
          <p className="training-info-title">Training Information</p>
          <p className="training-info-subtitle">Current model status</p>
          <dl className="training-info-list">
            <div className="training-info-row">
              <dt>Model status</dt>
              <dd className="value--success">{trainingInfo.modelStatus}</dd>
            </div>
            <div className="training-info-row">
              <dt>Last trained</dt>
              <dd>{trainingInfo.lastTrained}</dd>
            </div>
            <div className="training-info-row">
              <dt>Training records</dt>
              <dd>{trainingInfo.trainingRecords}</dd>
            </div>
            <div className="training-info-row">
              <dt>Active products</dt>
              <dd>{trainingInfo.activeProducts}</dd>
            </div>
              <div className="training-info-row">
                <dt>Latest forecast</dt>
                <dd>{trainingInfo.latestForecast}</dd>
              </div>
              <div className="training-info-row">
                <dt>Next training</dt>
                <dd>{trainingInfo.nextTraining}</dd>
              </div>
              <div className="training-info-row">
                <dt>Next forecast</dt>
                <dd className="value--success">{trainingInfo.nextForecast}</dd>
              </div>
          </dl>
        </div>
      </ExpandableModal>
    </>
  );
}

export default Forecasting;