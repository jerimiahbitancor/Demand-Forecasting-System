// utils/featureFlags.js
//
// On/off switches read from the environment. Read at call time, not at
// require time, so a test (or a restart with a new value) sees the change.
//
//   SCHEDULERS_ENABLED     the timed jobs: forecasts (9:00 AM), upload
//                          reminders (4:00 / 7:00 AM), the DA price import
//                          and the low-stock refresh. Default: on only when
//                          NODE_ENV=production. A local "npm run dev" points
//                          at the LIVE database, so it must never send
//                          reminders or run forecasts by itself.
//   PRODUCT_MERGE_ENABLED  POST /api/products/:id/merge. Default: off.
//                          merge_products() is live in the database since
//                          Oct 13 2026; merges wait until after the defense.
// See docs/deployment.md.

function envFlag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function schedulersEnabled(env = process.env) {
  return envFlag(env.SCHEDULERS_ENABLED, env.NODE_ENV === 'production');
}

function productMergeEnabled(env = process.env) {
  return envFlag(env.PRODUCT_MERGE_ENABLED, false);
}

module.exports = { envFlag, schedulersEnabled, productMergeEnabled };
