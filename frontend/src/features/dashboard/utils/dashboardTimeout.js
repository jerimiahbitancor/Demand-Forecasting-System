// utils/dashboardTimeout.js
//
// Dashboard requests wait longer than the shared client's 15 s default: a
// Render cold start takes about 60 s, and the dashboard's requests are often
// the first ones after the backend wakes. Passed per request only; the
// apiClient default stays 15 s.
export const DASHBOARD_TIMEOUT_MS = 75000;
