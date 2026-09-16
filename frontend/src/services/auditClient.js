// frontend/src/services/auditClient.js
// Best-effort client-side audit writer used by actions that happen in the
// browser (analytics report generation, etc.) so they still appear in the
// audit trail. Failures are swallowed — logging must never block the action.
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const getAuthToken = () => sessionStorage.getItem('access_token') || localStorage.getItem('token');

export function formatAuditDateRange(dateRange) {
  if (!Array.isArray(dateRange) || !dateRange[0] || !dateRange[1]) return '';
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${dateRange[0].toLocaleDateString('en-US', opts)} \u2013 ${dateRange[1].toLocaleDateString('en-US', opts)}`;
}

export async function logAuditEvent(action_type, details) {
  try {
    const token = getAuthToken();
    await axios.post(
      `${API_URL}/audit/log`,
      { action_type, details },
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );
  } catch {
    // best-effort only
  }
}