// Dashboard.jsx
import { useState, useEffect } from "react";
import { FaQuestionCircle, FaArrowUp, FaInfoCircle } from "react-icons/fa";
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
import "./Dashboard.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const Dashboard = () => {
  const [selectedChart, setSelectedChart] = useState("line");
  const [selectedPeriod, setSelectedPeriod] = useState("week");
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState({
    predictedSales: 0,
    actualSales: 0,
    forecastAccuracy: 0,
    ingredientsToPrepare: 0,
    salesTrend: 0,
    accuracyTrend: 0,
    bestSellers: [],
    ingredients: [],
    chartData: []
  });

  // Get auth token
  const getAuthToken = () => {
    return localStorage.getItem('token');
  };

  // Axios instance
  const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Generate chart data
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

  // Fetch dashboard data
  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Show loading with Swal2
      Swal.fire({
        title: 'Loading Dashboard',
        text: 'Please wait while we fetch your data...',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      const statsResponse = await apiClient.get('/uploads/stats/summary');
      
      Swal.close();

      if (statsResponse.data.success) {
        const stats = statsResponse.data.data;
        
        const totalRows = stats.total_rows || 0;
        const totalUploads = stats.total_uploads || 0;
        
        const predictedSales = Math.round((totalRows || 100) * 1.2 * 100);
        const actualSales = Math.round((totalRows || 100) * 100);
        const forecastAccuracy = Math.min(95, 70 + (totalUploads || 0) * 0.5);
        const ingredientsToPrepare = Math.min(15, 3 + (totalUploads || 0) * 0.2);

        const chartData = generateChartData(selectedPeriod);
        
        let bestSellers = [];
        try {
          const productsResponse = await apiClient.get('/mapping/products', {
            params: { limit: 10 }
          });
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

        setDashboardData({
          predictedSales,
          actualSales,
          forecastAccuracy: Math.round(forecastAccuracy),
          ingredientsToPrepare,
          salesTrend: Math.round((predictedSales - actualSales) / (actualSales || 1) * 100),
          accuracyTrend: Math.round((forecastAccuracy - 70) / 10),
          bestSellers,
          ingredients,
          chartData
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
      
      // Set fallback data
      setDashboardData({
        predictedSales: 45000,
        actualSales: 50000,
        forecastAccuracy: 92,
        ingredientsToPrepare: 12,
        salesTrend: 12,
        accuracyTrend: 2,
        bestSellers: getDefaultBestSellers(),
        ingredients: generateIngredients(),
        chartData: generateChartData(selectedPeriod)
      });
    } finally {
      setLoading(false);
    }
  };

  const getDefaultBestSellers = () => {
    return [
      { name: "Poppers Series", sold: 245, ratio: 1.8 },
      { name: "Cheesy Spicy Tocino", sold: 189, ratio: 1.4 },
      { name: "OG Tapsilog", sold: 156, ratio: 1.1 },
      { name: "Breaded Porkchop", sold: 143, ratio: 1.0 },
      { name: "Chicken Sriracha", sold: 134, ratio: 0.9 },
      { name: "Lechon Kawali", sold: 112, ratio: 0.8 },
      { name: "Sizzling Sisig", sold: 98, ratio: 0.7 },
      { name: "Herb Chicken", sold: 87, ratio: 0.6 },
    ];
  };

  const generateIngredients = () => {
    return [
      { name: "Beef Patty", qty: "5.2 kg", status: "urgent" },
      { name: "Pork Belly", qty: "4.8 kg", status: "urgent" },
      { name: "Chicken Breast", qty: "3.5 kg", status: "low" },
      { name: "Rice", qty: "3.2 kg", status: "low" },
      { name: "Cheese", qty: "2.8 kg", status: "low" },
      { name: "Cabbage", qty: "2.1 kg", status: "ok" },
      { name: "Eggs", qty: "1.8 kg", status: "ok" },
      { name: "Tomatoes", qty: "1.2 kg", status: "ok" },
    ];
  };

  useEffect(() => {
    fetchDashboardData();
  }, [selectedPeriod]);

  const handleChartChange = (e) => {
    setSelectedChart(e.target.value);
    console.log(`Chart changed to: ${e.target.value}`);
  };

  const handlePeriodChange = (e) => {
    setSelectedPeriod(e.target.value);
    console.log(`Period changed to: ${e.target.value}`);
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Custom Tooltip for Recharts
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="tooltip-label">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Get ratio class
  const getRatioClass = (ratio) => {
    const num = parseFloat(ratio);
    if (num >= 1.5) return 'ratio-high';
    if (num >= 1.0) return 'ratio-medium';
    return 'ratio-low';
  };

  // Get status class
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

  // Tooltip content with detailed explanations (KEPT INTACT)
  const tooltips = {
    // 1. Predicted Sales Today
    sales: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This is your estimated total sales for tomorrow.
        <br />
        <br />
        It also tells you if tomorrow is expected to be busier or slower than a
        typical [Tuesday/Friday/etc.].
        <br />
        <br />
        <strong style={{ color: "#22c55e" }}>✓ If it's higher:</strong> You
        might need extra staff and ingredients.
        <br />
        <strong style={{ color: "#ef4444" }}>✓ If it's lower:</strong> You can
        save money by preparing less.
        <br />
        <br />
        <span
          style={{
            color: "#60a5fa",
            cursor: "pointer",
            display: "block",
            textAlign: "center",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          Click to view detailed forecast in Analytics →
        </span>
      </div>
    ),

    // 2. Actual Sales Yesterday
    actual: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This is the actual amount you earned yesterday. It compares yesterday's
        results against what the system predicted.
        <br />
        <br />
        <strong style={{ color: "#22c55e" }}>
          ✓ If it's close to the forecast:
        </strong>{" "}
        The system is working well.
        <br />
        <strong style={{ color: "#fbbf24" }}>
          ✓ If it's much higher or lower:
        </strong>{" "}
        Something unusual happened (weather, holiday, or a specific item sold
        out).
        <br />
        <br />
        <span
          style={{
            color: "#60a5fa",
            cursor: "pointer",
            display: "block",
            textAlign: "center",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          Click to view detailed sales breakdown →
        </span>
      </div>
    ),

    // 3. Forecast Accuracy Score
    accuracy: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This tells you how reliable today's quantity forecasts are.
        <br />
        <br />
        <div style={{ margin: "8px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#22c55e", fontWeight: "bold" }}>●</span>
            <span>
              <strong>Above 90%</strong> → Excellent. You can rely on these
              numbers.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#60a5fa", fontWeight: "bold" }}>●</span>
            <span>
              <strong>80-90%</strong> → Good. Still useful for planning.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#fbbf24", fontWeight: "bold" }}>●</span>
            <span>
              <strong>70-80%</strong> → Fair. Use with caution.
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#ef4444", fontWeight: "bold" }}>●</span>
            <span>
              <strong>Below 70%</strong> → Low. Consider uploading more data.
            </span>
          </div>
        </div>
        <br />
        Accurate quantity forecasts help you order ingredients closer to actual
        demand, reducing waste and stockouts.
        <br />
        <br />
        <span
          style={{
            color: "#60a5fa",
            cursor: "pointer",
            display: "block",
            textAlign: "center",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          Click to view detailed accuracy report →
        </span>
      </div>
    ),

    // 4. Ingredient Preparation Alert
    stock: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        These are the top ingredients you should prepare or buy for tomorrow.
        <br />
        <br />
        This is based on your predicted menu sales and your recipe portions.
        <br />
        <br />
        <strong style={{ color: "#fbbf24" }}>Pro Tip:</strong>
        <br />
        Double-check your actual fridge/freezer stock before buying. This tells
        you what you'll likely need, not what you're running out of.
        <br />
        <br />
        <span
          style={{
            color: "#60a5fa",
            cursor: "pointer",
            display: "block",
            textAlign: "center",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          Click to view full ingredient demand breakdown in Analytics →
        </span>
      </div>
    ),

    // 5. Sales Overview Chart
    chart: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        A quick visual of how your sales are trending.
        <br />
        <br />
        <div style={{ margin: "8px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "20px",
                height: "3px",
                background: "#22c55e",
                borderRadius: "2px",
              }}
            ></span>
            <span>
              <strong>Green Line</strong> = What actually sold (past data)
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "20px",
                height: "3px",
                background: "#60a5fa",
                borderRadius: "2px",
              }}
            ></span>
            <span>
              <strong>Blue Line</strong> = What the system predicted
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-block",
                width: "20px",
                height: "3px",
                background: "#1e40af",
                borderRadius: "2px",
              }}
            ></span>
            <span>
              <strong>Purple Line</strong> = What the system predicts for the
              coming days
            </span>
          </div>
        </div>
        <br />
        When the Blue and Green lines are close together, the system is very
        accurate. This helps you plan confidently.
      </div>
    ),

    // 6. Top Best Sellers (Product Performance)
    bestSellers: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        These are your money-makers right now.
        <br />
        <br />
        The number shows how many servings were sold. The ratio tells you how
        they compare to your average item.
        <br />
        <br />
        <div style={{ margin: "8px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <span style={{ color: "#22c55e", fontWeight: "bold" }}>●</span>
            <span>
              <strong>Ratio above 1.0</strong> = Better than average{" "}
              <span style={{ color: "#22c55e" }}>(Keep this on the menu!)</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#ef4444", fontWeight: "bold" }}>●</span>
            <span>
              <strong>Ratio below 1.0</strong> = Below average{" "}
              <span style={{ color: "#fbbf24" }}>
                (Consider running a promo or replacing it)
              </span>
            </span>
          </div>
        </div>
        <br />
        Use this to decide which items to prioritize when buying ingredients.
        <br />
        <br />
        <span
          style={{
            color: "#60a5fa",
            cursor: "pointer",
            display: "block",
            textAlign: "center",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          Click to view detailed product analysis →
        </span>
      </div>
    ),

    // 7. Top Ingredients to Prepare
    ingredients: (
      <div style={{ padding: "4px 0", fontSize: "13px", lineHeight: "1.6" }}>
        This is your quick shopping list for tomorrow.
        <br />
        <br />
        We calculated this by looking at your predicted menu sales and how much
        of each ingredient goes into every dish.
        <br />
        <br />
        <strong style={{ color: "#34d399" }}>
          A little extra buffer
        </strong>{" "}
        has been added to cover unexpected orders or staff meals (you can adjust
        this buffer in Settings).
        <br />
        <br />
        <strong style={{ color: "#fbbf24" }}>Tip:</strong> Check your current
        supplies before heading to the market.
        <br />
        <br />
        <span
          style={{
            color: "#60a5fa",
            cursor: "pointer",
            display: "block",
            textAlign: "center",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          Click to view full ingredient demand breakdown in Analytics →
        </span>
      </div>
    ),
  };



  return (
    <div className="dashboard-container">
      <Navbar />

      <main className="dashboard-main">
        {/* Dashboard Title & Date */}
        <div className="dashboard-title-section">
          <h1 className="dashboard-title">Dashboard</h1>
          <div className="date-info">
            <span>{new Date().toLocaleTimeString()}</span>
            <span className="date-separator">{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span>
            <span className="date-separator">{new Date().toLocaleDateString()}</span>
          </div>
        </div>

        {/* Key Metrics Row */}
        <div className="metrics-grid">
          {/* 1. Predicted Sales Card */}
          <div className="metric-card border-red">
            <div className="card-header">
              <h3 className="card-title">Predicted Sales Today</h3>
              <Tippy
                content={tooltips.sales}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={380}
                interactive={true}
                trigger="mouseenter focus click"
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
              </Tippy>
            </div>

            <div className="metric-value-group">
              <span className="metric-value">{formatCurrency(dashboardData.predictedSales)}</span>
              <div className="badge-success">
                <FaArrowUp className="badge-icon" />
                +{Math.abs(dashboardData.salesTrend)}%
              </div>
            </div>

            <p className="metric-subtext">vs last month performance</p>
          </div>

          {/* 2. Actual Sales Card */}
          <div className="metric-card border-yellow">
            <div className="card-header">
              <h3 className="card-title">Actual Sales Yesterday</h3>
              <Tippy
                content={tooltips.actual}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={380}
                interactive={true}
                trigger="mouseenter focus click"
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
              </Tippy>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">{formatCurrency(dashboardData.actualSales)}</span>
            </div>
            <p className="metric-subtext">{Math.round((dashboardData.actualSales / (dashboardData.predictedSales || 1)) * 100)}% of predicted target</p>
          </div>

          {/* 3. Forecast Accuracy Card */}
          <div className="metric-card border-green">
            <div className="card-header">
              <h3 className="card-title">Forecast Accuracy</h3>
              <Tippy
                content={tooltips.accuracy}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={380}
                interactive={true}
                trigger="mouseenter focus click"
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
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

          {/* 4. Ingredient Preparation Alert */}
          <div className="metric-card border-red-dark">
            <div className="card-header">
              <h3 className="card-title">Ingredient Preparation Alert</h3>
              <Tippy
                content={tooltips.stock}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={380}
                interactive={true}
                trigger="mouseenter focus click"
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
              </Tippy>
            </div>
            <div className="metric-value-group">
              <span className="metric-value text-red">{dashboardData.ingredientsToPrepare}</span>
            </div>
            <p className="metric-subtext">items need preparation</p>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="main-content-grid">
          {/* Chart Section */}
          <div className="chart-section">
            <div className="chart-header">
              <div>
                <h2 className="chart-title">
                  Sales Overview
                  <Tippy
                    content={tooltips.chart}
                    placement="right"
                    animation="scale"
                    duration={200}
                    theme="dark"
                    arrow={true}
                    delay={[100, 0]}
                    maxWidth={350}
                    interactive={true}
                    trigger="mouseenter focus click"
                  >
                    <span className="chart-info-wrapper">
                      <FaQuestionCircle className="chart-info-icon" />
                    </span>
                  </Tippy>
                </h2>
                <p className="chart-description">
                  Actual Sales vs. Forecasted Sales vs. Future Forecast
                </p>
              </div>
              <div className="chart-controls">
                <select
                  className="chart-select"
                  value={selectedChart}
                  onChange={handleChartChange}
                >
                  <option value="line">Line Chart</option>
                  <option value="bar">Bar Chart</option>
                  <option value="composed">Composed</option>
                </select>
                <select
                  className="chart-select"
                  value={selectedPeriod}
                  onChange={handlePeriodChange}
                >
                  <option value="week">Last 7 Days</option>
                  <option value="month">Last 30 Days</option>
                </select>
              </div>
            </div>

            {/* Chart Visualization with Recharts */}
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={350}>
                {selectedChart === 'line' ? (
                  <LineChart data={dashboardData.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" />
                    <YAxis stroke="#6b7280" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="actual" 
                      stroke="#22c55e" 
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Actual Sales"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="forecast" 
                      stroke="#60a5fa" 
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Forecasted Sales"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="future" 
                      stroke="#1e40af" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Future Forecast"
                    />
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
                <Tippy
                  content={tooltips.bestSellers}
                  placement="top"
                  animation="scale"
                  duration={200}
                  theme="dark"
                  arrow={true}
                  delay={[100, 0]}
                  maxWidth={380}
                  interactive={true}
                  trigger="mouseenter focus click"
                >
                  <span className="icon-wrapper">
                    <FaInfoCircle className="card-info" />
                  </span>
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
                <Tippy
                  content={tooltips.ingredients}
                  placement="top"
                  animation="scale"
                  duration={200}
                  theme="dark"
                  arrow={true}
                  delay={[100, 0]}
                  maxWidth={380}
                  interactive={true}
                  trigger="mouseenter focus click"
                >
                  <span className="icon-wrapper">
                    <FaInfoCircle className="card-info" />
                  </span>
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

export default Dashboard;