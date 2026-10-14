// components/DashboardNotices.jsx
//
// Notice cards shown ABOVE the normal dashboard once a model is trained and
// forecasts exist (owner decision, Oct 14 2026). Problems no longer replace
// the dashboard with another screen; each one is a card here, built only
// from flags the backend actually found true (getDashboardState() in
// backend/services/uploadService.js returns `attention` and `mapping`).
//
// Severity: stale data and data-quality = "danger" (red). Low accuracy,
// retraining due and missing recipes = "warn" (amber). Nothing to show ->
// renders nothing.
import { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaDatabase, FaRedo, FaUpload, FaClipboardList } from "react-icons/fa";
import { RiErrorWarningLine } from "react-icons/ri";
import Swal from "../../../utils/swal";
import { StateBanner } from "./DashboardStateKit.jsx";
import "./DashboardNotices.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const getAuthToken = () => sessionStorage.getItem("access_token") || localStorage.getItem("token");

const pct = (value) => (typeof value === "number" ? value.toFixed(1) : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const DashboardNotices = ({ attention, mapping, onRefreshState }) => {
  const navigate = useNavigate();
  const [isRetraining, setIsRetraining] = useState(false);

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

  const notices = [];

  if (attention?.isStale) {
    const days = attention.staleDays != null ? plural(attention.staleDays, "day") : "some days";
    notices.push({
      key: "stale",
      tone: "danger",
      icon: <FaUpload size={18} />,
      title: "Sales data is behind",
      text:
        `Your most recent confirmed sales data is ${days} behind today` +
        (attention.lastConfirmedDate ? ` (as of ${attention.lastConfirmedDate})` : "") +
        ". Upload recent sales data to keep your forecasts accurate.",
      actionLabel: "Upload sales data",
      onAction: () => navigate("/data-management"),
    });
  }

  if (attention?.dataQualityIssue) {
    notices.push({
      key: "data-quality",
      tone: "danger",
      icon: <FaDatabase size={18} />,
      title: "Problem in an uploaded file",
      text: `An issue was found in your uploaded sales data: ${attention.dataQualityIssue}. Review your upload history for details.`,
      actionLabel: "Go to Data Management",
      onAction: () => navigate("/data-management"),
    });
  }

  if (attention?.isLowAccuracy) {
    const accuracy = pct(attention.accuracy);
    const baseline = pct(attention.baselineAccuracy);
    notices.push({
      key: "accuracy",
      tone: "warn",
      icon: <RiErrorWarningLine size={18} />,
      title: "Forecast accuracy",
      text:
        accuracy && baseline
          ? `Forecast accuracy is ${accuracy}%. A simple 7-day average scored ${baseline}% on the same days. ` +
            "Use the forecast as a planning guide, not an exact number."
          : "The forecast is not yet better than a simple 7-day average. " +
            "Use the forecast as a planning guide, not an exact number.",
      actionLabel: "View details",
      onAction: () => navigate("/forecasting"),
    });
  }

  if (attention?.needsRetraining) {
    const days = attention.daysSinceTraining != null ? plural(attention.daysSinceTraining, "day") : "a while";
    notices.push({
      key: "retraining",
      tone: "warn",
      icon: <FaRedo size={18} />,
      title: "Retraining due",
      text: `The forecasting model was last trained ${days} ago. Retrain it on your current sales data to keep forecasts up to date.`,
      actionLabel: isRetraining ? "Retraining…" : "Retrain model",
      onAction: handleRetrain,
      disabled: isRetraining,
    });
  }

  if (mapping?.hasUnmapped) {
    notices.push({
      key: "unmapped",
      tone: "warn",
      icon: <FaClipboardList size={18} />,
      title: "Recipes missing",
      text: `${mapping.unmappedCount} of ${mapping.activeCount} active products have no recipe yet, so the ingredient list is partial.`,
      actionLabel: "Add recipes",
      // ?tab=product opens the Product Management tab directly.
      onAction: () => navigate("/inventory-management?tab=product"),
    });
  }

  if (notices.length === 0) return null;

  return (
    <div className="sk-root dash-notices" role="region" aria-label="Things that need your attention">
      {notices.map((n) => (
        <StateBanner
          key={n.key}
          tone={n.tone}
          icon={n.icon}
          title={n.title}
          text={n.text}
          actions={
            <button
              type="button"
              className="sk-btn sk-btn--secondary"
              onClick={n.onAction}
              disabled={n.disabled}
            >
              {n.actionLabel}
              <FaArrowRight size={13} />
            </button>
          }
        />
      ))}
    </div>
  );
};

export default DashboardNotices;
