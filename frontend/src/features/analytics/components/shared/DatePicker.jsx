// components/shared/DatePicker.jsx
//
// One calendar popover, reused everywhere a "Date" or "Week: ..." filter
// pill shows up (Forecasting, Product Performance, Ingredient Demand).
// Before this, every tab had a static <span> pretending to be a filter —
// clicking it did nothing. Centralizing the calendar logic here means:
//   - the month-grid math is written and tested once, not three times
//   - a future bugfix (e.g. week boundaries in a different locale) is a
//     one-file change instead of a three-file hunt
//
// mode="week"   -> clicking a day selects that day's whole Mon–Sun week
// mode="single" -> clicking a day selects just that day

import { useState, useRef, useEffect } from "react";
import { FiCalendar, FiChevronDown, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import "./DatePicker.css";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isInSameWeek(day, selected) {
  const start = startOfWeek(selected);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return day >= start && day <= end;
}

function formatWeekLabel(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = start.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const endStr = sameMonth
    ? end.toLocaleDateString("en-US", { day: "numeric", year: "numeric" })
    : end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `Week: ${startStr}\u2013${endStr}`;
}

function formatDateLabel(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Builds a 6-week grid (42 days) covering the visible month, including the
// trailing/leading days from adjacent months, the way every calendar UI works.
function buildMonthGrid(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());

  const days = [];
  const cursor = new Date(gridStart);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function DatePicker({ value, onChange, mode = "single" }) {
  const [open, setOpen] = useState(false);
  const initialView = Array.isArray(value) ? value[0] || new Date() : new Date(value);
  const [viewDate, setViewDate] = useState(new Date(initialView));
  const [rangeStart, setRangeStart] = useState(Array.isArray(value) ? value[0] || null : null);
  const [rangeEnd, setRangeEnd] = useState(Array.isArray(value) ? value[1] || null : null);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the visible month / selection in sync if the parent updates `value` externally
  useEffect(() => {
    if (mode === "range") {
      if (Array.isArray(value)) {
        setRangeStart(value[0] || null);
        setRangeEnd(value[1] || null);
        setViewDate(new Date(value[0] || value[1] || new Date()));
      }
    } else {
      setViewDate(new Date(value));
    }
  }, [value, mode]);

  let label;
  if (mode === "week") {
    label = formatWeekLabel(value);
  } else if (mode === "range") {
    if (rangeStart && rangeEnd) {
      const startStr = rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const endStr = rangeEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      label = `${startStr}  ${endStr}`;
      // Use a nicer dash instead — replace above if the renderer shows control characters
      label = `${startStr}–${endStr}`;
    } else if (rangeStart) {
      label = formatDateLabel(rangeStart);
    } else {
      label = "Select range";
    }
  } else {
    label = formatDateLabel(value);
  }
  const days = buildMonthGrid(viewDate);
  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const goToPrevMonth = () =>
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const goToNextMonth = () =>
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

  const handleSelectDay = (day) => {
    if (mode === "range") {
      if (!rangeStart || (rangeStart && rangeEnd)) {
        // start a new range
        setRangeStart(day);
        setRangeEnd(null);
      } else if (rangeStart && !rangeEnd) {
        // finish range
        if (day < rangeStart) {
          setRangeStart(day);
          setRangeEnd(rangeStart);
          onChange([day, rangeStart]);
        } else {
          setRangeEnd(day);
          onChange([rangeStart, day]);
        }
        setOpen(false);
      }
    } else {
      onChange(day);
      setOpen(false);
    }
  };

  return (
    <div className="date-picker" ref={containerRef}>
      <button
        type="button"
        className="filter-pill date-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <FiCalendar size={14} /> {label} <FiChevronDown size={14} />
      </button>

      {open && (
        <div className="date-picker-popover" role="dialog" aria-label="Choose a date">
          <div className="date-picker-header">
            <button type="button" className="date-picker-nav" onClick={goToPrevMonth} aria-label="Previous month">
              <FiChevronLeft size={16} />
            </button>
            <span className="date-picker-month">{monthLabel}</span>
            <button type="button" className="date-picker-nav" onClick={goToNextMonth} aria-label="Next month">
              <FiChevronRight size={16} />
            </button>
          </div>

          <div className="date-picker-weekdays">
            {WEEKDAY_LABELS.map((w, i) => (
              <span key={`${w}-${i}`}>{w}</span>
            ))}
          </div>

          <div className="date-picker-grid">
            {days.map((day) => {
              const outsideMonth = day.getMonth() !== viewDate.getMonth();
              let selected = false;
              if (mode === "week") selected = isInSameWeek(day, value);
              else if (mode === "range") {
                if (rangeStart && rangeEnd) selected = day >= new Date(rangeStart.setHours(0,0,0,0)) && day <= new Date(rangeEnd.setHours(23,59,59,999));
                else if (rangeStart) selected = isSameDay(day, rangeStart);
              } else selected = isSameDay(day, value);
              const today = isSameDay(day, new Date());
              return (
                <button
                  type="button"
                  key={day.toISOString()}
                  className={[
                    "date-picker-day",
                    outsideMonth ? "date-picker-day--outside" : "",
                    selected ? "date-picker-day--selected" : "",
                    today ? "date-picker-day--today" : "",
                  ]
                    .join(" ")
                    .trim()}
                  onClick={() => handleSelectDay(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <button type="button" className="date-picker-today-btn" onClick={() => handleSelectDay(new Date())}>
            Jump to Today
          </button>
        </div>
      )}
    </div>
  );
}

export default DatePicker;