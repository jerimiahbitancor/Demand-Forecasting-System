// components/Inventory.jsx
import { useState } from "react";
import "./Inventory.css";
import { 
  FaPlus, 
  FaSearch, 
  FaEdit, 
  FaTrash, 
  FaEye,
  FaSortAmountDown,
  FaSortAmountUp,
  FaWarehouse,
  FaBoxOpen,
  FaExclamationTriangle,
  FaArrowLeft,
  FaArrowRight,
  FaClock,
  FaHistory,
  FaArchive,
  FaShoppingCart
} from 'react-icons/fa';

const Inventory = () => {
  // ============ STATE ============
  const [inventoryItems, setInventoryItems] = useState([
    { id: 1, date: '2024-01-15', name: 'Tomato Sauce', category: 'Sauces', unit: 'kg', quantity: 50, price: 120.00, batch: 'B001', min_stock: 10 },
    { id: 2, date: '2024-01-15', name: 'Pasta', category: 'Dry Goods', unit: 'kg', quantity: 30, price: 85.00, batch: 'B002', min_stock: 15 },
    { id: 3, date: '2024-01-14', name: 'Chicken Breast', category: 'Meat', unit: 'kg', quantity: 0, price: 250.00, batch: 'B003', min_stock: 20 },
    { id: 4, date: '2024-01-14', name: 'Olive Oil', category: 'Oils', unit: 'L', quantity: 8, price: 350.00, batch: 'B004', min_stock: 5 },
    { id: 5, date: '2024-01-13', name: 'Garlic', category: 'Vegetables', unit: 'kg', quantity: 12, price: 90.00, batch: 'B005', min_stock: 8 },
    { id: 6, date: '2024-01-13', name: 'Cheese', category: 'Dairy', unit: 'kg', quantity: 25, price: 420.00, batch: 'B006', min_stock: 10 },
    { id: 7, date: '2024-01-12', name: 'Bread Flour', category: 'Dry Goods', unit: 'kg', quantity: 45, price: 65.00, batch: 'B007', min_stock: 20 },
    { id: 8, date: '2024-01-12', name: 'Mushrooms', category: 'Vegetables', unit: 'kg', quantity: 5, price: 150.00, batch: 'B008', min_stock: 5 },
  ]);
  
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc");
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);

  // ============ FILTER & SORT ============
  const filteredItems = [...inventoryItems];
  
  // Search filter
  const searchedItems = searchTerm 
    ? filteredItems.filter(item => 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.batch.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : filteredItems;

  // Sort
  const sortedItems = [...searchedItems].sort((a, b) => {
    let aVal = a[sortField] || '';
    let bVal = b[sortField] || '';
    
    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }
    
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // ============ PAGINATION ============
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = sortedItems.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getStockStatus = (item) => {
    if (item.quantity === 0) {
      return { label: 'Out of Stock', className: 'status-out' };
    } else if (item.quantity <= item.min_stock) {
      return { label: 'Low Stock', className: 'status-low' };
    } else {
      return { label: 'In Stock', className: 'status-in' };
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return 'N/A';
    }
  };

  // Calculate stats
  const totalStockValue = inventoryItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
  const lowStockAlerts = inventoryItems.filter(item => item.quantity <= item.min_stock && item.quantity > 0).length;
  const recentBatch = inventoryItems.length > 0 ? '1hr ago' : 'N/A';
  const lastUpdate = inventoryItems.length > 0 ? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A';

  return (
    <div className="inventory-component">
      {/* Stats Cards with Summary Card Style */}
      <div className="inventory-stats-cards">
        <div className="inventory-stat-card">
          <div className="inventory-stat-card-content">
            <p className="inventory-stat-card-label">Total Stock Value</p>
            <p className="inventory-stat-card-value">₱ {totalStockValue.toLocaleString()}</p>
            <p className="inventory-stat-card-change positive">+5% from last month</p>
          </div>
        </div>

        <div className="inventory-stat-card">
          <div className="inventory-stat-card-content">
            <p className="inventory-stat-card-label">Low Stock Alerts</p>
            <p className="inventory-stat-card-value">{lowStockAlerts}</p>
            <p className="inventory-stat-card-change warning-text">Requires immediate attention</p>
          </div>
        </div>

        <div className="inventory-stat-card">
          <div className="inventory-stat-card-content">
            <p className="inventory-stat-card-label">Recent Batches</p>
            <p className="inventory-stat-card-value">{recentBatch}</p>
            <p className="inventory-stat-card-change">{lastUpdate}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="inventory-controls">
        <div className="inventory-search-box">
          <div className="inventory-search-icon" />
          <input
            type="text"
            className="inventory-search-input"
            placeholder="Search product or ingredient..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="inventory-controls-right">
          <select 
            className="inventory-sort-select"
            value={sortField}
            onChange={(e) => handleSort(e.target.value)}
          >
            <option value="date">Sort By: Newest First</option>
            <option value="name">Sort By: Name</option>
            <option value="category">Sort By: Category</option>
            <option value="quantity">Sort By: Quantity</option>
            <option value="price">Sort By: Price</option>
          </select>

          <button 
            className="inventory-btn-add-item"
            onClick={() => alert('Add new item')}
          >
            <FaPlus /> Add New Item
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="inventory-loading-state">
          <div className="inventory-spinner"></div>
          <p>Loading inventory...</p>
        </div>
      ) : inventoryItems.length === 0 ? (
        <div className="inventory-empty-state">
          <FaBoxOpen size={48} />
          <h3>No Inventory Items</h3>
          <p>Get started by adding your first inventory item.</p>
          <button 
            className="inventory-btn-add-item"
            onClick={() => alert('Add new item')}
          >
            <FaPlus /> Add First Item
          </button>
        </div>
      ) : (
        <>
          <div className="inventory-table-responsive">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th onClick={() => handleSort('date')}>
                    Date {sortField === 'date' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th onClick={() => handleSort('name')}>
                    Item Name {sortField === 'name' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th onClick={() => handleSort('category')}>
                    Category {sortField === 'category' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Unit</th>
                  <th onClick={() => handleSort('quantity')}>
                    Quantity {sortField === 'quantity' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th onClick={() => handleSort('price')}>
                    Price {sortField === 'price' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th onClick={() => handleSort('batch')}>
                    Batch {sortField === 'batch' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Stock Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.map((item, index) => {
                  const status = getStockStatus(item);
                  return (
                    <tr key={item.id || index}>
                      <td>{indexOfFirstItem + index + 1}</td>
                      <td>{formatDate(item.date || item.created_at)}</td>
                      <td className="inventory-item-name-cell">
                        <span className="inventory-item-name">{item.name}</span>
                      </td>
                      <td>{item.category}</td>
                      <td>{item.unit || 'pcs'}</td>
                      <td className={
                        item.quantity === 0 ? 'inventory-out-of-stock' : 
                        item.quantity <= item.min_stock ? 'inventory-low-stock' : ''
                      }>
                        {item.quantity}
                      </td>
                      <td>₱ {item.price?.toFixed(2) || '0.00'}</td>
                      <td>{item.batch || 'N/A'}</td>
                      <td>
                        <span className={`inventory-stock-status ${status.className}`}>
                          <span className="inventory-status-dot"></span>
                          {status.label}
                        </span>
                      </td>
                      <td>
                        <div className="inventory-action-buttons">
                          <button 
                            className="inventory-action-btn edit"
                            onClick={() => alert('Edit item: ' + item.name)}
                            title="Edit"
                          >
                            <FaEdit size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn restock"
                            onClick={() => alert('Restock item: ' + item.name)}
                            title="Restock"
                          >
                            <FaShoppingCart size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn history"
                            onClick={() => alert('View history: ' + item.name)}
                            title="View History"
                          >
                            <FaHistory size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn archive"
                            onClick={() => alert('Archive item: ' + item.name)}
                            title="Archive"
                          >
                            <FaArchive size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="inventory-pagination">
              <button 
                className="inventory-pagination-btn"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                <FaArrowLeft /> Previous
              </button>
              
              <div className="inventory-pagination-numbers">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNumber;
                  if (totalPages <= 5) {
                    pageNumber = i + 1;
                  } else if (currentPage <= 3) {
                    pageNumber = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNumber = totalPages - 4 + i;
                  } else {
                    pageNumber = currentPage - 2 + i;
                  }
                  
                  if (pageNumber > 0 && pageNumber <= totalPages) {
                    return (
                      <button
                        key={pageNumber}
                        className={`inventory-pagination-number ${currentPage === pageNumber ? 'active' : ''}`}
                        onClick={() => setCurrentPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    );
                  }
                  return null;
                })}
                
                {totalPages > 5 && currentPage < totalPages - 2 && (
                  <>
                    <span className="inventory-pagination-ellipsis">...</span>
                    <button
                      className="inventory-pagination-number"
                      onClick={() => setCurrentPage(totalPages)}
                    >
                      {totalPages}
                    </button>
                  </>
                )}
              </div>

              <button 
                className="inventory-pagination-btn"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next <FaArrowRight />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Inventory;