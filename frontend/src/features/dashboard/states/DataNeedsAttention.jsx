// states/DataNeedsAttention.jsx
import { useState } from "react";
import { FaCalendarAlt } from "react-icons/fa";
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/DataNeedsAttention.css";
import { useNavigate } from "react-router-dom";
import { RiErrorWarningLine } from "react-icons/ri";

const DataNeedsAttention = () => {
  const navigate = useNavigate();
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const formatDate = (date) => {
    const months = [
      "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
      "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
    ];
    const month = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
  };

  const formatDay = (date) => {
    const days = [
      "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
    ];
    return days[date.getDay()];
  };

  const formatTime = (date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  const now = new Date();
  const formattedDate = formatDate(now);
  const formattedDay = formatDay(now);
  const formattedTime = formatTime(now);

  // Navigation handlers
  const handleUploadData = () => {
    navigate("/data-management");
  };

  const handleGoToDataManagement = () => {
    navigate("/data-management");
  };

  // Calendar component
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
                  background: isToday ? '#ef4444' : 'transparent',
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

  return (
    <div className="data-attention-container">
      <Navbar />
      <main className="data-attention-main">
        {/* Dashboard Title & Date */}
        <div className="data-attention-title-section">
          <h1 className="data-attention-title">Dashboard</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
            <div className="data-attention-date-info">
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
              <span>{formattedTime}</span>
              <span className="data-attention-date-separator">{formattedDay}</span>
              <span className="data-attention-date-separator">{formattedDate}</span>
            </div>
          </div>
        </div>
        <div className="data-attention-issues-list">
          <div className="data-attention-issue-card1">
             <div className="data-attention-issue-body">
              <div className="data-attention-issue-icon-wrapper">
                <RiErrorWarningLine  className="data-attention-issue-warning-icon" />
              </div>
              <p className="data-attention-issue-text">
                You've uploaded sales data, but the system needs at least 12 months of history before demand forecasting can activate. Your data is outdated consider uploading recent data.
              </p>
            </div>
          </div>
          {/* Issue 2: Stale Sales Data */}
          <div className="data-attention-issue-card">
            <div className="data-attention-issue-number">1</div>
            <div className="data-attention-issue-body">
              <div className="data-attention-issue-content">
                <h4 className="data-attention-issue-title">Stale Sales Data</h4>
                <p className="data-attention-issue-text">
                  Your last upload was 45 days ago. Upload recent sales data to keep your forecasts accurate.
                </p>
              </div>
              <button 
                className="data-attention-issue-btn data-attention-issue-btn-secondary"
                onClick={handleUploadData}
              >
                Upload Sales Data
              </button>
            </div>
          </div>

          {/* Issue 3: Model Needs Retraining */}
          <div className="data-attention-issue-card">
            <div className="data-attention-issue-number">2</div>
            <div className="data-attention-issue-body">
              <div className="data-attention-issue-content">
                <h4 className="data-attention-issue-title">Model Needs Retraining</h4>
                <p className="data-attention-issue-text">
                  Your forecasting model has not been updated recently. Upload new sales data to trigger automatic retraining.
                </p>
              </div>
              <button 
                className="data-attention-issue-btn data-attention-issue-btn-secondary"
                onClick={handleUploadData}
              >
                Upload Sales Data
              </button>
            </div>
          </div>

          {/* Issue 4: Low Forecast Accuracy */}
          <div className="data-attention-issue-card">
            <div className="data-attention-issue-number">3</div>
            <div className="data-attention-issue-body">
              <div className="data-attention-issue-content">
                <h4 className="data-attention-issue-title">Low Forecast Accuracy</h4>
                <p className="data-attention-issue-text">
                  Your current forecast accuracy score is 68%, which is below the recommended threshold. Uploading more historical data may improve accuracy.
                </p>
              </div>
              <button 
                className="data-attention-issue-btn data-attention-issue-btn-secondary"
                onClick={handleUploadData}
              >
                Upload Sales Data
              </button>
            </div>
          </div>

          {/* Issue 5: Data Quality Issue */}
          <div className="data-attention-issue-card">
            <div className="data-attention-issue-number">4</div>
            <div className="data-attention-issue-body">
              <div className="data-attention-issue-content">
                <h4 className="data-attention-issue-title">Data Quality Issue</h4>
                <p className="data-attention-issue-text">
                  An issue was detected in your uploaded sales data. Review your upload history for errors.
                </p>
              </div>
              <button 
                className="data-attention-issue-btn data-attention-issue-btn-secondary"
                onClick={handleGoToDataManagement}
              >
                Go to Data Management
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DataNeedsAttention;