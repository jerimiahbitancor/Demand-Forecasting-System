import { FaArchive, FaTimes, FaTrash, FaUndo } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import "./InventoryConfirmationModal.css";

const InventoryConfirmationModal = ({
  type,
  item,
  isSubmitting,
  onConfirm,
  onClose,
}) => {
  if (!item) return null;
  const isDelete = type === "delete";
  const isRestore = type === "restore";
  const icon = isDelete ? (
    <FaTrash size={32} />
  ) : isRestore ? (
    <FaUndo size={32} />
  ) : (
    <FaArchive size={32} />
  );
  const title = isDelete
    ? "Delete Item"
    : isRestore
      ? "Restore Item"
      : "Archive Item";
  const action = isDelete ? "Delete" : isRestore ? "Restore" : "Archive";
  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <InventoryModal className="modal-md inventory-confirmation-modal" onClose={close}>
      <div className="modal-header inventory-modal-header">
        <h3 className="modal-title">{title}</h3>
        <button className="modal-close-btn" onClick={close}>
          <FaTimes />
        </button>
      </div>
      <div className="modal-body inventory-modal-body">
        <div className="confirmation-content">
          <div
            className={`confirmation-icon ${isDelete ? "danger" : isRestore ? "success" : "warning"}`}
          >
            {icon}
          </div>
          <h4>
            {isDelete
              ? "Are you sure you want to delete this item?"
              : `${action} this item?`}
          </h4>
          <p>
            You are about to {action.toLowerCase()}{" "}
            <strong>"{item.name}"</strong>.{" "}
            {isDelete
              ? "This action cannot be undone."
              : `The item will be ${isRestore ? "visible in the main inventory again" : "hidden from the main inventory"}.`}
          </p>
          <div className="item-details">
            <p>
              <strong>Category:</strong> {item.category || "N/A"}
            </p>
            <p>
              <strong>Quantity:</strong> {item.quantity || 0}{" "}
              {item.unit || "pcs"}
            </p>
          </div>
        </div>
      </div>
      <div className="modal-footer inventory-modal-footer">
        <button
          className="btn-secondary"
          onClick={close}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          className={
            isDelete ? "btn-danger" : isRestore ? "btn-primary" : "btn-warning"
          }
          onClick={onConfirm}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            `${action}ing...`
          ) : (
            <>
              {icon}
              {action} Item
            </>
          )}
        </button>
      </div>
    </InventoryModal>
  );
};

export default InventoryConfirmationModal;
