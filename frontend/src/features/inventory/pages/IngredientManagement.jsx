// components/Inventory.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "./Inventory.css";
import { 
  FaPlus, 
  FaEdit, 
  FaTrash, 
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
  FaSave,
  FaUndo,
  FaInfoCircle,
} from 'react-icons/fa';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from "../../../context/AuthContext";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import AddIngredientModal from '../components/AddIngredientModal';
import EditIngredientModal from '../components/EditIngredientModal';
import InventoryConfirmationModal from '../components/InventoryConfirmationModal';
import RestockModal from '../components/RestockModal';
import HistoryModal from '../components/HistoryModal';
import ArchiveModal from '../components/ArchiveModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const IngredientManagement = () => {
  const { getToken } = useAuth();
  
  // ============ STATE ============
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [sortDirection, setSortDirection] = useState("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedDate, setSelectedDate] = useState("");
  const [summaryStats, setSummaryStats] = useState({
    totalStockValue: 0,
    totalItems: 0,
    lowStockAlerts: 0,
    outOfStockItems: 0,
    forecastedDeduction: 0,
    excessStock: 0,
    normalStock: 0,
    criticalStock: 0,
    archivedItems: 0
  });
  
  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs for preventing multiple requests
  const isInitialMount = useRef(true);
  const fetchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const legacyModalsEnabled = () => false;

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    unit: 'kg',
    quantity: '',
    price: '',
    batch: '',
    min_stock: '',
    market_price: ''
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

    client.interceptors.request.use(
      async (config) => {
        try {
          const token = await getToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
          return config;
        } catch (error) {
          console.error('Error adding token:', error);
          return config;
        }
      },
      (error) => Promise.reject(error)
    );

    client.interceptors.response.use(
      (response) => response,
      async (error) => {
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
          toast.error('Session expired. Please login again.');
          window.location.assign('/login');
        }
        return Promise.reject(error);
      }
    );

    return client;
  }, [getToken]);

  // ============ GET STOCK STATUS ============
  const getStockStatus = useCallback((item) => {
    if (!item || item.is_archived) {
      return { 
        label: 'Archived', 
        className: 'status-archived',
        color: '#6b7280'
      };
    }
    if (item.quantity === 0) {
      return { 
        label: 'Critical Stock', 
        className: 'status-critical',
        color: '#dc2626'
      };
    } else if (item.quantity <= (item.min_stock || 0) * 0.5) {
      return { 
        label: 'Critical Stock', 
        className: 'status-critical',
        color: '#dc2626'
      };
    } else if (item.quantity <= (item.min_stock || 0)) {
      return { 
        label: 'Low Stock', 
        className: 'status-low',
        color: '#f59e0b'
      };
    } else if (item.quantity >= (item.min_stock || 0) * 3) {
      return { 
        label: 'Excess Stock', 
        className: 'status-excess',
        color: '#3b82f6'
      };
    } else {
      return { 
        label: 'Normal Stock', 
        className: 'status-normal',
        color: '#16a34a'
      };
    }
  }, []);

  // ============ FETCH DATA ============
  const fetchInventory = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      setLoading(true);
      
      const params = {
        search: searchTerm || null,
        sortBy: sortField,
        sortOrder: sortDirection,
        page: currentPage,
        limit: itemsPerPage
      };

      if (selectedCategory !== "All") {
        params.category = selectedCategory;
      }

      if (statusFilter === "archived") {
        params.archived = true;
      } else if (statusFilter !== "All") {
        params.status = statusFilter;
      }

      if (selectedDate) {
        params.date = selectedDate;
      }

      const response = await apiClient.get('/inventory/items', {
        params,
        signal: abortControllerRef.current.signal
      });

      if (response.data.success) {
        const summary = response.data.summary || {};
        const data = response.data.data || [];
        setInventoryItems(data);
        setTotalItems(summary.totalItems ?? response.data.total ?? 0);

        const totalStockValue = summary.totalStockValue ?? 0;
        const forecastedDeduction = totalStockValue * 0.3;

        setSummaryStats({
          totalStockValue: totalStockValue,
          totalItems: summary.totalItems ?? data.length,
          lowStockAlerts: summary.lowStockAlerts ?? 0,
          outOfStockItems: summary.outOfStockItems ?? 0,
          forecastedDeduction: forecastedDeduction,
          excessStock: summary.excessStock ?? 0,
          normalStock: summary.normalStock ?? 0,
          criticalStock: summary.criticalStock ?? 0,
          archivedItems: summary.archivedItems ?? 0
        });
      }
    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        return;
      }
      console.error('Error fetching inventory:', error);
      if (error.response?.status !== 401 && error.response?.status !== 429) {
        toast.error('Failed to load inventory items');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient, searchTerm, sortField, sortDirection, currentPage, itemsPerPage, selectedCategory, statusFilter, selectedDate]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await apiClient.get('/categories');
      if (response.data.success) {
        setCategories(['All', ...(response.data.data || [])]);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, [apiClient]);

  const debouncedFetch = useCallback(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
    fetchTimeoutRef.current = setTimeout(() => {
      fetchInventory();
    }, 300);
  }, [fetchInventory]);

  // ============ INITIAL LOAD ============
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      setTimeout(() => {
        fetchInventory();
        fetchCategories();
      }, 100);
    } else {
      debouncedFetch();
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchInventory, fetchCategories, debouncedFetch, searchTerm, sortField, sortDirection, currentPage, selectedCategory, statusFilter, selectedDate]);

  // ============ CRUD OPERATIONS ============
  const handleAddItem = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    try {
      const response = await apiClient.post('/inventory/items', {
        ...formData,
        quantity: parseFloat(formData.quantity),
        price: parseFloat(formData.price),
        market_price: parseFloat(formData.market_price) || 0,
        min_stock: parseFloat(formData.min_stock) || 0
      });

      if (response.data.success) {
        toast.success('Item added successfully!');
        resetForm();
        setIsAddModalOpen(false);
        setTimeout(() => fetchInventory(), 500);
        setTimeout(() => fetchCategories(), 500);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add item');
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
        market_price: parseFloat(formData.market_price) || 0,
        min_stock: parseFloat(formData.min_stock) || 0
      });

      if (response.data.success) {
        toast.success('Item updated successfully!');
        resetForm();
        setIsEditModalOpen(false);
        setTimeout(() => fetchInventory(), 500);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update item');
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
      toast.error(error.response?.data?.error || 'Failed to delete item');
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
      toast.error(error.response?.data?.error || 'Failed to restock item');
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
      toast.error(error.response?.data?.error || 'Failed to archive item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestoreItem = async () => {
    setIsSubmitting(true);
    try {
      const response = await apiClient.patch(`/inventory/items/${selectedItem.id}/restore`);
      if (response.data.success) {
        toast.success('Item restored successfully!');
        setIsRestoreModalOpen(false);
        setTimeout(() => fetchInventory(), 500);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to restore item');
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
      market_price: ''
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
      market_price: item.market_price?.toString() || ''
    });
    setIsEditModalOpen(true);
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

  const openRestoreModal = (item) => {
    setSelectedItem(item);
    setIsRestoreModalOpen(true);
  };

  // ============ UTILITY FUNCTIONS ============
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

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  // Pagination
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  // ============ STOCK LEGEND ============
  const stockLegend = [
    { label: 'No Forecast', color: '#9ca3af', className: 'legend-no-forecast' },
    { label: 'Archived', color: '#6b7280', className: 'legend-archived' },
    { label: 'Excess Stock', color: '#3b82f6', className: 'legend-excess' },
    { label: 'Normal Stock', color: '#16a34a', className: 'legend-normal' },
    { label: 'Low Stock', color: '#f59e0b', className: 'legend-low' },
    { label: 'Critical Stock', color: '#dc2626', className: 'legend-critical' }
  ];

  // ============ RENDER ============
  return (
    <div className="inventory-component">
      {/* Stats Cards - 4 Cards */}
      <div className="inventory-stats-cards">
        <div className="inventory-stat-card">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Total Stock Value</p>
              <Tippy
                content={(
                  <div className="inventory-card-tooltip">
                    <strong>How Total Stock Value is computed</strong>
                    <span>Each ingredient's current quantity is multiplied by its unit price.</span>
                    <table className="inventory-card-tooltip-table">
                      <thead>
                        <tr>
                          <th>Ingredient</th>
                          <th>You have</th>
                          <th>Price</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr><td>Pork</td><td>8 kg</td><td>₱400/kg</td><td>₱3,200</td></tr>
                        <tr><td>Chicken</td><td>6 kg</td><td>₱220/kg</td><td>₱1,320</td></tr>
                        <tr><td>Rice</td><td>25 kg</td><td>₱52/kg</td><td>₱1,300</td></tr>
                        <tr><td>Garlic, oil, soy sauce...</td><td>Various</td><td>Various</td><td>₱1,220</td></tr>
                        <tr className="inventory-card-tooltip-total"><th>Total</th><th></th><th></th><th>₱7,040</th></tr>
                      </tbody>
                    </table>
                    <table className="inventory-card-tooltip-comparison">
                      <tbody>
                        <tr><th>This Month</th><td>₱7,040</td></tr>
                        <tr><th>Last Month</th><td>₱6,300</td></tr>
                        <tr><th>Change</th><td>+₱740 (+12%)</td></tr>
                      </tbody>
                    </table>
                    <span>Your stock value went up ₱740 (+12%) from last month. This is fine if sales went up too, but if sales stayed the same, you may have bought more ingredients than needed.</span>
                  </div>
                )}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                maxWidth={380}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Total stock value information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value">{formatCurrency(summaryStats.totalStockValue)}</p>
            <p className="inventory-stat-card-change positive">+% from last month</p>
          </div>
        </div>

        <div className="inventory-stat-card">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Total Items</p>
              <Tippy
                content="Total number of active ingredients. Archived ingredients are not counted."
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Total items information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value">{summaryStats.totalItems || inventoryItems.length}</p>
            <p className="inventory-stat-card-change">Active inventory items</p>
          </div>
        </div>

        <div className="inventory-stat-card warning">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Low Stock Alerts</p>
              <Tippy
                content="This counts ingredients that are running low or almost out, where current stock may not cover tomorrow's expected usage. Only ingredients linked to a product recipe are counted. Click to filter the table and see which ingredients need restocking right away."
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                maxWidth={380}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Low stock alerts information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <div className="inventory-stock-alerts-group">
              <span className="alert-badge alert-excess" style={{ backgroundColor: '#3b82f6' }}>
                {summaryStats.excessStock}
              </span>
              <span className="alert-badge alert-normal" style={{ backgroundColor: '#16a34a' }}>
                {summaryStats.normalStock}
              </span>
              <span className="alert-badge alert-low" style={{ backgroundColor: '#f59e0b' }}>
                {summaryStats.lowStockAlerts}
              </span>
              <span className="alert-badge alert-critical" style={{ backgroundColor: '#dc2626' }}>
                {summaryStats.criticalStock}
              </span>
            </div>
            <p className="inventory-stat-card-change">Ingredient Alerts</p>
          </div>
        </div>

        <div className="inventory-stat-card info">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Unmapped Ingredients</p>
              <Tippy
                content="These are ingredients in your inventory that are not connected to a product recipe yet. Because the system does not know which dish uses them, it cannot calculate usage or give them a stock status, so they appear as No Forecast in the table. Go to Product Management and add these ingredients to the recipes of the dishes that use them."
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                maxWidth={380}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Unmapped ingredients information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value">2</p>
            <p className="inventory-stat-card-change">not in any products</p>
          </div>
        </div>
      </div>

      {/* Stock Legend */}
      <div className="inventory-legend-container">
        {stockLegend.map((legend, index) => (
          <div key={index} className="inventory-legend-item">
            <span className="legend-dot" style={{ backgroundColor: legend.color }}></span>
            <span className="legend-label">{legend.label}</span>
          </div>
        ))}
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
            value={selectedCategory}
            aria-label="Filter inventory by category"
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setCurrentPage(1);
            }}
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat === 'All' ? 'All Categories' : cat}</option>
            ))}
          </select>

          <select 
            className="inventory-sort-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="All">All Status</option>
            <option value="Normal Stock">Normal Stock</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Critical Stock">Critical Stock</option>
            <option value="Excess Stock">Excess Stock</option>
            <option value="archived">Archived</option>
          </select>

          <input
            type="date"
            className="inventory-sort-select inventory-date-filter"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Filter inventory by date"
            title="Filter by date"
          />

          <select 
            className="inventory-sort-select"
            value={sortField}
            onChange={(e) => handleSort(e.target.value)}
          >
            <option value="created_at">Sort By: Newest</option>
            <option value="name">Sort By: Name</option>
            <option value="category">Sort By: Category</option>
            <option value="quantity">Sort By: Quantity</option>
            <option value="price">Sort By: Unit Cost</option>
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
                  <th className="sortable" onClick={() => handleSort('name')}>
                    Item Name {sortField === 'name' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Unit</th>
                  <th className="sortable" onClick={() => handleSort('category')}>
                    Category {sortField === 'category' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('quantity')}>
                    Current Stock {sortField === 'quantity' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('price')}>
                    Unit Cost {sortField === 'price' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Market Price</th>
                  <th className="sortable" onClick={() => handleSort('updated_at')}>
                    Last Updated {sortField === 'updated_at' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((item, index) => {
                  const status = getStockStatus(item);
                  const displayIndex = (currentPage - 1) * itemsPerPage + index + 1;
                  const isArchived = item.is_archived;
                  return (
                    <tr key={item.id || index} className={isArchived ? 'archived-row' : ''}>
                      <td>{displayIndex}</td>
                      <td className="inventory-item-name-cell">
                        <span className="inventory-item-name">{item.name || 'Unnamed'}</span>
                      </td>
                      <td>{item.unit || 'pcs'}</td>
                      <td><span className="category-badge">{item.category || 'Uncategorized'}</span></td>
                      <td className={
                        status.className === 'status-critical' ? 'inventory-critical-stock' : 
                        status.className === 'status-low' ? 'inventory-low-stock' : 
                        status.className === 'status-excess' ? 'inventory-excess-stock' : 
                        status.className === 'status-normal' ? 'inventory-normal-stock' : ''
                      }>
                        {item.quantity || 0}
                      </td>
                      <td>{formatCurrency(item.price)}</td>
                      <td>{formatCurrency(item.market_price || item.price)}</td>
                      <td>{formatDate(item.updated_at || item.created_at)}</td>
                      <td>
                        <span className={`inventory-stock-status ${status.className}`}>
                          <span className="inventory-status-dot" style={{ backgroundColor: status.color }}></span>
                          {status.label}
                        </span>
                      </td>
                      <td>
                        <div className="inventory-action-buttons">
                          
                          {!isArchived && (
                            <>
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
                                title="Add Stock"
                              >
                                <FaShoppingCart size={14} />
                              </button>
                            </>
                          )}
                          <button 
                            className="inventory-action-btn history"
                            onClick={() => openHistoryModal(item)}
                            title="View History"
                          >
                            <FaHistory size={14} />
                          </button>
                          {!isArchived ? (
                            <button 
                              className="inventory-action-btn archive"
                              onClick={() => openArchiveModal(item)}
                              title="Archive"
                            >
                              <FaArchive size={14} />
                            </button>
                          ) : (
                            <button 
                              className="inventory-action-btn restore"
                              onClick={() => openRestoreModal(item)}
                              title="Restore"
                            >
                              <FaUndo size={14} />
                            </button>
                          )}
                        
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

      {/* ============ MODALS ============ */}
      <AddIngredientModal
        isOpen={isAddModalOpen}
        isSubmitting={isSubmitting}
        formData={formData}
        formErrors={formErrors}
        categories={categories}
        onChange={setFormData}
        onSubmit={handleAddItem}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
      />
      <EditIngredientModal
        isOpen={isEditModalOpen}
        isSubmitting={isSubmitting}
        formData={formData}
        formErrors={formErrors}
        categories={categories}
        onChange={setFormData}
        onSubmit={handleUpdateItem}
        onClose={() => {
          setIsEditModalOpen(false);
          resetForm();
        }}
      />
      {isDeleteModalOpen && <InventoryConfirmationModal type="delete" item={selectedItem} isSubmitting={isSubmitting} onConfirm={handleDeleteItem} onClose={() => setIsDeleteModalOpen(false)} />}
      {isArchiveModalOpen && <ArchiveModal item={selectedItem} isSubmitting={isSubmitting} onConfirm={handleArchiveItem} onClose={() => setIsArchiveModalOpen(false)} />}
      {isRestoreModalOpen && <InventoryConfirmationModal type="restore" item={selectedItem} isSubmitting={isSubmitting} onConfirm={handleRestoreItem} onClose={() => setIsRestoreModalOpen(false)} />}
      {isRestockModalOpen && <RestockModal item={selectedItem} data={restockData} isSubmitting={isSubmitting} onChange={setRestockData} onSubmit={handleRestock} onClose={() => { setIsRestockModalOpen(false); setRestockData({ quantity: '', reason: '', notes: '' }); }} />}
      {isHistoryModalOpen && <HistoryModal key={selectedItem?.id} item={selectedItem} apiClient={apiClient} onClose={() => setIsHistoryModalOpen(false)} />}

      {legacyModalsEnabled() && <>
      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="modal-overlay1" onClick={() => {
          if (!isSubmitting) {
            setIsAddModalOpen(false);
            resetForm();
          }
        }}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Add New Ingredient</h3>
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
                    {categories.filter(cat => cat !== 'All').map(cat => (
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
                  <label className="form-label">Initial Quantity <span className="required-star">*</span></label>
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
                  <label className="form-label">Unit Cost/Price Per Unit <span className="required-star">*</span></label>
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
                {isSubmitting ? 'Adding...' : <><FaPlus /> Add Item</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
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
                    {categories.filter(cat => cat !== 'All').map(cat => (
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
                  <label className="form-label">Unit Cost <span className="required-star">*</span></label>
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
                  <label className="form-label">Market Price</label>
                  <input
                    type="number"
                    className="form-input"
                    value={formData.market_price}
                    onChange={(e) => setFormData({...formData, market_price: e.target.value})}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
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

      {/* Delete Modal */}
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

      {/* Restock Modal */}
      {isRestockModalOpen && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) {
            setIsRestockModalOpen(false);
            setRestockData({ quantity: '', reason: '', notes: '' });
          }
        }}>
          <div className="modal-content modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Add Stock: {selectedItem?.name}</h3>
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
                {isSubmitting ? 'Processing...' : <><FaShoppingCart /> Add Stock</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
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
                </div>

                <div className="history-timeline">
                  <h4>Transaction History</h4>
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

      {/* Archive Modal */}
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

      {/* Restore Modal */}
      {isRestoreModalOpen && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) setIsRestoreModalOpen(false);
        }}>
          <div className="modal-content modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Restore Item</h3>
              <button className="modal-close-btn" onClick={() => {
                if (!isSubmitting) setIsRestoreModalOpen(false);
              }}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="confirmation-content">
                <div className="confirmation-icon success" style={{ background: '#dcfce7', color: '#16a34a' }}>
                  <FaUndo size={32} />
                </div>
                <h4>Restore this item?</h4>
                <p>
                  You are about to restore <strong>"{selectedItem?.name}"</strong>.
                  The item will be visible in the main inventory again.
                </p>
                <div className="item-details">
                  <p><strong>Category:</strong> {selectedItem?.category || 'N/A'}</p>
                  <p><strong>Quantity:</strong> {selectedItem?.quantity || 0} {selectedItem?.unit || 'pcs'}</p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => setIsRestoreModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleRestoreItem}
                disabled={isSubmitting}
                style={{ background: '#16a34a' }}
              >
                {isSubmitting ? 'Restoring...' : <><FaUndo /> Restore Item</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
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
                      <p>{selectedItem.quantity || 0}</p>
                    </div>
                    <div className="detail-item">
                      <label>Unit Cost</label>
                      <p>{formatCurrency(selectedItem.price)}</p>
                    </div>
                    <div className="detail-item">
                      <label>Market Price</label>
                      <p>{formatCurrency(selectedItem.market_price || selectedItem.price)}</p>
                    </div>
                    <div className="detail-item">
                      <label>Minimum Stock</label>
                      <p>{selectedItem.min_stock || 0}</p>
                    </div>
                    <div className="detail-item">
                      <label>Batch</label>
                      <p>{selectedItem.batch || 'N/A'}</p>
                    </div>
                    <div className="detail-item">
                      <label>Status</label>
                      <p>{selectedItem.is_archived ? 'Archived' : 'Active'}</p>
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
      </>}
    </div>
  );
};

export default IngredientManagement;