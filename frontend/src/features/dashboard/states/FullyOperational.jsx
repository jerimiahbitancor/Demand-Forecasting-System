// states/FullyOperational.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowUp, FaArrowDown, FaInfoCircle } from "react-icons/fa";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/scale.css";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart
} from 'recharts';
import apiClient from '../../../services/apiClient';
import Navbar from "../../components/Navbar/Navbar";
import DashboardNotices from "../components/DashboardNotices.jsx";
import { formatStockQty } from "../../../utils/formatStockQty.js";
import { formatItemsSold } from "../../../utils/formatItemsSold.js";
import {
  chartRange, toChartRows, pickBestSellers, pickIngredients, statusBadgeClass, shortDateLabel,
} from "../utils/dashboardPanels.js";
import { DASHBOARD_TIMEOUT_MS } from "../utils/dashboardTimeout.js";
import { accuracyPercent, accuracyVerdict, accuracyOffByLine, ACCURACY_HELP_SENTENCES } from "../../../utils/accuracyText.js";
import "../pages/Dashboard.css";

// Chart hover box. Module scope so recharts gets the same component every
// render (a component declared inside the render is rebuilt each time).
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map((entry, index) => (
          // Items sold, as a whole number: forecasts are expected values
          // (decimals); the chart itself still plots the raw values.
          <p key={index} style={{ color: entry.color }}>{entry.name}: {formatItemsSold(entry.value)}</p>
        ))}
      </div>
    );
  }
  return null;
};

// Neutral "not available yet" look for panels with no real data source.
const NOT_AVAILABLE_STYLE = {
  height: 350,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '0 24px',
  color: '#6b7280',
  fontSize: 14,
  border: '1px dashed #d1d5db',
  borderRadius: 12,
  background: '#f9fafb',
};
const NOT_AVAILABLE_TEXT_STYLE = { color: '#6b7280', fontSize: 13, margin: '8px 0', lineHeight: 1.5 };

// Stock Alert card: same colours as the Ingredient Management legend.
const STOCK_STATUSES = [
  { key: 'Critical', label: 'Critical', color: '#dc2626' },
  { key: 'Low', label: 'Low', color: '#f59e0b' },
  { key: 'Normal', label: 'Normal', color: '#16a34a' },
  { key: 'Excess', label: 'Excess', color: '#3b82f6' },
];
const STOCK_NO_DATA_COLOR = '#9ca3af';

// Headline colour = the WORST status present, not a count threshold (the old
// 10/5/1 thresholds showed 7 Critical ingredients in yellow).
const stockHeadlineColor = (counts) => {
  if (!counts) return STOCK_NO_DATA_COLOR;
  if (counts.Critical > 0) return '#dc2626';
  if (counts.Low > 0) return '#f59e0b';
  return '#16a34a';
};

// "2026-10-16" -> "Oct 16", from its parts: new Date("YYYY-MM-DD") is read
// as UTC midnight and can land on the day before.
const shortMonthDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// initialState = the /upload/dashboard-state payload. Since Oct 14 2026 a
// trained model always lands here; its attention/mapping blocks become
// notice cards above the KPIs (components/DashboardNotices.jsx).
const FullyOperational = ({ initialState, onRefreshState }) => {
  const [selectedChart, setSelectedChart] = useState("area");
  const [selectedPeriod, setSelectedPeriod] = useState("week");
  // KPI row only: 'loading' | 'ready' | 'failed'. The page itself renders
  // straight away; the Dashboard splash is the only full-page loading screen.
  const [summaryStatus, setSummaryStatus] = useState('loading');
  // null = not loaded (or failed to load): the KPI cards show "—", never
  // an invented 0.
  const [dashboardData, setDashboardData] = useState({
    predictedSales: null,
    actualSales: null,
    actualSalesDate: null,
    forecastAccuracy: null,
    accuracyBeatsBaseline: null,
    stockAlert: null,
    stockCounts: null,
    predictedSalesYesterday: null,
    salesTrend: null,
    accuracyTrend: 0,
  });
  // The three panels load on their own (Promise.allSettled), so one failing
  // panel never blanks the KPIs or the other panels.
  // status: 'loading' | 'ready' | 'failed'
  const [panels, setPanels] = useState({
    chart: { status: 'loading', rows: [] },
    bestSellers: { status: 'loading', rows: [], range: null },
    ingredients: { status: 'loading', rows: [], date: null },
  });
  const periodEffectRan = useRef(false);
  const navigate = useNavigate();

  // The two right-panel cards open the matching Analytics tab. Using the
  // /analytics?tab= URL (instead of the bare sub-route) keeps the Analytics
  // chrome — navbar, tab bar, breadcrumb — around the panel, so the owner
  // can navigate away.
  const openAnalyticsTab = (tabId) => navigate(`/analytics?tab=${tabId}`);

  // Card-level click/keyboard handler. The info icon stops propagation so
  // opening a tooltip never triggers navigation.
  const cardClickProps = (tabId) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => openAnalyticsTab(tabId),
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAnalyticsTab(tabId);
      }
    },
  });

  // Get day of week for dynamic message
  const getDayOfWeek = (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  };

  // Was a fabricated random +/-% "vs typical <weekday>" comparison —
  // there's no real per-weekday baseline available from any endpoint yet,
  // so rather than keep inventing a number next to the now-real predicted
  // sales figure, this just names which day the forecast is for.
  const getComparisonMessage = () => {
    const dayOfWeek = getDayOfWeek(new Date());
    return `Forecast for ${dayOfWeek}`;
  };

 const fetchDashboardData = async () => {
  try {
    setSummaryStatus('loading');

    // GET /api/forecast/summary feeds the KPI row (analyticsService.js
    // getForecastSummary). The three panels load separately (loadPanels).
    const summaryResponse = await apiClient.get('/forecast/summary', { timeout: DASHBOARD_TIMEOUT_MS });

    if (summaryResponse.data.success) {
      const summary = summaryResponse.data.data;
      const predictedSales = Math.round(summary.predictedSalesToday || 0);
      // null = nothing uploaded for yesterday: the card shows "—", never ₱0.
      const actualSales = summary.actualSalesYesterday != null ? Math.round(summary.actualSalesYesterday) : null;
      // Raw value; shown as a whole number (utils/accuracyText.js), same
      // wording as Analytics > Forecasting.
      const forecastAccuracy = summary.forecastAccuracy?.value ?? null;
      const predictedSalesYesterday = summary.predictedSalesYesterday != null
        ? Math.round(summary.predictedSalesYesterday)
        : null;
      const accuracyBeatsBaseline = summary.forecastAccuracy?.beatsBaseline ?? null;
      // Local name on purpose: the component also has a render-scope
      // `stockCounts` declared further down the render. Referencing
      // that one from here threw "Cannot access before initialization".
      const rawStock = summary.stockAlerts || {};
      const summaryStockCounts = {
        Critical: Number(rawStock.Critical) || 0,
        Low: Number(rawStock.Low) || 0,
        Normal: Number(rawStock.Normal) || 0,
        Excess: Number(rawStock.Excess) || 0,
      };
      // Headline = ingredients that need restocking (Critical + Low).
      const stockAlert = summaryStockCounts.Critical + summaryStockCounts.Low;

      setDashboardData({
        predictedSales,
        actualSales,
        actualSalesDate: summary.yesterday || null,
        forecastAccuracy,
        accuracyBeatsBaseline,
        stockAlert,
        stockCounts: summaryStockCounts,
        predictedSalesYesterday,
        // Today's forecast vs yesterday's actual sales (labelled on the badge).
        salesTrend: actualSales ? Math.round((predictedSales - actualSales) / actualSales * 100) : null,
        accuracyTrend: 0,
      });
    } else {
      throw new Error('Forecast summary was not successful');
    }
    setSummaryStatus('ready');
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    // Shown inline above the KPI row (no popup on every failed load).
    setSummaryStatus('failed');

    // Failed to load: show "—" everywhere, never zeros that look like data.
    setDashboardData({
      predictedSales: null,
      actualSales: null,
      actualSalesDate: null,
      forecastAccuracy: null,
      accuracyBeatsBaseline: null,
      stockAlert: null,
      stockCounts: null,
      predictedSalesYesterday: null,
      salesTrend: null,
      accuracyTrend: 0,
    });
  }
};

  // The three panels, from the endpoints the Analytics pages use. Every
  // setState happens after the requests settle.
  const loadPanels = async (period, includeSidePanels) => {
    const requests = [
      apiClient.get('/analytics/forecasting', { params: chartRange(period), timeout: DASHBOARD_TIMEOUT_MS }),
      ...(includeSidePanels
        ? [
          apiClient.get('/analytics/product-performance', { timeout: DASHBOARD_TIMEOUT_MS }),
          apiClient.get('/analytics/ingredient-demand', { timeout: DASHBOARD_TIMEOUT_MS }),
        ]
        : []),
    ];
    const [chartRes, perfRes, demandRes] = await Promise.allSettled(requests);
    const dataOf = (res) => (res && res.status === 'fulfilled' && res.value.data?.success ? res.value.data.data : null);

    setPanels((prev) => {
      const next = { ...prev };
      const chartData = dataOf(chartRes);
      next.chart = chartData
        ? { status: 'ready', rows: toChartRows(chartData.prediction?.series) }
        : { status: 'failed', rows: [] };
      if (includeSidePanels) {
        const perf = dataOf(perfRes);
        next.bestSellers = perf
          ? { status: 'ready', rows: pickBestSellers(perf.performanceRatio?.rows), range: perf.performanceRatio?.range || null }
          : { status: 'failed', rows: [], range: null };
        const demand = dataOf(demandRes);
        next.ingredients = demand
          ? { status: 'ready', rows: pickIngredients(demand.daily?.rows), date: demand.daily?.date || null }
          : { status: 'failed', rows: [], date: null };
      }
      return next;
    });
  };

  useEffect(() => {
    fetchDashboardData();
    loadPanels(selectedPeriod, true);
  }, []);

  // Period change: reload the chart only (skip the first run; the mount
  // effect above already loaded it).
  useEffect(() => {
    if (!periodEffectRan.current) {
      periodEffectRan.current = true;
      return;
    }
    loadPanels(selectedPeriod, false);
  }, [selectedPeriod]);

  const handleChartChange = (e) => setSelectedChart(e.target.value);
  const handlePeriodChange = (e) => setSelectedPeriod(e.target.value);
  
  const formatCurrency = (amount) => new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(amount);

  const getRatioClass = (ratio) => {
    const num = parseFloat(ratio);
    if (num >= 1.5) return 'ratio-high';
    if (num >= 1.0) return 'ratio-medium';
    return 'ratio-low';
  };

  // Tooltips
  const tooltips = {
    sales: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This is your estimated total sales for today.<br /><br />
        The badge compares it with yesterday's actual sales.<br /><br />
        <strong style={{ color: "#22c55e" }}>✓ If it's higher:</strong> You might need extra staff and ingredients.<br />
        <strong style={{ color: "#ef4444" }}>✓ If it's lower:</strong> You can save money by preparing less.<br /><br />
        <span style={{ color: "#60a5fa", cursor: "pointer", display: "block", textAlign: "center", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          Click to view detailed forecast in Analytics →
        </span>
      </div>
    ),
    actual: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This is the actual amount you earned yesterday. It compares yesterday's results against what the system predicted.<br /><br />
        <strong style={{ color: "#22c55e" }}>✓ If it's close to the forecast:</strong> The system is working well.<br />
        <strong style={{ color: "#fbbf24" }}>✓ If it's much higher or lower:</strong> Something unusual happened.<br /><br />
        <span style={{ color: "#60a5fa", cursor: "pointer", display: "block", textAlign: "center", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          Click to view detailed sales breakdown →
        </span>
      </div>
    ),
    // Same plain sentences as Analytics > Forecasting (utils/accuracyText.js).
    accuracy: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        {ACCURACY_HELP_SENTENCES.join(' ')}
      </div>
    ),
    // Matches the backend rule (analyticsService computeStockStatus): stock
    // vs TODAY's forecasted need, recipe ingredients only.
    stock: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        Compares each ingredient's current stock with today's forecasted need,
        worked out from the forecast and your recipes.<br /><br />
        <div style={{ margin: "8px 0" }}>
          <div><strong style={{ color: "#f87171" }}>Critical</strong>: less than half of the need</div>
          <div><strong style={{ color: "#fbbf24" }}>Low</strong>: less than the need</div>
          <div><strong style={{ color: "#4ade80" }}>Normal</strong>: 1 to 2 times the need</div>
          <div><strong style={{ color: "#60a5fa" }}>Excess</strong>: more than 2 times the need</div>
        </div>
        Only ingredients used in a product recipe are counted.
      </div>
    ),
    chart: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This chart shows product demand as servings (items), not sales revenue. It compares recorded sales with the forecast for the same dates and shows the upcoming forecast.<br /><br />
        <div style={{ margin: "8px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ display: "inline-block", width: "20px", height: "3px", background: "#22c55e", borderRadius: "2px" }}></span>
            <span><strong>Green</strong> = What actually sold (past data)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ display: "inline-block", width: "20px", height: "3px", background: "#60a5fa", borderRadius: "2px" }}></span>
            <span><strong>Light blue</strong> = What the system predicted</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-block", width: "20px", height: "3px", background: "#1e40af", borderRadius: "2px" }}></span>
            <span><strong>Dark blue</strong> = What the system predicts for the coming days</span>
          </div>
        </div>
      </div>
    ),
    bestSellers: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        These are your money-makers right now.<br /><br />
        <div style={{ margin: "8px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ color: "#22c55e", fontWeight: "bold" }}>●</span>
            <span><strong>Ratio above 1.0</strong> = Better than average <span style={{ color: "#22c55e" }}>(Keep this on the menu!)</span></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#ef4444", fontWeight: "bold" }}>●</span>
            <span><strong>Ratio below 1.0</strong> = Below average <span style={{ color: "#fbbf24" }}>(Consider running a promo or replacing it)</span></span>
          </div>
        </div>
        <span style={{ color: "#60a5fa", cursor: "pointer", display: "block", textAlign: "center", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          Click to view detailed product analysis →
        </span>
      </div>
    ),
    ingredients: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This is your quick shopping list for tomorrow.<br /><br />
        We calculated this by looking at your predicted menu sales and how much of each ingredient goes into every dish.<br /><br />
        <strong style={{ color: "#fbbf24" }}>Tip:</strong> Check your current supplies before heading to the market.<br /><br />
        <span style={{ color: "#60a5fa", cursor: "pointer", display: "block", textAlign: "center", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          Click to view full ingredient demand breakdown →
        </span>
      </div>
    ),
  };

  const comparisonMessage = getComparisonMessage();
  const stockCounts = dashboardData.stockCounts;
  const stockColor = stockHeadlineColor(stockCounts);
  const stockTotal = stockCounts ? STOCK_STATUSES.reduce((sum, st) => sum + stockCounts[st.key], 0) : null;
  // Amber only when the model is known NOT to beat the 7-day average;
  // unknown (no baseline) stays green, as before.
  const accuracyTone = dashboardData.accuracyBeatsBaseline === false ? 'amber' : 'green';

  return (
    <div className="dashboard-container">
      <Navbar />

      <main className="dashboard-main">
        {/* Dashboard Title & Date */}
        <div className="dashboard-title-section">
          <h1 className="dashboard-title">Dashboard</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
            <div className="date-info">
              <span>{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span>
              <span className="date-separator">{new Date().toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Things that need attention: shown above the normal dashboard,
            never instead of it. Renders nothing when all is well. */}
        <DashboardNotices
          attention={initialState?.attention}
          mapping={initialState?.mapping}
          onRefreshState={onRefreshState}
        />

        {/* KPI row status: inline, never a popup. */}
        {summaryStatus === 'loading' && (
          <p style={NOT_AVAILABLE_TEXT_STYLE} role="status">Loading today's numbers…</p>
        )}
        {summaryStatus === 'failed' && (
          <p style={{ ...NOT_AVAILABLE_TEXT_STYLE, color: '#b91c1c' }} role="alert">
            Today's numbers could not be loaded right now.{' '}
            <button
              type="button"
              onClick={fetchDashboardData}
              style={{ background: 'none', border: 'none', padding: 0, color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Try again
            </button>
          </p>
        )}

        {/* Key Metrics Row */}
        <div className="metrics-grid">
          {/* 1. Predicted Sales Today */}
          <div className="metric-card border-red">
            <div className="card-header">
              <h3 className="card-title">Predicted Sales Today</h3>
              <Tippy content={tooltips.sales} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
              </Tippy>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">{dashboardData.predictedSales != null ? formatCurrency(dashboardData.predictedSales) : '—'}</span>
              {dashboardData.salesTrend != null && (
                <div
                  className={dashboardData.salesTrend >= 0 ? 'badge-success' : 'badge-danger'}
                  title="vs yesterday's actual"
                  aria-label={`${dashboardData.salesTrend >= 0 ? '+' : ''}${dashboardData.salesTrend}% vs yesterday's actual`}
                >
                  {dashboardData.salesTrend >= 0 ? <FaArrowUp className="badge-icon" /> : <FaArrowDown className="badge-icon" />}
                  {dashboardData.salesTrend >= 0 ? '+' : ''}{dashboardData.salesTrend}%
                </div>
              )}
            </div>
            <p className="metric-subtext">{comparisonMessage}</p>
          </div>

          {/* 2. Actual Sales Yesterday */}
          <div className="metric-card border-yellow">
            <div className="card-header">
              <h3 className="card-title">Actual Sales Yesterday</h3>
              <Tippy content={tooltips.actual} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
              </Tippy>
            </div>
            <div className="metric-value-group">
              <span className={`metric-value${dashboardData.actualSales == null ? ' metric-value--empty' : ''}`}>
                {dashboardData.actualSales != null ? formatCurrency(dashboardData.actualSales) : '—'}
              </span>
            </div>
            {summaryStatus !== 'ready' ? (
              <p className="metric-subtext metric-subtext--muted">
                {summaryStatus === 'loading' ? 'Loading…' : 'Not available right now'}
              </p>
            ) : dashboardData.actualSales == null ? (
              // Nothing uploaded for yesterday: say so instead of showing ₱0.
              <p className="metric-subtext metric-subtext--muted">
                No sales uploaded for {shortMonthDay(dashboardData.actualSalesDate) || 'yesterday'}
              </p>
            ) : (
              <p className="metric-subtext">
                {dashboardData.predictedSalesYesterday
                  ? `${Math.round((dashboardData.actualSales / dashboardData.predictedSalesYesterday) * 100)}% of yesterday's forecast`
                  : "Yesterday's recorded sales"}
              </p>
            )}
          </div>

          {/* 3. Forecast Accuracy */}
          <div className={`metric-card border-${accuracyTone}`}>
            <div className="card-header">
              <h3 className="card-title">Forecast Accuracy</h3>
              <Tippy content={tooltips.accuracy} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
              </Tippy>
            </div>
            <div className="metric-value-group">
              <span className={`metric-value text-${accuracyTone}`}>
                {dashboardData.forecastAccuracy != null ? `${accuracyPercent(dashboardData.forecastAccuracy)}%` : '—'}
              </span>
            </div>
            <p className="metric-subtext small">
              {summaryStatus === 'loading'
                ? 'Loading…'
                : summaryStatus === 'failed'
                  ? 'Not available right now'
                  : dashboardData.forecastAccuracy != null
                    ? (accuracyVerdict(dashboardData.accuracyBeatsBaseline) || 'Latest trained model')
                    : 'No trained model yet'}
            </p>
            {summaryStatus === 'ready' && dashboardData.forecastAccuracy != null && (
              <p className="metric-footnote">{accuracyOffByLine(dashboardData.forecastAccuracy)}</p>
            )}
          </div>

          {/* 4. Stock Alert */}
          <div className="metric-card" style={{ borderTop: `4px solid ${stockColor}` }}>
            <div className="card-header">
              <h3 className="card-title">Stock Alert</h3>
              <Tippy content={tooltips.stock} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
              </Tippy>
            </div>

            <div className="metric-value-group stock-headline">
              <span className="metric-value" style={{ color: stockColor }}>{dashboardData.stockAlert ?? '—'}</span>
              {dashboardData.stockAlert != null && (
                <span className="stock-headline-label">
                  {dashboardData.stockAlert === 1 ? 'ingredient needs restocking' : 'ingredients need restocking'}
                </span>
              )}
            </div>

            {stockTotal > 0 && (
              <div
                className="stock-bar"
                role="img"
                aria-label={STOCK_STATUSES.map((st) => `${stockCounts[st.key]} ${st.label}`).join(', ')}
              >
                {STOCK_STATUSES.filter((st) => stockCounts[st.key] > 0).map((st) => (
                  <span
                    key={st.key}
                    className="stock-bar-segment"
                    style={{ flexGrow: stockCounts[st.key], backgroundColor: st.color }}
                  />
                ))}
              </div>
            )}

            {stockCounts && (
              <ul className="stock-grid">
                {STOCK_STATUSES.map((st) => (
                  <li key={st.key} className={`stock-grid-item${stockCounts[st.key] === 0 ? ' stock-grid-item--zero' : ''}`}>
                    <span
                      className="stock-dot"
                      aria-hidden="true"
                      style={{ backgroundColor: st.color, opacity: stockCounts[st.key] === 0 ? 0.4 : 1 }}
                    />
                    <span className="stock-grid-count">{stockCounts[st.key]}</span>
                    <span>{st.label}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="metric-footnote">
              {summaryStatus === 'loading'
                ? 'Loading…'
                : summaryStatus === 'failed'
                  ? 'Not available right now'
                  : stockCounts == null
                ? 'No stock data yet'
                : stockTotal > 0
                  ? `Of ${stockTotal} ingredients used in recipes, vs today's forecast`
                  : 'No recipe ingredients to compare yet'}
            </p>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="main-content-grid">
          {/* Chart Section */}
          <div className="chart-section">
            <div className="chart-header">
              <div>
                <h2 className="chart-title">
                  Demand Overview
                  <Tippy content={tooltips.chart} placement="right" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={350} interactive={true} trigger="mouseenter focus click">
                    <span className="chart-info-wrapper"><FaInfoCircle className="chart-info-icon" /></span>
                  </Tippy>
                </h2>
                <p className="chart-description">
                  Daily servings sold and expected: compare recorded sales with the forecast, then see predicted demand for upcoming days. This chart shows item quantities, not peso revenue; gaps indicate closed or unreported days.
                </p>
              </div>
              <div className="chart-controls">
                <select className="chart-select" value={selectedChart} onChange={handleChartChange}>
                  <option value="area">Area Chart</option>
                  <option value="line">Line Chart</option>
                  <option value="bar">Bar Chart</option>
                  <option value="composed">Composed</option>
                </select>
                <select className="chart-select" value={selectedPeriod} onChange={handlePeriodChange}>
                  <option value="week">Last 7 Days</option>
                  <option value="month">Last 30 Days</option>
                </select>
              </div>
            </div>

            <div className="chart-container">
              {panels.chart.status === 'loading' ? (
                <div style={NOT_AVAILABLE_STYLE}>Loading the demand chart…</div>
              ) : panels.chart.rows.length === 0 ? (
                <div style={NOT_AVAILABLE_STYLE}>
                  {panels.chart.status === 'failed'
                    ? 'The demand chart is not available right now. Please try again later.'
                    : 'Not available yet. There are no sales or forecasts in this date range.'}
                </div>
              ) : (
              <ResponsiveContainer width="100%" height={350}>
                {selectedChart === 'area' ? (
                  // Light fills so overlapping areas stay readable; nulls stay
                  // gaps so closed days are not drawn as zero.
                  <AreaChart data={panels.chart.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" label={{ value: 'Items sold', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="actual" stroke="#22c55e" strokeWidth={2} fill="#22c55e" fillOpacity={0.2} dot={{ r: 3 }} activeDot={{ r: 6 }} name="Actual Sales" connectNulls={false} />
                    <Area type="monotone" dataKey="forecast" stroke="#60a5fa" strokeWidth={2} fill="#60a5fa" fillOpacity={0.15} dot={{ r: 3 }} activeDot={{ r: 6 }} name="Forecasted Sales" connectNulls={false} />
                    <Area type="monotone" dataKey="future" stroke="#1e40af" strokeWidth={2} strokeDasharray="5 5" fill="#1e40af" fillOpacity={0.2} dot={{ r: 3 }} activeDot={{ r: 6 }} name="Future Forecast" connectNulls={false} />
                  </AreaChart>
                ) : selectedChart === 'line' ? (
                  <LineChart data={panels.chart.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" label={{ value: 'Items sold', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="actual" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Actual Sales" connectNulls={false} />
                    <Line type="monotone" dataKey="forecast" stroke="#60a5fa" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Forecasted Sales" connectNulls={false} />
                    <Line type="monotone" dataKey="future" stroke="#1e40af" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4 }} activeDot={{ r: 6 }} name="Future Forecast" connectNulls={false} />
                  </LineChart>
                ) : selectedChart === 'bar' ? (
                  <BarChart data={panels.chart.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" label={{ value: 'Items sold', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="actual" fill="#22c55e" name="Actual Sales" />
                    <Bar dataKey="forecast" fill="#60a5fa" name="Forecasted Sales" />
                    <Bar dataKey="future" fill="#1e40af" name="Future Forecast" />
                  </BarChart>
                ) : (
                  <ComposedChart data={panels.chart.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" label={{ value: 'Items sold', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="actual" fill="#22c55e" name="Actual Sales" />
                    <Line type="monotone" dataKey="forecast" stroke="#60a5fa" strokeWidth={2} name="Forecasted Sales" connectNulls={false} />
                    <Line type="monotone" dataKey="future" stroke="#1e40af" strokeWidth={2} strokeDasharray="5 5" name="Future Forecast" connectNulls={false} />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="right-panel">
            {/* Top Best Sellers */}
            <div className="placeholder-card clickable-card" {...cardClickProps('product-performance')}>
              <div className="placeholder-header">
                <h3 className="placeholder-title">Top Best Sellers</h3>
                <Tippy content={tooltips.bestSellers} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                  <span className="icon-wrapper" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><FaInfoCircle className="card-info" /></span>
                </Tippy>
              </div>
              <div className="scrollable-content">
                {panels.bestSellers.range && panels.bestSellers.rows.length > 0 && (
                  <p style={NOT_AVAILABLE_TEXT_STYLE}>
                    Last 7 uploaded days ({shortDateLabel(panels.bestSellers.range.from)} to {shortDateLabel(panels.bestSellers.range.to)})
                  </p>
                )}
                {panels.bestSellers.rows.length === 0 && (
                  <p style={NOT_AVAILABLE_TEXT_STYLE}>
                    {panels.bestSellers.status === 'loading'
                      ? 'Loading…'
                      : panels.bestSellers.status === 'failed'
                        ? 'Not available right now. Please try again later.'
                        : 'Not available yet. No product has a performance ratio for these days.'}
                  </p>
                )}
                {panels.bestSellers.rows.map((item, index) => (
                  <div key={index} className="best-seller-item">
                    <span className="product-name">{item.name}</span>
                    <div className="product-stats">
                      <span className="product-sales">{item.sold} sold</span>
                      <span className={`product-ratio ${getRatioClass(item.ratio)}`}>{item.ratio}x</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Ingredients to Prepare */}
            <div className="placeholder-card clickable-card" {...cardClickProps('ingredient-demand')}>
              <div className="placeholder-header">
                <h3 className="placeholder-title">Top Ingredients to Prepare</h3>
                <Tippy content={tooltips.ingredients} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                  <span className="icon-wrapper" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><FaInfoCircle className="card-info" /></span>
                </Tippy>
              </div>
              <div className="scrollable-content">
                {panels.ingredients.date && panels.ingredients.rows.length > 0 && (
                  <p style={NOT_AVAILABLE_TEXT_STYLE}>For {shortDateLabel(panels.ingredients.date)}</p>
                )}
                {panels.ingredients.rows.length === 0 && (
                  <p style={NOT_AVAILABLE_TEXT_STYLE}>
                    {panels.ingredients.status === 'loading'
                      ? 'Loading…'
                      : panels.ingredients.status === 'failed'
                        ? 'Not available right now. See Analytics, Ingredient Demand.'
                        : 'Not available yet. No forecast or recipe for today yet.'}
                  </p>
                )}
                {panels.ingredients.rows.map((item, index) => (
                  <div key={index} className="ingredient-item">
                    <span className="ingredient-name">{item.name}</span>
                    <div className="ingredient-stats">
                      <span className="ingredient-qty">{formatStockQty(item.need, item.unit)} {item.unit}</span>
                      <span className={`ingredient-status ${statusBadgeClass(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default FullyOperational;