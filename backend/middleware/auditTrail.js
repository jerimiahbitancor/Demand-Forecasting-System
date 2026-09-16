
const { logAction } = require('../services/auditService');

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

const METHOD_VERBS = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'adjust',
  DELETE: 'delete'
};

const resolveActionType = (req) => {
  const path = (req.path || '/').split('?')[0];
  const verb = METHOD_VERBS[req.method] || req.method.toLowerCase();
  const readable = path
    .replace(/^\/api\//, '')
    .split('/')
    .filter((segment) => segment && !/^\d+$/.test(segment))
    .join('_');

  if (!readable) return `${verb}_request`;
  return `${verb}_${readable}`;
};

const summarize = (req) => {
  try {
    const body = { ...(req.body || {}) };
    // Never persist credentials in the audit trail.
    delete body.password;
    delete body.confirm_password;
    delete body.current_password;
    delete body.new_password;
    delete body.auth_token;
    delete body.access_token;

    let summary = `${req.method} ${req.originalUrl.split('?')[0]}`;

    const small = JSON.stringify(body);
    if (small && small.length > 2 && small.length < 200) {
      summary += ` — ${small}`;
    }

    if (req.file || (req.files && req.files.length)) {
      summary += ' — file upload';
    }

    return summary.slice(0, 500);
  } catch {
    return `${req.method} ${req.originalUrl.split('?')[0]}`;
  }
};

module.exports = function auditTrail(req, res, next) {
  next();

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;

  const apiPath = (req.originalUrl || req.url || '/').split('?')[0];
  if (RICH_LOG_ROUTES.some((route) => apiPath.startsWith(route))) return;

  res.on('finish', () => {
    if (res.statusCode && res.statusCode >= 400) return;

    logAction(
      resolveActionType(req),
      summarize(req),
      req.user?.name || req.user?.email || null
    );
  });
};