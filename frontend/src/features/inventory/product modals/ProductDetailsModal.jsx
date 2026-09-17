import { FaArchive, FaEye, FaTimes, FaUndo } from 'react-icons/fa';
import InventoryModal from '../components/InventoryModal';
import './ProductDetailsModal.css';

const ProductDetailsModal = ({
  product,
  computedStatus,
  isArchiving,
  onArchive,
  onRestore,
  onClose,
}) => {
  if (!product) return null;

  const isArchived = computedStatus?.isArchived
    || product.is_archived === true
    || product.status === 'archived'
    || /^archived\b/i.test(product.inactive_reason || '');
  const isActive = computedStatus?.isActive ?? (
    product.status === 'active'
    || (!product.status && product.is_active === true)
  );
  const hasIngredients = Array.isArray(product.product_ingredients) && product.product_ingredients.length > 0;
  const isUnmapped = computedStatus?.isUnmapped ?? !hasIngredients;
  const statusLabel = computedStatus?.label
    || (isArchived
      ? 'ARCHIVED'
      : isActive
        ? 'ACTIVE'
        : product.status === 'new'
          ? 'INACTIVE (NEW)'
          : 'INACTIVE (DISCONTINUED)');
  const classForBadge = (className) => (className && {
    'status-active': 'active',
    'status-archived': 'archived',
    'status-unmapped': 'unmapped',
    'status-low-margin': 'low-margin',
    'status-discontinued': 'discontinued',
    'status-inactive': 'inactive',
    'status-inactive-new': 'inactive-new',
  }[className]) || (
    isArchived ? 'archived' : isUnmapped ? 'unmapped' : isActive ? 'active' : 'inactive'
  );
  const badgeClass = classForBadge(computedStatus?.className);
  const secondaryIndicators = computedStatus?.indicators || [];
  const ingredients = product.product_ingredients || [];
  const totalCogs = ingredients.length === 0 ? null : ingredients.reduce((total, ingredient) => {
    const unitPrice = Number(ingredient.ingredients?.price ?? ingredient.price) || 0;
    const quantity = Number(ingredient.quantity_per_serving ?? ingredient.quantity) || 0;
    return total + unitPrice * quantity;
  }, 0);

  const foodCostPercentage = totalCogs !== null && (product.price || 0) > 0
    ? (totalCogs / product.price) * 100
    : null;

  let forecastNote = 'Excluded from forecasting until activated.';
  if (isActive && hasIngredients) {
    forecastNote = 'Included in forecasting, ingredient demand estimation, automatic stock deduction, and COGS/food cost calculation.';
  } else if (isActive && !hasIngredients) {
    forecastNote = 'Included in forecasting but excluded from ingredient demand estimation, automatic stock deduction, and COGS/food cost calculation until a recipe is added.';
  } else if (isArchived) {
    forecastNote = 'Removed from the active product list. Excluded from forecasting and ingredient demand estimation. Historical data is retained.';
  } else if (!isActive) {
    forecastNote = 'Excluded from forecasting and automatic stock deduction until sales resume or 28 days of sales data are reached.';
  }

  const formatCurrency = (amount) => `₱${amount.toFixed(2)}`;

  return (
    <InventoryModal className="product-details-modal" onClose={onClose}>
      <div className="product-details-header">
        <div>
          <div className="product-details-title-row">
            <h3>{product.name || 'Unnamed product'}</h3>
            <div className="product-details-badges">
              <span className={`product-details-status ${badgeClass}`}>
                {statusLabel}
              </span>
              {secondaryIndicators.map((indicator) => (
                <span
                  key={indicator.key}
                  className={`product-details-status ${classForBadge(indicator.className)}`}
                >
                  {indicator.label}
                </span>
              ))}
            </div>
          </div>
          <p>{product.category || 'Uncategorized'}{product.serving_size_label ? ` | ${product.serving_size_label}` : ''}</p>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{forecastNote}</p>
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
            <strong>{totalCogs === null ? 'N/A' : formatCurrency(totalCogs)}</strong>
          </div>
          <div>
            <span>Food Cost %</span>
            <strong>{foodCostPercentage === null ? 'N/A' : `${foodCostPercentage.toFixed(1)}%`}</strong>
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
