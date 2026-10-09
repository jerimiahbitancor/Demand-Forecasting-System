// config/apiBase.js
//
// The backend base URL for this build (rule: config/resolveApiBase.js).
// API_URL is null in a deployed build with no VITE_API_URL; apiClient then
// fails every request with API_BASE_ERROR instead of calling localhost.
//
// Only services/apiClient.js uses this so far. About 30 other files still
// have their own `|| 'http://localhost:5000/api'` fallback; they are listed
// in docs/known-gaps.md as follow-up.

import { resolveApiBase } from './resolveApiBase';

const resolved = resolveApiBase({
  DEV: import.meta.env.DEV,
  VITE_API_URL: import.meta.env.VITE_API_URL,
});

export const API_URL = resolved.url;
export const API_BASE_ERROR = resolved.error;

if (API_BASE_ERROR) {
  // One clear line in the browser console, once per page load.
  console.error(API_BASE_ERROR);
}
