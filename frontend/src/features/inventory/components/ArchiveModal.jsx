import { FaArchive, FaTimes, FaBoxes } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import "./ArchiveModal.css";

const ArchiveModal = ({ item, isSubmitting, onConfirm, onClose }) => {
  if (!item) return null;

  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <InventoryModal className="modal-md inventory-archive-modal" onClose={close}>
      {/* Header */}
      <div className="inventory-archive-header">
        <div className="inventory-archive-header-left">
          <div className="inventory-archive-item-row">
                      <p>Do you want to archive <span className="item-name">{item.name || "Unnamed"}</span>?</p>

          </div>
        </div>
        <button className="modal-close-btn" onClick={close}>
          <FaTimes />
        </button>
      </div>

      {/* Body */}
      <div className="inventory-archive-body">
        <div className="inventory-archive-content">
         

          <div className="archive-info-card">
            <span className="archive-info-label">
              <FaBoxes className="archive-info-icon" />
              Current Stock
            </span>
            <span className="archive-info-value">
              {item.quantity || 0} {item.unit || "kg"}
            </span>
          </div>

          <p className="archive-warning-text">
            Archived ingredients are hidden from the active ingredient list. <br />They will not appear in product recipe dropdowns, <br /> ingredient demand estimates, or the shopping list.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="inventory-archive-footer">
        <button className="btn-secondary" onClick={close} disabled={isSubmitting}>
          Cancel
        </button>
        <button className="btn-primary" onClick={onConfirm} disabled={isSubmitting}>
          {isSubmitting ? "Archiving..." : <> Archive Ingredient</>}
        </button>
      </div>
    </InventoryModal>
  );
};

export default ArchiveModal;