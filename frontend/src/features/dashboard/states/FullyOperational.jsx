// states/FullyOperational.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowUp, FaArrowDown, FaInfoCircle, FaCalendarAlt } from "react-icons/fa";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/scale.css";
import {
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
import Swal from '../../../utils/swal';
import axios from 'axios';
import Navbar from "../../components/Navbar/Navbar";
import DashboardNotices from "../components/DashboardNotices.jsx";
import { formatStockQty } from "../../../utils/formatStockQty.js";
import { formatItemsSold } from "../../../utils/formatItemsSold.js";
import {
  chartRange, toChartRows, pickBestSellers, pickIngredients, statusBadgeClass, shortDateLabel,
} from "../utils/dashboardPanels.js";
import "../pages/Dashboard.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
  const [selectedChart, setSelectedChart] = useState("line");
  const [selectedPeriod, setSelectedPeriod] = useState("week");
  const [loading, setLoading] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  // null = not loaded (or failed to load): the KPI cards show "—", never
  // an invented 0.
  const [dashboardData, setDashboardData] = useState({
    predictedSales: null,
    actualSales: null,
    actualSalesDate: null,
    forecastAccuracy: null,
    forecastAccuracyLabel: null,
    accuracyBeatsBaseline: null,
    baselineAccuracy: null,
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

  const getAuthToken = () => sessionStorage.getItem('access_token') || localStorage.getItem('token');

  const apiClient = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' }
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error)
  );

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
    setLoading(true);
    Swal.fire({
      title: 'Loading Dashboard',
      text: 'Please wait while we fetch your data...',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });

    // GET /api/forecast/summary feeds the KPI row (analyticsService.js
    // getForecastSummary). The three panels load separately (loadPanels).
    const summaryResponse = await apiClient.get('/forecast/summary');
    Swal.close();

    if (summaryResponse.data.success) {
      const summary = summaryResponse.data.data;
      const predictedSales = Math.round(summary.predictedSalesToday || 0);
      // null = nothing uploaded for yesterday: the card shows "—", never ₱0.
      const actualSales = summary.actualSalesYesterday != null ? Math.round(summary.actualSalesYesterday) : null;
      const accuracyValue = summary.forecastAccuracy?.value;
      // One decimal, same as the accuracy notice card (64.6%).
      const forecastAccuracy = accuracyValue != null ? Math.round(accuracyValue * 10) / 10 : null;
      const predictedSalesYesterday = summary.predictedSalesYesterday != null
        ? Math.round(summary.predictedSalesYesterday)
        : null;
      // The backend never sent a `tier`; the label is standing.label
      // ("Better than a simple average" / "Not yet better ...").
      const forecastAccuracyLabel = summary.forecastAccuracy?.standing?.label || null;
      const accuracyBeatsBaseline = summary.forecastAccuracy?.beatsBaseline ?? null;
      const baselineValue = summary.forecastAccuracy?.baselineValue;
      const baselineAccuracy = baselineValue != null ? Math.round(baselineValue * 10) / 10 : null;
      const stockAlerts = summary.stockAlerts || { Critical: 0, Low: 0, Normal: 0, Excess: 0 };
      // Headline total = all tracked ingredients, so it always equals the sum
      // of the Critical/Low/Normal/Excess breakdown shown in the card.
      const stockAlert = (stockAlerts.Critical || 0) + (stockAlerts.Low || 0)
        + (stockAlerts.Normal || 0) + (stockAlerts.Excess || 0);

      const stockBreakdown = [
        { count: stockAlerts.Critical || 0, label: 'Critical', color: '#ef4444' },
        { count: stockAlerts.Low || 0, label: 'Low', color: '#eab308' },
        { count: stockAlerts.Normal || 0, label: 'Normal', color: '#22c55e' },
        { count: stockAlerts.Excess || 0, label: 'Excess', color: '#3b82f6' }
      ];

      setDashboardData({
        predictedSales,
        actualSales,
        actualSalesDate: summary.yesterday || null,
        forecastAccuracy,
        forecastAccuracyLabel,
        accuracyBeatsBaseline,
        baselineAccuracy,
        stockAlert,
        stockCounts,
        predictedSalesYesterday,
        // Today's forecast vs yesterday's actual sales (labelled on the badge).
        salesTrend: actualSales ? Math.round((predictedSales - actualSales) / actualSales * 100) : null,
        accuracyTrend: 0,
      });
    }
  } catch (error) {
    Swal.close();
    console.error('Error fetching dashboard data:', error);
    Swal.fire({
      icon: 'error',
      title: 'Failed to load dashboard',
      text: 'Could not load forecast summary. Please try again later.',
      confirmButtonColor: '#7A0101'
    });

    // Failed to load: show "—" everywhere, never zeros that look like data.
    setDashboardData({
      predictedSales: null,
      actualSales: null,
      actualSalesDate: null,
      forecastAccuracy: null,
      forecastAccuracyLabel: null,
      accuracyBeatsBaseline: null,
      baselineAccuracy: null,
      stockAlert: null,
      stockCounts: null,
      predictedSalesYesterday: null,
      salesTrend: null,
      accuracyTrend: 0,
    });
  } finally {
    setLoading(false);
  }
};

  // The three panels, from the endpoints the Analytics pages use. Every
  // setState happens after the requests settle.
  const loadPanels = async (period, includeSidePanels) => {
    const requests = [
      apiClient.get('/analytics/forecasting', { params: chartRange(period) }),
      ...(includeSidePanels
        ? [apiClient.get('/analytics/product-performance'), apiClient.get('/analytics/ingredient-demand')]
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
    // Runs on a period change only; loadPanels is rebuilt every render and
    // listing it would reload the chart on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod]);

  const handleChartChange = (e) => setSelectedChart(e.target.value);
  const handlePeriodChange = (e) => setSelectedPeriod(e.target.value);
  
  const formatCurrency = (amount) => new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(amount);

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
    // Accuracy = 100% - WMAPE judged against a 7-day average (owner rule,
    // Oct 1 2026). The old 90/80/70% bands were dropped and are not used.
    accuracy: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        Accuracy = 100% − WMAPE on the test period: the days held back when
        the model was trained, so it is scored on sales it had not seen.<br /><br />
        It is compared with a simple 7-day average on the same days:<br />
        <div style={{ margin: "8px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ color: "#22c55e", fontWeight: "bold" }}>●</span>
            <span><strong>Better than a simple average</strong>: the forecast adds real value.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#f59e0b", fontWeight: "bold" }}>●</span>
            <span><strong>Not yet better</strong>: use the forecast as a planning guide.</span>
          </div>
        </div>
        This is a past score. It only changes after the model is retrained.
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
        Track your historical sales, how accurately the system predicted them, and what demand is expected in the coming days — all in one view.<br /><br />
        <div style={{ margin: "8px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ display: "inline-block", width: "20px", height: "3px", background: "#22c55e", borderRadius: "2px" }}></span>
            <span><strong>Green Line</strong> = What actually sold (past data)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ display: "inline-block", width: "20px", height: "3px", background: "#60a5fa", borderRadius: "2px" }}></span>
            <span><strong>Blue Line</strong> = What the system predicted</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-block", width: "20px", height: "3px", background: "#1e40af", borderRadius: "2px" }}></span>
            <span><strong>Purple Line</strong> = What the system predicts for the coming days</span>
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

  // Simple Calendar component
  const CalendarPopup = ({ onClose, onSelect }) => {
    const [viewDate, setViewDate] = useState(new Date());
    
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    
    const handleDateClick = (day) => {
      const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      onSelect(newDate);
      onClose();
    };

    const changeMonth = (delta) => {
      setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
    };

    return (
      <div style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: '8px',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        padding: '16px',
        zIndex: 1000,
        minWidth: '280px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>‹</button>
          <span style={{ fontWeight: 'bold' }}>
            {viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={() => changeMonth(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>›</button>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center' }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
            <div key={day} style={{ fontSize: '11px', color: '#6b7280', fontWeight: 'bold' }}>{day}</div>
          ))}
          {Array.from({ length: firstDayOfMonth }, (_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const isToday = day === new Date().getDate() && 
                           viewDate.getMonth() === new Date().getMonth() && 
                           viewDate.getFullYear() === new Date().getFullYear();
            return (
              <button
                key={day}
                onClick={() => handleDateClick(day)}
                style={{
                  padding: '6px',
                  background: isToday ? '#3b82f6' : 'transparent',
                  color: isToday ? 'white' : '#1f2937',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: isToday ? 'bold' : 'normal'
                }}
                onMouseEnter={(e) => {
                  if (!isToday) e.target.style.background = '#f3f4f6';
                }}
                onMouseLeave={(e) => {
                  if (!isToday) e.target.style.background = 'transparent';
                }}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <Navbar />
        <main className="dashboard-main">
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
            <div>Loading dashboard...</div>
          </div>
        </main>
      </div>
    );
  }

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
                 <button
              onClick={() => setShowCalendar(!showCalendar)}
              style={{
                background: 'none',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '6px 10px',
                cursor: 'pointer',
                color: '#6b7280',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '14px'
              }}
              onMouseEnter={(e) => e.target.style.background = '#f3f4f6'}
              onMouseLeave={(e) => e.target.style.background = 'none'}
            >
              <FaCalendarAlt />
              <span></span>
            </button>
            {showCalendar && (
              <CalendarPopup
                onClose={() => setShowCalendar(false)}
                onSelect={(date) => {
                  setSelectedDate(date);
                  console.log('Selected date:', date);
                }}
              />
            )}
              <span>{new Date().toLocaleTimeString()}</span>
              <span className="date-separator">{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span>
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
            {dashboardData.actualSales == null ? (
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
                {dashboardData.forecastAccuracy != null ? `${dashboardData.forecastAccuracy.toFixed(1)}%` : '—'}
              </span>
            </div>
            <p className="metric-subtext small">
              {dashboardData.forecastAccuracy != null
                ? (dashboardData.forecastAccuracyLabel || 'Latest trained model')
                : 'No trained model yet'}
            </p>
            {dashboardData.baselineAccuracy != null && (
              <p className="metric-footnote">7-day average: {dashboardData.baselineAccuracy.toFixed(1)}%</p>
            )}
          </div>

          {/* 4. Stock Alert */}
         {/* 4. Stock Alert */}
<div className="metric-card" style={{ borderTop: `4px solid ${stockColor}` }}>
  <div className="card-header">
    <h3 className="card-title">Stock Alert</h3>
    <Tippy content={tooltips.stock} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
      <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
    </Tippy>
  </div>
  
  <div className="metric-value-group">
    <span className="metric-value" style={{ color: stockColor }}>{dashboardData.stockAlert ?? '—'}</span>
  </div>
  
  {/* Dynamic Stock Alert Breakdown */}
  <div style={{
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    marginTop: '8px',
    marginBottom: '12px'
  }}>
    {dashboardData.stockBreakdown && dashboardData.stockBreakdown.map((item, index) => (
      <div key={index} style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        gap: '2px'
      }}>
        <span style={{ 
          fontSize: '24px', 
          fontWeight: 'bold', 
          color: item.color,
          lineHeight: '1'
        }}>{item.count ?? '—'}</span>
        <span style={{ fontSize: '10px', color: '#9ca3af' }}>{item.label}</span>
      </div>
    ))}
  </div>
  
  <p className="metric-subtext" style={{ marginTop: '4px' }}>
    {dashboardData.stockAlert != null ? 'Ingredients compared with the latest forecast' : 'No stock data yet'}
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
                  Track your historical sales, how accurately the system predicted them, and what demand is expected in the coming days — all in one view.
                </p>
              </div>
              <div className="chart-controls">
                <select className="chart-select" value={selectedChart} onChange={handleChartChange}>
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
                {selectedChart === 'line' ? (
                  <LineChart data={panels.chart.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" label={{ value: 'Plates', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
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
                    <YAxis stroke="#6b7280" label={{ value: 'Plates', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
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
                    <YAxis stroke="#6b7280" label={{ value: 'Plates', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
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