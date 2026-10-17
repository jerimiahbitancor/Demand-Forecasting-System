// Temporary presentation toggle for route guards.
// Set VITE_ENABLE_TEMP_ACCESS_BYPASS=true to allow dashboard/analytics access without the guard.
// Set it to false to restore the normal validation behavior.
export const TEMPORARY_ACCESS_BYPASS = import.meta.env.VITE_ENABLE_TEMP_ACCESS_BYPASS === 'true';

// Dashboard state-preview routes — /dashboard/<state> and /dashboard?state=<state>.
//
// These are a development/QA aid: they let us jump straight to any dashboard
// lifecycle screen for screenshots without having to fabricate real data.
//
// In a production build they are OFF, so a visitor cannot type a URL to force
// their way into a state that does not reflect their actual data. They then
// fall through to the 404 page (or the normal dashboard for the ?state= form).
//
// Turn them on deliberately for a build with VITE_ENABLE_STATE_PREVIEW=true
// (e.g. a staging deploy where screenshots are still being captured).
// Otherwise the flag follows the Vite dev server: on in `npm run dev`,
// off in `npm run build`.
export const STATE_PREVIEW_ENABLED = import.meta.env.VITE_ENABLE_STATE_PREVIEW !== undefined
  ? import.meta.env.VITE_ENABLE_STATE_PREVIEW === 'true'
  : import.meta.env.DEV;
