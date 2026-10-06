// states/DataNeedsAttention.jsx
//
// State 6 of 7 — the model is trained and forecasts exist, but something
// about the data or the model has degraded. This state is only reachable
// when the backend's getDashboardState() already computed real reasons
// (isStale / isLowAccuracy / needsRetraining / dataQualityIssue — see
// backend/services/uploadService.js), so every card below is built from a
// flag that was actually true rather than a hardcoded list.
import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import {
  FaArrowRight,
  FaCalendarAlt,
  FaCheckCircle,
  FaDatabase,
  FaRedo,
  FaUpload,
} from "react-icons/fa";
import { RiErrorWarningLine, RiLightbulbLine } from "react-icons/ri";
import Swal from "../../../utils/swal";
import {
  StateShell,
  StateBanner,
  MonthPicker,
} from "../components/DashboardStateKit.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const getAuthToken = () => sessionStorage.getItem("access_token") || localStorage.getItem("token");

const DataNeedsAttention = ({ initialState }) => {
  const navigate = useNavigate();
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  // Seeded from the Dashboard's dashboard-state response — the `attention`
  // block is exactly what this screen renders. Fetching it again on mount meant
  // the cards appeared a beat after the screen did.
  const [attention, setAttention] = useState(initialState?.attention || null);
  const [isLoading, setIsLoading] = useState(!initialState);
  const [isRetraining, setIsRetraining] = useState(false);

  useEffect(() => {
    // Nothing to re-fetch when the Dashboard just handed us the reasons.
    if (initialState) return undefined;

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
    return () => {
      cancelled = true;
    };
  }, [initialState]);

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

  const handleUploadData = () => navigate("/data-management");
  const handleGoToDataManagement = () => navigate("/data-management");

  // Built only from real attention flags — a reason only appears here if
  // backend/services/uploadService.js's getDashboardState() actually found
  // it true. "Model Needs Retraining" and "Low Forecast Accuracy" both
  // offer Retrain Model, since retraining (not re-uploading data that's
  // already there) is the real remedy for both.
  const daysSinceTrainingLabel =
    attention?.daysSinceTraining != null
      ? `${attention.daysSinceTraining} day${attention.daysSinceTraining === 1 ? "" : "s"}`
      : "an unknown number of days";
  const staleDaysLabel =
    attention?.staleDays != null
      ? `${attention.staleDays} day${attention.staleDays === 1 ? "" : "s"}`
      : "some days";

  const issues = [];
  if (attention?.isStale) {
    issues.push({
      key: "stale",
      tone: "warn",
      icon: <FaUpload size={20} />,
      title: "Stale Sales Data",
      text:
        `Your most recent confirmed sales data is ${staleDaysLabel} behind today` +
        (attention.lastConfirmedDate ? ` (as of ${attention.lastConfirmedDate})` : "") +
        ". Upload recent sales data to keep your forecasts accurate.",
      actionLabel: "Upload Sales Data",
      onAction: handleUploadData,
    });
  }
  if (attention?.needsRetraining) {
    issues.push({
      key: "retraining",
      tone: "danger",
      icon: <FaRedo size={20} />,
      title: "Model Needs Retraining",
      text:
        `Your forecasting model was last trained ${daysSinceTrainingLabel} ago. ` +
        "Retrain it on your current sales data to keep forecasts up to date.",
      actionLabel: isRetraining ? "Retraining…" : "Retrain Model",
      onAction: handleRetrain,
      disabled: isRetraining,
    });
  }
  if (attention?.isLowAccuracy) {
    const modelAccuracy =
      typeof attention.accuracy === "number" ? attention.accuracy.toFixed(1) : null;
    const baselineAccuracy =
      typeof attention.baselineAccuracy === "number" ? attention.baselineAccuracy.toFixed(1) : null;

    issues.push({
      key: "accuracy",
      tone: "danger",
      icon: <RiErrorWarningLine size={20} />,
      title: "Low Forecast Accuracy",
      text:
        modelAccuracy && baselineAccuracy
          ? `Your model currently scores ${modelAccuracy}% accuracy on held-out data, ` +
            `below the ${baselineAccuracy}% a simple 7-day average would have scored on the ` +
            "same days. Retraining on your latest sales data is the fix worth trying first."
          : "Your model is currently scoring worse than a simple 7-day average on recent data. " +
            "Retraining on your latest sales data is the fix worth trying first.",
      actionLabel: isRetraining ? "Retraining…" : "Retrain Model",
      onAction: handleRetrain,
      disabled: isRetraining,
    });
  }
  if (attention?.dataQualityIssue) {
    issues.push({
      key: "data-quality",
      tone: "danger",
      icon: <FaDatabase size={20} />,
      title: "Data Quality Issue",
      text: `An issue was detected in your uploaded sales data: ${attention.dataQualityIssue}. Review your upload history for details.`,
      actionLabel: "Go to Data Management",
      onAction: handleGoToDataManagement,
    });
  }

  const summaryText = isLoading
    ? "Checking what needs your attention…"
    : issues.length > 0
      ? `${issues.length} issue${issues.length === 1 ? "" : "s"} need${
          issues.length === 1 ? "s" : ""
        } your attention below.`
      : "The issue that triggered this view has since cleared — this page will update shortly.";

  const clockSlot = (
    <span className="sk-clock-slot">
      <button
        type="button"
        className="sk-clock-action"
        onClick={() => setShowCalendar((open) => !open)}
      >
        <FaCalendarAlt size={13} />
        {selectedDate ? "Change date" : "Pick a date"}
      </button>
      {showCalendar ? (
        <MonthPicker
          onSelect={(date) => {
            setSelectedDate(date);
            setShowCalendar(false);
          }}
        />
      ) : null}
      {selectedDate ? (
        <button
          type="button"
          className="sk-clock-reset"
          onClick={() => {
            setSelectedDate(null);
            setShowCalendar(false);
          }}
        >
          Back to today
        </button>
      ) : null}
    </span>
  );

  return (
    <StateShell
      eyebrow="Needs attention"
      eyebrowTone="danger"
      title={<>Your forecasts need <em>your attention</em></>}
      lede="Forecasts are still available, but one or more things behind them have changed since the model was last trained. Fixing these keeps the numbers you plan with trustworthy."
      progress={{
        value: isLoading ? 90 : 100,
        tone: "danger",
        caption: "Forecasts are live — but these items reduce their reliability",
      }}
      clockSlot={clockSlot}
      selectedDate={selectedDate}
      status={
        <StateBanner
          tone={issues.length > 0 && !isLoading ? "danger" : "warn"}
          icon={<RiErrorWarningLine size={20} />}
          title={isLoading ? "Checking your data" : `${issues.length} item${issues.length === 1 ? "" : "s"} to resolve`}
          text={summaryText}
        />
      }
    >
      <section className="sk-section">
        <div className="sk-section-head">
          <div>
            <h2 className="sk-section-title">What to do</h2>
            <p className="sk-section-sub">
              Each card below corresponds to something the system actually detected.
              Working through them in order will bring the dashboard back to fully
              operational.
            </p>
          </div>
          {issues.length > 0 ? (
            <span className="sk-tag sk-tag--warn">
              {issues.length} open {issues.length === 1 ? "item" : "items"}
            </span>
          ) : null}
        </div>

        {issues.length > 0 ? (
          <div className="sk-grid-2">
            {issues.map((issue, index) => (
              <article
                className={`sk-card sk-card--hover sk-card--${issue.tone}`}
                key={issue.key}
              >
                <div className="sk-card-head">
                  <span className={`sk-card-ico sk-card-ico--${issue.tone}`}>
                    {issue.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="sk-step-num" style={{ marginBottom: 10 }}>
                      {index + 1}
                    </div>
                    <h3 className="sk-card-title">{issue.title}</h3>
                  </div>
                </div>
                <p className="sk-card-text">{issue.text}</p>
                <div className="sk-card-foot">
                  <button
                    type="button"
                    className="sk-btn sk-btn--primary"
                    onClick={issue.onAction}
                    disabled={issue.disabled}
                  >
                    {issue.actionLabel}
                    <FaArrowRight size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="sk-note sk-note--ok">
            <FaCheckCircle size={16} style={{ color: "var(--sk-success)", marginRight: 8, verticalAlign: -3 }} />
            {isLoading
              ? "Loading the checks behind this view…"
              : "Nothing needs your attention right now. This view clears itself once training catches up."}
          </div>
        )}
      </section>

      <section className="sk-section">
        <div className="sk-note">
          <RiLightbulbLine size={17} style={{ color: "var(--sk-burgundy)", marginRight: 8, verticalAlign: -3 }} />
          <strong>Why this matters.</strong> Forecasts are estimates. Stale sales data,
          an overdue model and a flagged upload each reduce how close those estimates
          land to your actual demand — which is exactly what ingredient purchasing is
          planned from.
        </div>
      </section>
    </StateShell>
  );
};

export default DataNeedsAttention;