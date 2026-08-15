// components/Product.jsx
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import "./Product.css";
import { useAuth } from "../../../context/AuthContext";
import axios from 'axios';
import { 
  FaPlus, 
  FaSearch, 
  FaEdit, 
  FaTrash, 
  FaEye,
  FaSortAmountDown,
  FaSortAmountUp,
  FaClipboardList,
  FaTags,
  FaDollarSign,
  FaCheckCircle,
  FaTimesCircle,
  FaArrowLeft,
  FaArrowRight,
  FaBoxOpen
} from 'react-icons/fa';
import Swal from 'sweetalert2';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const Product = () => {
  const { getToken, isAuthenticated } = useAuth();
  
  // ============ STATE ============
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [categories, setCategories] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  
  // Stats
  const [productStats, setProductStats] = useState({
    total_products: 0,
    active_products: 0,
    inactive_products: 0,
    total_value: 0
  });

  const isMountedRef = useRef(true);

  const apiClient = useMemo(() => {
    const client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      }
    });

    client.interceptors.request.use(
      async (config) => {
        const token = await getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return client;
  }, [getToken]);

  // ============ FUNCTIONS ============
  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/products');
      
      if (response.data.success && isMountedRef.current) {
        const items = response.data.data || [];
        setProducts(items);
        updateStats(items);
        updateCategories(items);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [apiClient]);

  const updateStats = (items) => {
    const total = items.length;
    const active = items.filter(item => item.is_active !== false).length;
    const inactive = items.filter(item => item.is_active === false).length;
    const totalValue = items.reduce((sum, item) => sum + (item.price || 0), 0);
    
    setProductStats({
      total_products: total,
      active_products: active,
      inactive_products: inactive,
      total_value: totalValue
    });
  };

  const updateCategories = (items) => {
    const uniqueCategories = [...new Set(items.map(item => item.category))];
    setCategories(uniqueCategories);
  };

  // ============ CRUD OPERATIONS ============
  const addProduct = async (productData) => {
    try {
      const response = await apiClient.post('/products', productData);
      if (response.data.success) {
        await fetchProducts();
        setShowAddModal(false);
        Swal.fire({
          icon: 'success',
          title: 'Product Added',
          text: 'Product has been added successfully.',
          timer: 1500,
          showConfirmButton: false
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error adding product:', error);
      Swal.fire({
        icon: 'error',
        title: 'Failed to Add Product',
        text: error.response?.data?.message || 'Please try again.'
      });
      return false;
    }
  };

  const updateProduct = async (id, productData) => {
    try {
      const response = await apiClient.put(`/products/${id}`, productData);
      if (response.data.success) {
        await fetchProducts();
        setEditingProduct(null);
        Swal.fire({
          icon: 'success',
          title: 'Product Updated',
          text: 'Product has been updated successfully.',
          timer: 1500,
          showConfirmButton: false
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating product:', error);
      Swal.fire({
        icon: 'error',
        title: 'Failed to Update Product',
        text: error.response?.data?.message || 'Please try again.'
      });
      return false;
    }
  };

  const deleteProduct = async (id, name) => {
    const result = await Swal.fire({
      title: 'Delete Product?',
      text: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#a31d1d',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete it'
    });

    if (!result.isConfirmed) return;

    try {
      const response = await apiClient.delete(`/products/${id}`);
      if (response.data.success) {
        await fetchProducts();
        Swal.fire({
          icon: 'success',
          title: 'Product Deleted',
          text: 'Product has been removed.',
          timer: 1500,
          showConfirmButton: false
        });
      }
    } catch (error) {
      console.error('Error deleting product:', error);
      Swal.fire({
        icon: 'error',
        title: 'Failed to Delete Product',
        text: error.response?.data?.message || 'Please try again.'
      });
    }
  };

  // ============ FILTER & SORT ============
  const filteredProducts = useMemo(() => {
    let items = products;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      items = items.filter(item => 
        item.name?.toLowerCase().includes(term) ||
        item.category?.toLowerCase().includes(term) ||
        (item.sku && item.sku.toLowerCase().includes(term))
      );
    }

    if (filterCategory !== 'all') {
      items = items.filter(item => item.category === filterCategory);
    }

    items = [...items].sort((a, b) => {
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

    return items;
  }, [products, searchTerm, filterCategory, sortField, sortDirection]);

  // ============ PAGINATION ============
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
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

  useEffect(() => {
    isMountedRef.current = true;
    
    if (isAuthenticated) {
      fetchProducts();
    }
    
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchProducts, isAuthenticated]);

  return (
    <div className="product-component">
      {/* Stats Cards */}
      <div className="products-stats">
        <div className="product-stat-card">
          <FaTags className="product-stat-icon" />
          <div>
            <p className="product-stat-label">Total Products</p>
            <p className="product-stat-value">{productStats.total_products}</p>
          </div>
        </div>
        <div className="product-stat-card">
          <FaCheckCircle className="product-stat-icon success" />
          <div>
            <p className="product-stat-label">Active</p>
            <p className="product-stat-value">{productStats.active_products}</p>
          </div>
        </div>
        <div className="product-stat-card">
          <FaTimesCircle className="product-stat-icon danger" />
          <div>
            <p className="product-stat-label">Inactive</p>
            <p className="product-stat-value">{productStats.inactive_products}</p>
          </div>
        </div>
        <div className="product-stat-card">
          <FaDollarSign className="product-stat-icon info" />
          <div>
            <p className="product-stat-label">Total Value</p>
            <p className="product-stat-value">₱ {productStats.total_value.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="inventory-controls">
        <div className="search-box">
          <FaSearch className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="controls-right">
          <select 
            className="sort-select"
            value={sortField}
            onChange={(e) => handleSort(e.target.value)}
          >
            <option value="name">Sort By: Name</option>
            <option value="category">Sort By: Category</option>
            <option value="price">Sort By: Price</option>
            <option value="created_at">Sort By: Date Added</option>
          </select>

          <button 
            className="btn-add-item"
            onClick={() => setShowAddModal(true)}
          >
            <FaPlus /> Add Product
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading products...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <FaBoxOpen size={48} />
          <h3>No Products Found</h3>
          <p>Add and manage your menu items and ingredients here.</p>
          <button 
            className="btn-add-item"
            onClick={() => setShowAddModal(true)}
          >
            <FaPlus /> Add First Product
          </button>
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th onClick={() => handleSort('created_at')}>
                    Date Added {sortField === 'created_at' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th onClick={() => handleSort('name')}>
                    Product Name {sortField === 'name' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th onClick={() => handleSort('category')}>
                    Category {sortField === 'category' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Unit</th>
                  <th>Quantity</th>
                  <th onClick={() => handleSort('price')}>
                    Price {sortField === 'price' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.map((product, index) => (
                  <tr key={product.id || index}>
                    <td>{indexOfFirstItem + index + 1}</td>
                    <td>{formatDate(product.created_at)}</td>
                    <td className="item-name-cell">
                      <span className="item-name">{product.name}</span>
                    </td>
                    <td>{product.category}</td>
                    <td>{product.unit || 'pcs'}</td>
                    <td>{product.quantity || 0}</td>
                    <td>₱ {product.price?.toFixed(2) || '0.00'}</td>
                    <td>
                      <span className={`status-badge ${product.is_active !== false ? 'status-badge-in' : 'status-badge-out'}`}>
                        {product.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button 
                          className="action-btn view"
                          onClick={() => {/* View product details */}}
                          title="View"
                        >
                          <FaEye size={14} />
                        </button>
                        <button 
                          className="action-btn edit"
                          onClick={() => setEditingProduct(product)}
                          title="Edit"
                        >
                          <FaEdit size={14} />
                        </button>
                        <button 
                          className="action-btn delete"
                          onClick={() => deleteProduct(product.id, product.name)}
                          title="Delete"
                        >
                          <FaTrash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                className="pagination-btn"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                <FaArrowLeft /> Previous
              </button>
              
              <div className="pagination-numbers">
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
                        className={`pagination-number ${currentPage === pageNumber ? 'active' : ''}`}
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
                    <span className="pagination-ellipsis">...</span>
                    <button
                      className="pagination-number"
                      onClick={() => setCurrentPage(totalPages)}
                    >
                      {totalPages}
                    </button>
                  </>
                )}
              </div>

              <button 
                className="pagination-btn"
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

export default Product;