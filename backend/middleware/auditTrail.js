const { logAction } = require('../services/auditService');

// Routes that write their own detailed audit entries (via logAction) and
// therefore should be skipped by the automatic middleware trail.
const RICH_LOG_ROUTES = [
  '/api/inventory/items',
  '/api/market-prices',
  '/api/market-prices/sources',
  '/api/categories',
  '/api/units',
  '/api/product-categories',
  '/api/upload',
  '/api/mapping/products',
  '/api/mapping/market-prices',
  '/api/settings/business-profile',
  '/api/settings/backup',
  '/api/settings/reset-data',
  '/api/auth/sync-user',
  '/api/auth/register',
  '/api/auth/verify-otp',
  '/api/auth/create-password',
  '/api/auth/resend-otp',
  '/api/auth/forgot-password'
];

// Known routes: readable action_type + human description. IDs are captured
// as "#<n>" in the message but never appear as raw URL syntax.
const KNOWN_ACTIONS = [
  { re: /^\/api\/notifications\/clear-all$/, method: 'DELETE', type: 'notification_clear_all', describe: () => 'Cleared all notifications' },
  { re: /^\/api\/notifications\/mark-all-read$/, method: 'PATCH', type: 'notification_mark_all_read', describe: () => 'Marked all notifications as read' },
  { re: /^\/api\/notifications\/mark-all-read$/, method: 'POST', type: 'notification_mark_all_read', describe: () => 'Marked all notifications as read' },
  { re: /^\/api\/notifications\/(\d+)\/read$/, method: 'PATCH', type: 'notification_read', describe: (m) => `Marked notification #${m[1]} as read` },
  { re: /^\/api\/notifications\/(\d+)\/read$/, method: 'POST', type: 'notification_read', describe: (m) => `Marked notification #${m[1]} as read` },
  { re: /^\/api\/notifications\/(\d+)$/, method: 'PATCH', type: 'notification_updated', describe: (m) => `Updated notification #${m[1]}` },
  { re: /^\/api\/notifications\/(\d+)$/, method: 'DELETE', type: 'notification_deleted', describe: (m) => `Deleted notification #${m[1]}` },
  { re: /^\/api\/business-days\/close$/, method: 'POST', type: 'business_day_closed', describe: () => 'Closed the business day' },
  { re: /^\/api\/ml\/train$/, method: 'POST', type: 'ml_training_started', describe: () => 'Started model training' },
  { re: /^\/api\/ml\/forecast$/, method: 'POST', type: 'forecast_generated', describe: () => 'Generated the sales forecast' },
  { re: /^\/api\/settings\/backups\/([^/]+)$/, method: 'DELETE', type: 'backup_deleted', describe: (m) => `Deleted backup "${safeLabel(m[1])}"` },
  { re: /^\/api\/settings\/account\/change-password\/send-code$/, method: 'POST', type: 'password_change_code_sent', describe: () => 'Sent a password change verification code' },
  { re: /^\/api\/settings\/account\/change-password\/verify$/, method: 'POST', type: 'password_changed', describe: () => 'Changed the account password' },
  { re: /^\/api\/settings\/account\/change-password$/, method: 'POST', type: 'password_changed', describe: () => 'Changed the account password' },
  { re: /^\/api\/users\/(\d+)$/, method: 'PUT', type: 'user_updated', describe: (m) => `Updated user account #${m[1]}` },
  { re: /^\/api\/users\/(\d+)$/, method: 'DELETE', type: 'user_deleted', describe: (m) => `Deleted user account #${m[1]}` },
  { re: /^\/api\/mapping\/refresh$/, method: 'POST', type: 'product_cache_refreshed', describe: () => 'Refreshed the product data cache' },
];

// Fallback verbs so unlisted routes still read as English sentences.
const FALLBACK_VERBS = {
  POST: 'Created',
  PUT: 'Updated',
  PATCH: 'Updated',
  DELETE: 'Deleted'
};

function safeLabel(value) {
  try {
    return decodeURIComponent(String(value || '')).slice(0, 100);
  } catch {
    return String(value || '').slice(0, 100);
  }
}

function resolveAction(req) {
  const path = (req.path || '/').split('?')[0];

  for (const { re, method, type, describe } of KNOWN_ACTIONS) {
    if (method && method !== req.method) continue;
    const match = path.match(re);
    if (match) return { type, describe: describe(match) };
  }

  const [type, describe] = genericAction(req.method, path);
  return { type, describe };
}

function genericAction(method, path) {
  const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const resource = (segments[0] || 'record').replace(/[_-]+/g, ' ');
  const id = segments.find((s) => /^\d+$/.test(s));
  const words = segments.slice(1).filter((s) => !/^\d+$/.test(s)).map((s) => s.replace(/[_-]+/g, ' '));

  const type = [
    (method === 'GET' ? method.toLowerCase() : FALLBACK_VERBS[method]?.toLowerCase() || method.toLowerCase()),
    segments.join('_'),
  ].filter(Boolean).join('_');

  const verb = FALLBACK_VERBS[method] || method.toLowerCase();
  let describe;
  if (words.length === 0) {
    describe = `${verb} ${resource}${id ? ` #${id}` : ''}`;
  } else {
    describe = `${verb} ${words.join(' ')} for ${resource}${id ? ` #${id}` : ''}`;
  }
  return [type, describe];
}

module.exports = function auditTrail(req, res, next) {
  next();

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;

  const apiPath = (req.originalUrl || req.url || '/').split('?')[0];
  if (RICH_LOG_ROUTES.some((route) => apiPath.startsWith(route))) return;

  res.on('finish', () => {
    if (res.statusCode && res.statusCode >= 400) return;

    const { type, describe } = resolveAction(req);
    logAction(
      type,
      describe,
      req.user?.name || req.user?.email || null
    );
  });
};