import { FaTimes } from 'react-icons/fa';
import './UploadStockShortfallSummary.css';

const formatAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { maximumFractionDigits: 3 })
    : '0';
};

const amountWithUnit = (value, unit) => [formatAmount(value), unit].filter(Boolean).join(' ');

const UploadStockShortfallSummary = ({ notification, onClose }) => {
  const metadata = notification?.metadata || {};
  const shortfalls = Array.isArray(metadata.shortfalls) ? metadata.shortfalls : [];

  return (
    <div className="upload-shortfall-overlay" onClick={onClose}>
      <section
        className="upload-shortfall-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-shortfall-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="upload-shortfall-header">
          <div>
            <h2 id="upload-shortfall-title">{notification.title || 'File not saved: not enough stock'}</h2>
            {metadata.filename && <p>{metadata.filename}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close upload summary">
            <FaTimes />
          </button>
        </header>

        <p className="upload-shortfall-message">{notification.message}</p>

        {shortfalls.length > 0 ? (
          <div className="upload-shortfall-table-wrap">
            <table className="upload-shortfall-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Needed</th>
                  <th>In stock</th>
                  <th>Short</th>
                </tr>
              </thead>
              <tbody>
                {shortfalls.map((item, index) => (
                  <tr key={`${item.ingredientId ?? item.ingredient_id ?? item.name}-${index}`}>
                    <td>{item.name || 'Ingredient'}</td>
                    <td>{amountWithUnit(item.required, item.unit)}</td>
                    <td>{amountWithUnit(item.available, item.unit)}</td>
                    <td>{amountWithUnit(item.shortfall, item.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="upload-shortfall-empty">No ingredient details were included in this notification.</p>
        )}
      </section>
    </div>
  );
};

export default UploadStockShortfallSummary;
