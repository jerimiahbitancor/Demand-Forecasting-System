// services/apiClient.js
//
// One shared HTTP client for the backend API.
//
// - Adds the login token (same lookup the dashboard used before).
// - Adds an X-Request-ID to every request. The backend echoes it and
//   writes it in its logs, so a "Ref: xxxxxxxx" on screen can be found
//   in the server logs.
// - On failure, attaches `error.apiError` (see utils/apiError.js) and
//   re-throws. No retries, no redirects, no toasts: callers decide.

import axios from 'axios';
import { makeRequestId, toApiError } from '../utils/apiError';
import { API_URL, API_BASE_ERROR } from '../config/apiBase';

export { API_URL };

const REQUEST_ID_HEADER = 'X-Request-ID';

function getAuthToken() {
  try {
    return sessionStorage.getItem('access_token') || localStorage.getItem('token');
  } catch {
    return null;
  }
}

const apiClient = axios.create({
  baseURL: API_URL || undefined,
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  // Deployed build with no VITE_API_URL: refuse instead of calling
  // localhost (see config/resolveApiBase.js).
  if (!API_URL) {
    throw Object.assign(new Error(API_BASE_ERROR), { code: 'API_URL_MISSING', config });
  }
  const token = getAuthToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  if (!config.headers.get(REQUEST_ID_HEADER)) {
    config.headers.set(REQUEST_ID_HEADER, makeRequestId());
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const sentRequestId = error?.config?.headers?.get?.(REQUEST_ID_HEADER) || null;
    error.apiError = toApiError(error, sentRequestId);
    return Promise.reject(error);
  }
);

export default apiClient;
