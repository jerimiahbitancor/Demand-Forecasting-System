import { FaTimes, FaUndo } from 'react-icons/fa';
import InventoryModal from '../components/InventoryModal';
import './ProductRestoreModal.css';

const ProductRestoreModal = ({ product, isSubmitting, onConfirm, onClose }) => {
  if (!product) return null;

  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <InventoryModal className="modal-md product-restore-modal" onClose={close}>
      <div className="modal-header inventory-modal-header">
        <h3 className="modal-title">Restore Product</h3>
        <button className="modal-close-btn" onClick={close} aria-label="Close restore dialog">
          <FaTimes />
        </button>
      </div>

      <div className="modal-body inventory-modal-body">
        <div className="confirmation-content">
          <div className="confirmation-icon success">
            <FaUndo size={32} />
          </div>
          <h4>Restore this product?</h4>
          <p>
            You are about to restore <strong>&quot;{product.name || 'Unnamed product'}&quot;</strong>.
            The product will be visible in the active product list again.
          </p>
          <div className="item-details">
            <p><strong>Category:</strong> {product.category || 'N/A'}</p>
            <p><strong>Price:</strong> {product.price == null ? '₱0.00' : `₱${Number(product.price).toFixed(2)}`}</p>
          </div>
        </div>
      </div>

      <div className="modal-footer inventory-modal-footer">
        <button className="btn-secondary" onClick={close} disabled={isSubmitting}>
          Cancel
        </button>
        <button className="btn-primary" onClick={onConfirm} disabled={isSubmitting}>
          {isSubmitting ? 'Restoring...' : <><FaUndo /> Restore Product</>}
        </button>
      </div>
    </InventoryModal>
  );
};

export default ProductRestoreModal;
