import { FaArchive, FaEye, FaTimes, FaUndo } from 'react-icons/fa';
import InventoryModal from '../components/InventoryModal';
import './ProductDetailsModal.css';

const ProductDetailsModal = ({
  product,
  isArchiving,
  onArchive,
  onRestore,
  onClose,
}) => {
  if (!product) return null;

  const isArchived = product.is_active === false;
  const ingredients = product.product_ingredients || [];
  const totalCogs = ingredients.reduce((total, ingredient) => {
    const unitPrice = Number(ingredient.ingredients?.price ?? ingredient.price) || 0;
    const quantity = Number(ingredient.quantity_per_serving ?? ingredient.quantity) || 0;
    return total + unitPrice * quantity;
  }, 0);

  const formatCurrency = (amount) => `₱${amount.toFixed(2)}`;

  return (
    <InventoryModal className="product-details-modal" onClose={onClose}>
      <div className="product-details-header">
        <div>
          <div className="product-details-title-row">
            <h3>{product.name || 'Unnamed product'}</h3>
            <span className={`product-details-status ${isArchived ? 'archived' : 'active'}`}>
              {isArchived ? 'Archived' : 'Active'}
            </span>
          </div>
          <p>{product.category || 'Uncategorized'}{product.serving_size_label ? ` | ${product.serving_size_label}` : ''}</p>
        </div>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close product details">
          <FaTimes />
        </button>
      </div>

      <div className="product-details-body">
        <div className="product-details-summary">
          <div>
            <span>Price</span>
            <strong>{product.price == null ? '₱0.00' : `₱${Number(product.price).toFixed(2)}`}</strong>
          </div>
          <div>
            <span>Ingredients</span>
            <strong>{ingredients.length}</strong>
          </div>
          <div>
            <span>Total COGS</span>
            <strong>{formatCurrency(totalCogs)}</strong>
          </div>
        </div>

        <div className="product-details-section-heading">
          <FaEye />
          <h4>Product Ingredients</h4>
        </div>

        <div className="product-details-table-wrapper">
          <table className="product-details-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Ingredient Name</th>
                <th>Quantity</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.length === 0 ? (
                <tr>
                  <td colSpan="4" className="product-details-empty">No ingredients added yet.</td>
                </tr>
              ) : (
                ingredients.map((ingredient, index) => (
                  <tr key={ingredient.id || ingredient.inventory_item_id || index}>
                    <td>{index + 1}</td>
                    <td>{ingredient.ingredients?.name || ingredient.name || 'Unknown ingredient'}</td>
                    <td>{ingredient.quantity_per_serving ?? ingredient.quantity ?? 0}</td>
                    <td>{ingredient.ingredients?.unit || ingredient.unit || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>

      
    </InventoryModal>
  );
};

export default ProductDetailsModal;
