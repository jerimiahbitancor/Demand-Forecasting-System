// components/MappingData.jsx
import { useState, useEffect } from "react";
import { 
  FiPlus, 
  FiEdit2, 
  FiTrash2, 
  FiChevronLeft,
  FiChevronRight,
  FiX,
  FiSave,
  FiSearch,
  FiRefreshCw
} from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./MappingData.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const MappingData = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortBy, setSortBy] = useState("Newest First");
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [mappingData, setMappingData] = useState([]);
  const [categories, setCategories] = useState(['All']);
  const [totalProducts, setTotalProducts] = useState(0);

  // Form state
  const [formData, setFormData] = useState({
    productName: "",
    price: "",
    category: "",
    servingSize: "",
    ingredients: []
  });

  const [newIngredient, setNewIngredient] = useState({
    name: "",
    quantity: "",
    unit: "kg"
  });

  // Form validation errors
  const [formErrors, setFormErrors] = useState({
    productName: "",
    price: "",
    category: "",
    ingredients: ""
  });

  // Get auth token
  const getAuthToken = () => {
    return localStorage.getItem('token');
  };

  // Axios instance
  const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch products
      const productsResponse = await apiClient.get('/mapping/products', {
        params: {
          category: selectedCategory === 'All' ? null : selectedCategory,
          search: searchTerm || null
        }
      });

      if (productsResponse.data.success) {
        setMappingData(productsResponse.data.data);
        setTotalProducts(productsResponse.data.data.length);
      }

      // Fetch categories
      const categoriesResponse = await apiClient.get('/mapping/categories');
      if (categoriesResponse.data.success) {
        setCategories(categoriesResponse.data.data);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load mapping data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedCategory, searchTerm]);

  // Validate form
  const validateForm = () => {
    const errors = {
      productName: "",
      price: "",
      category: "",
      ingredients: ""
    };
    let isValid = true;

    if (!formData.productName || formData.productName.trim() === "") {
      errors.productName = "Product name is required";
      isValid = false;
    }

    if (!formData.price || formData.price === "") {
      errors.price = "Price is required";
      isValid = false;
    } else if (isNaN(parseFloat(formData.price)) || parseFloat(formData.price) <= 0) {
      errors.price = "Price must be a valid number greater than 0";
      isValid = false;
    }

    if (!formData.category || formData.category.trim() === "") {
      errors.category = "Category is required";
      isValid = false;
    }

    if (formData.ingredients.length === 0) {
      errors.ingredients = "At least one ingredient is required";
      isValid = false;
    }

    setFormErrors(errors);
    return isValid;
  };

  // Handle add/update mapping
  const handleSaveMapping = async () => {
    if (!validateForm()) {
      const firstError = document.querySelector('.form-group .error-text');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setIsSaving(true);
    const savingToast = toast.loading(isEditMode ? 'Updating product...' : 'Saving product...');

    try {
      const payload = {
        name: formData.productName.trim(),
        price: parseFloat(formData.price),
        category: formData.category.trim(),
        serving_size_label: formData.servingSize || null,
        ingredients: formData.ingredients.map(ing => ({
          name: ing.name.trim(),
          quantity: parseFloat(ing.quantity) || 1,
          unit: ing.unit || 'kg'
        }))
      };

      let response;
      if (isEditMode && editingId) {
        response = await apiClient.put(`/mapping/products/${editingId}`, payload);
      } else {
        response = await apiClient.post('/mapping/products', payload);
      }

      toast.dismiss(savingToast);

      if (response.data.success) {
        toast.success(isEditMode ? '✅ Product updated successfully!' : '✅ Product added successfully!');
        resetForm();
        setIsModalOpen(false);
        fetchData();
      }
    } catch (error) {
      toast.dismiss(savingToast);
      console.error('Error saving product:', error);
      
      const errorMsg = error.response?.data?.error || error.message || 'Failed to save product';
      toast.error(`❌ ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Edit product
  const handleEdit = (product) => {
    setIsEditMode(true);
    setEditingId(product.id);
    setFormData({
      productName: product.name,
      price: product.price.toString(),
      category: product.category || '',
      servingSize: product.serving_size_label || '',
      ingredients: product.product_ingredients ? product.product_ingredients.map(pi => ({
        name: pi.ingredients.name,
        quantity: pi.quantity_per_serving.toString(),
        unit: pi.ingredients.unit || 'kg'
      })) : []
    });
    setFormErrors({ productName: "", price: "", category: "", ingredients: "" });
    setIsModalOpen(true);
  };

  // Delete product
  const handleDeleteMapping = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;

    const deletingToast = toast.loading('Deleting product...');

    try {
      const response = await apiClient.delete(`/mapping/products/${id}`);
      toast.dismiss(deletingToast);
      
      if (response.data.success) {
        toast.success('✅ Product deleted successfully!');
        fetchData();
      }
    } catch (error) {
      toast.dismiss(deletingToast);
      console.error('Error deleting product:', error);
      toast.error('❌ Failed to delete product');
    }
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      productName: "",
      price: "",
      category: "",
      servingSize: "",
      ingredients: []
    });
    setNewIngredient({ name: "", quantity: "", unit: "kg" });
    setFormErrors({ productName: "", price: "", category: "", ingredients: "" });
    setIsEditMode(false);
    setEditingId(null);
  };

  // Close modal
  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    resetForm();
  };

  // Add ingredient to list
  const handleAddIngredient = () => {
    if (!newIngredient.name || newIngredient.name.trim() === "") {
      toast.error('Please enter ingredient name');
      return;
    }
    
    if (!newIngredient.quantity || newIngredient.quantity === "") {
      toast.error('Please enter ingredient quantity');
      return;
    }
    
    if (isNaN(parseFloat(newIngredient.quantity)) || parseFloat(newIngredient.quantity) <= 0) {
      toast.error('Quantity must be a valid number greater than 0');
      return;
    }

    // Check for duplicate ingredient
    const duplicate = formData.ingredients.some(
      ing => ing.name.toLowerCase() === newIngredient.name.trim().toLowerCase()
    );
    
    if (duplicate) {
      toast.error('This ingredient already exists in the list');
      return;
    }

    setFormData({
      ...formData,
      ingredients: [...formData.ingredients, { 
        name: newIngredient.name.trim(),
        quantity: newIngredient.quantity,
        unit: newIngredient.unit 
      }]
    });
    setNewIngredient({ name: "", quantity: "", unit: "kg" });
    
    if (formErrors.ingredients) {
      setFormErrors({ ...formErrors, ingredients: "" });
    }
  };

  // Remove ingredient from list
  const handleRemoveIngredient = (index) => {
    const updatedIngredients = formData.ingredients.filter((_, i) => i !== index);
    setFormData({ ...formData, ingredients: updatedIngredients });
    
    if (formErrors.ingredients && updatedIngredients.length > 0) {
      setFormErrors({ ...formErrors, ingredients: "" });
    }
  };

  // Filter and sort data
  const getFilteredData = () => {
    let filtered = [...mappingData];
    
    if (searchTerm) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedCategory !== 'All') {
      filtered = filtered.filter(item => item.category === selectedCategory);
    }

    switch(sortBy) {
      case 'Price: Low to High':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'Price: High to Low':
        filtered.sort((a, b) => b.price - a.price);
        break;
      case 'A-Z':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'Oldest First':
        filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        break;
      case 'Newest First':
      default:
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
    }

    return filtered;
  };

  const filteredData = getFilteredData();
  const itemsPerPage = 5;
  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  // Get page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      for (
        let i = Math.max(2, currentPage - 1);
        i <= Math.min(totalPages - 1, currentPage + 1);
        i++
      ) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="mapping-container">
      {/* Header */}
      <div className="mapping-header">
        <h2 className="mapping-title">
          Current Ingredient Mapping ({totalProducts} Active Products)
          {loading && <span className="loading-spinner">...</span>}
        </h2>
        <button 
          className="btn-upload"
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          disabled={loading}
        >
          <FiPlus size={16} /> Add New Product
        </button>
      </div>

      {/* Search and Filter */}
      <div className="mapping-controls">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Search product or ingredient..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
        <div className="filter-wrapper">
          <select 
            className="filter-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select 
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option>Newest First</option>
            <option>Oldest First</option>
            <option>Price: Low to High</option>
            <option>Price: High to Low</option>
            <option>A-Z</option>
          </select>
          <button className="btn-refresh" onClick={fetchData} disabled={loading}>
            <FiRefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* Product Mapping Table */}
      <div className="mapping-section">
        <div className="mapping-table-wrapper">
          {loading ? (
            <div className="loading-state">Loading products...</div>
          ) : currentData.length === 0 ? (
            <div className="empty-state">No products found. Add your first product!</div>
          ) : (
            <table className="mapping-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Product Name</th>
                  <th>Category</th>
                  <th>Ingredients</th>
                  <th>Price</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {currentData.map((item, index) => (
                  <tr key={item.id}>
                    <td>{startIndex + index + 1}</td>
                    <td className="product-name">{item.name}</td>
                    <td><span className="category-badge">{item.category || 'Uncategorized'}</span></td>
                    <td className="ingredients-cell">
                      {item.product_ingredients && item.product_ingredients.length > 0 ? (
                        <div className="ingredients-list">
                          {item.product_ingredients.slice(0, 3).map((pi, i) => (
                            <span key={i} className="ingredient-tag">
                              {pi.ingredients.name}
                              {pi.quantity_per_serving && ` (${pi.quantity_per_serving}${pi.ingredients.unit})`}
                            </span>
                          ))}
                          {item.product_ingredients.length > 3 && (
                            <span className="ingredient-more">+{item.product_ingredients.length - 3} more</span>
                          )}
                        </div>
                      ) : (
                        <span className="no-ingredients">No ingredients</span>
                      )}
                    </td>
                    <td className="price-cell">₱{item.price.toFixed(2)}</td>
                    <td>
                      <button 
                        className="action-btn edit"
                        onClick={() => handleEdit(item)}
                        title="Edit product"
                      >
                        <FiEdit2 size={16} />
                      </button>
                      <button 
                        className="action-btn delete"
                        onClick={() => handleDeleteMapping(item.id, item.name)}
                        title="Delete product"
                      >
                        <FiTrash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && !loading && (
          <div className="pagination">
            <div className="pagination-left">
              <button 
                className="page-btn"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                <FiChevronLeft size={16} /> Previous
              </button>
            </div>
            <div className="pagination-center">
              {getPageNumbers().map((page, index) => (
                <button
                  key={index}
                  className={`page-number ${page === currentPage ? 'active' : ''} ${page === '...' ? 'dots' : ''}`}
                  onClick={() => typeof page === 'number' && setCurrentPage(page)}
                  disabled={page === '...'}
                >
                  {page}
                </button>
              ))}
            </div>
            <div className="pagination-right">
              <button 
                className="page-btn"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Next <FiChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal for Add/Edit Product */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{isEditMode ? 'Edit Product' : 'Add New Product'}</h3>
              <button className="modal-close" onClick={closeModal} disabled={isSaving}>
                <FiX size={24} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Product Name <span className="required">*</span></label>
                  <input
                    type="text"
                    placeholder="Enter product name"
                    value={formData.productName}
                    onChange={(e) => {
                      setFormData({...formData, productName: e.target.value});
                      if (formErrors.productName) {
                        setFormErrors({...formErrors, productName: ""});
                      }
                    }}
                    className={formErrors.productName ? 'error' : ''}
                  />
                  {formErrors.productName && (
                    <span className="error-text">{formErrors.productName}</span>
                  )}
                </div>

                <div className="form-group">
                  <label>Price <span className="required">*</span></label>
                  <input
                    type="number"
                    placeholder="Enter product price"
                    value={formData.price}
                    onChange={(e) => {
                      setFormData({...formData, price: e.target.value});
                      if (formErrors.price) {
                        setFormErrors({...formErrors, price: ""});
                      }
                    }}
                    step="0.01"
                    min="0.01"
                    className={formErrors.price ? 'error' : ''}
                  />
                  {formErrors.price && (
                    <span className="error-text">{formErrors.price}</span>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category <span className="required">*</span></label>
                  <input
                    type="text"
                    placeholder="Enter category"
                    value={formData.category}
                    onChange={(e) => {
                      setFormData({...formData, category: e.target.value});
                      if (formErrors.category) {
                        setFormErrors({...formErrors, category: ""});
                      }
                    }}
                    className={formErrors.category ? 'error' : ''}
                  />
                  {formErrors.category && (
                    <span className="error-text">{formErrors.category}</span>
                  )}
                </div>

                <div className="form-group">
                  <label>Serving Size</label>
                  <input
                    type="text"
                    placeholder="e.g., 1 cup, 250g"
                    value={formData.servingSize}
                    onChange={(e) => setFormData({...formData, servingSize: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Ingredients <span className="required">*</span></label>
                
                {/* Ingredient Input Row */}
                <div className="ingredient-input-row">
                  <input
                    type="text"
                    placeholder="Ingredient Name"
                    className="ingredient-name-input"
                    value={newIngredient.name}
                    onChange={(e) => setNewIngredient({...newIngredient, name: e.target.value})}
                  />
                  <input
                    type="number"
                    placeholder="Qty"
                    className="ingredient-qty-input"
                    value={newIngredient.quantity}
                    onChange={(e) => setNewIngredient({...newIngredient, quantity: e.target.value})}
                    step="0.001"
                    min="0.001"
                  />
                  <select 
                    className="ingredient-unit-select"
                    value={newIngredient.unit}
                    onChange={(e) => setNewIngredient({...newIngredient, unit: e.target.value})}
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="mL">mL</option>
                    <option value="pcs">pcs</option>
                    <option value="tbsp">tbsp</option>
                    <option value="tsp">tsp</option>
                    <option value="cup">cup</option>
                    <option value="oz">oz</option>
                    <option value="lb">lb</option>
                  </select>
                  <button 
                    className="btn-add-ingredient"
                    onClick={handleAddIngredient}
                  >
                    <FiPlus size={16} /> Add
                  </button>
                </div>

                {/* Ingredients Table */}
                <div className={`ingredients-table-wrapper ${formErrors.ingredients ? 'error-border' : ''}`}>
                  <table className="ingredients-modal-table">
                    <thead>
                      <tr>
                        <th>Ingredient Name</th>
                        <th>Quantity</th>
                        <th>Unit</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.ingredients.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="empty-row">
                            No ingredients added yet
                          </td>
                        </tr>
                      ) : (
                        formData.ingredients.map((ing, index) => (
                          <tr key={index}>
                            <td>{ing.name}</td>
                            <td>{ing.quantity}</td>
                            <td>{ing.unit}</td>
                            <td>
                              <button 
                                className="action-btn delete"
                                onClick={() => handleRemoveIngredient(index)}
                                title="Remove ingredient"
                              >
                                <FiTrash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {formErrors.ingredients && (
                    <span className="error-text" style={{ padding: '8px 12px', display: 'block' }}>
                      {formErrors.ingredients}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={closeModal}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleSaveMapping}
                disabled={isSaving}
              >
                <FiSave size={16} /> 
                {isSaving ? (isEditMode ? 'Updating...' : 'Saving...') : (isEditMode ? 'Update' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MappingData;