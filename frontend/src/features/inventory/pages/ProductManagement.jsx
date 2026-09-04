// components/ProductManagement.jsx
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { 
  FaPlus, 
  FaEdit, 
  FaTrash, 
  FaChevronLeft,
  FaChevronRight,
  FaTimes,
  FaSave,
  FaInfoCircle,
  FaArchive,
  FaUndo,
  FaChevronDown,
  FaSearch,
} from "react-icons/fa";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./ProductManagement.css";
import { useAuth } from "../../../context/AuthContext";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const STORAGE_KEYS = {
  MAPPING_DATA: 'mapping_data',
  CATEGORIES: 'mapping_categories',
  TOTAL_PRODUCTS: 'mapping_total_products',
  SEARCH_TERM: 'mapping_search_term',
  SELECTED_CATEGORY: 'mapping_selected_category',
  SORT_BY: 'mapping_sort_by',
  CURRENT_PAGE: 'mapping_current_page',
  STATUS_FILTER: 'mapping_status_filter',
  LAST_FETCH: 'mapping_last_fetch'
};

const ProductManagement = () => {
  const { getToken } = useAuth();

  // Refs
  const isInitialMount = useRef(true);
  const fetchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const autoRefreshIntervalRef = useRef(null);

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
  const [isViewMode, setIsViewMode] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isLowMarginModalOpen, setIsLowMarginModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  const [mappingData, setMappingData] = useState([]);
  const [categories, setCategories] = useState(['All']);
  const [totalProducts, setTotalProducts] = useState(0);

  // ============ PRODUCT STATS ============
  const [productStats, setProductStats] = useState({
    total_menu_items: 0,
    avg_cogs: 0,
    low_margin_products: 0,
    unmapped_products: 0
  });

  const [statusFilter, setStatusFilter] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEYS.STATUS_FILTER) || 'active';
  });

  // ============ INVENTORY ITEMS FOR INGREDIENTS ============
  const [inventoryItems, setInventoryItems] = useState([]);
  const [ingredientUnits, setIngredientUnits] = useState([]);
  const [searchIngredient, setSearchIngredient] = useState("");
  const [showIngredientDropdown, setShowIngredientDropdown] = useState(false);
  const [loadingIngredients, setLoadingIngredients] = useState(false);

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
    unit: "",
    inventory_item_id: null
  });

  const [formErrors, setFormErrors] = useState({
    productName: "",
    price: "",
    category: "",
    ingredients: ""
  });

  // ============ API CLIENT ============
  const apiClient = useMemo(() => {
    const client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
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
        if (error.response?.status === 401) {
          toast.error('Session expired. Please login again.');
          window.location.href = '/login';
        }
        if (error.response?.status === 429) {
          toast.error('Too many requests. Please wait a moment.');
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
        return Promise.reject(error);
      }
    );

    return client;
  }, [getToken]);

  // ============ UPDATE STATS ============
  const updateStats = useCallback((items) => {
    const total = items.length;
    
    const totalCOGS = items.reduce((sum, item) => sum + ((item.price || 0) * 0.6), 0);
    const avgCOGS = total > 0 ? totalCOGS / total : 0;
    
    const lowMarginProducts = items.filter(item => {
      const price = item.price || 0;
      const cogs = price * 0.6;
      const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
      return margin < 30 && price > 0;
    }).length;
    
    const unmappedProducts = items.filter(item => 
      !item.product_ingredients || item.product_ingredients.length === 0
    ).length;
    
    setProductStats({
      total_menu_items: total,
      avg_cogs: avgCOGS,
      low_margin_products: lowMarginProducts,
      unmapped_products: unmappedProducts
    });
  }, []);

  // ============ FETCH INVENTORY ITEMS FOR INGREDIENTS ============
  const fetchInventoryItems = useCallback(async () => {
    try {
      setLoadingIngredients(true);
      const response = await apiClient.get('/inventory/items', {
        params: {
          limit: 1000,
          sortBy: 'name',
          sortOrder: 'asc'
        }
      });

      if (response.data.success) {
        const allItems = response.data.data || [];
        const inStockItems = allItems.filter(item => (item.quantity || 0) > 0);
        setInventoryItems(inStockItems);
      } else {
        setInventoryItems([]);
      }
    } catch (error) {
      console.error('Error fetching inventory items:', error);
      setInventoryItems([]);
    } finally {
      setLoadingIngredients(false);
    }
  }, [apiClient]);

  const fetchIngredientUnits = useCallback(async () => {
    try {
      const response = await apiClient.get('/units');
      if (response.data.success) {
        const units = response.data.data || [];
        setIngredientUnits(units);
        setNewIngredient((current) => ({
          ...current,
          unit: current.unit || units[0]?.name || ''
        }));
      }
    } catch (error) {
      console.error('Error fetching ingredient units:', error);
      setIngredientUnits([]);
    }
  }, [apiClient]);

  useEffect(() => {
    Promise.resolve().then(fetchIngredientUnits);
  }, [fetchIngredientUnits]);

  // ============ FETCH DATA ============
  const fetchData = useCallback(async (forceRefresh = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      setLoading(true);
      
      const cacheSuffix = statusFilter === 'inactive' ? '_inactive' : '';
      const storedData = sessionStorage.getItem(STORAGE_KEYS.MAPPING_DATA + cacheSuffix);
      const storedCategories = sessionStorage.getItem(STORAGE_KEYS.CATEGORIES + cacheSuffix);
      const storedTotal = sessionStorage.getItem(STORAGE_KEYS.TOTAL_PRODUCTS + cacheSuffix);
      const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH + cacheSuffix);
      
      const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 5 * 60 * 1000;
      
      if (!forceRefresh && storedData && storedCategories && storedTotal && cacheValid) {
        const parsedData = JSON.parse(storedData);
        const parsedCategories = JSON.parse(storedCategories);
        const parsedTotal = parseInt(storedTotal);
        
        setMappingData(parsedData);
        setCategories(parsedCategories);
        setTotalProducts(parsedTotal);
        updateStats(parsedData);
        setLastUpdated(new Date());
        setLoading(false);
        await fetchInventoryItems();
        return;
      }

      const productsResponse = await apiClient.get('/mapping/products', {
        params: {
          status: statusFilter,
          category: selectedCategory === 'All' ? null : selectedCategory,
          search: searchTerm || null,
          forceRefresh: 'true'
        },
        signal: abortControllerRef.current.signal
      });

      if (productsResponse.data.success) {
        const data = productsResponse.data.data || [];
        setMappingData(data);
        setTotalProducts(data.length);
        updateStats(data);
        setLastUpdated(new Date());
        const cacheSuffix = statusFilter === 'inactive' ? '_inactive' : '';
        sessionStorage.setItem(STORAGE_KEYS.MAPPING_DATA + cacheSuffix, JSON.stringify(data));
        sessionStorage.setItem(STORAGE_KEYS.TOTAL_PRODUCTS + cacheSuffix, data.length.toString());
        sessionStorage.setItem(STORAGE_KEYS.LAST_FETCH + cacheSuffix, Date.now().toString());
      }

      const categoriesResponse = await apiClient.get('/mapping/categories', {
        params: {
          status: statusFilter,
          forceRefresh: 'true'
        }
      });
      
      if (categoriesResponse.data.success) {
        const cats = categoriesResponse.data.data || ['All'];
        setCategories(cats);
        const cacheSuffix = statusFilter === 'inactive' ? '_inactive' : '';
        sessionStorage.setItem(STORAGE_KEYS.CATEGORIES + cacheSuffix, JSON.stringify(cats));
      }

      try {
        const productCategoriesResponse = await apiClient.get('/product-categories');
        if (productCategoriesResponse.data.success) {
          const productCategories = productCategoriesResponse.data.data || [];
          const productCategoryNames = ['All', ...productCategories.map((category) => category.name)];
          setCategories(productCategoryNames);
          const cacheSuffix = statusFilter === 'inactive' ? '_inactive' : '';
          sessionStorage.setItem(STORAGE_KEYS.CATEGORIES + cacheSuffix, JSON.stringify(productCategoryNames));
        }
      } catch (error) {
        console.warn('Product category catalog unavailable; keeping product-derived categories.', error);
      }

      await fetchInventoryItems();

    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        return;
      }
      console.error('Error fetching mapping data:', error);
      if (error.response?.status === 401) {
        toast.error('Session expired. Please login again.');
      } else if (error.response?.status !== 429) {
        toast.error('Failed to load mapping data');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient, selectedCategory, searchTerm, statusFilter, fetchInventoryItems, updateStats]);

  // ============ AUTO REFRESH ============
  const startAutoRefresh = useCallback(() => {
    if (autoRefreshIntervalRef.current) {
      clearInterval(autoRefreshIntervalRef.current);
    }
    
    autoRefreshIntervalRef.current = setInterval(() => {
      console.log('🔄 Auto-refreshing mapping data...');
      fetchData(true);
    }, 5000);
    
    return autoRefreshIntervalRef.current;
  }, [fetchData]);

  const stopAutoRefresh = useCallback(() => {
    if (autoRefreshIntervalRef.current) {
      clearInterval(autoRefreshIntervalRef.current);
      autoRefreshIntervalRef.current = null;
    }
  }, []);

  // ============ DEBOUNCED FETCH ============
  const debouncedFetch = useCallback(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
    fetchTimeoutRef.current = setTimeout(() => {
      fetchData(false);
    }, 300);
  }, [fetchData]);

  // ============ EFFECTS ============
  useEffect(() => {
    const cacheSuffix = statusFilter === 'inactive' ? '_inactive' : '';
    sessionStorage.setItem(STORAGE_KEYS.MAPPING_DATA + cacheSuffix, JSON.stringify(mappingData));
  }, [mappingData, statusFilter]);

  useEffect(() => {
    const cacheSuffix = statusFilter === 'inactive' ? '_inactive' : '';
    sessionStorage.setItem(STORAGE_KEYS.CATEGORIES + cacheSuffix, JSON.stringify(categories));
  }, [categories, statusFilter]);

  useEffect(() => {
    const cacheSuffix = statusFilter === 'inactive' ? '_inactive' : '';
    sessionStorage.setItem(STORAGE_KEYS.TOTAL_PRODUCTS + cacheSuffix, totalProducts.toString());
  }, [totalProducts, statusFilter]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.STATUS_FILTER, statusFilter);
  }, [statusFilter]);

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

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      setTimeout(() => {
        fetchData(false);
        startAutoRefresh();
      }, 100);
    } else {
      debouncedFetch();
      stopAutoRefresh();
      startAutoRefresh();
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      stopAutoRefresh();
    };
  }, [fetchData, debouncedFetch, startAutoRefresh, stopAutoRefresh, searchTerm, selectedCategory, sortBy, statusFilter, currentPage]);

  // ============ FILTERED INVENTORY ITEMS FOR DROPDOWN ============
  const filteredInventoryItems = useMemo(() => {
    if (!searchIngredient) return inventoryItems;
    const searchLower = searchIngredient.toLowerCase();
    return inventoryItems.filter(item =>
      item.name?.toLowerCase().includes(searchLower) ||
      item.category?.toLowerCase().includes(searchLower)
    );
  }, [inventoryItems, searchIngredient]);

  // ============ VALIDATE FORM ============
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
      formData.ingredients.forEach((ingredient) => {
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

  // ============ SAVE PRODUCT ============
  const handleSaveMapping = async () => {
    if (!validateForm()) {
      const firstError = document.querySelector('.form-group .error-text');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setIsSaving(true);
    const savingToast = toast.loading(isEditMode ? 'Updating product...' : 'Creating product...');

    try {
      const payload = {
        name: formData.productName.trim(),
        price: parseFloat(formData.price),
        category: formData.category.trim(),
        serving_size_label: formData.servingSize || 'serving',
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
        toast.success(isEditMode ? 'Product updated successfully!' : 'Product created successfully!');
        resetForm();
        setIsModalOpen(false);
        await fetchData(true);
        stopAutoRefresh();
        startAutoRefresh();
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

  // ============ HANDLE VIEW ============
  const handleView = (product) => {
    setIsViewMode(true);
    setIsEditMode(false);
    setEditingId(product.id);
    setFormData({
      productName: product.name || '',
      price: product.price?.toString() || '',
      category: product.category || '',
      servingSize: product.serving_size_label || '',
      ingredients: product.product_ingredients && product.product_ingredients.length > 0 
        ? product.product_ingredients.map(pi => ({
            name: pi.ingredients?.name || '',
            quantity: pi.quantity_per_serving?.toString() || '',
            unit: pi.ingredients?.unit || 'kg',
            inventory_item_id: pi.inventory_item_id || null
          }))
        : []
    });
    setIsModalOpen(true);
  };

  // ============ HANDLE EDIT ============
  const handleEdit = (product) => {
    setIsEditMode(true);
    setIsViewMode(false);
    setEditingId(product.id);
    setFormData({
      productName: product.name || '',
      price: product.price?.toString() || '',
      category: product.category || '',
      servingSize: product.serving_size_label || '',
      ingredients: product.product_ingredients && product.product_ingredients.length > 0 
        ? product.product_ingredients.map(pi => ({
            name: pi.ingredients?.name || '',
            quantity: pi.quantity_per_serving?.toString() || '',
            unit: pi.ingredients?.unit || 'kg',
            inventory_item_id: pi.inventory_item_id || null
          }))
        : []
    });
    setFormErrors({ productName: "", price: "", category: "", ingredients: "" });
    setIsModalOpen(true);
  };

  // ============ HANDLE ARCHIVE ============
  const handleArchive = (product) => {
    setSelectedItem(product);
    setIsArchiveModalOpen(true);
  };

  // ============ CONFIRM ARCHIVE ============
  const confirmArchive = async () => {
    if (!selectedItem) return;
    
    setIsArchiving(true);
    const archiveToast = toast.loading('Archiving product...');

    try {
      const response = await apiClient.post(`/mapping/products/${selectedItem.id}/archive`, {
        reason: 'Archived by user'
      });

      toast.dismiss(archiveToast);

      if (response.data.success) {
        toast.success('Product archived successfully!');
        setIsArchiveModalOpen(false);
        setSelectedItem(null);
        await fetchData(true);
        stopAutoRefresh();
        startAutoRefresh();
      }
    } catch (error) {
      toast.dismiss(archiveToast);
      console.error('Error archiving product:', error);
      toast.error(error.response?.data?.error || 'Failed to archive product');
    } finally {
      setIsArchiving(false);
    }
  };

  // ============ HANDLE REACTIVATE ============
  const handleReactivate = async (product) => {
    const reactivateToast = toast.loading('Reactivating product...');

    try {
      const response = await apiClient.post(`/mapping/products/${product.id}/reactivate`, {
        forceReactivate: true
      });

      toast.dismiss(reactivateToast);

      if (response.data.success) {
        toast.success('Product reactivated successfully!');
        await fetchData(true);
        stopAutoRefresh();
        startAutoRefresh();
      }
    } catch (error) {
      toast.dismiss(reactivateToast);
      console.error('Error reactivating product:', error);
      toast.error(error.response?.data?.error || 'Failed to reactivate product');
    }
  };

  // ============ RESET FORM ============
  const resetForm = () => {
    setFormData({
      productName: "",
      price: "",
      category: "",
      servingSize: "",
      ingredients: []
    });
    setNewIngredient({ 
      name: "", 
      quantity: "", 
      unit: ingredientUnits[0]?.name || '',
      inventory_item_id: null 
    });
    setSearchIngredient("");
    setShowIngredientDropdown(false);
    setFormErrors({ productName: "", price: "", category: "", ingredients: "" });
    setIsEditMode(false);
    setIsViewMode(false);
    setEditingId(null);
  };

  // ============ CLOSE MODAL ============
  const closeModal = () => {
    if (isSaving) return;
    setIsModalOpen(false);
    resetForm();
  };

  // ============ SELECT INGREDIENT FROM INVENTORY ============
  const handleSelectIngredient = (item) => {
    setNewIngredient({
      name: item.name,
      quantity: "",
      unit: item.unit || ingredientUnits[0]?.name || '',
      inventory_item_id: item.id
    });
    setSearchIngredient(item.name);
    setShowIngredientDropdown(false);
  };

  // ============ ADD INGREDIENT ============
  const handleAddIngredient = () => {
    if (!newIngredient.name || newIngredient.name.trim() === "") {
      toast.error('Please select an ingredient from the inventory');
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
        unit: newIngredient.unit,
        inventory_item_id: newIngredient.inventory_item_id
      }]
    });
    setNewIngredient({ 
      name: "", 
      quantity: "", 
      unit: ingredientUnits[0]?.name || '',
      inventory_item_id: null 
    });
    setSearchIngredient("");
    setShowIngredientDropdown(false);
    
    if (formErrors.ingredients) {
      setFormErrors({ ...formErrors, ingredients: "" });
    }
  };

  // ============ REMOVE INGREDIENT ============
  const handleRemoveIngredient = (index) => {
    const updatedIngredients = formData.ingredients.filter((_, i) => i !== index);
    setFormData({ ...formData, ingredients: updatedIngredients });
    
    if (formErrors.ingredients && updatedIngredients.length > 0) {
      setFormErrors({ ...formErrors, ingredients: "" });
    }
  };

  // ============ GET STATUS DETAILS ============
  const getStatusDetails = (product) => {
    const isActive = product?.is_active === true;
    const hasIngredients = product?.product_ingredients && product.product_ingredients.length > 0;
    
    const price = product?.price || 0;
    const cogs = price * 0.6;
    const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
    const isLowMargin = margin < 30 && price > 0;
    const isUnmapped = !hasIngredients;
    
    const createdDate = new Date(product?.created_at);
    const daysOld = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    const isNew = daysOld < 28 && isActive;
    const isDiscontinued = !isActive && daysOld > 28;
    
    let label = 'Active';
    let className = 'status-active';
    let dotColor = '#16a34a';
    let tooltip = 'This product is active and being forecasted.';
    
    if (isUnmapped) {
      label = 'Unmapped';
      className = 'status-unmapped';
      dotColor = '#9ca3af';
      tooltip = 'No ingredient recipe configured. This product cannot be included in ingredient demand estimates or the shopping list. Add a recipe using the Edit button.';
    } else if (isLowMargin && isActive) {
      label = 'Low Margin';
      className = 'status-low-margin';
      dotColor = '#ec4899';
      tooltip = 'This product has a profit margin below 30%. Consider adjusting price or reducing ingredient costs.';
    } else if (!isActive && isDiscontinued) {
      label = 'Discontinued';
      className = 'status-discontinued';
      dotColor = '#dc2626';
      tooltip = 'No sales recorded in 28 days. Excluded from forecasting until sales resume.';
    } else if (!isActive && isNew) {
      label = 'INACTIVE (NEW)';
      className = 'status-inactive-new';
      dotColor = '#f59e0b';
      tooltip = 'New product detected. Forecast will be available after 28 days of sales data.';
    } else if (!isActive) {
      label = 'INACTIVE';
      className = 'status-inactive';
      dotColor = '#6b7280';
      tooltip = 'Product is inactive.';
    }

    return { label, className, dotColor, tooltip, isActive, isUnmapped, isLowMargin, isNew, isDiscontinued };
  };

  // ============ SORT OPTIONS ============
  const sortOptions = [
    { value: "Newest First", label: "Newest First" },
    { value: "Oldest First", label: "Oldest First" },
    { value: "A-Z", label: "A to Z" },
    { value: "Z-A", label: "Z to A" },
    { value: "Price: Low to High", label: "Price: Low to High" },
    { value: "Price: High to Low", label: "Price: High to Low" },
  ];

  // ============ FILTERED DATA ============
  const getFilteredData = useMemo(() => {
    let filtered = [...mappingData];
    
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.name?.toLowerCase().includes(searchLower) ||
        item.category?.toLowerCase().includes(searchLower) ||
        item.product_ingredients?.some(pi => 
          pi.ingredients?.name?.toLowerCase().includes(searchLower)
        )
      );
    }

    if (selectedCategory !== 'All') {
      filtered = filtered.filter(item => item.category === selectedCategory);
    }

    switch(sortBy) {
      case 'Price: Low to High':
        filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
        break;
      case 'Price: High to Low':
        filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
        break;
      case 'A-Z':
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'Z-A':
        filtered.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
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

  // ============ PAGINATION ============
  const itemsPerPage = 10;
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

  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedLowMarginItem, setSelectedLowMarginItem] = useState(null);

  // Format currency
  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return '₱0.00';
    return `₱${parseFloat(amount).toFixed(2)}`;
  };

  // Format date
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

  // ============ STOCK LEGEND ============
  const stockLegend = [
    { label: 'Unmapped', color: '#9ca3af' },
    { label: 'Low Margin', color: '#ec4899' },
    { label: 'Active', color: '#16a34a' },
    { label: 'Inactive (New)', color: '#f59e0b' },
    { label: 'Inactive (Discontinued)', color: '#dc2626' }
  ];

  // Get count for each status
  const getStatusCounts = () => {
    let unmapped = 0;
    let lowMargin = 0;
    let active = 0;
    let inactiveNew = 0;
    let discontinued = 0;

    mappingData.forEach(item => {
      const status = getStatusDetails(item);
      if (status.isUnmapped) unmapped++;
      else if (status.isLowMargin && status.isActive) lowMargin++;
      else if (status.isActive) active++;
      else if (status.isNew && !status.isActive) inactiveNew++;
      else if (status.isDiscontinued) discontinued++;
    });

    return { unmapped, lowMargin, active, inactiveNew, discontinued };
  };

  const statusCounts = getStatusCounts();

  // Get sample data for tooltip
  const getTooltipData = () => {
    const sampleProducts = mappingData.slice(0, 6);
    const totalIngredientCost = sampleProducts.reduce((sum, item) => sum + ((item.price || 0) * 0.6), 0);
    const avgCogs = sampleProducts.length > 0 ? totalIngredientCost / sampleProducts.length : 0;
    const avgPrice = sampleProducts.length > 0 ? sampleProducts.reduce((sum, item) => sum + (item.price || 0), 0) / sampleProducts.length : 0;
    
    return { sampleProducts, totalIngredientCost, avgCogs, avgPrice };
  };

  const tooltipData = getTooltipData();

  // Static low margin items data for the tooltip
  const lowMarginTooltipData = [
    {
      name: 'Breaded Porkchop',
      sellingPrice: 79,
      ingredientCost: 62,
      profit: 17,
      margin: 21,
      description: "Only ₱17 stays with you after ingredients. Below 30% threshold."
    },
    {
      name: 'Adobo',
      sellingPrice: 110,
      ingredientCost: 88,
      profit: 22,
      margin: 20,
      description: "Sells for ₱110 but ingredients cost ₱88. Very little profit left. Below 30% threshold."
    }
  ];

  return (
    <div className="product-management-container">
      {/* Stats Cards - 4 Cards with Tooltips */}
      <div className="product-stats-cards">
        <div className="product-stat-card">
          <div className="product-stat-card-content">
            <div className="product-stat-card-header">
              <p className="product-stat-card-label">Total Menu Items</p>
              <Tippy
                content="All active menu items currently on your menu. Archived and inactive items are not counted."
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="product-card-info" tabIndex={0} aria-label="Total menu items information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="product-stat-card-value">{productStats.total_menu_items}</p>
            <p className="product-stat-card-change positive">Active products</p>
          </div>
        </div>

        <div className="product-stat-card">
          <div className="product-stat-card-content">
            <div className="product-stat-card-header">
              <p className="product-stat-card-label">Average COGS</p>
              <Tippy
                content={(
                  <div className="product-card-tooltip">
                    <strong>How Average COGS is computed</strong>
                    <table className="product-tooltip-table">
                      <thead>
                        <tr>
                          <th>Menu Item</th>
                          <th>Selling price</th>
                          <th>Ingredient cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tooltipData.sampleProducts.length > 0 ? (
                          tooltipData.sampleProducts.map((item, idx) => (
                            <tr key={idx}>
                              <td>{item.name}</td>
                              <td>{formatCurrency(item.price)}</td>
                              <td>{formatCurrency((item.price || 0) * 0.6)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="3">No products available</td>
                          </tr>
                        )}
                        {tooltipData.sampleProducts.length > 0 && (
                          <tr className="tooltip-total-row">
                            <td><strong>Total</strong></td>
                            <td>—</td>
                            <td><strong>{formatCurrency(tooltipData.totalIngredientCost)}</strong></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <div className="tooltip-calculation">
                      <span><strong>Calculation:</strong> {formatCurrency(tooltipData.totalIngredientCost)} total ingredient cost ÷ {tooltipData.sampleProducts.length || 1} dishes = <strong>{formatCurrency(tooltipData.avgCogs)}</strong> average per dish</span>
                    </div>
                    <span className="tooltip-note">
                      This means on average, you spend {formatCurrency(tooltipData.avgCogs)} in ingredients for every dish you prepare. If your average selling price is around {formatCurrency(tooltipData.avgPrice)}, then {formatCurrency(tooltipData.avgCogs)} of every dish's revenue goes back to buying ingredients.
                    </span>
                  </div>
                )}
                placement="top"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                maxWidth={420}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="product-card-info" tabIndex={0} aria-label="Average COGS information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="product-stat-card-value">₱ {productStats.avg_cogs.toFixed(2)}</p>
            <p className="product-stat-card-change">Cost of Goods Sold</p>
          </div>
        </div>

        <div className="product-stat-card warning">
          <div className="product-stat-card-content">
            <div className="product-stat-card-header">
              <p className="product-stat-card-label">Low Margin Items</p>
              <div className="product-card-header-actions">
                <Tippy
                  content={(
                    <div className="product-card-tooltip">
                      <strong>Low Margin Items</strong>
                      <span>These are menu items where most of your selling price goes to ingredients, leaving you with very little profit. For example, if a dish costs ₱80 in ingredients but you sell it for ₱95, only ₱15 stays with you — that's less than 20% of the price. This count shows how many of your items fall into that situation.</span>
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
                  <span className="product-card-info" tabIndex={0} aria-label="Low margin items information">
                    <FaInfoCircle />
                  </span>
                </Tippy>
                
                {/* ============ TOOLTIP ON EXPAND ICON WITH STATIC EXAMPLE ============ */}
                <Tippy
                  content={(
                    <div className="product-card-tooltip tooltip-expand-table">
                      <strong>Low Margin Items — the 2 menu items flagged</strong>
                      
                      {/* Breaded Porkchop */}
                      <div className="tooltip-low-margin-item">
                        <div className="tooltip-item-name">Breaded Porkchop</div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Selling price</span>
                          <span className="tooltip-item-value">₱79</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Ingredient cost</span>
                          <span className="tooltip-item-value negative">−₱62</span>
                        </div>
                        <div className="tooltip-item-divider"></div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit per menu</span>
                          <span className="tooltip-item-value profit">₱17</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit margin</span>
                          <span className="tooltip-item-value margin-low">21%</span>
                        </div>
                        <div className="tooltip-item-description">
                          Only ₱17 stays with you after ingredients. Below 30% threshold.
                        </div>
                      </div>

                      {/* Divider between items */}
                      <div className="tooltip-item-divider-full"></div>

                      {/* Adobo */}
                      <div className="tooltip-low-margin-item">
                        <div className="tooltip-item-name">Adobo</div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Selling price</span>
                          <span className="tooltip-item-value">₱110</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Ingredient cost</span>
                          <span className="tooltip-item-value negative">−₱88</span>
                        </div>
                        <div className="tooltip-item-divider"></div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit per menu</span>
                          <span className="tooltip-item-value profit">₱22</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit margin</span>
                          <span className="tooltip-item-value margin-low">20%</span>
                        </div>
                        <div className="tooltip-item-description">
                          Sells for ₱110 but ingredients cost ₱88. Very little profit left. Below 30% threshold.
                        </div>
                      </div>

                      <div className="tooltip-summary">
                        Most of the selling price is eaten up by ingredient cost. You can either raise the price, swap to cheaper ingredients, or accept the lower profit if these dishes attract more customers.
                      </div>
                      
               
                    </div>
                  )}
                  placement="top"
                  animation="scale"
                  duration={200}
                  theme="dark"
                  arrow
                  delay={[100, 0]}
                  maxWidth={420}
                  interactive
                  trigger="mouseenter focus click"
                  appendTo={() => document.body}
                  zIndex={100000}
                >
                  <span 
                    className="product-card-expand" 
                    tabIndex={0} 
                    aria-label="Expand low margin items"
                    onClick={() => {
                      const lowMarginItems = mappingData.filter(item => {
                        const price = item.price || 0;
                        const cogs = price * 0.6;
                        const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
                        return margin < 30 && price > 0;
                      });
                      if (lowMarginItems.length > 0) {
                        setSelectedLowMarginItem(lowMarginItems);
                        setIsLowMarginModalOpen(true);
                      }
                    }}
                    role="button"
                  >
                    <FaChevronDown />
                  </span>
                </Tippy>
              </div>
            </div>
            <div className="product-stock-alerts-group">
              <span className="alert-badge alert-unmapped" style={{ backgroundColor: '#9ca3af' }}>
                {statusCounts.unmapped}
              </span>
              <span className="alert-badge alert-low-margin" style={{ backgroundColor: '#ec4899' }}>
                {statusCounts.lowMargin}
              </span>
              <span className="alert-badge alert-active" style={{ backgroundColor: '#16a34a' }}>
                {statusCounts.active}
              </span>
              <span className="alert-badge alert-inactive-new" style={{ backgroundColor: '#f59e0b' }}>
                {statusCounts.inactiveNew}
              </span>
              <span className="alert-badge alert-discontinued" style={{ backgroundColor: '#dc2626' }}>
                {statusCounts.discontinued}
              </span>
            </div>
            <p className="product-stat-card-change">Product Status Counts</p>
          </div>
        </div>

        <div className="product-stat-card info">
          <div className="product-stat-card-content">
            <div className="product-stat-card-header">
              <p className="product-stat-card-label">Unmapped Products</p>
              <Tippy
                content="These are menu items that don't have an ingredient recipe added yet. Without a recipe, the system doesn't know what ingredients go into each dish, so it can't estimate how much to buy or include these items in the shopping list. Go to each unmapped product and add its ingredients to unlock the full shopping list and demand estimates."
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
                <span className="product-card-info" tabIndex={0} aria-label="Unmapped products information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="product-stat-card-value" style={{ color: '#9ca3af' }}>{productStats.unmapped_products}</p>
            <p className="product-stat-card-change">Missing ingredients</p>
          </div>
        </div>
      </div>

      {/* ============ STOCK LEGEND ============ */}
      <div className="inventory-legend-container">
        {stockLegend.map((legend, index) => (
          <div key={index} className="inventory-legend-item">
            <span className="legend-dot" style={{ backgroundColor: legend.color }}></span>
            <span className="legend-label">{legend.label}</span>
          </div>
        ))}
      </div>

   

      <div className="product-controls">
        <div className="search-wrapper">
          <FaSearch className="search-icon" />
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
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setSelectedCategory('All');
              setCurrentPage(1);
            }}
          >
            <option value="active">Active products</option>
            <option value="inactive">Inactive products</option>
          </select>
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
            className="btn-primary"
            onClick={() => {
              resetForm();
              setIsEditMode(false);
              setIsViewMode(false);
              setIsModalOpen(true);
            }}
          >
            <FaPlus /> Add Product
          </button>
        </div>
      </div>

      <div className="product-section">
        <div className="product-table-wrapper">
          {loading ? (
            <div className="loading-state">Loading products...</div>
          ) : currentData.length === 0 ? (
            <div className="empty-state">No products found for this view.</div>
          ) : (
            <table className="product-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Item Name</th>
                  <th>Category</th>
                  <th>Modifier</th>
                  <th>Ingredients</th>
                  <th>Selling Price</th>
                  <th>Total Ingredient Cost</th>
                  <th>Status</th>
                  <th>Date Created</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentData.map((item, index) => {
                  const status = getStatusDetails(item);
                  const totalIngredientCost = item.product_ingredients?.reduce((sum, pi) => {
                    const price = pi.ingredients?.price || 0;
                    const qty = pi.quantity_per_serving || 0;
                    return sum + (price * qty);
                  }, 0) || 0;

                  return (
                    <tr key={item.id}>
                      <td>{startIndex + index + 1}</td>
                      <td className="product-item-name">{item.name}</td>
                      <td><span className="product-category-badge">{item.category || 'Uncategorized'}</span></td>
                      <td>{item.serving_size_label || '—'}</td>
                      <td className="ingredients-cell">
                        {item.product_ingredients && item.product_ingredients.length > 0 ? (
                          <div className="ingredients-list">
                            {item.product_ingredients.slice(0, 3).map((pi, i) => (
                              <span key={i} className="ingredient-tag">
                                {pi.ingredients?.name || 'Unknown'}
                                {pi.quantity_per_serving && ` (${pi.quantity_per_serving}${pi.ingredients?.unit || ''})`}
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
                      <td className="price-cell">{formatCurrency(item.price)}</td>
                      <td>{formatCurrency(totalIngredientCost)}</td>
                      <td>
                        <div className="status-pill-group">
                          <span className={`product-status-badge ${status.className}`}>
                            <span className="product-status-dot" style={{ backgroundColor: status.dotColor }}></span>
                            {status.label}
                          </span>
                          {status.isUnmapped || status.isLowMargin || !status.isActive ? (
                            <span className="status-info-wrapper" title={status.tooltip}>
                              <FaInfoCircle size={12} className="status-info-icon" />
                              <span className="status-tooltip">{status.tooltip}</span>
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{formatDate(item.created_at)}</td>
                      <td>{formatDate(item.updated_at)}</td>
                      <td>
                        <div className="product-action-buttons">
                          <button 
                            className="product-action-btn edit"
                            onClick={() => handleEdit(item)}
                            title="Edit Product"
                          >
                            <FaEdit size={14} />
                          </button>
                          {status.isActive ? (
                            <button 
                              className="product-action-btn archive"
                              onClick={() => handleArchive(item)}
                              title="Archive"
                            >
                              <FaArchive size={14} />
                            </button>
                          ) : (
                            <button 
                              className="product-action-btn reactivate"
                              onClick={() => handleReactivate(item)}
                              title="Reactivate"
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
                <FaChevronLeft /> Previous
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
                Next <FaChevronRight />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ============ LOW MARGIN MODAL ============ */}
      {isLowMarginModalOpen && selectedLowMarginItem && (
        <div className="modal-overlay" onClick={() => setIsLowMarginModalOpen(false)}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Low Margin Items</h3>
              <button className="modal-close-btn" onClick={() => setIsLowMarginModalOpen(false)}>
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <div className="low-margin-content">
                <p className="low-margin-description">
                  Low margin items — the {Array.isArray(selectedLowMarginItem) ? selectedLowMarginItem.length : 1} menu item{Array.isArray(selectedLowMarginItem) && selectedLowMarginItem.length > 1 ? 's' : ''} flagged
                </p>
                
                {/* Table View */}
                <div className="low-margin-table-wrapper">
                  <table className="low-margin-table">
                    <thead>
                      <tr>
                        <th>Menu Item</th>
                        <th>Selling Price</th>
                        <th>Ingredient Cost</th>
                        <th>Profit per Menu</th>
                        <th>Profit Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray(selectedLowMarginItem) ? (
                        selectedLowMarginItem.map((item, idx) => {
                          const price = item.price || 0;
                          const cogs = price * 0.6;
                          const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
                          const profit = price - cogs;
                          return (
                            <tr key={idx} className={margin < 20 ? 'very-low-margin-row' : 'low-margin-row'}>
                              <td><strong>{item.name}</strong></td>
                              <td className="price-amount">{formatCurrency(price)}</td>
                              <td className="cost-amount">−{formatCurrency(cogs)}</td>
                              <td className="profit-amount">{formatCurrency(profit)}</td>
                              <td>
                                <span className={`margin-badge ${margin < 20 ? 'very-low' : 'low'}`}>
                                  {margin.toFixed(0)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="low-margin-summary">
                  <p>Most of the selling price is eaten up by ingredient cost. You can either raise the price, swap to cheaper ingredients, or accept the lower profit if these dishes attract more customers.</p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsLowMarginModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL (Add/Edit/View) ============ */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{isViewMode ? 'Product Details' : (isEditMode ? 'Edit Product' : 'Add New Product')}</h3>
              <button className="modal-close-btn" onClick={closeModal} disabled={isSaving}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Product Name <span className="required-star">*</span></label>
                  <input
                    type="text"
                    placeholder="Enter product name"
                    value={formData.productName}
                    onChange={(e) => {
                      if (!isViewMode) {
                        setFormData({...formData, productName: e.target.value});
                        if (formErrors.productName) {
                          setFormErrors({...formErrors, productName: ""});
                        }
                      }
                    }}
                    readOnly={isViewMode}
                    className={`form-input ${formErrors.productName ? 'error' : ''} ${isViewMode ? 'readonly' : ''}`}
                  />
                  {formErrors.productName && (
                    <span className="error-text">{formErrors.productName}</span>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Price <span className="required-star">*</span></label>
                  <input
                    type="number"
                    placeholder="Enter product price"
                    value={formData.price}
                    onChange={(e) => {
                      if (!isViewMode) {
                        setFormData({...formData, price: e.target.value});
                        if (formErrors.price) {
                          setFormErrors({...formErrors, price: ""});
                        }
                      }
                    }}
                    readOnly={isViewMode}
                    step="0.01"
                    min="0.01"
                    className={`form-input ${formErrors.price ? 'error' : ''} ${isViewMode ? 'readonly' : ''}`}
                  />
                  {formErrors.price && (
                    <span className="error-text">{formErrors.price}</span>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Category <span className="required-star">*</span></label>
                {isViewMode ? (
                  <input
                    type="text"
                    value={formData.category}
                    readOnly
                    className="form-input readonly"
                  />
                ) : (
                  <select
                    className={`form-input ${formErrors.category ? 'error' : ''}`}
                    value={formData.category}
                    onChange={(e) => {
                      setFormData({...formData, category: e.target.value});
                      if (formErrors.category) {
                        setFormErrors({...formErrors, category: ""});
                      }
                    }}
                  >
                    <option value="">Select Category</option>
                    {categories.filter(cat => cat !== 'All').map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                )}
                {formErrors.category && (
                  <span className="error-text">{formErrors.category}</span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Serving Size Label</label>
                <input
                  type="text"
                  placeholder="e.g., serving, kg, pcs, L"
                  value={formData.servingSize}
                  onChange={(e) => {
                    if (!isViewMode) {
                      setFormData({...formData, servingSize: e.target.value});
                    }
                  }}
                  readOnly={isViewMode}
                  className={`form-input ${isViewMode ? 'readonly' : ''}`}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Ingredients <span className="required-star">*</span></label>
                
                {!isViewMode && (
                  <div className="ingredient-input-row">
                    <div className="ingredient-search-wrapper" style={{ position: 'relative', flex: 2 }}>
                      <input
                        type="text"
                        placeholder="Search in-stock inventory for ingredient..."
                        className="ingredient-name-input"
                        value={searchIngredient}
                        onChange={(e) => {
                          setSearchIngredient(e.target.value);
                          setShowIngredientDropdown(true);
                          if (e.target.value === '') {
                            setNewIngredient({ 
                              name: "", 
                              quantity: "", 
                              unit: ingredientUnits[0]?.name || '',
                              inventory_item_id: null 
                            });
                          }
                        }}
                        onFocus={() => {
                          if (inventoryItems.length > 0) {
                            setShowIngredientDropdown(true);
                          } else {
                            fetchInventoryItems();
                          }
                        }}
                        onBlur={() => {
                          setTimeout(() => setShowIngredientDropdown(false), 200);
                        }}
                      />
                      {loadingIngredients && (
                        <div className="ingredient-dropdown-loading">
                          Loading inventory items...
                        </div>
                      )}
                      {showIngredientDropdown && !loadingIngredients && filteredInventoryItems.length > 0 && (
                        <div className="ingredient-dropdown">
                          <div className="ingredient-dropdown-header">
                            In-Stock Items ({filteredInventoryItems.length})
                          </div>
                          {filteredInventoryItems.map(item => (
                            <div
                              key={item.id}
                              className="ingredient-dropdown-item"
                              onClick={() => handleSelectIngredient(item)}
                            >
                              <span>{item.name}</span>
                              <span className="ingredient-dropdown-stock">
                                {item.category} • {item.quantity} {item.unit || 'pcs'} in stock
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {showIngredientDropdown && !loadingIngredients && searchIngredient && filteredInventoryItems.length === 0 && inventoryItems.length > 0 && (
                        <div className="ingredient-dropdown-empty">
                          No matching in-stock items found
                        </div>
                      )}
                      {showIngredientDropdown && !loadingIngredients && inventoryItems.length === 0 && (
                        <div className="ingredient-dropdown-empty">
                          No in-stock items available. Please add items to inventory first.
                        </div>
                      )}
                    </div>
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
                      {ingredientUnits.map((unit) => (
                        <option key={unit.id || unit.name} value={unit.name}>{unit.name}</option>
                      ))}
                    </select>
                    <button 
                      className="btn-add-ingredient"
                      onClick={handleAddIngredient}
                    >
                      <FaPlus /> Add
                    </button>
                  </div>
                )}

                <div className={`ingredients-table-wrapper ${formErrors.ingredients ? 'error-border' : ''}`}>
                  <table className="ingredients-modal-table">
                    <thead>
                      <tr>
                        <th>Ingredient Name</th>
                        <th>Quantity</th>
                        <th>Unit</th>
                        {!isViewMode && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {formData.ingredients.length === 0 ? (
                        <tr>
                          <td colSpan={isViewMode ? 3 : 4} className="empty-row">
                            No ingredients added yet
                          </td>
                        </tr>
                      ) : (
                        formData.ingredients.map((ing, index) => (
                          <tr key={index}>
                            <td>
                              {ing.name}
                              {ing.inventory_item_id && (
                                <span className="ingredient-id-tag">(ID: {ing.inventory_item_id})</span>
                              )}
                            </td>
                            <td>{ing.quantity}</td>
                            <td>{ing.unit}</td>
                            {!isViewMode && (
                              <td>
                                <button 
                                  className="action-btn remove-ingredient"
                                  onClick={() => handleRemoveIngredient(index)}
                                  title="Remove ingredient"
                                >
                                  <FaTrash size={16} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {formErrors.ingredients && (
                    <span className="error-text">{formErrors.ingredients}</span>
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
                {isViewMode ? 'Close' : 'Cancel'}
              </button>
              {!isViewMode && (
                <button 
                  className="btn-primary" 
                  onClick={handleSaveMapping}
                  disabled={isSaving}
                >
                  <FaSave /> 
                  {isSaving ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update' : 'Create')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ ARCHIVE CONFIRMATION MODAL ============ */}
      {isArchiveModalOpen && selectedItem && (
        <div className="modal-overlay" onClick={() => {
          if (!isArchiving) setIsArchiveModalOpen(false);
        }}>
          <div className="modal-content modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Archive Product</h3>
              <button className="modal-close-btn" onClick={() => {
                if (!isArchiving) setIsArchiveModalOpen(false);
              }} disabled={isArchiving}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="confirmation-content">
                <div className="confirmation-icon warning">
                  <FaArchive size={32} />
                </div>
                <h4>Archive this product?</h4>
                <p>
                  You are about to archive <strong>"{selectedItem.name}"</strong>.
                  Archived products will be hidden from the active product list.
                </p>
                <div className="item-details">
                  <p><strong>Category:</strong> {selectedItem.category || 'Uncategorized'}</p>
                  <p><strong>Price:</strong> {formatCurrency(selectedItem.price)}</p>
                  <p><strong>Status:</strong> {selectedItem.is_active ? 'Active' : 'Inactive'}</p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => setIsArchiveModalOpen(false)}
                disabled={isArchiving}
              >
                Cancel
              </button>
              <button 
                className="btn-warning" 
                onClick={confirmArchive}
                disabled={isArchiving}
              >
                {isArchiving ? 'Archiving...' : <><FaArchive /> Archive</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductManagement;