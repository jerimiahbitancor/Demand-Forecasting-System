// utils/uploadReminders.js
//
// Which upload reminders are due right now. Pure: no I/O, no clock — the
// caller passes "today" in Asia/Manila and everything else it read.
//
// Rules (owner's v3 flowchart, page 1):
//   - business_date = YESTERDAY in Asia/Manila. The night runs 3 PM to
//     3 AM, and Loyverse files it under the day it OPENED, so at 04:00 on
//     Sunday the night that just ended is Saturday's.
//   - Only operating days count: business_profile.operating_days,
//     0 = Monday ... 6 = Sunday (utils/staleDays.js resolveOperatingDays).
//   - A date is RESOLVED when business_days has confirmed_open or
//     confirmed_closed for it.
//   - Nothing at all until a model has been trained (model_metrics has a
//     row): before that, the first-use history step on the dashboard is
//     where missing days get sorted out.
//
// Slots:
//   '0400'  business_date unresolved -> "Upload yesterday's sales"
//           + ONE summary of the other unresolved operating days in the
//             last LOOKBACK_DAYS (not business_date, not today)
//   '0700'  business_date still unresolved -> second reminder
//
// Every reminder carries a dedupe key; the job never sends a key twice.

const LOOKBACK_DAYS = 60;
const MAX_DATES_IN_MESSAGE = 10;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // getUTCDay order
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

const toIso = (date) => date.toISOString().slice(0, 10);

function addDays(iso, n) {
  const date = parseIso(iso);
  date.setUTCDate(date.getUTCDate() + n);
  return toIso(date);
}

// JS getUTCDay(): 0 = Sunday. Operating days use 0 = Monday.
const mondayFirstWeekday = (iso) => (parseIso(iso).getUTCDay() + 6) % 7;

// '2026-10-10' -> 'Sat, 10-10-2026'
function formatReminderDate(iso) {
  const date = parseIso(iso);
  const [y, m, d] = iso.split('-');
  return `${WEEKDAY_SHORT[date.getUTCDay()]}, ${d}-${m}-${y}`;
}

/**
 * Unresolved operating days in [today - lookbackDays, today - 1], oldest
 * first. Shared by the reminder job and GET /api/business-days/pending so
 * the bell and the Data Management card always list the same days.
 *
 * firstSaleDate (optional): nothing before it is listed — before the first
 * upload there is no history to answer for.
 */
function findUnresolvedOperatingDays({
  today, operatingDays, resolvedDates = [], firstSaleDate = null, lookbackDays = LOOKBACK_DAYS,
}) {
  if (!parseIso(today)) return [];
  const resolved = new Set(resolvedDates);
  const out = [];
  for (let back = lookbackDays; back >= 1; back -= 1) {
    const iso = addDays(today, -back);
    if (firstSaleDate && iso < firstSaleDate) continue;
    if (!operatingDays.has(mondayFirstWeekday(iso))) continue;
    if (resolved.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

function listDates(dates) {
  const shown = dates.slice(0, MAX_DATES_IN_MESSAGE).map(formatReminderDate).join('; ');
  const more = dates.length - MAX_DATES_IN_MESSAGE;
  return more > 0 ? `${shown}; and ${more} more` : shown;
}

/**
 * @param {object} p
 * @param {string} p.today            Asia/Manila calendar date, 'YYYY-MM-DD'
 * @param {Set<number>} p.operatingDays 0 = Monday ... 6 = Sunday
 * @param {Iterable<string>} p.resolvedDates dates with confirmed_open/confirmed_closed
 * @param {boolean} p.modelExists     model_metrics has at least one row
 * @param {'0400'|'0700'} p.slot
 * @param {string|null} [p.firstSaleDate]
 * @param {string} [p.link]           where the notification sends the owner
 * @returns {Array<{ key, type, title, message, link, metadata }>}
 */
function planUploadReminders({
  today, operatingDays, resolvedDates = [], modelExists, slot,
  firstSaleDate = null, link = null, lookbackDays = LOOKBACK_DAYS,
}) {
  if (!modelExists) return [];
  if (!parseIso(today)) return [];
  if (slot !== '0400' && slot !== '0700') return [];

  const resolved = new Set(resolvedDates);
  const businessDate = addDays(today, -1);
  const businessDateDue = operatingDays.has(mondayFirstWeekday(businessDate))
    && !resolved.has(businessDate)
    && !(firstSaleDate && businessDate < firstSaleDate);
  const label = formatReminderDate(businessDate);
  const reminders = [];

  if (slot === '0400') {
    if (businessDateDue) {
      const key = `upload_reminder:${businessDate}:0400`;
      reminders.push({
        key,
        type: 'warning',
        title: "Upload yesterday's sales",
        message: `Upload sales data for ${label}, or mark the store as closed.`,
        link,
        metadata: { kind: 'upload_reminder', key, business_date: businessDate, slot },
      });
    }

    const others = findUnresolvedOperatingDays({
      today, operatingDays, resolvedDates: resolved, firstSaleDate, lookbackDays,
    }).filter((d) => d !== businessDate);
    if (others.length > 0) {
      const key = `unconfirmed_days:${today}`;
      reminders.push({
        key,
        type: 'warning',
        title: `${others.length} day(s) still need your answer`,
        message: `Sales data for (${listDates(others)}) has not been uploaded. `
          + 'Please upload the sales file or mark the store as closed.',
        link,
        metadata: { kind: 'unconfirmed_days', key, dates: others },
      });
    }
  }

  if (slot === '0700' && businessDateDue) {
    const key = `upload_reminder:${businessDate}:0700`;
    reminders.push({
      key,
      type: 'warning',
      title: "Reminder: upload yesterday's sales",
      message: `Don't forget to upload sales data for ${label} before the forecast at 9:00 AM, `
        + 'or mark the store as closed.',
      link,
      metadata: { kind: 'upload_reminder', key, business_date: businessDate, slot },
    });
  }

  return reminders;
}

module.exports = {
  planUploadReminders,
  findUnresolvedOperatingDays,
  formatReminderDate,
  addDays,
  LOOKBACK_DAYS,
};
