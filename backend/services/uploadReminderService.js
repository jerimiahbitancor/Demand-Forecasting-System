// services/uploadReminderService.js
//
// Reads what utils/uploadReminders.js needs, and sends reminders with a
// dedupe check. Used by jobs/uploadReminderJob.js (04:00 / 07:00) and by
// GET /api/business-days/pending (the Data Management card), so the bell
// and the card always agree on which days are unanswered.
//
// Read-only except for inserting notifications.

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { resolveOperatingDays } = require('../utils/staleDays');
const { fetchAllRows } = require('../utils/fetchAllRows');
const {
  planUploadReminders, findUnresolvedOperatingDays, formatReminderDate, addDays, LOOKBACK_DAYS,
} = require('../utils/uploadReminders');

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TZ = 'Asia/Manila';
// The "Days that need your answer" card on Data Management.
const REMINDER_LINK = '/data-management#days-to-answer';

const todayManila = (now = new Date()) => dayjs(now).tz(PH_TZ).format('YYYY-MM-DD');

async function modelExists(client) {
  const { data, error } = await client.from('model_metrics').select('id').limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function loadOperatingDays(client) {
  const { data, error } = await client.from('business_profile').select('operating_days').limit(1);
  if (error) throw error;
  return resolveOperatingDays(data && data[0] ? data[0].operating_days : null);
}

// Resolved dates (confirmed open OR closed) in [from, to]. Paged.
async function loadResolvedDates(client, from, to) {
  const { data, error } = await fetchAllRows(() => client
    .from('business_days')
    .select('business_date')
    .in('status', ['confirmed_open', 'confirmed_closed'])
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date'));
  if (error) throw error;
  return (data || []).map((r) => String(r.business_date).slice(0, 10));
}

async function loadFirstSaleDate(client) {
  const { data, error } = await client
    .from('daily_sales')
    .select('sale_date')
    .order('sale_date', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data && data[0] ? String(data[0].sale_date).slice(0, 10) : null;
}

// Everything the planner needs for `today` (Asia/Manila).
async function loadReminderInputs(client, today) {
  const from = addDays(today, -LOOKBACK_DAYS);
  const [hasModel, operating, resolvedDates, firstSaleDate] = await Promise.all([
    modelExists(client),
    loadOperatingDays(client),
    loadResolvedDates(client, from, today),
    loadFirstSaleDate(client),
  ]);
  return {
    today,
    modelExists: hasModel,
    operatingDays: operating.days,
    operatingDaysSource: operating.source,
    resolvedDates,
    firstSaleDate,
  };
}

// For the Data Management card. Gated on a trained model, same as the bell
// reminders: before the first training the owner is still loading history,
// and the dashboard's first-use history review is where missing days get
// sorted out. Without the gate a first-time user (no sales yet, so no
// firstSaleDate to start from) saw every operating day of the last 60 days
// listed as "needs your answer".
async function getPendingDays(client, { now = new Date() } = {}) {
  const today = todayManila(now);
  const inputs = await loadReminderInputs(client, today);
  const dates = inputs.modelExists ? findUnresolvedOperatingDays(inputs) : [];
  return {
    today,
    businessDate: addDays(today, -1),
    lookbackDays: LOOKBACK_DAYS,
    operatingDays: [...inputs.operatingDays].sort(),
    operatingDaysSource: inputs.operatingDaysSource,
    modelExists: inputs.modelExists,
    days: dates.map((date) => ({ date, label: formatReminderDate(date) })),
  };
}

// True when a notification with this metadata.key was ever sent to the
// user (read or not). "Never send a key twice."
async function alreadySent(client, userId, key) {
  const { data, error } = await client
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('metadata->>key', key)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Plans the reminders for `slot` and sends each one to every user who has
 * not had that key yet. Returns a summary for the scheduler status.
 * summary.results: one entry per (reminder, user) — { key, userId,
 * duplicate, row } — so the job can look up each email's outcome.
 */
async function sendUploadReminders(client, createNotification, { slot, now = new Date() }) {
  const today = todayManila(now);
  const inputs = await loadReminderInputs(client, today);
  const reminders = planUploadReminders({ ...inputs, slot, link: REMINDER_LINK });
  const summary = {
    today, slot, modelExists: inputs.modelExists, planned: reminders.map((r) => r.key), sent: 0, duplicates: 0,
    results: [],
  };
  if (reminders.length === 0) return summary;

  // Same "notify every row in `user`" loop as refreshLowStockNotifications.
  const { data: users, error } = await client.from('user').select('id');
  if (error) throw error;

  for (const user of users || []) {
    for (const reminder of reminders) {
      if (await alreadySent(client, user.id, reminder.key)) {
        summary.duplicates += 1;
        summary.results.push({ key: reminder.key, userId: user.id, duplicate: true, row: null });
        continue;
      }
      const created = await createNotification({
        userId: user.id,
        type: reminder.type,
        title: reminder.title,
        message: reminder.message,
        link: reminder.link,
        metadata: reminder.metadata,
      });
      if (created) summary.sent += 1;
      summary.results.push({ key: reminder.key, userId: user.id, duplicate: false, row: created || null });
    }
  }
  return summary;
}

module.exports = {
  getPendingDays,
  sendUploadReminders,
  loadReminderInputs,
  todayManila,
  REMINDER_LINK,
  PH_TZ,
};
