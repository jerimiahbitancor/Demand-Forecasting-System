// frontend/src/features/datamanagement/components/ConfirmDeleteModal.jsx
import { useRef, useEffect } from "react";
import { FiAlertTriangle, FiTrash2 } from "react-icons/fi";
import "./ConfirmDeleteModal.css";

const ConfirmDeleteModal = ({ productName, onCancel, onConfirm }) => {
  const cancelRef = useRef(null);

  // Cancel gets initial focus so an accidental Enter press doesn't delete.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Escape cancels — a confirmation dialog is safe to dismiss this way,
  // unlike the add/edit form modal where an accidental Escape could
  // discard unsaved work.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-delete-overlay" onClick={onCancel}>
      <div
        className="confirm-delete-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-delete-icon">
          <FiAlertTriangle size={26} />
        </div>

        <h3 id="confirm-delete-title" className="confirm-delete-title">
          Delete {productName}?
        </h3>

        <p className="confirm-delete-body">
          This permanently removes its historical sales data and forecasting
          models. This can&rsquo;t be undone.
        </p>

        <div className="confirm-delete-actions">
          <button ref={cancelRef} className="confirm-delete-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm-delete-confirm" onClick={onConfirm}>
            <FiTrash2 size={16} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;