// services/notificationService.js
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { emailRemindersEnabled } = require('../utils/featureFlags');
const { parseAllowedOrigins } = require('../middleware/corsConfig');
const {
  sendEmail, isEmailConfigured, isValidEmail, maskEmail,
} = require('./emailService');

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
  'low_stock',         // low or out of stock (keys low_<id> / out_<id>)
  'restock_summary',   // "N ingredients need attention"
]);
const EMAIL_DEDUPE_MS = 24 * 60 * 60 * 1000;
const EMAIL_FOOTER = 'You get this email because reminders are on. Change the email in Settings > Business Profile.';

const sentEmailKeys = new Map(); // dedupe key -> sent at (ms)
const pendingEmails = new Set(); // in-flight sends (tests wait on these)

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

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
 */
async function emailReminder(notification, {
  client = supabaseAdmin, send = sendEmail, env = process.env, now = new Date(),
} = {}) {
  const kind = notification && notification.metadata && notification.metadata.kind;
  if (!emailRemindersEnabled(env)) return { sent: false, reason: 'disabled' };
  if (!EMAIL_REMINDER_KINDS.includes(kind)) return { sent: false, reason: 'not_a_reminder' };

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
    const email = buildReminderEmail(notification, env);
    await send({ to, subject: email.subject, html: email.html, text: email.text });
    logger.info('reminder_email_sent', { kind, to: maskEmail(to) });
    return { sent: true, reason: null, to: maskEmail(to) };
  } catch (error) {
    sentEmailKeys.delete(key); // let a later reminder try again
    logger.warn('reminder_email_failed', { kind, err: error });
    return { sent: false, reason: 'send_failed' };
  }
}

// Starts emailReminder without waiting for it.
function queueReminderEmail(notification) {
  try {
    const p = emailReminder(notification).catch(() => {});
    pendingEmails.add(p);
    p.finally(() => pendingEmails.delete(p));
  } catch (_) {
    // never let email handling touch the notification flow
  }
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
      console.error('Error creating notification:', error);
      return null;
    }
    if (data) queueReminderEmail(data);
    return data;
  } catch (error) {
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

// Reconcile low-stock / out-of-stock alerts for every user, based on the
// ingredients table (quantity vs min_stock). This is "dynamic" in both
// directions:
//   - new alerts are created for ingredients that just went low,
//   - alerts for ingredients that recovered are automatically marked read,
//   - ingredients that are still low are NOT re-notified (no duplicates).
const refreshLowStockNotifications = async () => {
  try {
    const { data: ingredients, error: ingError } = await supabaseAdmin
      .from('ingredients')
      .select('id, name, quantity, min_stock, unit')
      .eq('is_archived', false);

    if (ingError) throw ingError;

    // Desired alerts: key = `low_<id>` or `out_<id>` (stored in metadata.key so
    // recovered alerts can be matched and retired).
    const desired = {};
    const setDesired = (ingredient, key, title, message) => {
      if (!desired[key]) {
        desired[key] = { ingredientId: ingredient.id, title, message };
      }
    };

    for (const ingredient of ingredients || []) {
      const quantity = Number(ingredient.quantity) || 0;
      const minStock = Number(ingredient.min_stock) || 0;
      const name = ingredient.name || `ingredient #${ingredient.id}`;
      const unit = ingredient.unit || '';

      if (quantity === 0) {
        setDesired(
          ingredient,
          `out_${ingredient.id}`,
          `Out of stock: ${name}`,
          `${name} has 0 units left and needs to be restocked.`
        );
      } else if (quantity <= minStock) {
        setDesired(
          ingredient,
          `low_${ingredient.id}`,
          `Low stock: ${name}`,
          `${name} is down to ${quantity} ${unit} (minimum ${minStock}). Consider restocking soon.`
        );
      }
    }

    const { data: users, error: userError } = await supabaseAdmin
      .from('user')
      .select('id');

    if (userError) throw userError;

    for (const user of users || []) {
      // All of this user's current unread inventory alerts.
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', user.id)
        .eq('type', 'warning')
        .eq('read', false)
        .limit(500);

      if (existingError) throw existingError;

      const missing = new Set(Object.keys(desired));

      for (const notification of existing || []) {
        const key = notification.metadata?.key;
        const kind = notification.metadata?.kind;

        if (kind === 'restock_summary') {
          // Retire the previous aggregate reminder so there is always exactly
          // one fresh "restock alert for N ingredients" per user.
          await supabaseAdmin
            .from('notifications')
            .update({ read: true, updated_at: new Date() })
            .eq('id', notification.id);
          continue;
        }

        if (key && desired[key]) {
          // Still low — leave it unread, don't notify again.
          missing.delete(key);
        } else if (key && (key.startsWith('low_') || key.startsWith('out_'))) {
          // No longer low — retire the alert.
          await supabaseAdmin
            .from('notifications')
            .update({ read: true, updated_at: new Date() })
            .eq('id', notification.id);
        }
      }

      for (const key of missing) {
        const item = desired[key];
        await createNotification({
          userId: user.id,
          type: 'warning',
          title: item.title,
          message: item.message,
          link: '/inventory-management',
          metadata: { kind: 'low_stock', key, ingredient_id: item.ingredientId },
        });
      }

      // Aggregate "Restock reminder for N ingredients" alert.
      const alertCount = Object.keys(desired).length;
      if (alertCount > 0) {
        await createNotification({
          userId: user.id,
          type: 'warning',
          title: `Restock reminder: ${alertCount} ingredient${alertCount > 1 ? 's' : ''} need attention`,
          message: `${alertCount} ingredient(s) are low or out of stock. Open Ingredient Management to restock them.`,
          link: '/inventory-management',
          metadata: { kind: 'restock_summary' },
        });
      }
    }
  } catch (error) {
    console.error('Error refreshing low-stock notifications:', error);
  }
};

module.exports = {
  createNotification,
  createNotificationOnce,
  refreshLowStockNotifications,
  emailReminder,
  sendTestReminderEmail,
  buildReminderEmail,
  emailDedupeKey,
  frontendBaseUrl,
  TestEmailError,
  EMAIL_REMINDER_KINDS,
  // test hooks
  _waitForEmails: () => Promise.all([...pendingEmails]),
  _resetEmailState: () => { sentEmailKeys.clear(); pendingEmails.clear(); },
};