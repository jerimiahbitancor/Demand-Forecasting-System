// states/ForecastsReady.jsx
import { FaArrowUp, FaCheckCircle } from 'react-icons/fa';
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/ForecastsReady.css";

const ForecastsReady = () => {
  return (
    <div className="dashboard-container">
      <Navbar />
      <main className="dashboard-main">
        <div className="dashboard-title-section">
          <h1 className="dashboard-title">Dashboard</h1>
          <div className="date-info">
            <span>{new Date().toLocaleTimeString()}</span>
            <span className="date-separator">{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span>
            <span className="date-separator">{new Date().toLocaleDateString()}</span>
          </div>
        </div>

        {/* Success Banner */}
        <div style={{
          background: '#dcfce7',
          borderLeft: '4px solid #22c55e',
          padding: '16px 20px',
          borderRadius: '8px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <FaCheckCircle style={{ color: '#22c55e', fontSize: '24px' }} />
          <div>
            <strong style={{ color: '#166534' }}>Forecasts Ready!</strong>
            <p style={{ color: '#166534', margin: '4px 0 0 0', fontSize: '14px' }}>
              Your AI forecasts are ready to use. View insights below.
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="metrics-grid">
          <div className="metric-card border-green">
            <div className="card-header">
              <h3 className="card-title">Predicted Sales</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">₱52,500</span>
              <div className="badge-success">
                <FaArrowUp className="badge-icon" />
                +8.5%
              </div>
            </div>
            <p className="metric-subtext">Next 7 days forecast</p>
          </div>

          <div className="metric-card border-blue">
            <div className="card-header">
              <h3 className="card-title">Top Predicted Items</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">12</span>
            </div>
            <p className="metric-subtext">Items with high demand</p>
          </div>

          <div className="metric-card border-purple">
            <div className="card-header">
              <h3 className="card-title">Confidence Score</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">94%</span>
            </div>
            <p className="metric-subtext">Model confidence level</p>
          </div>

          <div className="metric-card border-indigo">
            <div className="card-header">
              <h3 className="card-title">Recommendations</h3>
            </div>
            <div className="metric-value-group">
              <span className="metric-value">5</span>
            </div>
            <p className="metric-subtext">Actionable insights</p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '32px',
          gap: '12px'
        }}>
          <button style={{
            padding: '10px 24px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}>
            View Full Forecast
          </button>
          <button style={{
            padding: '10px 24px',
            background: '#22c55e',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}>
            Export Report
          </button>
        </div>
      </main>
    </div>
  );
};

export default ForecastsReady;