// components/DashboardNotices.jsx
//
// Notice cards shown ABOVE the normal dashboard once a model is trained
// (owner decision, Oct 14 2026; since Oct 24 2026 also before the first
// forecast exists, see the "no forecast yet" notice). Problems no longer replace
// the dashboard with another screen; each one is a card here, built only
// from flags the backend actually found true (getDashboardState() in
// backend/services/uploadService.js returns `attention` and `mapping`).
//
// Severity: stale data and data-quality = "danger" (red). Low accuracy,
// retraining due and missing recipes = "warn" (amber). Nothing to show ->
// renders nothing.
//
// Oct 17 2026: one compact panel with a row per notice, instead of a stack
// of full-width banners (two banners took ~330px above the KPI cards). No
// dismiss button: every notice is a live condition and goes away by itself
// once it is fixed.
import { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaDatabase, FaRedo, FaUpload, FaClipboardList, FaChartLine } from "react-icons/fa";
import { RiErrorWarningLine } from "react-icons/ri";
import Swal from "../../../utils/swal";
import { lowAccuracyNotice } from "../../../utils/accuracyText.js";
import "./DashboardNotices.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const getAuthToken = () => sessionStorage.getItem("access_token") || localStorage.getItem("token");

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "2026-09-28" -> "Sep 28, 2026". Built from its parts: new Date("YYYY-MM-DD")
// is read as UTC midnight and can show the day before in some time zones.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatDateParts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};

// Rows shown before "Show N more".
const VISIBLE_NOTICES = 3;

const DashboardNotices = ({ attention, mapping, onRefreshState }) => {
  const navigate = useNavigate();
  const [isRetraining, setIsRetraining] = useState(false);
  const [isForecasting, setIsForecasting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Retraining is only offered on the "retraining due" card. It is the one
  // place a trained model can still be retrained from (the Analytics page
  // has Generate Forecast, not Start Training).
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
      onRefreshState?.();
    } catch (err) {
      toast.error(err.response?.data?.error || "Retraining failed to start", { id: toastId });
    } finally {
      setIsRetraining(false);
    }
  };

  // Same request as Analytics' "Generate Forecast" (a 7-day refresh with
  // the current model; it never retrains).
  const handleGenerateForecast = async () => {
    setIsForecasting(true);
    const toastId = toast.loading("Generating forecast… (the first run after a quiet period can take about a minute)");
    try {
      const response = await axios.post(`${API_URL}/ml/forecast`, { horizonDays: 7 }, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const results = response.data?.data?.results || [];
      const done = results.filter((r) => r.status === "forecasted").length;
      const failed = results.filter((r) => r.status === "failed").length;
      const text = `Forecast generated${done ? ` for ${plural(done, "product")}` : ""}.`
        + (failed ? ` ${plural(failed, "product")} could not be forecast; see Notifications.` : "");
      if (failed) toast(text, { id: toastId, icon: "⚠️" });
      else toast.success(text, { id: toastId });
      onRefreshState?.();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to generate forecast", { id: toastId });
    } finally {
      setIsForecasting(false);
    }
  };

  const notices = [];

  // A trained model with no forecast for today onwards: the first forecast
  // has not run yet, is running now, or failed. Shown first: without a
  // forecast the rest of the dashboard has nothing to compare against.
  if (attention?.noUpcomingForecast) {
    const running = attention.forecastInFlight || isForecasting;
    notices.push({
      key: "no-forecast",
      tone: "danger",
      icon: <FaChartLine />,
      title: running ? "Forecast is being generated" : "No forecast yet",
      text: running
        ? "The model is trained and today's forecast is running. This page updates when it is ready."
        : "The model is trained, but there is no forecast for today yet (it has not run, or the last run failed). Generate one now.",
      actionLabel: running ? "Generating…" : "Generate forecast",
      onAction: handleGenerateForecast,
      disabled: running,
    });
  }

  if (attention?.isStale) {
    // staleDays counts OPERATING days with no upload (backend
    // utils/staleDays.js), not calendar days, so the old "N days behind
    // today" overstated the gap.
    const days = attention.staleDays != null ? plural(attention.staleDays, "operating day") : "Some operating days";
    const since = formatDateParts(attention.lastConfirmedDate);
    notices.push({
      key: "stale",
      tone: "danger",
      icon: <FaUpload />,
      title: "Sales data is behind",
      text:
        `${days} without uploaded sales` +
        (since ? ` since ${since}` : "") +
        ". Forecasts are running on older data.",
      actionLabel: "Upload sales data",
      onAction: () => navigate("/data-management"),
    });
  }

  if (attention?.dataQualityIssue) {
    notices.push({
      key: "data-quality",
      tone: "danger",
      icon: <FaDatabase />,
      title: "Problem in an uploaded file",
      text: `Issue found: ${attention.dataQualityIssue}. Check your upload history for details.`,
      actionLabel: "Review uploads",
      onAction: () => navigate("/data-management"),
    });
  }

  if (attention?.isLowAccuracy) {
    // isLowAccuracy = the forecast does not beat the weekly average.
    // Wording lives in utils/accuracyText.js.
    notices.push({
      key: "accuracy",
      tone: "warn",
      icon: <RiErrorWarningLine />,
      title: "Forecast accuracy",
      text: lowAccuracyNotice(attention.accuracy),
      actionLabel: "View details",
      onAction: () => navigate("/forecasting"),
    });
  }

  if (attention?.needsRetraining) {
    const days = attention.daysSinceTraining != null ? plural(attention.daysSinceTraining, "day") : "a while";
    notices.push({
      key: "retraining",
      tone: "warn",
      icon: <FaRedo />,
      title: "Retraining due",
      text: `Last trained ${days} ago. Retrain on your current sales data to keep forecasts up to date.`,
      actionLabel: isRetraining ? "Retraining…" : "Retrain model",
      onAction: handleRetrain,
      disabled: isRetraining,
    });
  }

  if (mapping?.hasUnmapped) {
    notices.push({
      key: "unmapped",
      tone: "warn",
      icon: <FaClipboardList />,
      title: "Recipes missing",
      text: `${mapping.unmappedCount} of ${mapping.activeCount} active products have no recipe, so ingredient needs and stock alerts are incomplete.`,
      actionLabel: "Add recipes",
      // ?tab=product opens the Product Management tab directly.
      onAction: () => navigate("/inventory-management?tab=product"),
    });
  }

  if (notices.length === 0) return null;

  const hiddenCount = Math.max(0, notices.length - VISIBLE_NOTICES);
  const shown = showAll ? notices : notices.slice(0, VISIBLE_NOTICES);

  return (
    <section className="dn-panel" aria-label="Things that need your attention">
      <header className="dn-header">
        <h2 className="dn-heading">Needs your attention</h2>
        <span className="dn-count" aria-hidden="true">· {notices.length}</span>
      </header>
      <ul className="dn-list">
        {shown.map((n) => (
          <li key={n.key} className="dn-row">
            <span className={`dn-icon dn-icon--${n.tone}`} aria-hidden="true">{n.icon}</span>
            <div className="dn-body">
              <p className="dn-title">{n.title}</p>
              <p className="dn-text">{n.text}</p>
            </div>
            <button
              type="button"
              className="dn-action"
              onClick={n.onAction}
              disabled={n.disabled}
            >
              {n.actionLabel}
              <FaArrowRight size={11} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="dn-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </section>
  );
};

export default DashboardNotices;
