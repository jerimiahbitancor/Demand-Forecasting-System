import { useState } from 'react';
import { FaQuestionCircle, FaInfoCircle } from 'react-icons/fa';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import Navbar from '../components/Navbar/Navbar';
import '../dashboard/pages/Dashboard.css';
import './Forecasting.css';

const Forecasting = () => {
  const [chartType, setChartType] = useState('line');
  const [period, setPeriod] = useState('daily');
  const [product, setProduct] = useState('all');

  // Tooltips
  const tooltips = {
    salesPrediction: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#60a5fa', display: 'block', marginBottom: '6px' }}>
        Daily & Weekly Forecast
        </strong>
        View sales predictions for each product on a daily and weekly basis.
        <br/><br/>
        This helps you:
        <br/>
        • Plan inventory levels
        <br/>
        • Schedule staff accordingly
        <br/>
        • Identify demand patterns
        <br/><br/>
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
          Toggle between Daily, Weekly, and Monthly views
        </span>
      </div>
    ),
    forecastAccuracy: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#34d399', display: 'block', marginBottom: '6px' }}>
          Model Performance Metrics
        </strong>
        <div style={{ margin: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span><strong>MAPE</strong> (Mean Absolute Percentage Error)</span>
            <span style={{ color: '#60a5fa' }}>8.2%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span><strong>MAE</strong> (Mean Absolute Error)</span>
            <span style={{ color: '#60a5fa' }}>₱1,245</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span><strong>RMSE</strong> (Root Mean Square Error)</span>
            <span style={{ color: '#60a5fa' }}>₱1,890</span>
          </div>
        </div>
        <br/>
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
          Lower values indicate better prediction accuracy
        </span>
      </div>
    ),
    modelInsights: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#fbbf24', display: 'block', marginBottom: '6px' }}>
          Feature Importance & Training Info
        </strong>
        <div style={{ margin: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Historical Sales Data</span>
            <span style={{ color: '#22c55e' }}>45%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Day of Week</span>
            <span style={{ color: '#22c55e' }}>25%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Seasonal Trends</span>
            <span style={{ color: '#22c55e' }}>18%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Weather Data</span>
            <span style={{ color: '#22c55e' }}>12%</span>
          </div>
        </div>
        <br/>
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
          Model trained on 90 days of data • Last updated: Today
        </span>
      </div>
    ),
    exportReport: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#60a5fa', display: 'block', marginBottom: '6px' }}>
          Export Forecast Report
        </strong>
        Download your forecast data in PDF or Excel format.
        <br/><br/>
        <strong>PDF:</strong> For presentations and reports
        <br/>
        <strong>Excel:</strong> For data analysis and manipulation
        <br/><br/>
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
          Includes all product forecasts and accuracy metrics
        </span>
      </div>
    ),
    forecastedItems: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#60a5fa', display: 'block', marginBottom: '6px' }}>
          Products Forecasted
        </strong>
        Total number of products currently being forecasted by the system.
        <br/><br/>
        Each product is analyzed daily to predict:
        <br/>
        • Expected sales volume
        <br/>
        • Peak demand periods
        <br/>
        • Trend direction
      </div>
    ),
    avgAccuracy: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#34d399', display: 'block', marginBottom: '6px' }}>
          🎯 Prediction Accuracy
        </strong>
        Average accuracy across all forecasted products.
        <br/><br/>
        <strong>92.4%</strong> means the system's predictions are very reliable.
        <br/><br/>
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
          Based on comparison of predicted vs actual sales
        </span>
      </div>
    ),
    highestForecast: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#fbbf24', display: 'block', marginBottom: '6px' }}>
          📈 Highest Forecast
        </strong>
        The product with the highest predicted sales volume.
        <br/><br/>
        <strong>Sisig</strong> is currently the top forecasted item based on:
        <br/>
        • Historical sales data
        <br/>
        • Current demand trends
        <br/>
        • Seasonal patterns
      </div>
    ),
    growthRate: (
      <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
        <strong style={{ color: '#22c55e', display: 'block', marginBottom: '6px' }}>
          📊 Growth Rate
        </strong>
        Expected increase in overall sales volume.
        <br/><br/>
        <strong>+12.5%</strong> projected growth indicates:
        <br/>
        • Increasing customer demand
        <br/>
        • Positive business trends
        <br/>
        • Opportunity for expansion
        <br/><br/>
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>
          Based on 30-day forecast projection
        </span>
      </div>
    )
  };

  return (
    <div className="dashboard-container">
      <Navbar />

      <main className="dashboard-main">
        <div className="dashboard-title-section">
          <div className="dashboard-title-row">
            <h1 className="dashboard-title">Analytics</h1>
            <div className="breadcrumb">
              <span className="breadcrumb-link active">Forecasting</span>
            </div>
          </div>
        </div>

        <div className="metrics-grid">
          <div className="metric-card border-red">
            <div className="card-header">
              <h3 className="card-title">Forecasted Items</h3>
              <Tippy
                content={tooltips.forecastedItems}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={320}
                interactive={true}
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
              </Tippy>
            </div>
            <div className="metric-value">42 items</div>
            <p className="metric-subtext">Products forecasted</p>
          </div>

          <div className="metric-card border-yellow">
            <div className="card-header">
              <h3 className="card-title">Average Accuracy</h3>
              <Tippy
                content={tooltips.avgAccuracy}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={320}
                interactive={true}
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
              </Tippy>
            </div>
            <div className="metric-value">92.4%</div>
            <p className="metric-subtext">Prediction accuracy</p>
          </div>

          <div className="metric-card border-green">
            <div className="card-header">
              <h3 className="card-title">Highest Forecast</h3>
              <Tippy
                content={tooltips.highestForecast}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={320}
                interactive={true}
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
              </Tippy>
            </div>
            <div className="metric-value">Sisig</div>
            <p className="metric-subtext">Top forecast</p>
          </div>

          <div className="metric-card border-red-dark">
            <div className="card-header">
              <h3 className="card-title">Growth Rate</h3>
              <Tippy
                content={tooltips.growthRate}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                delay={[100, 0]}
                maxWidth={320}
                interactive={true}
              >
                <span className="icon-wrapper">
                  <FaInfoCircle className="card-info" />
                </span>
              </Tippy>
            </div>
            <div className="metric-value text-green">+12.5%</div>
            <p className="metric-subtext">Expected increase</p>
          </div>
        </div>

        <div className="main-content-grid1">
          <div className="chart-section">
            <div className="chart-header">
              <div>
                <h2 className="chart-title">
                  Sales Prediction Chart
                  <Tippy
                    content={tooltips.salesPrediction}
                    placement="right"
                    animation="scale"
                    duration={200}
                    theme="dark"
                    arrow={true}
                    delay={[100, 0]}
                    maxWidth={350}
                    interactive={true}
                  >
                    <span className="chart-info-wrapper">
                      <FaQuestionCircle className="chart-info-icon" />
                    </span>
                  </Tippy>
                </h2>
                <p className="chart-description">Actual Sales vs Forecast vs Future Forecast</p>
              </div>

              <div className="chart-controls">
                <select className="chart-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>

                <select className="chart-select" value={chartType} onChange={(e) => setChartType(e.target.value)}>
                  <option value="line">Line Chart</option>
                  <option value="bar">Bar Chart</option>
                </select>

                <select className="chart-select" value={product} onChange={(e) => setProduct(e.target.value)}>
                  <option value="all">All Products</option>
                  <option value="sisig">Sisig</option>
                  <option value="adobo">Adobo</option>
                  <option value="tonkatsu">Tonkatsu</option>
                  <option value="chicken">Chicken Sriracha</option>
                  <option value="tocino">Cheesy Spicy Tocino</option>
                </select>
              </div>
            </div>

            <div className="chart-container">
              <div className="chart-legend">
                <div className="legend-item">
                  <span className="legend-line green"></span>
                  Actual Sales
                </div>
                <div className="legend-item">
                  <span className="legend-line blue"></span>
                  Forecasted Sales
                </div>
                <div className="legend-item">
                  <span className="legend-line dark-blue"></span>
                  Future Forecast
                </div>
              </div>

              <div className="chart-wrapper">
                <svg className="chart-svg" preserveAspectRatio="none" viewBox="0 0 1000 300">
                  <g stroke="#f0f0f0" strokeWidth="1">
                    <line x1="50" x2="50" y1="0" y2="280" />
                    <line x1="50" x2="950" y1="280" y2="280" />
                    <line x1="50" x2="950" y1="230" y2="230" />
                    <line x1="50" x2="950" y1="180" y2="180" />
                    <line x1="50" x2="950" y1="130" y2="130" />
                    <line x1="50" x2="950" y1="80" y2="80" />
                    <line x1="50" x2="950" y1="30" y2="30" />
                  </g>

                  <path d="M50 240 L200 200 L350 170 L500 130 L650 90 L800 60 L950 40" fill="none" stroke="#22c55e" strokeWidth="2" />
                  <path d="M50 260 L200 230 L350 190 L500 150 L650 110 L800 70 L950 30" fill="none" stroke="#60a5fa" strokeWidth="2" />
                  <path d="M50 270 L200 250 L350 220 L500 190 L650 170 L800 130 L950 100" fill="none" stroke="#1e40af" strokeWidth="2" />
                </svg>

                <div className="y-axis-labels">
                  <span>6000</span>
                  <span>5000</span>
                  <span>4000</span>
                  <span>3000</span>
                  <span>2000</span>
                  <span>1000</span>
                  <span>0</span>
                </div>

                <div className="axis-label-vertical">Sales</div>

                <div className="x-axis-labels">
                  <span>Mon</span>
                  <span>Tue</span>
                  <span>Wed</span>
                  <span>Thu</span>
                  <span>Fri</span>
                  <span>Sat</span>
                  <span>Sun</span>
                </div>

                <div className="axis-label-horizontal">Date</div>
              </div>

              <div className="insights-and-actions">
                <div className="model-insights">
                  <h4>
                    Model Insights
                    <Tippy
                      content={tooltips.modelInsights}
                      placement="top"
                      animation="scale"
                      duration={200}
                      theme="dark"
                      arrow={true}
                      delay={[100, 0]}
                      maxWidth={350}
                      interactive={true}
                    >
                      <span className="insight-icon-wrapper">
                        <FaInfoCircle className="insight-info-icon" />
                      </span>
                    </Tippy>
                  </h4>
                  <ul>
                    <li>Sisig demand expected to increase 15%</li>
                    <li>Weekend demand remains highest</li>
                    <li>Forecast confidence: High</li>
                  </ul>
                </div>

                <div className="export-actions">
                  <Tippy
                    content={tooltips.exportReport}
                    placement="top"
                    animation="scale"
                    duration={200}
                    theme="dark"
                    arrow={true}
                    delay={[100, 0]}
                    maxWidth={320}
                    interactive={true}
                  >
                    <button className="btn btn-primary">Export PDF</button>
                  </Tippy>
                  <Tippy
                    content={tooltips.exportReport}
                    placement="top"
                    animation="scale"
                    duration={200}
                    theme="dark"
                    arrow={true}
                    delay={[100, 0]}
                    maxWidth={320}
                    interactive={true}
                  >
                    <button className="btn btn-outline">Export EXCEL</button>
                  </Tippy>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Forecasting;