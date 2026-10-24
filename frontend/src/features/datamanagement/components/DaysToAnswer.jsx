// components/DaysToAnswer.jsx
//
// "Days that need your answer": operating days in the last 60 days, up to
// yesterday, with no sales upload and no "closed" mark. The 4:00 AM / 7:00 AM
// upload reminders link here (/data-management#days-to-answer).
//
// Each day has two answers: upload that day's sales file (opens the upload
// panel below), or mark the store closed for that day. The list comes from
// GET /api/business-days/pending, the same rule the reminders use.
//
// Hidden until a model has been trained (data.modelExists). Before that the
// owner is still loading history, and the dashboard's first-use history
// review is where missing days are answered.
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Swal from "../../../utils/swal";
import apiClient from "../../../services/apiClient";
import { onDataChanged } from "../../../utils/appEvents";
import "./DaysToAnswer.css";

const ANCHOR = "days-to-answer";

const DaysToAnswer = ({ refreshKey = 0, onUploadClick }) => {
  const [days, setDays] = useState(null);
  // null = not loaded yet. Defaults to true if an older backend leaves the
  // field out, so the card keeps working during a staggered deploy.
  const [modelExists, setModelExists] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [closingDate, setClosingDate] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const cardRef = useRef(null);
  const scrolledRef = useRef(false);
  const linkedHere = typeof window !== "undefined" && window.location.hash === `#${ANCHOR}`;

  // Collapsed by default so the section stays out of the way; a reminder that
  // linked here (#days-to-answer) opens it straight away instead.
  const [open, setOpen] = useState(linkedHere);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiClient.get("/business-days/pending")
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data || {};
        setDays(data.days || []);
        setModelExists(data.modelExists !== false);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error.apiError?.message || "Could not load the days that need your answer.");
      });
    return () => { cancelled = true; };
  }, [refreshKey, reloadKey]);

  // A finished upload anywhere in the app (the bell sees it) may answer a day.
  useEffect(() => onDataChanged((change) => {
    if (change.kind === "upload") reload();
  }), [reload]);

  // Opened from a reminder: bring the card into view once it has loaded.
  useEffect(() => {
    if (!linkedHere || scrolledRef.current || days === null) return;
    scrolledRef.current = true;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [days, linkedHere]);

  // A reminder can also land on the hash while we are already here: open then too.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === `#${ANCHOR}`) setOpen(true);
    };
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  const handleMarkClosed = async (day) => {
    const confirmation = await Swal.fire({
      title: `Mark ${day.label} as closed?`,
      text:
        "This day will be saved as a day your store was closed. " +
        "If you upload sales for it later, it will change back to open.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes, mark as closed",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#7A0101",
    });
    if (!confirmation.isConfirmed) return;

    setClosingDate(day.date);
    try {
      await apiClient.post("/business-days/close", { date: day.date });
      toast.success(`${day.label} is marked as closed.`);
    } catch (error) {
      toast.error(error.apiError?.message || "Could not mark this day as closed.");
    } finally {
      setClosingDate(null);
      reload();
    }
  };

  if (loadError) {
    return (
      <section id={ANCHOR} ref={cardRef} className="days-to-answer days-to-answer--error">
        <p>{loadError}</p>
        <button type="button" className="days-to-answer__btn" onClick={reload}>Try again</button>
      </section>
    );
  }

  if (days === null) return null;

  // First-time user (no trained model yet): nothing to answer here, and no
  // "all answered" message either, since there was never anything to answer.
  if (modelExists === false) return null;

  if (days.length === 0) {
    // Nothing to answer: stay out of the way, unless a reminder sent the
    // owner here, then say so.
    return linkedHere ? (
      <section id={ANCHOR} ref={cardRef} className="days-to-answer days-to-answer--done">
        <p>All recent days are answered. Thank you!</p>
      </section>
    ) : null;
  }

  const bodyId = "days-to-answer-body";

  return (
    <section
      id={ANCHOR}
      ref={cardRef}
      className="days-to-answer"
      aria-labelledby="days-to-answer-title"
    >
      <button
        type="button"
        id="days-to-answer-title"
        className="days-to-answer__header"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="days-to-answer__heading">
          Days that need your answer
          <span className="days-to-answer__count">{days.length}</span>
        </span>
        <svg
          className={`days-to-answer__chevron${open ? " is-open" : ""}`}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div id={bodyId} className="days-to-answer__body" hidden={!open}>
        <p className="days-to-answer__intro">
          Your store usually opens on these days, but no sales file was uploaded and the day
          is not marked closed. Upload the sales file, or mark the store as closed.
        </p>
        <ul className="days-to-answer__list">
          {days.map((day) => (
            <li key={day.date} className="days-to-answer__row">
              <span className="days-to-answer__date">{day.label}</span>
              <span className="days-to-answer__actions">
                <button
                  type="button"
                  className="days-to-answer__btn days-to-answer__btn--primary"
                  onClick={() => onUploadClick && onUploadClick(day.date)}
                >
                  Upload Sales Data
                </button>
                <button
                  type="button"
                  className="days-to-answer__btn"
                  disabled={closingDate !== null}
                  onClick={() => handleMarkClosed(day)}
                >
                  {closingDate === day.date ? "Saving..." : "Mark Store as Closed"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default DaysToAnswer;
