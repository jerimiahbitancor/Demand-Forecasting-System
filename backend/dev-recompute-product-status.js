// dev-recompute-product-status.js
//
// DEV ONLY. Existing products.status rows were computed the last time
// reconcileProductActivation() ran (on the most recent upload), using
// whatever real "now" was at that moment. Setting DEV_NOW_OVERRIDE in
// .env changes what productStatusService.js treats as "now" going
// forward, but does NOT retroactively touch rows already written to
// the database — this script forces that recompute so testing against
// a historical data snapshot doesn't require a real upload just to
// pick up the override.
//
// Usage: set DEV_NOW_OVERRIDE=YYYY-MM-DD in backend/.env, then run
//   node dev-recompute-product-status.js
// Refuses to run when NODE_ENV=production or DEV_NOW_OVERRIDE is unset,
// since running this against real, current data is a no-op at best.
require('dotenv').config();
const mappingService = require('./services/mappingService');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run: NODE_ENV=production.');
    process.exit(1);
  }
  if (!process.env.DEV_NOW_OVERRIDE) {
    console.error('❌ DEV_NOW_OVERRIDE is not set in the environment — nothing to recompute against.');
    process.exit(1);
  }

  console.log(`🔧 Recomputing products.status as of DEV_NOW_OVERRIDE=${process.env.DEV_NOW_OVERRIDE}...\n`);
  try {
    const result = await mappingService.reconcileProductActivation();
    console.log(`✅ Done — checked ${result.checked ?? 0} products, updated ${result.updated} row(s).`);
  } catch (error) {
    console.error('❌ Error recomputing product status:', error.message);
    process.exit(1);
  }
}

main();
