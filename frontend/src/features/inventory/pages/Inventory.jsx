// components/Inventory.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "./Inventory.css";
import { 
  FaPlus, 
  FaSearch, 
  FaEdit, 
  FaTrash, 
  FaEye,
  FaSortAmountDown,
  FaSortAmountUp,
  FaBoxOpen,
  FaArrowLeft,
  FaArrowRight,
  FaClock,
  FaHistory,
  FaArchive,
  FaShoppingCart,
  FaTimes,
  FaSave
} from 'react-icons/fa';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from "../../../context/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const Inventory = () => {
  const { getToken } = useAuth();
  
  // ============ STATE ============
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [sortDirection, setSortDirection] = useState("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [totalItems, setTotalItems] = useState(0);
  const [categories, setCategories] = useState([]);
  const [summaryStats, setSummaryStats] = useState({
    totalStockValue: 0,
    totalItems: 0,
    lowStockAlerts: 0,
    outOfStockItems: 0
  });
  
  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs for preventing multiple requests
  const isInitialMount = useRef(true);
  const fetchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    unit: 'kg',
    quantity: '',
    price: '',
    batch: '',
    min_stock: '',
    supplier: '',
    location: '',
    notes: ''
  });

  const [restockData, setRestockData] = useState({
    quantity: '',
    reason: '',
    notes: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // ============ API CLIENT ============
  const apiClient = useMemo(() => {
    const client = axios.create({
      baseURL: API_URL,
      headers: { 
        'Content-Type': 'application/json' 
      },
      timeout: 10000
    });

    // Request interceptor - Add token
    client.interceptors.request.use(
      async (config) => {
        try {
          const token = await getToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          } else {
            console.warn('No token available for request:', config.url);
          }
          return config;
        } catch (error) {
          console.error('Error adding token:', error);
          return config;
        }
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - Handle 401 and 429
    client.interceptors.response.use(
      (response) => response,
      async (error) => {
        // Handle 429 Too Many Requests
        if (error.response?.status === 429) {
          console.warn('Rate limit hit, waiting before retry...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          try {
            const newToken = await getToken();
            if (newToken) {
              const originalRequest = error.config;
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return client(originalRequest);
            }
          } catch (retryError) {
            console.error('Retry failed:', retryError);
          }
        }
        
        if (error.response?.status === 401) {
          console.warn('401 Unauthorized - Attempting to refresh');
          try {
            const newToken = await getToken();
            if (newToken) {
              const originalRequest = error.config;
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return client(originalRequest);
            } else {
              toast.error('Session expired. Please login again.');
              window.location.href = '/login';
            }
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            toast.error('Session expired. Please login again.');
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );

    return client;
  }, [getToken]);

  // ============ FETCH DATA WITH ABORT CONTROLLER ============
  const fetchInventory = useCallback(async () => {
    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      setLoading(true);
      
      const response = await apiClient.get('/inventory/items', {
        params: {
          search: searchTerm || null,
          sortBy: sortField,
          sortOrder: sortDirection,
          page: currentPage,
          limit: itemsPerPage
        },
        signal: abortControllerRef.current.signal
      });

      if (response.data.success) {
        const summary = response.data.summary || {};
        setInventoryItems(response.data.data || []);
        setTotalItems(summary.totalItems ?? response.data.total ?? 0);
        setSummaryStats({
          totalStockValue: summary.totalStockValue ?? 0,
          totalItems: summary.totalItems ?? 0,
          lowStockAlerts: summary.lowStockAlerts ?? 0,
          outOfStockItems: summary.outOfStockItems ?? 0
        });
      }
    } catch (error) {
      // Ignore aborted requests
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        console.log('Request cancelled');
        return;
      }
      
      console.error('Error fetching inventory:', error);
      if (error.response?.status !== 401 && error.response?.status !== 429) {
        toast.error('Failed to load inventory items');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient, searchTerm, sortField, sortDirection, currentPage, itemsPerPage]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await apiClient.get('/categories');
      if (response.data.success) {
        setCategories(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      if (error.response?.status !== 401 && error.response?.status !== 429) {
        toast.error('Failed to load categories');
      }
    }
  }, [apiClient]);

  // Debounced fetch function
  const debouncedFetch = useCallback(() => {
    // Clear existing timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
    
    // Set new timeout
    fetchTimeoutRef.current = setTimeout(() => {
      fetchInventory();
    }, 300);
  }, [fetchInventory]);

  // ============ INITIAL LOAD AND DEPENDENCY CHANGES ============
  useEffect(() => {
    // Only run on mount or when dependencies change
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Initial load with slight delay to prevent rate limiting
      setTimeout(() => {
        fetchInventory();
        fetchCategories();
      }, 100);
    } else {
      // Subsequent loads with debounce
      debouncedFetch();
    }

    // Cleanup
    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchInventory, fetchCategories, debouncedFetch, searchTerm, sortField, sortDirection, currentPage]);

  // ============ CRUD OPERATIONS ============
  const handleAddItem = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    try {
      const response = await apiClient.post('/inventory/items', {
        ...formData,
        quantity: parseFloat(formData.quantity),
        price: parseFloat(formData.price),
        min_stock: parseFloat(formData.min_stock) || 0
      });

      if (response.data.success) {
        toast.success('Item added successfully!');
        resetForm();
        setIsAddModalOpen(false);
        // Wait before fetching to avoid rate limit
        setTimeout(() => fetchInventory(), 500);
        setTimeout(() => fetchCategories(), 500);
      }
    } catch (error) {
      if (error.response?.status === 429) {
        toast.error('Too many requests. Please wait a moment.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to add item');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateItem = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    try {
      const response = await apiClient.put(`/inventory/items/${selectedItem.id}`, {
        ...formData,
        quantity: parseFloat(formData.quantity),
        price: parseFloat(formData.price),
        min_stock: parseFloat(formData.min_stock) || 0
      });

      if (response.data.success) {
        toast.success('Item updated successfully!');
        resetForm();
        setIsEditModalOpen(false);
        setTimeout(() => fetchInventory(), 500);
      }
    } catch (error) {
      if (error.response?.status === 429) {
        toast.error('Too many requests. Please wait a moment.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to update item');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async () => {
    setIsSubmitting(true);
    try {
      const response = await apiClient.delete(`/inventory/items/${selectedItem.id}`);
      if (response.data.success) {
        toast.success('Item deleted successfully!');
        setIsDeleteModalOpen(false);
        setTimeout(() => fetchInventory(), 500);
      }
    } catch (error) {
      if (error.response?.status === 429) {
        toast.error('Too many requests. Please wait a moment.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to delete item');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestock = async () => {
    if (!restockData.quantity || parseFloat(restockData.quantity) <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiClient.post(`/inventory/items/${selectedItem.id}/restock`, {
        quantity: parseFloat(restockData.quantity),
        reason: restockData.reason,
        notes: restockData.notes
      });

      if (response.data.success) {
        toast.success('Item restocked successfully!');
        setRestockData({ quantity: '', reason: '', notes: '' });
        setIsRestockModalOpen(false);
        setTimeout(() => fetchInventory(), 500);
      }
    } catch (error) {
      if (error.response?.status === 429) {
        toast.error('Too many requests. Please wait a moment.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to restock item');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveItem = async () => {
    setIsSubmitting(true);
    try {
      const response = await apiClient.patch(`/inventory/items/${selectedItem.id}/archive`);
      if (response.data.success) {
        toast.success('Item archived successfully!');
        setIsArchiveModalOpen(false);
        setTimeout(() => fetchInventory(), 500);
      }
    } catch (error) {
      if (error.response?.status === 429) {
        toast.error('Too many requests. Please wait a moment.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to archive item');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============ FORM HANDLERS ============
  const validateForm = () => {
    const errors = {};
    
    if (!formData.name || formData.name.trim() === '') {
      errors.name = 'Item name is required';
    }
    
    if (!formData.category || formData.category.trim() === '') {
      errors.category = 'Category is required';
    }
    
    if (!formData.quantity || formData.quantity === '') {
      errors.quantity = 'Quantity is required';
    } else if (isNaN(parseFloat(formData.quantity)) || parseFloat(formData.quantity) < 0) {
      errors.quantity = 'Quantity must be a valid number';
    }
    
    if (!formData.price || formData.price === '') {
      errors.price = 'Price is required';
    } else if (isNaN(parseFloat(formData.price)) || parseFloat(formData.price) < 0) {
      errors.price = 'Price must be a valid number';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      unit: 'kg',
      quantity: '',
      price: '',
      batch: '',
      min_stock: '',
      supplier: '',
      location: '',
      notes: ''
    });
    setFormErrors({});
  };

  const openEditModal = (item) => {
    setSelectedItem(item);
    setFormData({
      name: item.name || '',
      category: item.category || '',
      unit: item.unit || 'kg',
      quantity: item.quantity?.toString() || '',
      price: item.price?.toString() || '',
      batch: item.batch || '',
      min_stock: item.min_stock?.toString() || '',
      supplier: item.supplier || '',
      location: item.location || '',
      notes: item.notes || ''
    });
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (item) => {
    setSelectedItem(item);
    setIsDeleteModalOpen(true);
  };

  const openRestockModal = (item) => {
    setSelectedItem(item);
    setRestockData({ quantity: '', reason: '', notes: '' });
    setIsRestockModalOpen(true);
  };

  const openHistoryModal = (item) => {
    setSelectedItem(item);
    setIsHistoryModalOpen(true);
  };

  const openArchiveModal = (item) => {
    setSelectedItem(item);
    setIsArchiveModalOpen(true);
  };

  const openViewModal = (item) => {
    setSelectedItem(item);
    setIsViewModalOpen(true);
  };

  // ============ UTILITY FUNCTIONS ============
  const getStockStatus = (item) => {
    if (!item) return { label: 'Unknown', className: 'status-unknown' };
    if (item.quantity === 0) {
      return { label: 'Out of Stock', className: 'status-out' };
    } else if (item.quantity <= (item.min_stock || 0)) {
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

  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return '₱ 0.00';
    return `₱ ${parseFloat(amount).toFixed(2)}`;
  };

  // ============ SORT HANDLERS ============
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  // Calculate stats from overall filtered inventory, not the current page
  const totalStockValue = summaryStats.totalStockValue;
  const lowStockAlerts = summaryStats.lowStockAlerts;
  const outOfStockItems = summaryStats.outOfStockItems;

  // Pagination
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  // ============ RENDER ============
  return (
    <div className="inventory-component">
      {/* Stats Cards */}
      <div className="inventory-stats-cards">
        <div className="inventory-stat-card">
          <div className="inventory-stat-card-content">
            <p className="inventory-stat-card-label">All Items Value</p>
            <p className="inventory-stat-card-value">{formatCurrency(totalStockValue)}</p>
            <p className="inventory-stat-card-change positive">All items: {summaryStats.totalItems || inventoryItems.length}</p>
          </div>
        </div>

        <div className="inventory-stat-card warning">
          <div className="inventory-stat-card-content">
            <p className="inventory-stat-card-label">Low Stock Alerts</p>
            <p className="inventory-stat-card-value">{lowStockAlerts}</p>
            <p className="inventory-stat-card-change warning-text">Requires attention</p>
          </div>
        </div>

        <div className="inventory-stat-card danger">
          <div className="inventory-stat-card-content">
            <p className="inventory-stat-card-label">Out of Stock</p>
            <p className="inventory-stat-card-value">{outOfStockItems}</p>
            <p className="inventory-stat-card-change danger-text">Need restock</p>
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
            placeholder="Search by name, category, or batch..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        <div className="inventory-controls-right">
          <select 
            className="inventory-sort-select"
            value={sortField}
            onChange={(e) => handleSort(e.target.value)}
          >
            <option value="created_at">Sort By: Newest</option>
            <option value="name">Sort By: Name</option>
            <option value="category">Sort By: Category</option>
            <option value="quantity">Sort By: Quantity</option>
            <option value="price">Sort By: Price</option>
            <option value="batch">Sort By: Batch</option>
          </select>

          <button 
            className="btn-primary"
            onClick={() => {
              resetForm();
              setIsAddModalOpen(true);
            }}
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
            onClick={() => {
              resetForm();
              setIsAddModalOpen(true);
            }}
          >
            Add First Item
          </button>
        </div>
      ) : (
        <>
          <div className="inventory-table-responsive">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="sortable" onClick={() => handleSort('created_at')}>
                    Date {sortField === 'created_at' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('name')}>
                    Item Name {sortField === 'name' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('category')}>
                    Category {sortField === 'category' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Unit</th>
                  <th className="sortable" onClick={() => handleSort('quantity')}>
                    Quantity {sortField === 'quantity' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('price')}>
                    Price {sortField === 'price' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('batch')}>
                    Batch {sortField === 'batch' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Stock Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((item, index) => {
                  const status = getStockStatus(item);
                  const displayIndex = (currentPage - 1) * itemsPerPage + index + 1;
                  return (
                    <tr key={item.id || index}>
                      <td>{displayIndex}</td>
                      <td>{formatDate(item.created_at)}</td>
                      <td className="inventory-item-name-cell">
                        <span className="inventory-item-name">{item.name || 'Unnamed'}</span>
                      </td>
                      <td><span className="category-badge">{item.category || 'Uncategorized'}</span></td>
                      <td>{item.unit || 'pcs'}</td>
                      <td className={
                        (item.quantity || 0) === 0 ? 'inventory-out-of-stock' : 
                        (item.quantity || 0) <= (item.min_stock || 0) ? 'inventory-low-stock' : ''
                      }>
                        {item.quantity || 0}
                      </td>
                      <td>{formatCurrency(item.price)}</td>
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
                            className="inventory-action-btn view"
                            onClick={() => openViewModal(item)}
                            title="View Details"
                          >
                            <FaEye size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn edit"
                            onClick={() => openEditModal(item)}
                            title="Edit"
                          >
                            <FaEdit size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn restock"
                            onClick={() => openRestockModal(item)}
                            title="Restock"
                          >
                            <FaShoppingCart size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn history"
                            onClick={() => openHistoryModal(item)}
                            title="View History"
                          >
                            <FaHistory size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn archive"
                            onClick={() => openArchiveModal(item)}
                            title="Archive"
                          >
                            <FaArchive size={14} />
                          </button>
                          <button 
                            className="inventory-action-btn delete"
                            onClick={() => openDeleteModal(item)}
                            title="Delete"
                          >
                            <FaTrash size={14} />
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

      {/* ============ ADD MODAL ============ */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) {
            setIsAddModalOpen(false);
            resetForm();
          }
        }}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Add New Inventory Item</h3>
              <button className="modal-close-btn" onClick={() => {
                if (!isSubmitting) {
                  setIsAddModalOpen(false);
                  resetForm();
                }
              }}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Item Name <span className="required-star">*</span></label>
                  <input
                    type="text"
                    className={`form-input ${formErrors.name ? 'error' : ''}`}
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="Enter item name"
                  />
                  {formErrors.name && <span className="form-error">{formErrors.name}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Category <span className="required-star">*</span></label>
                  <select
                    className={`form-input ${formErrors.category ? 'error' : ''}`}
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                  >
                    <option value="">Select Category</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                  {formErrors.category && <span className="form-error">{formErrors.category}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Unit</label>
                  <select
                    className="form-input"
                    value={formData.unit}
                    onChange={(e) => setFormData({...formData, unit: e.target.value})}
                  >
                    <option value="kg">Kilogram (kg)</option>
                    <option value="g">Gram (g)</option>
                    <option value="L">Liter (L)</option>
                    <option value="mL">Milliliter (mL)</option>
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="box">Box</option>
                    <option value="pack">Pack</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Quantity <span className="required-star">*</span></label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.quantity ? 'error' : ''}`}
                    value={formData.quantity}
                    onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                  {formErrors.quantity && <span className="form-error">{formErrors.quantity}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Price per Unit <span className="required-star">*</span></label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.price ? 'error' : ''}`}
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                  {formErrors.price && <span className="form-error">{formErrors.price}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Minimum Stock Level</label>
                  <input
                    type="number"
                    className="form-input"
                    value={formData.min_stock}
                    onChange={(e) => setFormData({...formData, min_stock: e.target.value})}
                    placeholder="0"
                    min="0"
                    step="1"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Batch Number</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.batch}
                    onChange={(e) => setFormData({...formData, batch: e.target.value})}
                    placeholder="Enter batch number"
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => {
                  if (!isSubmitting) {
                    setIsAddModalOpen(false);
                    resetForm();
                  }
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleAddItem}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Adding...' : <> Add Item</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ EDIT MODAL ============ */}
      {isEditModalOpen && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) {
            setIsEditModalOpen(false);
            resetForm();
          }
        }}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Inventory Item</h3>
              <button className="modal-close-btn" onClick={() => {
                if (!isSubmitting) {
                  setIsEditModalOpen(false);
                  resetForm();
                }
              }}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Item Name <span className="required-star">*</span></label>
                  <input
                    type="text"
                    className={`form-input ${formErrors.name ? 'error' : ''}`}
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="Enter item name"
                  />
                  {formErrors.name && <span className="form-error">{formErrors.name}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Category <span className="required-star">*</span></label>
                  <select
                    className={`form-input ${formErrors.category ? 'error' : ''}`}
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                  >
                    <option value="">Select Category</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                  {formErrors.category && <span className="form-error">{formErrors.category}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Unit</label>
                  <select
                    className="form-input"
                    value={formData.unit}
                    onChange={(e) => setFormData({...formData, unit: e.target.value})}
                  >
                    <option value="kg">Kilogram (kg)</option>
                    <option value="g">Gram (g)</option>
                    <option value="L">Liter (L)</option>
                    <option value="mL">Milliliter (mL)</option>
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="box">Box</option>
                    <option value="pack">Pack</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Quantity <span className="required-star">*</span></label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.quantity ? 'error' : ''}`}
                    value={formData.quantity}
                    onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                  {formErrors.quantity && <span className="form-error">{formErrors.quantity}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Price per Unit <span className="required-star">*</span></label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.price ? 'error' : ''}`}
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                  {formErrors.price && <span className="form-error">{formErrors.price}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Minimum Stock Level</label>
                  <input
                    type="number"
                    className="form-input"
                    value={formData.min_stock}
                    onChange={(e) => setFormData({...formData, min_stock: e.target.value})}
                    placeholder="0"
                    min="0"
                    step="1"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Batch Number</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.batch}
                    onChange={(e) => setFormData({...formData, batch: e.target.value})}
                    placeholder="Enter batch number"
                  />
                </div>

                

               
                
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => {
                  if (!isSubmitting) {
                    setIsEditModalOpen(false);
                    resetForm();
                  }
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleUpdateItem}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Updating...' : <><FaSave /> Update Item</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ DELETE MODAL ============ */}
      {isDeleteModalOpen && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) setIsDeleteModalOpen(false);
        }}>
          <div className="modal-content modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Delete Item</h3>
              <button className="modal-close-btn" onClick={() => {
                if (!isSubmitting) setIsDeleteModalOpen(false);
              }}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="confirmation-content">
                <div className="confirmation-icon danger">
                  <FaTrash size={32} />
                </div>
                <h4>Are you sure you want to delete this item?</h4>
                <p>
                  You are about to delete <strong>"{selectedItem?.name}"</strong>. 
                  This action cannot be undone.
                </p>
                <div className="item-details">
                  <p><strong>Category:</strong> {selectedItem?.category || 'N/A'}</p>
                  <p><strong>Quantity:</strong> {selectedItem?.quantity || 0} {selectedItem?.unit || 'pcs'}</p>
                  <p><strong>Price:</strong> {formatCurrency(selectedItem?.price)}</p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                className="btn-danger" 
                onClick={handleDeleteItem}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Deleting...' : <><FaTrash /> Delete Item</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ RESTOCK MODAL ============ */}
      {isRestockModalOpen && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) {
            setIsRestockModalOpen(false);
            setRestockData({ quantity: '', reason: '', notes: '' });
          }
        }}>
          <div className="modal-content modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Restock: {selectedItem?.name}</h3>
              <button className="modal-close-btn" onClick={() => {
                if (!isSubmitting) {
                  setIsRestockModalOpen(false);
                  setRestockData({ quantity: '', reason: '', notes: '' });
                }
              }}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="restock-info">
                <div className="current-stock">
                  <p><strong>Current Stock:</strong> {selectedItem?.quantity || 0} {selectedItem?.unit || 'pcs'}</p>
                  <p><strong>Minimum Level:</strong> {selectedItem?.min_stock || 0} {selectedItem?.unit || 'pcs'}</p>
                </div>
                
                <div className="form-group">
                  <label className="form-label">
                    Quantity to Add <span className="required-star">*</span>
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={restockData.quantity}
                    onChange={(e) => setRestockData({...restockData, quantity: e.target.value})}
                    placeholder="Enter quantity"
                    min="0.01"
                    step="0.01"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Reason</label>
                  <select
                    className="form-input"
                    value={restockData.reason}
                    onChange={(e) => setRestockData({...restockData, reason: e.target.value})}
                  >
                    <option value="">Select reason...</option>
                    <option value="purchase_order">Purchase Order</option>
                    <option value="production">Production</option>
                    <option value="return">Return</option>
                    <option value="adjustment">Stock Adjustment</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-input"
                    value={restockData.notes}
                    onChange={(e) => setRestockData({...restockData, notes: e.target.value})}
                    placeholder="Additional notes"
                    rows={3}
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => {
                  if (!isSubmitting) {
                    setIsRestockModalOpen(false);
                    setRestockData({ quantity: '', reason: '', notes: '' });
                  }
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleRestock}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Processing...' : <><FaShoppingCart /> Restock</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ HISTORY MODAL ============ */}
      {isHistoryModalOpen && (
        <div className="modal-overlay" onClick={() => setIsHistoryModalOpen(false)}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">History: {selectedItem?.name}</h3>
              <button className="modal-close-btn" onClick={() => setIsHistoryModalOpen(false)}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="history-content">
                <div className="item-summary">
                  <p><strong>Current Stock:</strong> {selectedItem?.quantity || 0} {selectedItem?.unit || 'pcs'}</p>
                  <p><strong>Category:</strong> {selectedItem?.category || 'N/A'}</p>
                  <p><strong>Batch:</strong> {selectedItem?.batch || 'N/A'}</p>
                </div>

                <div className="history-timeline">
                  <h4>Transaction History</h4>
                  <div className="timeline-item">
                    <div className="timeline-dot"></div>
                    <div className="timeline-content">
                      <div className="timeline-header">
                        <span className="timeline-date">{formatDate(new Date())}</span>
                        <span className="timeline-type restock">Restock</span>
                      </div>
                      <p>Added 50 units</p>
                      <p className="timeline-note">Purchase Order #PO-2024-001</p>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <div className="timeline-dot"></div>
                    <div className="timeline-content">
                      <div className="timeline-header">
                        <span className="timeline-date">{formatDate(new Date(Date.now() - 86400000))}</span>
                        <span className="timeline-type usage">Usage</span>
                      </div>
                      <p>Used 10 units in production</p>
                      <p className="timeline-note">Batch #B-2024-015</p>
                    </div>
                  </div>
                  <div className="timeline-empty">
                    <FaClock size={32} />
                    <p>Full transaction history will be available here</p>
                  </div>
                </div>
              </div>
            </div>

          
          </div>
        </div>
      )}

      {/* ============ ARCHIVE MODAL ============ */}
      {isArchiveModalOpen && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) setIsArchiveModalOpen(false);
        }}>
          <div className="modal-content modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Archive Item</h3>
              <button className="modal-close-btn" onClick={() => {
                if (!isSubmitting) setIsArchiveModalOpen(false);
              }}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="confirmation-content">
                <div className="confirmation-icon warning">
                  <FaArchive size={32} />
                </div>
                <h4>Archive this item?</h4>
                <p>
                  You are about to archive <strong>"{selectedItem?.name}"</strong>. 
                  Archived items are hidden from the main inventory but can be restored later.
                </p>
                <div className="item-details">
                  <p><strong>Category:</strong> {selectedItem?.category || 'N/A'}</p>
                  <p><strong>Quantity:</strong> {selectedItem?.quantity || 0} {selectedItem?.unit || 'pcs'}</p>
                  <p><strong>Status:</strong> {(selectedItem?.quantity || 0) === 0 ? 'Out of Stock' : 'In Stock'}</p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => setIsArchiveModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                className="btn-warning" 
                onClick={handleArchiveItem}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Archiving...' : <><FaArchive /> Archive Item</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ VIEW MODAL ============ */}
      {isViewModalOpen && (
        <div className="modal-overlay" onClick={() => setIsViewModalOpen(false)}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Item Details</h3>
              <button className="modal-close-btn" onClick={() => setIsViewModalOpen(false)}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              {selectedItem && (
                <div className="view-details">
                  <div className="detail-header">
                    <h3>{selectedItem.name || 'Unnamed'}</h3>
                    <span className={`status-badge ${getStockStatus(selectedItem).className}`}>
                      {getStockStatus(selectedItem).label}
                    </span>
                  </div>

                  <div className="detail-grid">
                    <div className="detail-item">
                      <label>Category</label>
                      <p>{selectedItem.category || 'N/A'}</p>
                    </div>
                    <div className="detail-item">
                      <label>Unit</label>
                      <p>{selectedItem.unit || 'pcs'}</p>
                    </div>
                    <div className="detail-item">
                      <label>Quantity</label>
                      <p className={(selectedItem.quantity || 0) === 0 ? 'danger-text' : ''}>
                        {selectedItem.quantity || 0}
                      </p>
                    </div>
                    <div className="detail-item">
                      <label>Price</label>
                      <p>{formatCurrency(selectedItem.price)}</p>
                    </div>
                    <div className="detail-item">
                      <label>Minimum Stock</label>
                      <p>{selectedItem.min_stock || 0}</p>
                    </div>
                    <div className="detail-item">
                      <label>Batch</label>
                      <p>{selectedItem.batch || 'N/A'}</p>
                    </div>
                  
                    <div className="detail-item full-width">
                      <label>Created</label>
                      <p>{formatDate(selectedItem.created_at)}</p>
                    </div>
                    {selectedItem.updated_at && (
                      <div className="detail-item full-width">
                        <label>Last Updated</label>
                        <p>{formatDate(selectedItem.updated_at)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

          
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;