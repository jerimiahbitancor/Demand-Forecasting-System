// states/FullyOperational.jsx
import { useState, useEffect } from "react";
import { FaArrowUp, FaInfoCircle, FaCalendarAlt } from "react-icons/fa";
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
import Swal from 'sweetalert2';
import '../../../utils/swalTheme.css';
import axios from 'axios';
import Navbar from "../../components/Navbar/Navbar";
import "../pages/Dashboard.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const FullyOperational = () => {
  const [selectedChart, setSelectedChart] = useState("line");
  const [selectedPeriod, setSelectedPeriod] = useState("week");
  const [loading, setLoading] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dashboardData, setDashboardData] = useState({
    predictedSales: 0,
    actualSales: 0,
    forecastAccuracy: 0,
    stockAlert: 0,
    salesTrend: 0,
    accuracyTrend: 0,
    bestSellers: [],
    ingredients: [],
    chartData: []
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

  // Get dynamic comparison message
  const getComparisonMessage = (predictedSales) => {
    const today = new Date();
    const dayOfWeek = getDayOfWeek(today);
    // Random percentage between 5-20% for demo
    const percentage = Math.floor(Math.random() * 15) + 5;
    const isAbove = Math.random() > 0.5;
    return `${isAbove ? '+' : '-'}${percentage}% ${isAbove ? 'above' : 'below'} typical ${dayOfWeek}`;
  };

  const generateChartData = (period) => {
    const days = period === 'week' ? 7 : 30;
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const actual = Math.floor(Math.random() * 100) + 50;
      const forecast = Math.floor(actual * (0.85 + Math.random() * 0.3));
      const future = Math.floor(Math.random() * 80) + 40;
      data.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        actual: actual,
        forecast: forecast,
        future: future,
        day: date.toLocaleDateString('en-US', { weekday: 'short' })
      });
    }
    return data;
  };

  const getDefaultBestSellers = () => [
    { name: "Poppers Series", sold: 245, ratio: 1.8 },
    { name: "Cheesy Spicy Tocino", sold: 189, ratio: 1.4 },
    { name: "OG Tapsilog", sold: 156, ratio: 1.1 },
    { name: "Breaded Porkchop", sold: 143, ratio: 1.0 },
    { name: "Chicken Sriracha", sold: 134, ratio: 0.9 },
    { name: "Lechon Kawali", sold: 112, ratio: 0.8 },
    { name: "Sizzling Sisig", sold: 98, ratio: 0.7 },
    { name: "Herb Chicken", sold: 87, ratio: 0.6 },
  ];

  const generateIngredients = () => [
    { name: "Beef Patty", qty: "5.2 kg", status: "urgent" },
    { name: "Pork Belly", qty: "4.8 kg", status: "urgent" },
    { name: "Chicken Breast", qty: "3.5 kg", status: "low" },
    { name: "Rice", qty: "3.2 kg", status: "low" },
    { name: "Cheese", qty: "2.8 kg", status: "low" },
    { name: "Cabbage", qty: "2.1 kg", status: "ok" },
    { name: "Eggs", qty: "1.8 kg", status: "ok" },
    { name: "Tomatoes", qty: "1.2 kg", status: "ok" },
  ];

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

    const statsResponse = await apiClient.get('/upload/stats/summary');
    Swal.close();

    if (statsResponse.data.success) {
      const stats = statsResponse.data.data;
      const totalRows = stats.total_rows || 0;
      const totalUploads = stats.total_uploads || 0;
      const predictedSales = Math.round((totalRows || 100) * 1.2 * 100);
      const actualSales = Math.round((totalRows || 100) * 100);
      const forecastAccuracy = Math.min(95, 70 + (totalUploads || 0) * 0.5);
      const stockAlert = Math.min(15, 3 + (totalUploads || 0) * 0.2);
      const chartData = generateChartData(selectedPeriod);

      let bestSellers = [];
      try {
        const productsResponse = await apiClient.get('/mapping/products', { params: { limit: 10 } });
        if (productsResponse.data.success && productsResponse.data.data.length > 0) {
          bestSellers = productsResponse.data.data.map((p, i) => ({
            name: p.name || `Product ${i + 1}`,
            sold: Math.floor(Math.random() * 200) + 50,
            ratio: (0.6 + Math.random() * 0.8).toFixed(1)
          })).sort((a, b) => b.sold - a.sold).slice(0, 10);
        } else {
          bestSellers = getDefaultBestSellers();
        }
      } catch (e) {
        bestSellers = getDefaultBestSellers();
      }

      const ingredients = generateIngredients();

      // Calculate stock breakdown dynamically
      const stockBreakdown = calculateStockBreakdown(ingredients);

      setDashboardData({
        predictedSales,
        actualSales,
        forecastAccuracy: Math.round(forecastAccuracy),
        stockAlert: Math.round(stockAlert),
        salesTrend: Math.round((predictedSales - actualSales) / (actualSales || 1) * 100),
        accuracyTrend: Math.round((forecastAccuracy - 70) / 10),
        bestSellers,
        ingredients,
        chartData,
        stockBreakdown // Add this
      });
    }
  } catch (error) {
    Swal.close();
    console.error('Error fetching dashboard data:', error);
    Swal.fire({
      icon: 'error',
      title: 'Failed to load dashboard',
      text: 'Using fallback data. Please try again later.',
      confirmButtonColor: '#7A0101'
    });
    
    const ingredients = generateIngredients();
    const stockBreakdown = calculateStockBreakdown(ingredients);
    
    setDashboardData({
      predictedSales: 45000,
      actualSales: 50000,
      forecastAccuracy: 92,
      salesTrend: 12,
      accuracyTrend: 2,
      bestSellers: getDefaultBestSellers(),
      ingredients,
      chartData: generateChartData(selectedPeriod),
      stockBreakdown // Add this
    });
  } finally {
    setLoading(false);
  }
};

const calculateStockBreakdown = (ingredients) => {
  const urgentCount = ingredients.filter(item => item.status === 'urgent').length;
  const lowCount = ingredients.filter(item => item.status === 'low').length;
  const okCount = ingredients.filter(item => item.status === 'ok').length;
  
  const criticalCount = urgentCount > 3 ? Math.floor(urgentCount * 0.6) : urgentCount;
  const highCount = urgentCount - criticalCount;
  
  return [
    { 
      count: criticalCount || 2, 
      label: 'Critical', 
      color: '#ef4444' 
    },
    { 
      count: highCount + lowCount || 3, 
      label: 'High', 
      color: '#eab308' 
    },
    { 
      count: okCount * 2 + 48 || 48, 
      label: 'Medium', 
      color: '#22c55e' 
    },
    { 
      count: Math.floor(okCount / 2) || 3, 
      label: 'Low', 
      color: '#3b82f6' 
    }
  ];
};
  useEffect(() => {
    fetchDashboardData();
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
            <p key={index} style={{ color: entry.color }}>{entry.name}: {entry.value}</p>
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

  const getStatusClass = (status) => {
    switch(status) {
      case 'urgent': return 'urgent';
      case 'low': return 'warning';
      case 'ok': return 'ok';
      default: return 'ok';
    }
  };

  const getStatusText = (status) => {
    switch(status) {
      case 'urgent': return 'Urgent';
      case 'low': return 'Low';
      case 'ok': return 'OK';
      default: return 'OK';
    }
  };

  // Get color based on stock alert number
  const getStockAlertColor = (value) => {
    if (value >= 40) return '#ef4444'; // Red
    if (value >= 30) return '#eab308'; // Yellow
    if (value >= 20) return '#22c55e'; // Green
    return '#3b82f6'; // Blue
  };

  // Tooltips
  const tooltips = {
    sales: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This is your estimated total sales for tomorrow.<br /><br />
        It also tells you if tomorrow is expected to be busier or slower than a typical day.<br /><br />
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
    accuracy: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This tells you how reliable today's quantity forecasts are.<br /><br />
        <div style={{ margin: "8px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ color: "#22c55e", fontWeight: "bold" }}>●</span>
            <span><strong>Above 90%</strong> → Excellent. You can rely on these numbers.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ color: "#60a5fa", fontWeight: "bold" }}>●</span>
            <span><strong>80-90%</strong> → Good. Still useful for planning.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ color: "#fbbf24", fontWeight: "bold" }}>●</span>
            <span><strong>70-80%</strong> → Fair. Use with caution.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#ef4444", fontWeight: "bold" }}>●</span>
            <span><strong>Below 70%</strong> → Low. Consider uploading more data.</span>
          </div>
        </div>
        <br />
        <span style={{ color: "#60a5fa", cursor: "pointer", display: "block", textAlign: "center", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          Click to view detailed accuracy report →
        </span>
      </div>
    ),
    stock: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        These are the top ingredients you should prepare or buy for tomorrow.<br /><br />
        This is based on your predicted menu sales and your recipe portions.<br /><br />
        <strong style={{ color: "#fbbf24" }}>Pro Tip:</strong><br />
        Double-check your actual fridge/freezer stock before buying.<br /><br />
        <span style={{ color: "#60a5fa", cursor: "pointer", display: "block", textAlign: "center", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          Click to view full ingredient demand breakdown →
        </span>
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

  const comparisonMessage = getComparisonMessage(dashboardData.predictedSales);
  const stockColor = getStockAlertColor(dashboardData.stockAlert);

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

        {/* Key Metrics Row */}
        <div className="metrics-grid">
          {/* 1. Predicted Sales Tomorrow */}
          <div className="metric-card border-red">
            <div className="card-header">
              <h3 className="card-title">Predicted Sales Tomorrow</h3>
              <Tippy content={tooltips.sales} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
              </Tippy>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">{formatCurrency(dashboardData.predictedSales)}</span>
              <div className="badge-success">
                <FaArrowUp className="badge-icon" />
                +{Math.abs(dashboardData.salesTrend)}%
              </div>
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
              <span className="metric-value">{formatCurrency(dashboardData.actualSales)}</span>
            </div>
            <p className="metric-subtext">{Math.round((dashboardData.actualSales / (dashboardData.predictedSales || 1)) * 100)}% of predicted target</p>
          </div>

          {/* 3. Forecast Accuracy */}
          <div className="metric-card border-green">
            <div className="card-header">
              <h3 className="card-title">Forecast Accuracy</h3>
              <Tippy content={tooltips.accuracy} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
              </Tippy>
            </div>
            <div className="metric-value-group">
              <span className="metric-value text-green">{dashboardData.forecastAccuracy}%</span>
              <div className="badge-success">
                <FaArrowUp className="badge-icon" />
                +{Math.abs(dashboardData.accuracyTrend)}%
              </div>
            </div>
            <p className="metric-subtext small">Based on recent uploads</p>
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
    <span className="metric-value" style={{ color: stockColor }}>{dashboardData.stockAlert}</span>
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
        }}>{item.count}</span>
        <span style={{ fontSize: '10px', color: '#9ca3af' }}>{item.label}</span>
      </div>
    ))}
  </div>
  
  <p className="metric-subtext" style={{ marginTop: '4px' }}>
    Based on {dashboardData.ingredients.length} of 12 products
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
              <ResponsiveContainer width="100%" height={350}>
                {selectedChart === 'line' ? (
                  <LineChart data={dashboardData.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="actual" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Actual Sales" />
                    <Line type="monotone" dataKey="forecast" stroke="#60a5fa" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Forecasted Sales" />
                    <Line type="monotone" dataKey="future" stroke="#1e40af" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4 }} activeDot={{ r: 6 }} name="Future Forecast" />
                  </LineChart>
                ) : selectedChart === 'bar' ? (
                  <BarChart data={dashboardData.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="actual" fill="#22c55e" name="Actual Sales" />
                    <Bar dataKey="forecast" fill="#60a5fa" name="Forecasted Sales" />
                    <Bar dataKey="future" fill="#1e40af" name="Future Forecast" />
                  </BarChart>
                ) : (
                  <ComposedChart data={dashboardData.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="actual" fill="#22c55e" name="Actual Sales" />
                    <Line type="monotone" dataKey="forecast" stroke="#60a5fa" strokeWidth={2} name="Forecasted Sales" />
                    <Line type="monotone" dataKey="future" stroke="#1e40af" strokeWidth={2} strokeDasharray="5 5" name="Future Forecast" />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="right-panel">
            {/* Top Best Sellers */}
            <div className="placeholder-card">
              <div className="placeholder-header">
                <h3 className="placeholder-title">Top Best Sellers</h3>
                <Tippy content={tooltips.bestSellers} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                  <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
                </Tippy>
              </div>
              <div className="scrollable-content">
                {dashboardData.bestSellers.map((item, index) => (
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
            <div className="placeholder-card">
              <div className="placeholder-header">
                <h3 className="placeholder-title">Top Ingredients to Prepare</h3>
                <Tippy content={tooltips.ingredients} placement="top" animation="scale" duration={200} theme="dark" arrow={true} delay={[100, 0]} maxWidth={380} interactive={true} trigger="mouseenter focus click">
                  <span className="icon-wrapper"><FaInfoCircle className="card-info" /></span>
                </Tippy>
              </div>
              <div className="scrollable-content">
                {dashboardData.ingredients.map((item, index) => (
                  <div key={index} className="ingredient-item">
                    <span className="ingredient-name">{item.name}</span>
                    <div className="ingredient-stats">
                      <span className="ingredient-qty">{item.qty}</span>
                      <span className={`ingredient-status ${getStatusClass(item.status)}`}>
                        {getStatusText(item.status)}
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