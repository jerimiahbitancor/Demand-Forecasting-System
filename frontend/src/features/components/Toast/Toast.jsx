// frontend/src/components/Toast/Toast.jsx
import "./Toast.css";

const Toast = ({ toast, onDismiss }) => {
  if (!toast) return null;

  return (
    <div className={`toast toast-${toast.type}`} role="status">
      <span>{toast.message}</span>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
};

export default Toast;