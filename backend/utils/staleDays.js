// utils/staleDays.js
//
// "Is the forecast working from stale data?" counted the useful way:
// how many days the store was EXPECTED to be open, with no upload and no
// "closed" mark, since the last confirmed open day.
//
// Why not forecast_runs.stale_days? ml-service computes it as
// (today - last confirmed OPEN date) - 1, which counts every day in between,
// closed ones included. A normal Sunday off made the dashboard say "Data
// Needs Attention: stale" every Monday. (Production, Oct 6 2026: last open
// Sat Oct 3, run on Tue Oct 6 -> stale_days 2, one of them Sunday.)
//
// A date d counts as MISSING when all of these hold:
//   - lastConfirmedDate < d < today          (Asia/Manila calendar dates)
//   - d's weekday is an operating day        (business_profile.operating_days)
//   - business_days has no confirmed row for d (neither open nor closed)
//
// Weekdays use ml-service's convention: 0 = Monday ... 6 = Sunday (Python's
// date.weekday()). With no configured days it falls back to Mon-Fri, the
// same default as ml-service data_loader.get_operating_days.
//
// Pure: no I/O. Dates are 'YYYY-MM-DD' strings.

const DEFAULT_OPERATING_DAYS = Object.freeze([0, 1, 2, 3, 4]); // Mon-Fri, as ml-service
const MAX_DAYS_SCANNED = 3660; // ~10 years; guards against a bad date looping forever

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible dates such as 2026-02-31.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

const toIso = (date) => date.toISOString().slice(0, 10);

// JS getUTCDay(): 0 = Sunday. ml-service: 0 = Monday.
const mondayFirstWeekday = (date) => (date.getUTCDay() + 6) % 7;

// business_profile.operating_days -> { days: Set<0..6>, source }.
// source is 'configured' when a usable list is stored, otherwise 'default'.
function resolveOperatingDays(stored) {
  if (Array.isArray(stored)) {
    const days = stored.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    // An explicitly stored list is used as is, even if empty (store never
    // open -> nothing is ever missing). Only null/absent falls back.
    if (days.length === stored.length) return { days: new Set(days), source: 'configured' };
  }
  return { days: new Set(DEFAULT_OPERATING_DAYS), source: 'default' };
}

/**
 * @param {object} p
 * @param {string|null} p.lastConfirmedDate  forecast_runs.last_confirmed_date
 * @param {string} p.today                   today in Asia/Manila
 * @param {Set<number>} p.operatingDays      0 = Monday ... 6 = Sunday
 * @param {Iterable<string>} p.recordedDates dates with a confirmed open/closed business_days row
 * @returns {{ missingOperatingDays: number, missingDates: string[] }}
 */
function countMissingOperatingDays({ lastConfirmedDate, today, operatingDays, recordedDates = [] }) {
  const start = parseIsoDate(lastConfirmedDate);
  const end = parseIsoDate(today);
  if (!start || !end) return { missingOperatingDays: 0, missingDates: [] };

  const recorded = new Set(recordedDates);
  const missingDates = [];
  const cursor = new Date(start.getTime());
  for (let i = 0; i < MAX_DAYS_SCANNED; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor >= end) break;
    const iso = toIso(cursor);
    if (operatingDays.has(mondayFirstWeekday(cursor)) && !recorded.has(iso)) missingDates.push(iso);
  }
  return { missingOperatingDays: missingDates.length, missingDates };
}

module.exports = {
  countMissingOperatingDays,
  resolveOperatingDays,
  DEFAULT_OPERATING_DAYS,
};
