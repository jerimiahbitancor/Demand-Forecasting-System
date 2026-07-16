// frontend/src/features/datamanagement/components/ArchiveReasonModal.jsx
import { useEffect, useRef } from "react";
import { FiX, FiAlertTriangle } from "react-icons/fi";

const ArchiveReasonModal = ({ productName, reasons, selectedReason, error, onCancel, onConfirm, onSelectReason }) => {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Archive {productName}?</h3>
          <button className="modal-close" onClick={onCancel} aria-label="Close archive dialog">
            <FiX size={24} />
          </button>
        </div>

        <div className="modal-body">
          <div className="archive-modal-note">
            <FiAlertTriangle size={20} />
            <p>
              Archiving will mark this product as inactive and exclude it from active menu forecasts. You can reactivate it later.
            </p>
          </div>

          <div className="form-group">
            <label>Archive Reason</label>
            <select
              className={error ? 'error' : ''}
              value={selectedReason}
              onChange={(e) => onSelectReason(e.target.value)}
            >
              <option value="">Select a reason</option>
              {reasons.map((reason) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
            {error && <span className="error-text">{error}</span>}
          </div>
        </div>

        <div className="modal-footer">
          <button ref={cancelRef} className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            Confirm Archive
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArchiveReasonModal;
