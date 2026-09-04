// Usage: <ExpandableModal isOpen={isOpen} onClose={handleClose} title="Sales forecast">{content}</ExpandableModal>

import { FiX } from "react-icons/fi";
import "./ExpandableModal.css";

const ExpandableModal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="expandable-modal-overlay" onClick={onClose}>
      <div
        className="expandable-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expandable-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="expandable-modal-header">
          <h2 id="expandable-modal-title">{title}</h2>
          <button
            type="button"
            className="expandable-modal-close"
            onClick={onClose}
            aria-label="Close expanded view"
          >
            <FiX size={22} />
          </button>
        </div>
        <div className="expandable-modal-body">{children}</div>
      </div>
    </div>
  );
};

export default ExpandableModal;
