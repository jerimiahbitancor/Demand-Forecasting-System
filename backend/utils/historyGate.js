// utils/historyGate.js
//
// The first-use "12 months of sales history" rule. Pure functions only:
// no database, no clock. The caller passes in the dates; this decides.
//
// ml-service/services/history_gate.py is a line-for-line twin of this file.
// Both are tested against the SAME cases in
// ml-service/tests/fixtures/history_gate_cases.json, and a cross-check test
// runs both on those cases and compares the answers field by field. If you
// change the rule here, change it there too, and add a case to that file.
//
// The rule (owner's decision, Sep 30 2026):
//   1. Span: last sale date − first sale date + 1 >= 365 calendar days.
//      Measured on the uploaded data, NEVER on today's date — the clock
//      moving forward must not count as history.
//   2. Every day accounted for: each date from the first to the last sale
//      date is either open (has daily_sales rows) or confirmed closed
//      (business_days.status = 'confirmed_closed'). Zero unconfirmed dates.
//
// Closed days count toward the span. A date that has sales AND is marked
// closed counts as open — an upload always wins over a closed mark.

const MIN_HISTORY_SPAN_DAYS = 365;
const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 'YYYY-MM-DD' -> whole days since 1970-01-01, or null if not a real date.
// Uses UTC math on purpose: these are calendar dates, not moments, so no
// timezone should ever shift them by a day.
function toDayNumber(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Rejects dates that roll over, like 2026-02-30 or 2026-13-01.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / DAY_MS);
}

function fromDayNumber(dayNumber) {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const n = toDayNumber(dateStr);
  return n === null ? null : WEEKDAYS[new Date(n * DAY_MS).getUTCDay()];
}

function isValidDate(dateStr) {
  return toDayNumber(dateStr) !== null;
}

// saleDates:   dates that have daily_sales rows (duplicates/unsorted fine)
// closedDates: dates with business_days.status = 'confirmed_closed'
function evaluateHistoryGate({ saleDates = [], closedDates = [] } = {}) {
  const saleSet = new Set(saleDates.filter(isValidDate));
  const closedSet = new Set(closedDates.filter(isValidDate));

  const empty = {
    firstSaleDate: null,
    lastSaleDate: null,
    spanDays: 0,
    spanMonths: 0,
    requiredSpanDays: MIN_HISTORY_SPAN_DAYS,
    openDays: 0,
    closedDays: 0,
    unconfirmedDays: 0,
    unconfirmedDates: [],
    spanOk: false,
    allAccounted: false,
    passes: false,
    insufficientReason: 'no_data',
  };
  if (saleSet.size === 0) return empty;

  const sorted = [...saleSet].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstN = toDayNumber(first);
  const lastN = toDayNumber(last);
  const spanDays = lastN - firstN + 1;

  let openDays = 0;
  let closedDays = 0;
  const unconfirmedDates = [];
  for (let n = firstN; n <= lastN; n += 1) {
    const d = fromDayNumber(n);
    if (saleSet.has(d)) openDays += 1;
    else if (closedSet.has(d)) closedDays += 1;
    else unconfirmedDates.push(d);
  }

  const spanOk = spanDays >= MIN_HISTORY_SPAN_DAYS;
  const allAccounted = unconfirmedDates.length === 0;
  let insufficientReason = null;
  if (!spanOk && !allAccounted) insufficientReason = 'both';
  else if (!spanOk) insufficientReason = 'span';
  else if (!allAccounted) insufficientReason = 'unconfirmed';

  return {
    firstSaleDate: first,
    lastSaleDate: last,
    spanDays,
    // Display only (average month length). The rule itself is in days.
    spanMonths: Math.round((spanDays / 30.4375) * 10) / 10,
    requiredSpanDays: MIN_HISTORY_SPAN_DAYS,
    openDays,
    closedDays,
    unconfirmedDays: unconfirmedDates.length,
    unconfirmedDates,
    spanOk,
    allAccounted,
    passes: spanOk && allAccounted,
    insufficientReason,
  };
}

// Validates a request to mark dates closed. All-or-nothing: any bad date
// rejects the whole request, with a reason per bad date, so the owner never
// ends up with half a batch saved.
//   saleDates: every date that has daily_sales rows
//   today:     the business's current date ('YYYY-MM-DD', Asia/Manila)
const MAX_CLOSE_BATCH = 500;

function validateClosableDates(dates, { saleDates = [], today, maxBatch = MAX_CLOSE_BATCH } = {}) {
  if (!Array.isArray(dates) || dates.length === 0) {
    return { ok: false, dates: [], errors: [{ date: null, reason: 'Send a non-empty list of dates.' }] };
  }
  if (dates.length > maxBatch) {
    return {
      ok: false,
      dates: [],
      errors: [{ date: null, reason: `Too many dates in one request (${dates.length}). The limit is ${maxBatch}.` }],
    };
  }

  const saleSet = new Set(saleDates.filter(isValidDate));
  const sortedSales = [...saleSet].sort();
  const first = sortedSales[0] || null;
  const last = sortedSales[sortedSales.length - 1] || null;
  const todayN = toDayNumber(today);

  const errors = [];
  const clean = new Set();
  for (const raw of dates) {
    const d = typeof raw === 'string' ? raw.trim() : raw;
    if (!isValidDate(d)) {
      errors.push({ date: raw, reason: 'Not a valid date (use YYYY-MM-DD).' });
      continue;
    }
    if (todayN !== null && toDayNumber(d) > todayN) {
      errors.push({ date: d, reason: 'Future dates cannot be marked closed here.' });
      continue;
    }
    if (!first || d < first || d > last) {
      errors.push({ date: d, reason: 'Outside your sales history.' });
      continue;
    }
    if (saleSet.has(d)) {
      errors.push({ date: d, reason: 'This date has sales, so the store was open.' });
      continue;
    }
    clean.add(d);
  }

  return { ok: errors.length === 0, dates: [...clean].sort(), errors };
}

module.exports = {
  MIN_HISTORY_SPAN_DAYS,
  MAX_CLOSE_BATCH,
  evaluateHistoryGate,
  validateClosableDates,
  isValidDate,
  weekdayOf,
  toDayNumber,
};
