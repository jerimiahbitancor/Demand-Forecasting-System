// components/HistoryGapReview.jsx
//
// One-time history step on the "insufficient data" dashboard: lists the
// dates inside the owner's sales history that have no sales and are not
// marked closed, and lets the owner mark them closed in one go.
//
// Every date starts checked. The owner unchecks any day the store was
// actually OPEN (the upload is just missing) — those stay unconfirmed, and
// the fix for them is uploading that day's sales file, not marking it here.
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import Swal from '../../../utils/swal';
import "./HistoryGapReview.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
// Matches MAX_CLOSE_BATCH in backend/utils/historyGate.js.
const MAX_BATCH = 500;

const authHeaders = () => {
  const token = sessionStorage.getItem("access_token") || localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// 'YYYY-MM-DD' -> 'Jul 10, 2025'. Built from the parts, not new Date(str),
// so a UTC-midnight parse can't shift the day in the browser's timezone.
const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
};

const monthLabel = (dateStr) => {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

const HistoryGapReview = ({ onSaved }) => {
  const [gaps, setGaps] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [showList, setShowList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Bumped to re-fetch the list (after a save, or after a failed save —
  // a date may have gained sales since the list loaded).
  const [reloadKey, setReloadKey] = useState(0);
  const reloadGaps = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const loadGaps = async () => {
      try {
        const res = await axios.get(`${API_URL}/business-days/gaps`, { headers: authHeaders() });
        if (cancelled) return;
        const data = res.data?.data || null;
        setLoadError(null);
        setGaps(data);
        setChecked(new Set((data?.gapDates || []).map((g) => g.date)));
      } catch (err) {
        console.error("Error loading dates with no sales:", err);
        if (!cancelled) {
          setLoadError("We couldn't load the dates with no sales. Please refresh the page.");
        }
      }
    };
    loadGaps();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const byMonth = useMemo(() => {
    const groups = new Map();
    for (const gap of gaps?.gapDates || []) {
      const key = gap.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(gap);
    }
    return [...groups.entries()];
  }, [gaps]);

  if (loadError) {
    return <div className="gap-review gap-review--error">{loadError}</div>;
  }
  const gapDates = gaps?.gapDates || [];
  if (gapDates.length === 0) return null;

  const toggleDate = (date) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const toggleMonth = (monthDates, allChecked) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const g of monthDates) {
        if (allChecked) next.delete(g.date);
        else next.add(g.date);
      }
      return next;
    });
  };

  const saveClosed = async (dates) => {
    if (dates.length === 0) {
      toast.error("No days are selected.");
      return;
    }

    const confirmation = await Swal.fire({
      title: `Mark ${dates.length} day${dates.length === 1 ? "" : "s"} as closed?`,
      text:
        "These days will be saved as days your store was closed. " +
        "If you later upload sales for one of these days, it will change back to open.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes, mark as closed",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#7A0101",
    });
    if (!confirmation.isConfirmed) return;

    setIsSaving(true);
    const toastId = toast.loading("Saving...");
    try {
      const sorted = [...dates].sort();
      for (let i = 0; i < sorted.length; i += MAX_BATCH) {
        await axios.post(
          `${API_URL}/business-days/bulk-close`,
          { dates: sorted.slice(i, i + MAX_BATCH) },
          { headers: authHeaders() }
        );
      }
      toast.success(
        `${dates.length} day${dates.length === 1 ? "" : "s"} marked as closed.`,
        { id: toastId }
      );
      setShowList(false);
      reloadGaps();
      if (onSaved) await onSaved();
    } catch (err) {
      const problems = err.response?.data?.errors || [];
      const first = problems[0];
      const detail = first
        ? `${first.date ? `${formatDate(first.date)}: ` : ""}${first.reason}`
        : err.response?.data?.error || "Please try again.";
      toast.error(
        `Nothing was saved. ${detail}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`,
        { id: toastId }
      );
      // A date may have gained sales since the list loaded — reload it.
      reloadGaps();
    } finally {
      setIsSaving(false);
    }
  };

  const allDates = gapDates.map((g) => g.date);
  const uncheckedCount = allDates.length - checked.size;

  return (
    <div className="gap-review">
      <p className="gap-review__question">
        We found <strong>{gapDates.length} date{gapDates.length === 1 ? "" : "s"} with no sales</strong>{" "}
        between <strong>{formatDate(gaps.firstSaleDate)}</strong> and{" "}
        <strong>{formatDate(gaps.lastSaleDate)}</strong>. Were these days your store was closed?
      </p>

      <div className="gap-review__actions">
        <button
          type="button"
          className="gap-review__btn gap-review__btn--secondary"
          onClick={() => setShowList((v) => !v)}
          disabled={isSaving}
        >
          {showList ? "Hide list" : "Review list"}
        </button>
        <button
          type="button"
          className="gap-review__btn gap-review__btn--primary"
          onClick={() => saveClosed(allDates)}
          disabled={isSaving}
        >
          Mark all as closed
        </button>
      </div>

      {showList && (
        <div className="gap-review__list">
          <p className="gap-review__hint">
            Uncheck any day your store was <strong>open</strong>. Those days stay as they are —
            upload that day&apos;s sales file instead.
          </p>

          {byMonth.map(([key, monthDates]) => {
            const allChecked = monthDates.every((g) => checked.has(g.date));
            return (
              <fieldset key={key} className="gap-review__month">
                <legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => toggleMonth(monthDates, allChecked)}
                    />{" "}
                    {monthLabel(monthDates[0].date)} ({monthDates.length})
                  </label>
                </legend>
                <div className="gap-review__days">
                  {monthDates.map((g) => (
                    <label key={g.date} className="gap-review__day">
                      <input
                        type="checkbox"
                        checked={checked.has(g.date)}
                        onChange={() => toggleDate(g.date)}
                      />
                      <span>{formatDate(g.date)}</span>
                      <span className="gap-review__weekday">{g.weekday}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}

          <div className="gap-review__footer">
            <span>
              {checked.size} selected
              {uncheckedCount > 0 ? ` · ${uncheckedCount} left as they are` : ""}
            </span>
            <button
              type="button"
              className="gap-review__btn gap-review__btn--primary"
              onClick={() => saveClosed([...checked])}
              disabled={isSaving || checked.size === 0}
            >
              Mark {checked.size} selected as closed
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryGapReview;
