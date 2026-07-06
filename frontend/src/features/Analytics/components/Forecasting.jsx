// components/Forecasting.jsx
import { useState } from "react";
import { FiChevronDown, FiSearch, FiCalendar, FiInfo, FiZap } from "react-icons/fi";
import DatePicker from "./shared/DatePicker.jsx";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import InfoBanner from "./shared/InfoBanner.jsx";
import "./shared/InfoBanner.css";
import "./Forecasting.css";

// ---------------------------------------------------------------------
// Mock data — replace with real API responses
// ---------------------------------------------------------------------
const accuracyHistory = [
  78, 76, 80, 79, 83, 81, 85, 84, 88, 86, 89, 91, 90, 92.6,
];

const salesPrediction = {
  weekLabel: "Week: June 20–26, 2026",
  points: [
    { label: "Mon", actual: 650, forecast: 700 },
    { label: "Tue", actual: 1750, forecast: 1400 },
    { label: "Wed", actual: 2100, forecast: 2000 },
    { label: "Thu", actual: 2800, forecast: 2600 },
    { label: "Fri", actual: 3900, forecast: 3300 },
    { label: "Sat", actual: 4600, forecast: 3700 },
    { label: "Sun", actual: 5300, forecast: 3900, future: true },
  ],
  rows: [
    { date: "June 23, 2026", product: "Poppers & Rice", actualQty: 48, forecastQty: 45, actualRevenue: "₱2,400", forecastRevenue: "₱2,250" },
    { date: "June 23, 2026", product: "Breaded Tonkatsu", actualQty: 32, forecastQty: 35, actualRevenue: "₱1,920", forecastRevenue: "₱2,100" },
    { date: "June 23, 2026", product: "Chick & Fries", actualQty: 27, forecastQty: 28, actualRevenue: "₱1,350", forecastRevenue: "₱1,400" },
    { date: "June 24, 2026", product: "Cheesy Tapa", actualQty: 22, forecastQty: 23, actualRevenue: "₱2,550", forecastRevenue: "₱2,800" },
    { date: "June 24, 2026", product: "Poppers & Rice", actualQty: 52, forecastQty: 52, actualRevenue: "₱3,120", forecastRevenue: "₱3,000" },
  ],
};

const demandPrediction = {
  weekLabel: "Week: June 20–26, 2026",
  points: [
    { label: "Mon", actual: 18, forecast: 20 },
    { label: "Tue", actual: 22, forecast: 21 },
    { label: "Wed", actual: 25, forecast: 24 },
    { label: "Thu", actual: 30, forecast: 28 },
    { label: "Fri", actual: 36, forecast: 34 },
    { label: "Sat", actual: 40, forecast: 38 },
    { label: "Sun", actual: 44, forecast: 45, future: true },
  ],
  rows: [
    { date: "June 23, 2026", product: "Poppers & Rice", actualQty: 48, forecastQty: 45, unit: "servings" },
    { date: "June 23, 2026", product: "Breaded Tonkatsu", actualQty: 32, forecastQty: 35, unit: "servings" },
    { date: "June 23, 2026", product: "Chick & Fries", actualQty: 27, forecastQty: 28, unit: "servings" },
    { date: "June 24, 2026", product: "Cheesy Tapa", actualQty: 22, forecastQty: 23, unit: "servings" },
  ],
  rows: [],
};

const featureImportance = [
  { label: "Is payday", value: 92 },
  { label: "Holiday", value: 84 },
  { label: "Day of Week", value: 76 },
  { label: "Sales Lag (7 days)", value: 68 },
  { label: "Sales Lag (1 day)", value: 45 },
];

const trainingInfo = {
  modelStatus: "Trained",
  lastTrained: "June 24, 2026 • 6:00 AM",
  trainingRecords: "1,248 rows (≈5 months)",
  activeProducts: "14 menu items",
};

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
      Forecasts update automatically whenever you upload new sales data — there's no need to manually refresh.
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
  const latestAccuracy = accuracyHistory[accuracyHistory.length - 1];
  const errorRate = (100 - latestAccuracy).toFixed(1);
  const [mode, setMode] = useState("Sales");
  const [selectedRange, setSelectedRange] = useState([new Date(), new Date()]);

  const chartPoints = mode === "Sales" ? salesPrediction.points : demandPrediction.points;

  return (
    <>
      <div className="analytics-col-main">
        {/* Forecast Accuracy */}
        <section className="analytics-card">
          <h2 className="analytics-card-title">
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

          <div className="metric-pair">
            <div className="metric-box">
              <p className="metric-label">Forecast Accuracy</p>
              <p className="metric-value metric-value--success">{latestAccuracy}%</p>
              <p className="metric-caption metric-caption--success">
                Excellent — reliable for planning
              </p>
            </div>
            <div className="metric-box">
              <p className="metric-label">Forecast error rate</p>
              <p className="metric-value metric-value--success">{errorRate}%</p>
              <p className="metric-caption metric-caption--success">
                Excellent — below 10% threshold
              </p>
            </div>
          </div>

          <InfoBanner variant="info">
            <strong>What is this metric?</strong> This percentage tells you how close your
            forecasts are to real-world results on average. Your current error score of 7.4% means your
            predictions are typically accurate to within {latestAccuracy}% of the actual
            totals, whether the guess was slightly too high or too low.
          </InfoBanner>

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
            </div>
          </div>
        </section>

        {/* Sales and Demand Prediction */}
        <section className="analytics-card">
          <h2 className="analytics-card-title">
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
                salesPrediction.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{row.date}</td>
                    <td>{row.product}</td>
                    <td>{row.actualQty}</td>
                    <td>{row.forecastQty}</td>
                    <td>{row.actualRevenue}</td>
                    <td>{row.forecastRevenue}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>

      <div className="analytics-col-side">
        <button type="button" className="btn-generate-report">
          Generate Report
        </button>

        <section className="analytics-card">
          <h2 className="analytics-card-title">
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

          <InfoBanner variant="info">
            Forecasts are automatically updated each time you upload new sales data. No
            manual reforecast needed.
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
              {featureImportance.map((f) => (
                <li key={f.label} className="feature-row">
                  <span>{f.label}</span>
                  <span className="feature-value">{f.value}%</span>
                </li>
              ))}
            </ul>
          </div>

          <InfoBanner variant="tip" icon={<FiZap size={14} />}>
            Day of Week has the strongest influence on sales. Paydays (15th and 30th) also
            significantly boost demand.
          </InfoBanner>

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
            </dl>
          </div>
        </section>
      </div>
    </>
  );
}

export default Forecasting;