// states/ConnectionProblem.jsx
//
// Shown when a check FAILS, so a failure never looks like a business state
// ("No Data", "Insufficient Data", ...).
//
//   mode="full"   — nothing has loaded yet in this visit: a full card with
//                   the reason, a Retry button and the request reference.
//   mode="banner" — data loaded before: a slim yellow bar saying the last
//                   refresh failed and how old the data on screen is.
//                   Floats under the navbar; `inline` puts it in the page flow.
//
// `error` is the object from hooks/usePolling.js (utils/apiError.js shape).

import { useNavigate } from 'react-router-dom';
import { shortRef } from '../../../utils/apiError';
import './statescss/ConnectionProblem.css';

const formatTime = (ms) => (ms
  ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  : '—');

function connectionMessage(error) {
  switch (error?.kind) {
    case 'network':
    case 'timeout':
      return "Can't reach the server right now.";
    case 'server':
      return 'The server had a problem.';
    case 'rate_limited':
      return `Too many requests. Retrying in ${error.retryInSec ?? error.retryAfterSec ?? 60} s.`;
    case 'auth':
      return 'Your session has expired. Please log in again.';
    default:
      return 'The dashboard could not be loaded.';
  }
}

const ConnectionProblem = ({ error, onRetry, mode = 'full', lastSuccessAt = null, lastErrorAt = null, inline = false }) => {
  const navigate = useNavigate();
  const ref = shortRef(error?.requestId);
  const isAuth = error?.kind === 'auth';

  if (mode === 'banner') {
    return (
      <div className={`connection-banner${inline ? ' inline' : ''}`} role="status" aria-live="polite">
        <span className="connection-banner-text">
          Couldn&apos;t refresh at {formatTime(lastErrorAt)} — showing data from {formatTime(lastSuccessAt)}.
          {ref && <span className="connection-ref"> Ref: {ref}</span>}
        </span>
        {onRetry && (
          <button type="button" className="connection-banner-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <main className="connection-problem" role="alert">
      <div className="connection-problem-card">
        <div className={`connection-problem-icon ${isAuth ? 'is-auth' : ''}`} aria-hidden="true">
          {isAuth ? '🔒' : '⚠️'}
        </div>
        <h2 className="connection-problem-title">
          {isAuth ? 'Please log in again' : 'We could not load your dashboard'}
        </h2>
        <p className="connection-problem-message">{connectionMessage(error)}</p>
        <p className="connection-problem-note">
          {isAuth
            ? 'Your data is safe. Log in to continue where you left off.'
            : 'Your data is safe. This screen is not your store status — it only means the check did not finish.'}
        </p>
        <div className="connection-problem-actions">
          {isAuth ? (
            <button type="button" className="connection-btn primary" onClick={() => navigate('/login')}>
              Go to login
            </button>
          ) : null}
          {onRetry && (
            <button type="button" className={`connection-btn ${isAuth ? 'secondary' : 'primary'}`} onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
        {ref && <p className="connection-ref">Ref: {ref}</p>}
      </div>
    </main>
  );
};

export default ConnectionProblem;
