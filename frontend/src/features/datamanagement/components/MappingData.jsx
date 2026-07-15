// components/MappingData.jsx
import { useState, useEffect, useCallback, useMemo } from "react";
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
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { useAuth } from "../../../context/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const STORAGE_KEYS = {
  MAPPING_DATA: 'mapping_data',
  CATEGORIES: 'mapping_categories',
  TOTAL_PRODUCTS: 'mapping_total_products',
  SEARCH_TERM: 'mapping_search_term',
  SELECTED_CATEGORY: 'mapping_selected_category',
  SORT_BY: 'mapping_sort_by',
  CURRENT_PAGE: 'mapping_current_page',
  LAST_FETCH: 'mapping_last_fetch'
};

const MappingData = () => {
  const { getToken } = useAuth();

  const [searchTerm, setSearchTerm] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEYS.SEARCH_TERM) || "";
  });
  
  const [selectedCategory, setSelectedCategory] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEYS.SELECTED_CATEGORY) || "All";
  });
  
  const [sortBy, setSortBy] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEYS.SORT_BY) || "Newest First";
  });
  
  const [currentPage, setCurrentPage] = useState(() => {
    return parseInt(sessionStorage.getItem(STORAGE_KEYS.CURRENT_PAGE)) || 1;
  });
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [mappingData, setMappingData] = useState(() => {
    const stored = sessionStorage.getItem(STORAGE_KEYS.MAPPING_DATA);
    return stored ? JSON.parse(stored) : [];
  });
  
  const [categories, setCategories] = useState(() => {
    const stored = sessionStorage.getItem(STORAGE_KEYS.CATEGORIES);
    return stored ? JSON.parse(stored) : ['All'];
  });
  
  const [totalProducts, setTotalProducts] = useState(() => {
    return parseInt(sessionStorage.getItem(STORAGE_KEYS.TOTAL_PRODUCTS)) || 0;
  });

  const [pendingDelete, setPendingDelete] = useState(null);

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

  const [formErrors, setFormErrors] = useState({
    productName: "",
    price: "",
    category: "",
    ingredients: ""
  });

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

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.MAPPING_DATA, JSON.stringify(mappingData));
  }, [mappingData]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.TOTAL_PRODUCTS, totalProducts.toString());
  }, [totalProducts]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.SEARCH_TERM, searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.SELECTED_CATEGORY, selectedCategory);
  }, [selectedCategory]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.SORT_BY, sortBy);
  }, [sortBy]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.CURRENT_PAGE, currentPage.toString());
  }, [currentPage]);

  const fetchData = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      
      const storedData = sessionStorage.getItem(STORAGE_KEYS.MAPPING_DATA);
      const storedCategories = sessionStorage.getItem(STORAGE_KEYS.CATEGORIES);
      const storedTotal = sessionStorage.getItem(STORAGE_KEYS.TOTAL_PRODUCTS);
      const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
      
      const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 5 * 60 * 1000;
      
      if (!forceRefresh && storedData && storedCategories && storedTotal && cacheValid) {
        const parsedData = JSON.parse(storedData);
        const parsedCategories = JSON.parse(storedCategories);
        const parsedTotal = parseInt(storedTotal);
        
        setMappingData(parsedData);
        setCategories(parsedCategories);
        setTotalProducts(parsedTotal);
        setLoading(false);
        return;
      }

      const productsResponse = await apiClient.get('/mapping/products', {
        params: {
          category: selectedCategory === 'All' ? null : selectedCategory,
          search: searchTerm || null,
          forceRefresh: forceRefresh ? 'true' : 'false'
        }
      });

      if (productsResponse.data.success) {
        const data = productsResponse.data.data || [];
        setMappingData(data);
        setTotalProducts(data.length);
        sessionStorage.setItem(STORAGE_KEYS.MAPPING_DATA, JSON.stringify(data));
        sessionStorage.setItem(STORAGE_KEYS.TOTAL_PRODUCTS, data.length.toString());
        sessionStorage.setItem(STORAGE_KEYS.LAST_FETCH, Date.now().toString());
      }

      const categoriesResponse = await apiClient.get('/mapping/categories', {
        params: {
          forceRefresh: forceRefresh ? 'true' : 'false'
        }
      });
      
      if (categoriesResponse.data.success) {
        const cats = categoriesResponse.data.data || ['All'];
        setCategories(cats);
        sessionStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(cats));
      }

    } catch (error) {
      console.error('Error fetching mapping data:', error);
      if (error.response?.status === 401) {
        toast.error('Session expired. Please login again.');
      } else {
        toast.error('Failed to load mapping data');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient, selectedCategory, searchTerm]);

  useEffect(() => {
    const hasStoredData = sessionStorage.getItem(STORAGE_KEYS.MAPPING_DATA) !== null;
    const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
    const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 5 * 60 * 1000;
    
    if (hasStoredData && cacheValid) {
      const storedData = sessionStorage.getItem(STORAGE_KEYS.MAPPING_DATA);
      const storedCategories = sessionStorage.getItem(STORAGE_KEYS.CATEGORIES);
      const storedTotal = sessionStorage.getItem(STORAGE_KEYS.TOTAL_PRODUCTS);
      
      if (storedData) setMappingData(JSON.parse(storedData));
      if (storedCategories) setCategories(JSON.parse(storedCategories));
      if (storedTotal) setTotalProducts(parseInt(storedTotal));
      setLoading(false);
    } else {
      fetchData(false);
    }
  }, [fetchData]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
        const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 5 * 60 * 1000;
        if (!cacheValid) {
          fetchData(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData]);

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
    } else {
      formData.ingredients.forEach((ingredient, index) => {
        const name = ingredient.name?.trim();
        const quantity = parseFloat(ingredient.quantity);

        if (!name) {
          errors.ingredients = "All ingredients must have a name.";
          isValid = false;
        }

        if (ingredient.quantity === undefined || ingredient.quantity === null || ingredient.quantity === '') {
          errors.ingredients = "All ingredients must have a quantity.";
          isValid = false;
        } else if (isNaN(quantity) || quantity <= 0) {
          errors.ingredients = "Ingredient quantities must be numbers greater than 0.";
          isValid = false;
        }
      });
    }

    setFormErrors(errors);
    return isValid;
  };

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
        toast.success(isEditMode ? 'Product updated successfully!' : 'Product added successfully!');
        resetForm();
        setIsModalOpen(false);
        await fetchData(true);
      }
    } catch (error) {
      toast.dismiss(savingToast);
      console.error('Error saving product:', error);
      
      const errorMsg = error.response?.data?.error || error.message || 'Failed to save product';
      toast.error(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

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

  const requestDelete = (id, name) => {
    setPendingDelete({ id, name });
  };

  const confirmDelete = async () => {
    const { id, name } = pendingDelete;
    const deletingToast = toast.loading('Deleting product...');

    try {
      const response = await apiClient.delete(`/mapping/products/${id}`);
      toast.dismiss(deletingToast);

      if (response.data.success) {
        toast.success(`"${name}" has been removed.`);
        await fetchData(true);
      }
    } catch (error) {
      toast.dismiss(deletingToast);
      console.error('Error deleting product:', error);
      toast.error('Failed to delete product');
    } finally {
      setPendingDelete(null);
    }
  };

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

  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    resetForm();
  };

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

  const handleRemoveIngredient = (index) => {
    const updatedIngredients = formData.ingredients.filter((_, i) => i !== index);
    setFormData({ ...formData, ingredients: updatedIngredients });
    
    if (formErrors.ingredients && updatedIngredients.length > 0) {
      setFormErrors({ ...formErrors, ingredients: "" });
    }
  };

  const sortOptions = [
    { value: "Newest First", label: "Newest First" },
    { value: "Oldest First", label: "Oldest First" },
    { value: "A-Z", label: "A to Z" },
    { value: "Z-A", label: "Z to A" },
    { value: "Price: Low to High", label: "Price: Low to High" },
    { value: "Price: High to Low", label: "Price: High to Low" },
  ];

  const getFilteredData = useMemo(() => {
    let filtered = [...mappingData];
    
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchLower) ||
        item.category?.toLowerCase().includes(searchLower) ||
        item.product_ingredients?.some(pi => 
          pi.ingredients.name.toLowerCase().includes(searchLower)
        )
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
      case 'Z-A':
        filtered.sort((a, b) => b.name.localeCompare(a.name));
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
  }, [mappingData, searchTerm, selectedCategory, sortBy]);

  const itemsPerPage = 5;
  const totalPages = Math.ceil(getFilteredData.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = getFilteredData.slice(startIndex, startIndex + itemsPerPage);

  const getPageNumbers = useMemo(() => {
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
  }, [totalPages, currentPage]);

  return (
    <div className="mapping-container">
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

      <div className="mapping-controls">
        <div className="search-wrapper">
          <FiSearch className="search-icon" />
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
            {sortOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button 
            className="btn-refresh" 
            onClick={() => fetchData(true)} 
            disabled={loading}
          >
            <FiRefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

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
                        onClick={() => requestDelete(item.id, item.name)}
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
              {getPageNumbers.map((page, index) => (
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

      {isModalOpen && (
        <div className="modal-overlay">
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

      {pendingDelete && (
        <ConfirmDeleteModal
          productName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
};

export default MappingData;