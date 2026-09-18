// states/DataNeedsAttention.jsx
import { useState, useEffect } from "react";
import { FaCalendarAlt } from "react-icons/fa";
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/DataNeedsAttention.css";
import { useNavigate } from "react-router-dom";
import { RiErrorWarningLine } from "react-icons/ri";
import axios from "axios";
import toast from "react-hot-toast";
import Swal from "sweetalert2";
import "../../../utils/swalTheme.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const getAuthToken = () => sessionStorage.getItem("access_token") || localStorage.getItem("token");

const DataNeedsAttention = () => {
  const navigate = useNavigate();
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [attention, setAttention] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetraining, setIsRetraining] = useState(false);

  // This state is only reachable when the backend's getDashboardState()
  // already computed real reasons (isStale/isLowAccuracy/needsRetraining/
  // dataQualityIssue — see backend/services/uploadService.js) — this used
  // to be a fully hardcoded card list ("45 days ago", "68%", etc.) that
  // never matched what actually triggered the state, including a top
  // banner describing the UNRELATED "insufficient data" scenario. Fetching
  // the real dashboard-state response here is what makes every number
  // below true.
  useEffect(() => {
    let cancelled = false;
    async function loadAttention() {
      setIsLoading(true);
      try {
        const token = getAuthToken();
        const response = await axios.get(`${API_URL}/upload/dashboard-state`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!cancelled) setAttention(response.data?.data?.attention || null);
      } catch (err) {
        console.error("Error fetching dashboard attention reasons:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadAttention();
    return () => { cancelled = true; };
  }, []);

  // Same Swal-confirm -> single-toast-id lifecycle pattern as
  // ReadyToTrain.jsx's handleStartTraining — the one existing way to
  // trigger POST /api/ml/train. Before this, retraining was only reachable
  // from the "no model yet" dashboard state; once a model exists and
  // accuracy drops or retraining is overdue, there was no button anywhere
  // that actually retrained — only ones that navigated to Upload Sales Data.
  const handleRetrain = async () => {
    const confirmation = await Swal.fire({
      title: "Retrain the forecasting model?",
      text: "This retrains the model on all sales data currently uploaded. It can take a " +
            "few minutes. Make sure the products in Inventory Management reflect what you " +
            "actually sell before retraining — archived items are excluded automatically.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Retrain now",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#7A0101",
    });
    if (!confirmation.isConfirmed) return;

    setIsRetraining(true);
    const toastId = toast.loading("Retraining model…");
    try {
      await axios.post(`${API_URL}/ml/train`, {}, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      toast.success("Retraining completed successfully.", { id: toastId });
    } catch (err) {
      toast.error(err.response?.data?.error || "Retraining failed to start", { id: toastId });
    } finally {
      setIsRetraining(false);
    }
  };

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

  // Built only from real attention flags — a reason only appears here if
  // backend/services/uploadService.js's getDashboardState() actually found
  // it true. "Model Needs Retraining" and "Low Forecast Accuracy" both
  // offer Retrain Model, since retraining (not re-uploading data that's
  // already there) is the real remedy for both.
  const daysSinceTrainingLabel = attention?.daysSinceTraining != null
    ? `${attention.daysSinceTraining} day${attention.daysSinceTraining === 1 ? "" : "s"}`
    : "an unknown number of days";
  const staleDaysLabel = attention?.staleDays != null
    ? `${attention.staleDays} day${attention.staleDays === 1 ? "" : "s"}`
    : "some days";

  const issues = [];
  if (attention?.isStale) {
    issues.push({
      key: "stale",
      title: "Stale Sales Data",
      text: `Your most recent confirmed sales data is ${staleDaysLabel} behind today` +
            (attention.lastConfirmedDate ? ` (as of ${attention.lastConfirmedDate})` : "") +
            ". Upload recent sales data to keep your forecasts accurate.",
      actionLabel: "Upload Sales Data",
      onAction: handleUploadData,
      primary: false,
    });
  }
  if (attention?.needsRetraining) {
    issues.push({
      key: "retraining",
      title: "Model Needs Retraining",
      text: `Your forecasting model was last trained ${daysSinceTrainingLabel} ago. ` +
            "Retrain it on your current sales data to keep forecasts up to date.",
      actionLabel: isRetraining ? "Retraining…" : "Retrain Model",
      onAction: handleRetrain,
      disabled: isRetraining,
      primary: true,
    });
  }
  if (attention?.isLowAccuracy) {
    issues.push({
      key: "accuracy",
      title: "Low Forecast Accuracy",
      text: `Your current forecast accuracy is ${attention.accuracy?.toFixed(1)}%, below the ` +
            "70% reliable threshold. Retraining on your latest uploaded sales data may help.",
      actionLabel: isRetraining ? "Retraining…" : "Retrain Model",
      onAction: handleRetrain,
      disabled: isRetraining,
      primary: true,
    });
  }
  if (attention?.dataQualityIssue) {
    issues.push({
      key: "data-quality",
      title: "Data Quality Issue",
      text: `An issue was detected in your uploaded sales data: ${attention.dataQualityIssue}. Review your upload history for details.`,
      actionLabel: "Go to Data Management",
      onAction: handleGoToDataManagement,
      primary: false,
    });
  }

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
                {isLoading
                  ? "Checking what needs your attention…"
                  : issues.length > 0
                    ? `${issues.length} issue${issues.length === 1 ? "" : "s"} need${issues.length === 1 ? "s" : ""} your attention below.`
                    : "The issue that triggered this view has since cleared — this page will update shortly."}
              </p>
            </div>
          </div>

          {!isLoading && issues.map((issue, index) => (
            <div className="data-attention-issue-card" key={issue.key}>
              <div className="data-attention-issue-number">{index + 1}</div>
              <div className="data-attention-issue-body">
                <div className="data-attention-issue-content">
                  <h4 className="data-attention-issue-title">{issue.title}</h4>
                  <p className="data-attention-issue-text">{issue.text}</p>
                </div>
                <button
                  className={`data-attention-issue-btn ${issue.primary ? "" : "data-attention-issue-btn-secondary"}`}
                  onClick={issue.onAction}
                  disabled={issue.disabled}
                >
                  {issue.actionLabel}
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default DataNeedsAttention;