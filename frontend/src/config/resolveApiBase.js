// config/resolveApiBase.js
//
// Decides which backend URL the app talks to. Pure (no import.meta), so
// plain Node tests can run it; config/apiBase.js feeds it Vite's env.
//
// Rule:
//   - VITE_API_URL set           -> use it.
//   - not set, development (DEV) -> http://localhost:5000/api.
//   - not set, deployed build    -> NO URL and an error message. Never fall
//     back to localhost there: a deployed site calling the visitor's own
//     computer fails in a confusing way (and looks like "the server is down").
//
// Vite bakes VITE_* variables in at BUILD time, so fixing a missing value
// needs a redeploy, not just a settings change.

export const DEV_FALLBACK_API_URL = 'http://localhost:5000/api';

export const MISSING_API_URL_MESSAGE =
  'VITE_API_URL is not set for this build — set it in Vercel for this environment and redeploy';

export function resolveApiBase({ DEV, VITE_API_URL } = {}) {
  const configured = typeof VITE_API_URL === 'string' ? VITE_API_URL.trim() : '';
  if (configured) return { url: configured, error: null };
  if (DEV === true) return { url: DEV_FALLBACK_API_URL, error: null };
  return { url: null, error: MISSING_API_URL_MESSAGE };
}
