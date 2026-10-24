// services/notificationService.js
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { emailRemindersEnabled, schedulersEnabled } = require('../utils/featureFlags');
const { escapeHtml } = require('../utils/escapeHtml');
const { parseAllowedOrigins } = require('../middleware/corsConfig');
const {
  sendEmail, isEmailConfigured, isValidEmail, maskEmail,
} = require('./emailService');
const { buildRestockEmail, restockListFromMetadata, fmtNum, urgentCountsText } = require('./restockEmail');
const { forecastSlotFor, forecastRanSince } = require('../utils/forecastSlot');
const { loadReminderInputs, todayManila } = require('./uploadReminderService');
const { findUnresolvedOperatingDays, addDays } = require('../utils/uploadReminders');
// Required lazily in runStockRefresh: stockAlertService -> analyticsService
// is a heavy require chain that most callers of this file never need.
const loadRestockListLazy = (...args) => require('./stockAlertService').loadRestockList(...args);

// ---------------------------------------------------------------------------
// Email reminders (Oct 14 2026)
//
// After a notification row is saved, a REMINDER (something the owner must act
// on) is also emailed to business_profile.business_email — but only when
// EMAIL_REMINDERS_ENABLED is true (default off; production sets it) and its
// metadata.kind is in EMAIL_REMINDER_KINDS. Status messages (upload done,
// training/forecast results, price imports) never email.
//
// Fire-and-forget: the email never fails or delays the notification insert.
// One email per reminder, not one per user: the jobs write one row per user,
// so emails are de-duplicated in memory for 24 h by metadata.key (or kind +
// title + Manila date when there is no key). The memory resets on restart,
// so a restart can send a reminder again; it never loses one.
// ---------------------------------------------------------------------------

const EMAIL_REMINDER_KINDS = Object.freeze([
  'upload_reminder',   // 4:00 / 7:00 AM: upload yesterday's sales or mark closed
  'unconfirmed_days',  // 4:00 AM summary of other unanswered days
  'stock_shortfall',   // an upload used more of an ingredient than was in stock
                       // (only possible before migration 020 is run)
  'upload_blocked_stock', // a sales upload was refused: not enough stock
                          // (migration 020, Oct 2026)
  'restock_summary',   // the daily restock email (ingredient list); only rows
                       // with metadata.emailed === true are sent, see
                       // runStockRefresh. Per-ingredient 'low_stock' alerts
                       // stay in the bell and are never emailed.
]);
const EMAIL_DEDUPE_MS = 24 * 60 * 60 * 1000;
const EMAIL_FOOTER = 'You get this email because reminders are on. Change the email in Settings > Business Profile.';

const sentEmailKeys = new Map(); // dedupe key -> sent at (ms)
const pendingEmails = new Set(); // in-flight sends (tests wait on these)
// notification id -> promise of emailReminder()'s { sent, reason }, so a job
// can record what happened to each email (jobs/uploadReminderJob.js run log).
// Read once with emailOutcomeOf(); unread entries expire after 10 minutes.
const emailOutcomes = new Map();
const EMAIL_OUTCOME_TTL_MS = 10 * 60 * 1000;

const manilaDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

// Which email this notification is. stock_shortfall keys are per upload, so a
// 288-file history backfill would mean up to 288 emails for one ingredient:
// those are grouped per ingredient per Manila day instead.
function emailDedupeKey(notification, now = new Date()) {
  const md = (notification && notification.metadata) || {};
  if (md.kind === 'stock_shortfall' && md.ingredient_id != null) {
    return `stock_shortfall:${md.ingredient_id}:${manilaDate(now)}`;
  }
  // One "upload refused" email per Manila day, not one per file: a refused
  // 288-file backfill must not send 288 emails. Each file still gets its own
  // bell notification with its own list of short ingredients.
  if (md.kind === 'upload_blocked_stock') {
    return `upload_blocked_stock:${manilaDate(now)}`;
  }
  if (md.kind === 'restock_summary' && md.email_key) return String(md.email_key);
  if (md.key) return String(md.key);
  return `${md.kind}|${notification.title}|${manilaDate(now)}`;
}

// Where "Open ChefDuo" points. FRONTEND_URL if set; otherwise the first
// non-localhost ALLOWED_ORIGINS entry (the deployed frontend), otherwise the
// first entry. No trailing slash.
function frontendBaseUrl(env = process.env) {
  const explicit = (env.FRONTEND_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const origins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const deployed = origins.find((o) => !/localhost|127\.0\.0\.1/.test(o));
  return (deployed || origins[0] || '').replace(/\/+$/, '');
}

function buildReminderEmail({ title, message, link }, env = process.env) {
  const base = frontendBaseUrl(env);
  const url = `${base}${link || ''}` || null;
  const subject = `ChefDuo: ${title}`;
  const text = [message, '', url ? `Open ChefDuo: ${url}` : null, '', EMAIL_FOOTER]
    .filter((line) => line !== null).join('\n');
  const button = url
    ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#8B1538;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open ChefDuo</a></p>`
    : '';
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c2632;line-height:1.5">
<h2 style="color:#8B1538;margin:0 0 12px">${escapeHtml(title)}</h2>
<p>${escapeHtml(message)}</p>
${button}
<p style="font-size:12px;color:#6b7280">${escapeHtml(EMAIL_FOOTER)}</p>
</body></html>`;
  return { subject, html, text, url };
}

async function loadBusinessEmail(client = supabaseAdmin) {
  const { data, error } = await client.from('business_profile').select('business_email').limit(1);
  if (error) throw error;
  const email = data && data[0] ? data[0].business_email : null;
  return typeof email === 'string' ? email.trim() : null;
}

/**
 * Emails one reminder notification, if it should be. Never throws.
 * Returns { sent, reason, to } (`to` masked) — for logs and tests.
 *
 * 'disabled', 'not_a_reminder' and 'duplicate' are not logged here: they
 * happen once per notification row, which would flood the log. The job
 * that created the rows logs them once per run instead
 * (jobs/uploadReminderJob.js, reminder_email_skipped).
 */
async function emailReminder(notification, {
  client = supabaseAdmin, send = sendEmail, env = process.env, now = new Date(),
} = {}) {
  const kind = notification && notification.metadata && notification.metadata.kind;
  if (!emailRemindersEnabled(env)) return { sent: false, reason: 'disabled' };
  if (!EMAIL_REMINDER_KINDS.includes(kind)) return { sent: false, reason: 'not_a_reminder' };
  // A restock summary row is emailed only when runStockRefresh chose it
  // (first list of the Manila day, or a NEW out of stock / critical item).
  if (kind === 'restock_summary' && notification.metadata.emailed !== true) {
    return { sent: false, reason: 'not_selected' };
  }

  const key = emailDedupeKey(notification, now);
  const nowMs = now.getTime();
  for (const [k, at] of sentEmailKeys) if (nowMs - at > EMAIL_DEDUPE_MS) sentEmailKeys.delete(k);
  if (sentEmailKeys.has(key)) return { sent: false, reason: 'duplicate' };
  sentEmailKeys.set(key, nowMs); // reserve before any await: two users' rows race here

  try {
    if (!isEmailConfigured(env)) {
      sentEmailKeys.delete(key);
      logger.warn('reminder_email_skipped', { reason: 'email_not_configured', kind });
      return { sent: false, reason: 'not_configured' };
    }
    const to = await loadBusinessEmail(client);
    if (!isValidEmail(to)) {
      sentEmailKeys.delete(key);
      logger.warn('reminder_email_skipped', { reason: to ? 'invalid_business_email' : 'no_business_email', kind, to: to ? maskEmail(to) : null });
      return { sent: false, reason: 'no_business_email' };
    }
    const md = notification.metadata || {};
    const email = kind === 'restock_summary' && Array.isArray(md.items)
      ? buildRestockEmail(restockListFromMetadata(md), { baseUrl: frontendBaseUrl(env) })
      : buildReminderEmail(notification, env);
    await send({ to, subject: email.subject, html: email.html, text: email.text });
    logger.info('reminder_email_sent', { kind, to: maskEmail(to) });
    return { sent: true, reason: null, to: maskEmail(to) };
  } catch (error) {
    sentEmailKeys.delete(key); // let a later reminder try again
    logger.warn('reminder_email_failed', { kind, err: error });
    return { sent: false, reason: 'send_failed' };
  }
}

// Starts emailReminder without waiting for it. emailReminder() never
// throws by design; if it ever does, the error is logged (not swallowed)
// and the notification flow is still untouched.
function queueReminderEmail(notification) {
  try {
    const p = emailReminder(notification).catch((error) => {
      logger.error('reminder_email_failed', { kind: notification?.metadata?.kind, err: error });
      return { sent: false, reason: 'send_failed' };
    });
    pendingEmails.add(p);
    p.finally(() => pendingEmails.delete(p));
    if (notification && notification.id != null) {
      emailOutcomes.set(notification.id, p);
      const timer = setTimeout(() => emailOutcomes.delete(notification.id), EMAIL_OUTCOME_TTL_MS);
      if (timer.unref) timer.unref();
    }
  } catch (error) {
    logger.error('reminder_email_failed', { kind: notification?.metadata?.kind, err: error });
  }
}

// What happened to the email for a notification row createNotification()
// returned: { sent, reason } (reason null when sent). Waits for an email
// still in flight. 'not_queued' when no email was attempted for that row.
async function emailOutcomeOf(row) {
  const p = row && row.id != null ? emailOutcomes.get(row.id) : null;
  if (!p) return { sent: false, reason: 'not_queued' };
  emailOutcomes.delete(row.id);
  return p;
}

class TestEmailError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TestEmailError';
    this.status = status;
  }
}

// POST /api/notifications/test-email: a sample "Upload yesterday's sales"
// email to the business email, sent even when EMAIL_REMINDERS_ENABLED is off
// (the owner asked for it). Not de-duplicated, and writes no notification.
async function sendTestReminderEmail({ client = supabaseAdmin, send = sendEmail, env = process.env, now = new Date() } = {}) {
  if (!isEmailConfigured(env)) throw new TestEmailError('Email is not configured on the server', 503);
  const to = await loadBusinessEmail(client);
  if (!isValidEmail(to)) throw new TestEmailError('No business email in Settings', 400);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [y, m, d] = manilaDate(yesterday).split('-');
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short' }).format(yesterday);
  const email = buildReminderEmail({
    title: "Upload yesterday's sales (test)",
    message: `This is a test. A real reminder would say: Upload sales data for ${weekday}, ${d}-${m}-${y}, or mark the store as closed.`,
    link: '/data-management#days-to-answer',
  }, env);
  await send({ to, subject: email.subject, html: email.html, text: email.text });
  return { sentTo: maskEmail(to) };
}

// Insert a row into the `notifications` table for a specific user.
// Returns the created row, or null if the user is unknown / the insert failed.
// A reminder kind may also be emailed afterwards (see above); that never
// changes what this returns or how long it takes.
const createNotification = async ({ userId, type = 'info', title, message, link = null, metadata = null }) => {
  if (!userId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert([{ user_id: userId, type, title, message, link, metadata }])
      .select()
      .single();
    if (error) {
      // 23505: the reminder key index (migration 012) refused a second
      // copy, e.g. two servers racing. Not an error; nothing to email.
      if (error.code === '23505') {
        logger.info('notification_duplicate_skipped', { kind: metadata && metadata.kind, key: metadata && metadata.key });
        return null;
      }
      console.error('Error creating notification:', error);
      return null;
    }
    if (data) queueReminderEmail(data);
    return data;
  } catch (error) {
    if (error && error.code === '23505') {
      logger.info('notification_duplicate_skipped', { kind: metadata && metadata.kind, key: metadata && metadata.key });
      return null;
    }
    console.error('Error creating notification:', error);
    return null;
  }
};

// createNotification(), but only if this user never got a notification with
// the same metadata.key (read or not). Returns the new row, or null when it
// was already sent or the insert failed. Requires metadata.key.
const createNotificationOnce = async (notification) => {
  const key = notification && notification.metadata && notification.metadata.key;
  if (!notification || !notification.userId || !key) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('id')
      .eq('user_id', notification.userId)
      .eq('metadata->>key', key)
      .limit(1);
    if (error) {
      console.error('Error checking for an existing notification:', error);
      return null;
    }
    if (Array.isArray(data) && data.length > 0) return null;
  } catch (error) {
    console.error('Error checking for an existing notification:', error);
    return null;
  }
  return createNotification(notification);
};

// ---------------------------------------------------------------------------
// Stock alerts + the daily restock email (Oct 17 2026)
//
// Every ingredient's status comes from services/stockAlertService.js, the
// SAME rule as the Ingredient Management page: out of stock (quantity 0),
// Critical (< 50% of the forecast need), Low (< 100%), and for ingredients
// with no forecast need the old rule, quantity <= min_stock.
//
// Bell, per user ("dynamic" both ways, as before):
//   - one alert per ingredient, key out_<id> / critical_<id> / low_<id>
//     (kind 'low_stock'); still-current alerts are not repeated, alerts
//     for ingredients that recovered or changed group are marked read;
//   - one restock_summary row with the whole list in metadata (items,
//     for_date, counts), replacing the previous one.
// Email: at most one restock email per Manila date, decided from the DB
// (key restock_summary:<YYYY-MM-DD>, metadata.emailed) so restarts never
// resend it. The FIRST one of the day waits until today's 9:00 forecast
// has run (forecast_runs, utils/forecastSlot.js); before that only the
// bell is updated. A second one goes out only when a NEW ingredient is out
// of stock or Critical. Per-ingredient alerts are never emailed. If
// yesterday's sales are not uploaded yet, the summary says so.
//
// Runs after every successful forecast (scheduled and manual), after an
// upload's stock deduction, after a restock, a stock edit, a recipe change
// or a safety buffer change, and every 6 hours as a fallback. Overlapping
// calls are merged: one run at a time, plus one more if asked meanwhile.
// ---------------------------------------------------------------------------

const STOCK_ALERT_PREFIXES = ['out_', 'critical_', 'low_'];
const isStockAlertKey = (key) => typeof key === 'string' && STOCK_ALERT_PREFIXES.some((p) => key.startsWith(p));
const qtyText = (value, unit) => (unit ? `${fmtNum(value)} ${unit}` : fmtNum(value));

function stockAlertFor(item, weekday) {
  const { name, unit } = item;
  const needText = item.need != null ? `; ${qtyText(item.need, unit)} needed for ${weekday}` : '';
  if (item.group === 'out') {
    return {
      key: `out_${item.ingredientId}`,
      title: `Out of stock: ${name}`,
      message: item.need != null
        ? `${name} has 0 ${unit || 'units'} left${needText}.`
        : `${name} has 0 ${unit || 'units'} left and needs to be restocked.`,
    };
  }
  if (item.group === 'critical') {
    return {
      key: `critical_${item.ingredientId}`,
      title: `Critical stock: ${name}`,
      message: `${name} is down to ${qtyText(item.stock, unit)}${needText}.`,
    };
  }
  return {
    key: `low_${item.ingredientId}`,
    title: `Low stock: ${name}`,
    message: item.rule === 'min_stock'
      ? `${name} is down to ${qtyText(item.stock, unit)} (minimum ${fmtNum(item.minStock)}). Consider restocking soon.`
      : `${name} is down to ${qtyText(item.stock, unit)}${needText}.`,
  };
}

function summaryCountsText(counts) {
  return [
    counts.out ? `${counts.out} out of stock` : null,
    counts.critical ? `${counts.critical} critical` : null,
    counts.low ? `${counts.low} low` : null,
  ].filter(Boolean).join(', ');
}

/**
 * Should this refresh send the restock email? Read-only.
 * Returns { send, reason, dayKey, emailKey, urgentIds, newUrgentIds }.
 * reason: 'first_today' | 'new_urgent' | 'duplicate' | 'disabled' |
 *         'not_configured' | 'nothing_to_restock' | 'waiting_for_forecast'
 */
async function decideRestockEmail(client, list, { now = new Date(), env = process.env } = {}) {
  const dayKey = `restock_summary:${manilaDate(now)}`;
  const urgentIds = list.items
    .filter((i) => i.group === 'out' || i.group === 'critical')
    .map((i) => i.ingredientId)
    .sort((a, b) => Number(a) - Number(b));
  const base = { send: false, dayKey, emailKey: null, urgentIds, newUrgentIds: [] };
  if (list.items.length === 0) return { ...base, reason: 'nothing_to_restock' };
  if (!emailRemindersEnabled(env)) return { ...base, reason: 'disabled' };
  if (!isEmailConfigured(env)) return { ...base, reason: 'not_configured' };

  const { data, error } = await client
    .from('notifications')
    .select('id, metadata')
    .eq('metadata->>key', dayKey)
    .eq('metadata->>emailed', 'true')
    .limit(500);
  if (error) throw error;
  const sentRows = data || [];
  if (sentRows.length === 0) {
    // The first email of the day waits for today's 9:00 forecast.
    const ran = await forecastRanSince(client, forecastSlotFor(now).slotStart);
    if (!ran) return { ...base, reason: 'waiting_for_forecast' };
    return { ...base, send: true, reason: 'first_today', emailKey: `${dayKey}#1` };
  }

  const known = new Set();
  const emailKeys = new Set();
  for (const row of sentRows) {
    for (const id of (row.metadata && row.metadata.urgent_ids) || []) known.add(String(id));
    if (row.metadata && row.metadata.email_key) emailKeys.add(row.metadata.email_key);
  }
  const newUrgentIds = urgentIds.filter((id) => !known.has(String(id)));
  if (newUrgentIds.length === 0) return { ...base, reason: 'duplicate' };
  return { ...base, send: true, reason: 'new_urgent', emailKey: `${dayKey}#${emailKeys.size + 1}`, newUrgentIds };
}

// Yesterday (Manila), when it is an operating day with no upload and no
// closed mark yet — the stock then does not include that night's sales.
// Same rule as the 4:00 AM upload reminder. null otherwise, or on a read
// failure (the line is a hint; it must not stop the refresh).
async function pendingSalesDate(client, now) {
  try {
    const today = todayManila(now);
    const yesterday = addDays(today, -1);
    const inputs = await loadReminderInputs(client, today);
    return findUnresolvedOperatingDays(inputs).includes(yesterday) ? yesterday : null;
  } catch (error) {
    logger.warn('pending_sales_check_failed', { err: error });
    return null;
  }
}

async function markRead(client, id) {
  await client.from('notifications').update({ read: true, updated_at: new Date() }).eq('id', id);
}

/**
 * One stock refresh. Returns a summary (for logs and tests). Throws on a
 * read failure; refreshLowStockNotifications() catches.
 */
async function runStockRefresh({
  client = supabaseAdmin, now = new Date(), trigger = 'timer', env = process.env,
  loadList = loadRestockListLazy, notify = createNotification, emailOutcome = emailOutcomeOf,
} = {}) {
  const list = await loadList({ client, now });
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long' })
    .format(new Date(`${list.forDate}T12:00:00+08:00`));

  const desired = new Map();
  for (const item of list.items) {
    const alert = stockAlertFor(item, weekday);
    desired.set(alert.key, { ...alert, ingredientId: item.ingredientId, group: item.group });
  }

  const decision = await decideRestockEmail(client, list, { now, env });
  const salesPending = list.items.length > 0 ? await pendingSalesDate(client, now) : null;

  const { data: users, error: userError } = await client.from('user').select('id');
  if (userError) throw userError;

  const result = {
    trigger, forDate: list.forDate, items: list.items.length, counts: list.counts,
    alertsCreated: 0, alertsRetired: 0, summaries: 0, email: { decision: decision.reason, sent: false, outcome: null },
  };
  let emailRow = null;

  for (const [index, user] of (users || []).entries()) {
    const { data: existing, error: existingError } = await client
      .from('notifications')
      .select('id, metadata')
      .eq('user_id', user.id)
      .eq('type', 'warning')
      .eq('read', false)
      .limit(500);
    if (existingError) throw existingError;

    const missing = new Set(desired.keys());
    for (const n of existing || []) {
      const key = n.metadata && n.metadata.key;
      const kind = n.metadata && n.metadata.kind;
      if (kind === 'restock_summary') {
        // Always exactly one fresh summary per user.
        await markRead(client, n.id);
        continue;
      }
      if (key && desired.has(key)) {
        missing.delete(key); // still in the same group: don't notify again
      } else if (isStockAlertKey(key)) {
        await markRead(client, n.id); // recovered, or moved to another group
        result.alertsRetired += 1;
      }
    }

    for (const key of missing) {
      const a = desired.get(key);
      const row = await notify({
        userId: user.id,
        type: 'warning',
        title: a.title,
        message: a.message,
        link: '/inventory-management',
        metadata: { kind: 'low_stock', key, ingredient_id: a.ingredientId, group: a.group },
      });
      if (row) result.alertsCreated += 1;
    }

    if (list.items.length > 0) {
      const n = list.counts.total;
      // Only the first user's row carries the email (one business email).
      const emailed = decision.send && index === 0;
      const urgent = urgentCountsText(list.counts);
      const row = await notify({
        userId: user.id,
        type: 'warning',
        title: `Restock: ${n} ingredient${n === 1 ? '' : 's'}${urgent ? ` (${urgent})` : ''}`,
        message: `${summaryCountsText(list.counts)}. Open the grocery list to see what to buy.`,
        link: '/ingredient-demand',
        metadata: {
          kind: 'restock_summary',
          key: decision.dayKey,
          for_date: list.forDate,
          safety_buffer_pct: list.safetyBufferPct,
          stock_at: list.stockAt,
          counts: list.counts,
          total_est_cost: list.totalEstCost,
          unpriced_count: list.unpricedCount,
          sales_pending_date: salesPending,
          items: list.items,
          urgent_ids: decision.urgentIds,
          emailed,
          email_key: emailed ? decision.emailKey : null,
        },
      });
      if (row) result.summaries += 1;
      if (emailed && row) emailRow = row;
    }
  }

  // The DB says "emailed" only if the email really went out, so a failed
  // or skipped send is tried again by the next refresh.
  if (emailRow) {
    const outcome = await emailOutcome(emailRow);
    result.email.sent = Boolean(outcome && outcome.sent);
    result.email.outcome = outcome && outcome.sent ? 'sent' : (outcome && outcome.reason) || 'failed';
    if (!result.email.sent) {
      await client.from('notifications')
        .update({ metadata: { ...emailRow.metadata, emailed: false, email_key: null } })
        .eq('id', emailRow.id);
    }
  }

  // Once per run, not once per row.
  if (['disabled', 'not_configured', 'duplicate'].includes(decision.reason)) {
    logger[decision.reason === 'duplicate' ? 'info' : 'warn']('reminder_email_skipped', {
      job: 'stockRefresh', trigger, kind: 'restock_summary', reason: decision.reason, items: list.items.length,
    });
  }
  logger.info('stock_refresh_done', result);
  return result;
}

let refreshInFlight = null;
let refreshAgain = null;

// Runs runStockRefresh(); calls that arrive while one runs are merged into
// ONE more run afterwards (a 288-file backfill must not mean 288 runs).
// Never throws; resolves to the last run's summary, or null on failure.
function refreshLowStockNotifications(options = {}) {
  if (refreshInFlight) {
    refreshAgain = options;
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    let current = options;
    let last = null;
    for (;;) {
      try {
        last = await runStockRefresh(current);
      } catch (error) {
        console.error('Error refreshing low-stock notifications:', error);
        last = null;
      }
      if (!refreshAgain) break;
      current = refreshAgain;
      refreshAgain = null;
    }
    return last;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

// Fire-and-forget refresh after a forecast, an upload, a restock, a stock
// edit, a recipe change or a safety buffer change. Only where the timed
// jobs are on: a local server points at the LIVE database and must not
// write alerts or send email by itself.
// NEVER throws and is never awaited by its callers: they call it just
// before sending their own response, so a failure here must not be able
// to turn a saved upload/restock into an error answer.
function queueStockRefresh(trigger, { env = process.env } = {}) {
  try {
    if (!schedulersEnabled(env)) return null;
    return refreshLowStockNotifications({ trigger }).catch(() => null);
  } catch (error) {
    logger.error('stock_refresh_queue_failed', { trigger, err: error });
    return null;
  }
}

module.exports = {
  createNotification,
  createNotificationOnce,
  refreshLowStockNotifications,
  runStockRefresh,
  queueStockRefresh,
  decideRestockEmail,
  stockAlertFor,
  emailReminder,
  emailOutcomeOf,
  sendTestReminderEmail,
  buildReminderEmail,
  emailDedupeKey,
  frontendBaseUrl,
  TestEmailError,
  EMAIL_REMINDER_KINDS,
  // test hooks
  _waitForEmails: () => Promise.all([...pendingEmails]),
  _resetEmailState: () => { sentEmailKeys.clear(); pendingEmails.clear(); emailOutcomes.clear(); },
  _waitForStockRefresh: () => refreshInFlight || Promise.resolve(null),
};