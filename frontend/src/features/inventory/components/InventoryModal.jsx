import "./InventoryModal.css";

const InventoryModal = ({ children, className = '', onClose, closeOnOverlay = true }) => (
  <div
    className="inventory-modal-overlay"
    onClick={closeOnOverlay ? onClose : undefined}
  >
    <div
      className={`inventory-modal-content ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  </div>
);

export default InventoryModal;
