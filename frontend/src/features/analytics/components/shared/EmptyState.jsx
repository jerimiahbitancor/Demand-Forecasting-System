// components/shared/EmptyState.jsx
//
// One "nothing to show here" box for every Analytics section that can be
// empty. It always says WHY it is empty, and can offer one action
// (e.g. "Last 7 days", "Go to Product Management").

import { FiInbox } from "react-icons/fi";
import "./EmptyState.css";

/**
 * @param {string} title - short headline, e.g. "No forecast yet"
 * @param {React.ReactNode} message - one sentence on why it is empty
 * @param {string} [actionLabel] - optional button text
 * @param {() => void} [onAction] - optional button handler
 * @param {React.ReactNode} [icon] - optional icon override
 */
function EmptyState({ title, message, actionLabel, onAction, icon }) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden="true">{icon || <FiInbox size={20} />}</span>
      {title && <p className="empty-state-title">{title}</p>}
      {message && <p className="empty-state-message">{message}</p>}
      {actionLabel && onAction && (
        <button type="button" className="empty-state-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
