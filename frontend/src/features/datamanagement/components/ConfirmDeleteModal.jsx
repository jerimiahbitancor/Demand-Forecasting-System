// frontend/src/features/datamanagement/components/ConfirmDeleteModal.jsx
import { useRef, useEffect } from "react";

const ConfirmDeleteModal = ({ productName, onCancel, onConfirm }) => {
  const cancelRef = useRef(null);

  // Cancel gets initial focus so an accidental Enter press doesn't delete.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Delete Product?</h3>
        </div>
        <div className="modal-body">
          <p>
            Are you sure you want to delete <strong>{productName}</strong>? This will
            permanently remove its historical data and forecasting models.
          </p>
        </div>
        <div className="modal-footer">
          <button ref={cancelRef} className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-destructive" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;