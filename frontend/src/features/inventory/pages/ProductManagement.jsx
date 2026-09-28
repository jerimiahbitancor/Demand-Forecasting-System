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
  FaChevronDown,
  FaEye,
  FaUndo,
  FaCheck,
} from "react-icons/fa";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./ProductManagement.css";
import "../InventoryControls.css";
import { useAuth } from "../../../context/AuthContext";
import { normalizeRecipeQuantityToUnit, RECIPE_EXTRA_UNITS, RECIPE_VOLUME_UNITS, RECIPE_MASS_UNITS, recipeDensityFor, pieceWeightOf, priceRecipeIngredient, parseRecipeQuantity } from "../../../utils/recipeUnits";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import ProductDetailsModal from '../product modals/ProductDetailsModal';
import ProductRestoreModal from '../product modals/ProductRestoreModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const calculateProductCogs = (product) => {
  if (!product?.product_ingredients?.length) return null;
  return product.product_ingredients.reduce((total, ingredient) => {
    const ingredientPrice = Number(ingredient.ingredients?.price) || 0;
    // The recipe's stored unit (ingredient.unit) may differ from the
    // ingredient's stock/price unit (ingredient.ingredients.unit). Convert so
    // "price x quantity" is always in the unit the price is quoted in.
    const ingredientUnit = ingredient.ingredients?.unit || null;
    const recipeUnit = ingredient.unit || ingredientUnit;
    const gramsPerCup = recipeDensityFor(
      ingredient.ingredients?.grams_per_cup,
      ingredient.ingredients?.name
    );
    const pieceWeight = pieceWeightOf(ingredient.ingredients?.name, ingredient.unit || ingredientUnit);
    const quantity = Number(
      normalizeRecipeQuantityToUnit(ingredient.quantity_per_serving, recipeUnit, ingredientUnit, gramsPerCup, pieceWeight)
    ) || 0;
    return total + ingredientPrice * quantity;
  }, 0);
};

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

// Granular client-side filters (new/discontinued/unmapped/high-food-cost) all
// fetch the same "all products (excluding archived)" dataset from the API,
// then apply their own derived-status filter on the client.
const apiStatusForFilter = (filter) =>
  filter === 'archived' ? 'archived'
    : 'all';

const cacheSuffixForFilter = (filter) => {
  const api = apiStatusForFilter(filter);
  return api === 'all' ? '_all' : `_${api}`;
};

const ProductManagement = () => {
  const { getToken } = useAuth();

  // Refs
  const isInitialMount = useRef(true);
  const fetchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

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
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isProductDetailsModalOpen, setIsProductDetailsModalOpen] = useState(false);
  const [isLowMarginModalOpen, setIsLowMarginModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkArchiveOpen, setIsBulkArchiveOpen] = useState(false);
  // Owner-configurable via Settings > Forecast Configuration (defaults
  // to 35%, the settled spec value — see forecast_config.food_cost_warning_threshold).
  const [foodCostThreshold, setFoodCostThreshold] = useState(35);
  
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
    return 'all';
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

  // ============ INLINE INGREDIENT EDITING ============
  const [editingIngredientIndex, setEditingIngredientIndex] = useState(null);
  const [draftIngredient, setDraftIngredient] = useState(null);

  const availableIngredientUnits = useMemo(() => [
    ...new Set([
      ...RECIPE_EXTRA_UNITS,
      ...ingredientUnits.map((unit) => unit.name)
    ])
  ], [ingredientUnits]);

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

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/settings/forecast-config')
      .then((response) => {
        if (!cancelled && response.data.success && response.data.data.food_cost_warning_threshold != null) {
          setFoodCostThreshold(response.data.data.food_cost_warning_threshold);
        }
      })
      .catch((error) => console.error('Error fetching food cost threshold:', error));
    return () => { cancelled = true; };
  }, [apiClient]);

  // ============ UPDATE STATS ============
  const updateStats = useCallback((items) => {
    const total = items.length;
    
    const mappedItems = items.filter(item => calculateProductCogs(item) !== null);
    const totalCOGS = mappedItems.reduce((sum, item) => sum + calculateProductCogs(item), 0);
    const avgCOGS = mappedItems.length > 0 ? totalCOGS / mappedItems.length : 0;
    
    const lowMarginProducts = items.filter(item => {
      if (!item.product_ingredients?.length) return false;
      const price = Number(item.price) || 0;
      const cogs = calculateProductCogs(item);
      const foodCostPercentage = price > 0 ? (cogs / price) * 100 : null;
      return foodCostPercentage !== null && foodCostPercentage > foodCostThreshold;
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
  }, [foodCostThreshold]);

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
      
      const cacheSuffix = cacheSuffixForFilter(statusFilter);
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
          status: apiStatusForFilter(statusFilter),
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
        const cacheSuffix = cacheSuffixForFilter(statusFilter);
        sessionStorage.setItem(STORAGE_KEYS.MAPPING_DATA + cacheSuffix, JSON.stringify(data));
        sessionStorage.setItem(STORAGE_KEYS.TOTAL_PRODUCTS + cacheSuffix, data.length.toString());
        sessionStorage.setItem(STORAGE_KEYS.LAST_FETCH + cacheSuffix, Date.now().toString());
      }

      const categoriesResponse = await apiClient.get('/mapping/categories', {
        params: {
          status: apiStatusForFilter(statusFilter),
          forceRefresh: 'true'
        }
      });
      
      if (categoriesResponse.data.success) {
        const cats = categoriesResponse.data.data || ['All'];
        setCategories(cats);
        const cacheSuffix = cacheSuffixForFilter(statusFilter);
        sessionStorage.setItem(STORAGE_KEYS.CATEGORIES + cacheSuffix, JSON.stringify(cats));
      }

      try {
        const productCategoriesResponse = await apiClient.get('/product-categories');
        if (productCategoriesResponse.data.success) {
          const productCategories = productCategoriesResponse.data.data || [];
          const productCategoryNames = ['All', ...productCategories.map((category) => category.name)];
          setCategories(productCategoryNames);
          const cacheSuffix = cacheSuffixForFilter(statusFilter);
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

  // ============ EFFECTS ============
  useEffect(() => {
    const cacheSuffix = cacheSuffixForFilter(statusFilter);
    sessionStorage.setItem(STORAGE_KEYS.MAPPING_DATA + cacheSuffix, JSON.stringify(mappingData));
  }, [mappingData, statusFilter]);

  useEffect(() => {
    const cacheSuffix = cacheSuffixForFilter(statusFilter);
    sessionStorage.setItem(STORAGE_KEYS.CATEGORIES + cacheSuffix, JSON.stringify(categories));
  }, [categories, statusFilter]);

  useEffect(() => {
    const cacheSuffix = cacheSuffixForFilter(statusFilter);
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
        fetchData(true);
      }, 100);
    } else {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
      fetchTimeoutRef.current = setTimeout(() => {
        fetchData(true);
      }, 300);
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData, searchTerm, selectedCategory, sortBy, statusFilter, currentPage]);

  useEffect(() => {
    const handleProductsUpdated = () => {
      console.log('Product catalog changed from upload; force-refreshing Product Management');

      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith('mapping_')) {
          sessionStorage.removeItem(key);
        }
      });

      fetchData(true);
    };

    window.addEventListener('products:updated', handleProductsUpdated);

    return () => {
      window.removeEventListener('products:updated', handleProductsUpdated);
    };
  }, [fetchData]);

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
        const quantity = parseRecipeQuantity(ingredient.quantity);

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
          quantity: String(ing.quantity ?? '').trim() || '1',
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
    setEditingIngredientIndex(null);
    setDraftIngredient(null);
    setFormData({
      productName: product.name || '',
      price: product.price?.toString() || '',
      category: product.category || '',
      servingSize: product.serving_size_label || '',
      ingredients: product.product_ingredients && product.product_ingredients.length > 0 
        ? product.product_ingredients.map(pi => ({
            name: pi.ingredients?.name || '',
            quantity: pi.quantity_per_serving?.toString() || '',
            unit: pi.unit || pi.ingredients?.unit || 'kg',
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
    setEditingIngredientIndex(null);
    setDraftIngredient(null);
    setFormData({
      productName: product.name || '',
      price: product.price?.toString() || '',
      category: product.category || '',
      servingSize: product.serving_size_label || '',
      ingredients: product.product_ingredients && product.product_ingredients.length > 0 
        ? product.product_ingredients.map(pi => ({
            name: pi.ingredients?.name || '',
            quantity: pi.quantity_per_serving?.toString() || '',
            unit: pi.unit || pi.ingredients?.unit || 'kg',
            inventory_item_id: pi.inventory_item_id || null
          }))
        : []
    });
    setFormErrors({ productName: "", price: "", category: "", ingredients: "" });
    setIsModalOpen(true);
  };

  // ============ HANDLE ARCHIVE ==========
  const handleArchive = (product) => {
    setSelectedItem(product);
    setIsArchiveModalOpen(true);
  };

  const handleViewDetails = (product) => {
    setSelectedItem(product);
    setIsProductDetailsModalOpen(true);
  };

  // ============ BULK SELECTION HANDLERS ============
  const toggleSelectItem = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const selectableIds = currentData.filter((i) => {
      const st = getStatusDetails(i);
      return !st.isArchived;
    }).map((i) => i.id);
    const allSelected =
      selectableIds.length > 0 &&
      selectableIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : selectableIds);
  };

  const selectedNamesList = (() => {
    const names = selectedIds
      .map((id) => mappingData.find((i) => i.id === id)?.name)
      .filter(Boolean);
    if (names.length > 5) return `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`;
    return names.join(', ') || 'N/A';
  })();

  const handleBulkArchive = async () => {
    const idsToArchive = selectedIds.filter((id) => {
      const item = mappingData.find((i) => i.id === id);
      if (!item) return false;
      const st = getStatusDetails(item);
      return !st.isArchived;
    });
    if (!idsToArchive.length) {
      toast.error('No archivable products are selected to archive');
      setIsBulkArchiveOpen(false);
      return;
    }

    setIsArchiving(true);
    let archived = 0;
    try {
      for (const id of idsToArchive) {
        const response = await apiClient.post(`/mapping/products/${id}/archive`, {
          reason: 'Archived by user'
        });
        if (response.data.success) archived += 1;
      }
      toast.success(`${archived} product(s) archived successfully!`);
      setIsBulkArchiveOpen(false);
      setSelectedIds([]);
      await fetchData(true);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to archive selected products');
    } finally {
      setIsArchiving(false);
    }
  };

  const openRestoreModal = (product) => {
    setSelectedItem(product);
    setIsRestoreModalOpen(true);
  };

  const confirmRestore = async () => {
    if (!selectedItem) return;

    setIsArchiving(true);
    const restoreToast = toast.loading('Restoring product...');

    try {
      const response = await apiClient.post(`/mapping/products/${selectedItem.id}/reactivate`, {
        forceReactivate: true
      });

      toast.dismiss(restoreToast);

      if (response.data.success) {
        toast.success('Product restored successfully!');
        setIsRestoreModalOpen(false);
        setIsProductDetailsModalOpen(false);
        setSelectedItem(null);
        await fetchData(true);
      }
    } catch (error) {
      toast.dismiss(restoreToast);
      toast.error(error.response?.data?.error || 'Failed to restore product');
    } finally {
      setIsArchiving(false);
    }
  };

  // ============ CONFIRM ARCHIVE ==========
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
      }
    } catch (error) {
      toast.dismiss(archiveToast);
      console.error('Error archiving product:', error);
      toast.error(error.response?.data?.error || 'Failed to archive product');
    } finally {
      setIsArchiving(false);
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
    setEditingIngredientIndex(null);
    setDraftIngredient(null);
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
    
    const addQuantity = parseRecipeQuantity(newIngredient.quantity);
    if (isNaN(addQuantity) || addQuantity <= 0) {
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

    const inventoryItem = inventoryItems.find(i => i.id === newIngredient.inventory_item_id) || null;
    // Store the quantity exactly as typed, alongside the unit the user chose.
    // Conversion to the ingredient's stock/price unit happens at read time
    // (COGS here, ingredient demand in analyticsService, stock deductions in
    // uploadService) so "1 cup" stays "1 cup" in the recipe.
    const usedUnit = newIngredient.unit || inventoryItem?.unit || 'kg';

    setFormData({
      ...formData,
      ingredients: [...formData.ingredients, { 
        name: newIngredient.name.trim(),
        quantity: newIngredient.quantity.trim(),
        unit: usedUnit,
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

  // ============ LIVE INGREDIENT COST PREVIEW ============
  // Recomputes automatically whenever the user picks an ingredient, types a
  // quantity, or changes the unit: converted amount (into the ingredient's
  // purchase unit), cost of the amount used, and a warning when a volume
  // recipe unit needs a density that isn't set.
  const costPreview = useMemo(() => {
    const item = inventoryItems.find(i => i.id === newIngredient.inventory_item_id) || null;
    if (!item) return null;
    const qty = parseRecipeQuantity(newIngredient.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const unitPrice = Number(item.price) || 0;
    const gramsPerCup = recipeDensityFor(item.grams_per_cup, item.name);
    const pieceWeight = pieceWeightOf(item.name, newIngredient.unit);
    const converted = normalizeRecipeQuantityToUnit(qty, newIngredient.unit, item.unit, gramsPerCup, pieceWeight);
    const from = String(newIngredient.unit || '').trim().toLowerCase();
    const to = String(item.unit || '').trim().toLowerCase();
    const volumeToMass = RECIPE_VOLUME_UNITS.has(from) && RECIPE_MASS_UNITS.has(to);
    return {
      name: item.name,
      qty,
      unit: newIngredient.unit,
      stockUnit: item.unit,
      converted,
      cost: converted * unitPrice,
      unitPrice,
      gramsPerCup,
      pieceWeight,
      needsDensity: volumeToMass && !gramsPerCup
    };
  }, [inventoryItems, newIngredient.inventory_item_id, newIngredient.quantity, newIngredient.unit]);

  // ============ PER-INGREDIENT COST (TABLE) ============
  // Cost of each added ingredient, using the same conversion math as the live
  // preview and the COGS calculation. When the ingredient has no matching
  // inventory item (no recorded price) its cost shows as N/A.
  const ingredientRowCost = useCallback((ing) => {
    if (!ing) return null;
    const item = inventoryItems.find(i => i.id === ing.inventory_item_id)
      || inventoryItems.find(i =>
        String(i.name || '').trim().toLowerCase() === String(ing.name || '').trim().toLowerCase()
      );
    if (!item) return null;
    const unitPrice = Number(item.price) || 0;
    const qty = parseRecipeQuantity(ing.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const { cost } = priceRecipeIngredient({
      quantity: qty,
      recipeUnit: ing.unit || item.unit,
      stockUnit: item.unit,
      price: unitPrice,
      gramsPerCup: item.grams_per_cup,
      ingredientName: item.name
    });
    return Number.isFinite(cost) && cost > 0 ? cost : null;
  }, [inventoryItems]);

  const totalIngredientCost = useMemo(() => {
    const costs = formData.ingredients.map(ingredientRowCost);
    const known = costs.filter((c) => c !== null);
    return known.length > 0 ? known.reduce((sum, c) => sum + c, 0) : null;
  }, [formData.ingredients, ingredientRowCost]);

  // ============ REMOVE INGREDIENT ============
  const handleRemoveIngredient = (index) => {
    const updatedIngredients = formData.ingredients.filter((_, i) => i !== index);
    setFormData({ ...formData, ingredients: updatedIngredients });
    
    if (editingIngredientIndex === index) {
      setEditingIngredientIndex(null);
      setDraftIngredient(null);
    }
    
    if (formErrors.ingredients && updatedIngredients.length > 0) {
      setFormErrors({ ...formErrors, ingredients: "" });
    }
  };

  // ============ INLINE EDIT INGREDIENT ============
  const startEditingIngredient = (index) => {
    setEditingIngredientIndex(index);
    setDraftIngredient({ ...formData.ingredients[index] });
  };

  const handleDraftIngredientChange = (field, value) => {
    setDraftIngredient(prev => ({ ...prev, [field]: value }));
  };

  const cancelIngredientEdit = () => {
    setEditingIngredientIndex(null);
    setDraftIngredient(null);
  };

  const confirmIngredientEdit = (index) => {
    if (!draftIngredient) return;

    const name = String(draftIngredient.name || '').trim();
    const quantity = parseRecipeQuantity(draftIngredient.quantity);

    if (!name) {
      toast.error('Ingredient name is required');
      return;
    }

    if (draftIngredient.quantity === undefined || draftIngredient.quantity === null || draftIngredient.quantity === '') {
      toast.error('Ingredient quantity is required');
      return;
    }

    if (isNaN(quantity) || quantity <= 0) {
      toast.error('Quantity must be a valid number greater than 0');
      return;
    }

    const duplicate = formData.ingredients.some((existing, i) =>
      i !== index && String(existing.name || '').toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      toast.error('This ingredient already exists in the list');
      return;
    }

    const updatedIngredients = [...formData.ingredients];
    updatedIngredients[index] = {
      ...draftIngredient,
      name,
      quantity: String(draftIngredient.quantity).trim()
    };

    setFormData({ ...formData, ingredients: updatedIngredients });
    setEditingIngredientIndex(null);
    setDraftIngredient(null);

    if (formErrors.ingredients) {
      setFormErrors({ ...formErrors, ingredients: "" });
    }
  };

  // ============ GET STATUS DETAILS ============
  // Primary status comes from the product lifecycle (Active / Inactive (New) /
  // Inactive (Discontinued) / Archived). Unmapped and High Food Cost are
  // SECONDARY indicators shown alongside the primary status. They are mutually
  // exclusive: High Food Cost requires a COGS calculation, and COGS requires a
  // recipe, so an unmapped product can never be flagged High Food Cost.
  const getStatusDetails = (product) => {
    const lifecycleStatus = product?.status || null;
    const isActive = lifecycleStatus ? lifecycleStatus === 'active' : product?.is_active === true;
    const hasIngredients = Array.isArray(product?.product_ingredients)
      && product.product_ingredients.length > 0;
    const isArchived = lifecycleStatus === 'archived' || product?.is_archived === true
      || /^archived\b/i.test(product?.inactive_reason || '');

    const price = product?.price || 0;
    const cogs = calculateProductCogs(product);
    const foodCostPercentage = cogs !== null && price > 0 ? (cogs / price) * 100 : null;
    const isMapped = hasIngredients;
    const isUnmapped = !isMapped;
    const isHighFoodCost = isMapped && foodCostPercentage !== null
      && foodCostPercentage > foodCostThreshold;

    const createdDate = new Date(product?.created_at);
    const daysOld = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    const isNew = lifecycleStatus === 'new' || (!lifecycleStatus && daysOld < 28);
    const isDiscontinued = lifecycleStatus === 'inactive' || (!lifecycleStatus && !isActive && daysOld > 28);

    let label = 'Active';
    let className = 'status-active';
    let dotColor = '#16a34a';
    let tooltip = 'Included in forecasting, ingredient demand estimation, automatic stock deduction, and COGS/food cost calculation.';

    if (isArchived) {
      label = 'Archived';
      className = 'status-archived';
      dotColor = '#6b7280';
      tooltip = 'Removed from the active product list. Excluded from forecasting and ingredient demand estimation. Historical data is retained. Can be restored by the owner.';
    } else if (isDiscontinued) {
      label = 'INACTIVE (DISCONTINUED)';
      className = 'status-discontinued';
      dotColor = '#dc2626';
      tooltip = 'No sales recorded in the last 28 days. Excluded from active forecasting until sales activity resumes. Historical sales data is retained.';
    } else if (isNew) {
      label = 'INACTIVE (NEW)';
      className = 'status-inactive-new';
      dotColor = '#f59e0b';
      tooltip = hasIngredients
        ? 'New product with a recipe. COGS and Food Cost Percentage are calculated. Forecasting becomes available after the required 28-day minimum sales history is reached.'
        : 'New product. Requires a recipe configuration and the 28-day minimum sales history before forecasting is available.';
    }

    const indicators = [];
    if (!isArchived) {
      if (isUnmapped) {
        indicators.push({
          key: 'unmapped',
          label: 'UNMAPPED',
          className: 'status-unmapped',
          dotColor: '#9ca3af',
          tooltip: isNew
            ? 'Requires a recipe configuration and at least 28 days of sales data before forecasting is available.'
            : isDiscontinued
              ? 'No sales for 28+ days. Requires a recipe configuration. Excluded from forecasting until sales resume.'
              : 'No ingredient recipe configured. Included in forecasting but excluded from ingredient demand estimation, automatic stock deduction, and COGS/food cost calculation. Add a recipe using the Edit button.',
        });
      } else if (isHighFoodCost) {
        indicators.push({
          key: 'high-food-cost',
          label: 'HIGH FOOD COST',
          className: 'status-low-margin',
          dotColor: '#ec4899',
          tooltip: `This product's Food Cost Percentage (${foodCostPercentage.toFixed(1)}%) is above the ${foodCostThreshold}% warning threshold. COGS and Food Cost Percentage are calculated from the recipe. Consider reviewing the selling price, recipe, portion size, or ingredient costs.`,
        });
      }
    }

    return {
      label,
      className,
      dotColor,
      tooltip,
      isActive,
      isArchived,
      isUnmapped,
      isMapped,
      isHighFoodCost,
      hasIngredients,
      cogs,
      foodCostPercentage,
      isNew,
      isDiscontinued,
      indicators,
    };
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

    if (statusFilter === 'active' || statusFilter === 'new' || statusFilter === 'discontinued'
      || statusFilter === 'unmapped' || statusFilter === 'high-food-cost') {
      filtered = filtered.filter((item) => {
        const st = getStatusDetails(item);
        if (st.isArchived) return false;
        switch (statusFilter) {
          case 'active': return st.isActive;
          case 'new': return st.isNew;
          case 'discontinued': return st.isDiscontinued;
          case 'unmapped': return st.isUnmapped;
          case 'high-food-cost': return st.isHighFoodCost;
          default: return true;
        }
      });
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
  }, [mappingData, searchTerm, selectedCategory, sortBy, statusFilter, foodCostThreshold]);

  // ============ PAGINATION ============
  const itemsPerPage = 10;
  const totalPages = Math.ceil(getFilteredData.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = getFilteredData.slice(startIndex, startIndex + itemsPerPage);

  const allPageSelected =
    currentData.filter((i) => {
      const st = getStatusDetails(i);
      return !st.isArchived;
    }).length > 0 &&
    currentData
      .filter((i) => {
        const st = getStatusDetails(i);
        return !st.isArchived;
      })
      .every((i) => selectedIds.includes(i.id));

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
    return `₱${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    { label: 'Archived', color: '#6b7280' },
    { label: 'Unmapped', color: '#9ca3af' },
    { label: 'High Food Cost', color: '#ec4899' },
    { label: 'Active', color: '#16a34a' },
    { label: 'Inactive (New)', color: '#f59e0b' },
    { label: 'Inactive (Discontinued)', color: '#dc2626' }
  ];

  const highFoodCostItems = mappingData.filter(item => {
    const st = getStatusDetails(item);
    const price = Number(item.price) || 0;
    const cogs = calculateProductCogs(item);
    return !st.isArchived && cogs !== null && price > 0 && (cogs / price) * 100 > foodCostThreshold;
  });

  // Get sample data for tooltip
  const getTooltipData = () => {
    const sampleProducts = mappingData.slice(0, 6);
    const mappedSamples = sampleProducts.filter(item => calculateProductCogs(item) !== null);
    const totalIngredientCost = mappedSamples.reduce((sum, item) => sum + calculateProductCogs(item), 0);
    const avgCogs = mappedSamples.length > 0 ? totalIngredientCost / mappedSamples.length : 0;
    const avgPrice = sampleProducts.length > 0 ? sampleProducts.reduce((sum, item) => sum + (item.price || 0), 0) / sampleProducts.length : 0;
    
    return { sampleProducts, mappedSamples, totalIngredientCost, avgCogs, avgPrice };
  };

  const tooltipData = getTooltipData();

  // Static high food cost examples for the tooltip — illustrative only,
  // percentages recomputed from the sample numbers so the copy stays
  // internally consistent (Food Cost % = COGS / Selling Price × 100,
  // not the old "profit margin" framing this used to use).
  const lowMarginTooltipData = [
    {
      name: 'Breaded Porkchop',
      sellingPrice: 79,
      ingredientCost: 62,
      profit: 17,
      margin: 21,
      description: `Food Cost Percentage is 78% — above the ${foodCostThreshold}% threshold. Only ₱17 stays with you after ingredients.`
    },
    {
      name: 'Adobo',
      sellingPrice: 110,
      ingredientCost: 88,
      profit: 22,
      margin: 20,
      description: `Food Cost Percentage is 80% — above the ${foodCostThreshold}% threshold. Very little profit left after ingredient cost.`
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
                content="Shows the total number of active menu items currently available in your product list. Archived and inactive products are not included."
                placement="bottom"
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
                    <strong>Average COGS</strong>
                    <span>Shows the average estimated ingredient cost per mapped menu item. COGS is calculated using the ingredient quantities in each recipe and their current recorded unit costs.</span>
                    <span>Products without a recipe are not included because their ingredient cost cannot be calculated.</span>
                    <table className="product-tooltip-table">
                      <thead>
                        <tr>
                          <th>Menu Item</th>
                          <th>Selling price</th>
                          <th>Ingredient cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tooltipData.mappedSamples.length > 0 ? (
                          tooltipData.mappedSamples.map((item, idx) => (
                            <tr key={idx}>
                              <td>{item.name}</td>
                              <td>{formatCurrency(item.price)}</td>
                              <td>{formatCurrency(calculateProductCogs(item))}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="3">No products available</td>
                          </tr>
                        )}
                        {tooltipData.mappedSamples.length > 0 && (
                          <tr className="tooltip-total-row">
                            <td><strong>Total</strong></td>
                            <td>—</td>
                            <td><strong>{formatCurrency(tooltipData.totalIngredientCost)}</strong></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <div className="tooltip-calculation">
                      <span><strong>Calculation:</strong> {formatCurrency(tooltipData.totalIngredientCost)} total mapped ingredient cost ÷ {tooltipData.mappedSamples.length || 1} mapped menu items = <strong>{formatCurrency(tooltipData.avgCogs)}</strong> average per item</span>
                    </div>
                    <span className="tooltip-note">
                      Average COGS is a general cost overview. Interpret it together with selling prices: {formatCurrency(tooltipData.avgCogs)} may be high for a ₱60 product but low for a ₱200 product.
                    </span>
                  </div>
                )}
                placement="bottom"
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
            <p className="product-stat-card-value">₱ {productStats.avg_cogs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="product-stat-card-change">Cost of Goods Sold</p>
          </div>
        </div>

        <div className="product-stat-card warning">
          <div className="product-stat-card-content">
            <div className="product-stat-card-header">
              <p className="product-stat-card-label">High Food Cost Items</p>
              <div className="product-card-header-actions">
                <Tippy
                  content={(
                    <div className="product-card-tooltip">
                      <strong>High Food Cost Items</strong>
                      <span>These are menu items where ingredient costs take up a high percentage of the selling price. They may need a review of the selling price, recipe, portion size, or ingredient costs. This is a warning indicator only and does not represent the product's actual net profit.</span>
                    </div>
                  )}
                  placement="bottom"
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
                  <span className="product-card-info" tabIndex={0} aria-label="High food cost items information">
                    <FaInfoCircle />
                  </span>
                </Tippy>
                
                {/* ============ TOOLTIP ON EXPAND ICON WITH STATIC EXAMPLE ============ */}
                <Tippy
                  content={(
                    <div className="product-card-tooltip tooltip-expand-table">
                      <strong>High Food Cost Items — {highFoodCostItems.length} products detected</strong>
                      <span className="tooltip-review-note">Consider reviewing the selling price, recipe, portion size, or current ingredient costs.</span>
                      
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
                          <span className="tooltip-item-label">Food cost percentage</span>
                          <span className="tooltip-item-value margin-low">78.5%</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit per menu</span>
                          <span className="tooltip-item-value profit">₱17</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit margin</span>
                          <span className="tooltip-item-value margin-low">21%</span>
                        </div>
                        <div className="tooltip-item-description">
                          Only ₱17 stays with you after ingredients. Food cost is above the {foodCostThreshold}% threshold.
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
                          <span className="tooltip-item-label">Food cost percentage</span>
                          <span className="tooltip-item-value margin-low">80%</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit per menu</span>
                          <span className="tooltip-item-value profit">₱22</span>
                        </div>
                        <div className="tooltip-item-row">
                          <span className="tooltip-item-label">Profit margin</span>
                          <span className="tooltip-item-value margin-low">20%</span>
                        </div>
                        <div className="tooltip-item-description">
                          Sells for ₱110 but ingredients cost ₱88. Very little profit left. Food cost is above the {foodCostThreshold}% threshold.
                        </div>
                      </div>

                      <div className="tooltip-summary">
                        Most of the selling price is eaten up by ingredient cost. You can either raise the price, swap to cheaper ingredients, or accept the lower profit if these dishes attract more customers.
                      </div>
                      <div className="tooltip-summary">
                        Important: a High Food Cost indicator does not automatically mean the product is unprofitable. The system compares estimated ingredient cost with selling price and does not include labor, rent, utilities, or other operating expenses. Some high-demand or premium products may intentionally have higher food costs.
                      </div>
                      
               
                    </div>
                  )}
                  placement="bottom"
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
                    aria-label="Expand high food cost items"
                    onClick={() => {
                      if (highFoodCostItems.length > 0) {
                        setSelectedLowMarginItem(highFoodCostItems);
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
              <span className="alert-badge alert-low-margin" style={{ backgroundColor: '#ec4899' }}>
                {highFoodCostItems.length}
              </span>
            </div>
            <p className="product-stat-card-change">Food cost above {foodCostThreshold}%</p>
          </div>
        </div>

        <div className="product-stat-card info">
          <div className="product-stat-card-content">
            <div className="product-stat-card-header">
              <p className="product-stat-card-label">Unmapped Products</p>
              <Tippy
                content="These are menu items that don't have an ingredient recipe added yet. Without a recipe, the system doesn't know what ingredients go into each dish, so it can't estimate how much to buy or include these items in the shopping list. Go to each unmapped product and add its ingredients to unlock the full shopping list and demand estimates."
                placement="bottom"
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

   

      <div className="inventory-controls">
        <div className="inventory-search-box">
          <input
            type="text"
            placeholder="Search product or ingredient..."
            className="inventory-search-input"
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
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setSelectedCategory('All');
              setCurrentPage(1);
            }}
          >
            <option value="all">All products</option>
            <option value="active">Active</option>
            <option value="new">Inactive (New)</option>
            <option value="discontinued">Inactive (Discontinued)</option>
            <option value="unmapped">Unmapped</option>
            <option value="high-food-cost">High Food Cost</option>
            <option value="archived">Archived products</option>
          </select>
          <select 
            className="inventory-sort-select"
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setCurrentPage(1);
            }}
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select 
            className="inventory-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            {sortOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {selectedIds.length > 0 && (
            <>
              <button 
                className="btn-warning"
                onClick={() => setIsBulkArchiveOpen(true)}
                aria-label={`Archive ${selectedIds.length} selected product(s)`}
              >
                <FaArchive /> Archive Selected ({selectedIds.length})
              </button>
              <button 
                className="btn-secondary"
                onClick={() => setSelectedIds([])}
                aria-label="Clear selection"
              >
                <FaTimes /> Clear
              </button>
            </>
          )}
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
          {loading && mappingData.length === 0 ? (
            <div className="loading-state">Loading products...</div>
          ) : currentData.length === 0 ? (
            <div className="empty-state">No products found for this view.</div>
          ) : (
            <table className="product-table">
              <thead>
                <tr>
                  <th className="inventory-checkbox-cell">
                    <input
                      type="checkbox"
                      className="inventory-row-checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all products on this page"
                    />
                  </th>
                  <th>#</th>
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
                  const totalIngredientCost = calculateProductCogs(item);

                  return (
                    <tr key={item.id}>
                      <td className="inventory-checkbox-cell">
                        <input
                          type="checkbox"
                          className="inventory-row-checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggleSelectItem(item.id)}
                          disabled={status.isArchived}
                          aria-label={`Select ${item.name || 'product'}`}
                        />
                      </td>
                      <td>{startIndex + index + 1}</td>
                      <td className="product-item-name">{item.name}</td>
                      <td><span className="product-category-badge">{item.category || 'Uncategorized'}</span></td>
                      <td>{item.serving_size_label || '—'}</td>
                      <td className="ingredients-cell">
                        {item.product_ingredients && item.product_ingredients.length > 0 ? (
                          <Tippy
                            content={
                              <div className="product-ingredients-tooltip">
                                <strong>{item.name} — Ingredients</strong>
                                {item.product_ingredients.map((pi, i) => (
                                  <div key={i} className="product-ingredients-tooltip-row">
                                    <span>{pi.ingredients?.name || 'Unknown'}</span>
                                    <span>{pi.quantity_per_serving}{pi.unit || pi.ingredients?.unit || ''}</span>
                                  </div>
                                ))}
                              </div>
                            }
                            placement="top"
                            animation="scale"
                            duration={200}
                            theme="dark"
                            arrow
                            delay={[200, 0]}
                            maxWidth={320}
                            interactive
                            trigger="mouseenter focus"
                            appendTo={() => document.body}
                            zIndex={100000}
                          >
                            <span className="ingredient-tag product-ingredients-hover">
                              {item.product_ingredients.length} ingredient{item.product_ingredients.length !== 1 ? 's' : ''}
                            </span>
                          </Tippy>
                        ) : (
                          <span className="no-ingredients">No ingredients</span>
                        )}
                      </td>
                      <td className="price-cell">{formatCurrency(item.price)}</td>
                      <td>{totalIngredientCost === null ? 'N/A' : formatCurrency(totalIngredientCost)}</td>
                      <td>
                        <div className="status-pill-group">
                          <Tippy
                            content={status.tooltip}
                            placement="top"
                            animation="scale"
                            duration={200}
                            theme="dark"
                            arrow
                            trigger="mouseenter focus"
                            appendTo={() => document.body}
                            zIndex={100000}
                          >
                            <span className={`product-status-badge ${status.className}`} tabIndex={0} style={{ cursor: 'help' }}>
                              <span className="product-status-dot" style={{ backgroundColor: status.dotColor }}></span>
                              {status.label}
                            </span>
                          </Tippy>
                          {status.indicators.map((indicator) => (
                            <Tippy
                              key={indicator.key}
                              content={indicator.tooltip}
                              placement="top"
                              animation="scale"
                              duration={200}
                              theme="dark"
                              arrow
                              trigger="mouseenter focus"
                              appendTo={() => document.body}
                              zIndex={100000}
                            >
                              <span className={`product-status-badge product-status-indicator ${indicator.className}`} tabIndex={0} style={{ cursor: 'help' }}>
                                <span className="product-status-dot" style={{ backgroundColor: indicator.dotColor }}></span>
                                {indicator.label}
                              </span>
                            </Tippy>
                          ))}
                        </div>
                      </td>
                      <td>{formatDate(item.created_at)}</td>
                      <td>{formatDate(item.updated_at)}</td>
                      <td>
                        <div className="product-action-buttons">
                          <button 
                            className="product-action-btn view"
                            onClick={() => handleViewDetails(item)}
                            title="View Product Details"
                          >
                            <FaEye size={14} />
                          </button>
                          <button 
                            className="product-action-btn edit"
                            onClick={() => handleEdit(item)}
                            title="Edit Product"
                          >
                            <FaEdit size={14} />
                          </button>
                          {status.isArchived ? (
                            <button 
                              className="product-action-btn restore"
                              onClick={() => openRestoreModal(item)}
                              title="Restore Product"
                            >
                              <FaUndo size={14} />
                            </button>
                          ) : (
                            <button 
                              className="product-action-btn archive"
                              onClick={() => handleArchive(item)}
                              title="Archive"
                            >
                              <FaArchive size={14} />
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

        {/* Pagination — always visible so it's clear the table is split 10 per page */}
        {mappingData.length > 0 && (
          <div className="pagination">
            <div className="pagination-info-wrap">
              <span className="pagination-info">
                Showing {Math.min(startIndex + 1, mappingData.length)}–
                {Math.min(startIndex + itemsPerPage, mappingData.length)} of {mappingData.length} items
              </span>
            </div>
            <div className="pagination-controls">
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
            <div className="pagination-anchor" aria-hidden="true"></div>
          </div>
        )}
      </div>

      {/* ============ HIGH FOOD COST MODAL ============ */}
      {isLowMarginModalOpen && selectedLowMarginItem && (
        <div className="modal-overlay" onClick={() => setIsLowMarginModalOpen(false)}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">High Food Cost Items</h3>
              <button className="modal-close-btn" onClick={() => setIsLowMarginModalOpen(false)}>
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <div className="low-margin-content">
                <p className="low-margin-description">
                  High food cost items — the {Array.isArray(selectedLowMarginItem) ? selectedLowMarginItem.length : 1} menu item{Array.isArray(selectedLowMarginItem) && selectedLowMarginItem.length > 1 ? 's' : ''} flagged
                </p>
                
                {/* Table View */}
                <div className="low-margin-table-wrapper">
                  <table className="low-margin-table">
                    <thead>
                      <tr>
                        <th>Menu Item</th>
                        <th>Selling Price</th>
                        <th>Ingredient Cost</th>
                        <th>Food Cost %</th>
                        <th>Profit per Menu</th>
                        <th>Profit Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray(selectedLowMarginItem) ? (
                        selectedLowMarginItem.map((item, idx) => {
                          const price = item.price || 0;
                          const cogs = calculateProductCogs(item);
                          if (cogs === null) return null;
                          const margin = price > 0 ? ((price - cogs) / price) * 100 : 0;
                          const foodCostPercentage = price > 0 ? (cogs / price) * 100 : 0;
                          const profit = price - cogs;
                          return (
                            <tr key={idx} className={margin < 20 ? 'very-low-margin-row' : 'low-margin-row'}>
                              <td><strong>{item.name}</strong></td>
                              <td className="price-amount">{formatCurrency(price)}</td>
                              <td className="cost-amount">−{formatCurrency(cogs)}</td>
                              <td><span className="margin-badge low">{foodCostPercentage.toFixed(1)}%</span></td>
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
                  <p><strong>Important:</strong> A High Food Cost indicator does not automatically mean that the product is unprofitable. The system only compares estimated ingredient cost with selling price and does not include labor, rent, utilities, or other operating expenses.</p>
                  <p>Some products may intentionally have a higher food cost because they are high-demand items, premium products, or strategically important menu items. Use this indicator to support review rather than automatically changing prices.</p>
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
                      type="text"
                      inputMode="decimal"
                      placeholder="Qty (e.g. 1/2)"
                      className="ingredient-qty-input"
                      value={newIngredient.quantity}
                      onChange={(e) => setNewIngredient({...newIngredient, quantity: e.target.value})}
                    />
                    <select 
                      className="ingredient-unit-select"
                      value={newIngredient.unit}
                      onChange={(e) => setNewIngredient({...newIngredient, unit: e.target.value})}
                    >
                      {availableIngredientUnits.map((unit) => (
                        <option key={unit} value={unit}>{unit}</option>
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

                {costPreview && (
                  <div className={`ingredient-cost-preview ${costPreview.needsDensity ? 'preview-warning' : ''}`}>
                    {costPreview.needsDensity ? (
                      <>
                        <strong>{costPreview.name}:</strong> recipe uses a volume unit ({costPreview.unit}) but the ingredient is bought by weight ({costPreview.stockUnit}). Set <em>Grams per Cup</em> on the ingredient (flour ≈ 125) so the cup converts to {costPreview.stockUnit}.
                      </>
                    ) : (
                      <>
                        <strong>{costPreview.name}:</strong> {costPreview.qty} {costPreview.unit}
                        {costPreview.stockUnit.toLowerCase() !== String(costPreview.unit).toLowerCase()
                          ? ` = ${costPreview.converted} ${costPreview.stockUnit}`
                          : ''}
                        {' '}× ₱{Number(costPreview.unitPrice).toFixed(2)}/{costPreview.stockUnit} ≈ <strong>₱{Number(costPreview.cost).toFixed(2)}</strong> per serving
                        {costPreview.gramsPerCup ? ` (density ${costPreview.gramsPerCup} g/cup)` : ''}
                        {costPreview.pieceWeight ? ` (est ~${costPreview.pieceWeight} g/pc)` : ''}
                      </>
                    )}
                  </div>
                )}

                <div className={`ingredients-table-wrapper ${formErrors.ingredients ? 'error-border' : ''}`}>
                  <table className="ingredients-modal-table">
                    <thead>
                      <tr>
                        <th>Ingredient Name</th>
                        <th>Quantity</th>
                        <th>Unit</th>
                        <th>Cost</th>
                        {!isViewMode && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {formData.ingredients.length === 0 ? (
                        <tr>
                          <td colSpan={isViewMode ? 4 : 5} className="empty-row">
                            No ingredients added yet
                          </td>
                        </tr>
                      ) : (
                        formData.ingredients.map((ing, index) => {
                          const activeIngredient = editingIngredientIndex === index && draftIngredient
                            ? draftIngredient
                            : ing;
                          const rowCost = ingredientRowCost(activeIngredient);
                          return (
                          <tr key={index} className={editingIngredientIndex === index ? 'editing-ingredient-row' : ''}>
                            <td>
                              {editingIngredientIndex === index && draftIngredient ? (
                                <input
                                  type="text"
                                  className="form-input ingredient-edit-input"
                                  value={draftIngredient.name || ''}
                                  onChange={(e) => handleDraftIngredientChange('name', e.target.value)}
                                  placeholder="Ingredient name"
                                />
                              ) : (
                                <>
                                  {ing.name}
                                  {ing.inventory_item_id && (
                                    <span className="ingredient-id-tag">(ID: {ing.inventory_item_id})</span>
                                  )}
                                </>
                              )}
                            </td>
                            <td>
                              {editingIngredientIndex === index && draftIngredient ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="form-input ingredient-edit-input"
                                  value={draftIngredient.quantity}
                                  onChange={(e) => handleDraftIngredientChange('quantity', e.target.value)}
                                  placeholder="Quantity (e.g. 1/2)"
                                />
                              ) : (
                                ing.quantity
                              )}
                            </td>
                            <td>
                              {editingIngredientIndex === index && draftIngredient ? (
                                <select
                                  className="ingredient-edit-select"
                                  value={draftIngredient.unit || ''}
                                  onChange={(e) => handleDraftIngredientChange('unit', e.target.value)}
                                >
                                  {availableIngredientUnits.map((unit) => (
                                    <option key={unit} value={unit}>{unit}</option>
                                  ))}
                                </select>
                              ) : (
                                ing.unit
                              )}
                            </td>
                            <td className="ingredient-cost-cell">
                              {rowCost !== null ? formatCurrency(rowCost) : '—'}
                            </td>
                            {!isViewMode && (
                              <td>
                                <div className="ingredient-row-actions">
                                  {editingIngredientIndex === index ? (
                                    <>
                                      <button
                                        className="action-btn ingredient-edit-btn confirm"
                                        onClick={() => confirmIngredientEdit(index)}
                                        title="Save ingredient edit"
                                      >
                                        <FaCheck size={16} />
                                      </button>
                                      <button
                                        className="action-btn ingredient-edit-btn cancel"
                                        onClick={cancelIngredientEdit}
                                        title="Cancel edit"
                                      >
                                        <FaTimes size={16} />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        className="action-btn ingredient-edit-btn"
                                        onClick={() => startEditingIngredient(index)}
                                        title="Edit ingredient"
                                      >
                                        <FaEdit size={16} />
                                      </button>
                                      <button
                                        className="action-btn remove-ingredient"
                                        onClick={() => handleRemoveIngredient(index)}
                                        title="Remove ingredient"
                                      >
                                        <FaTrash size={16} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                          );
                        })
                      )}
                      {formData.ingredients.length > 0 && (
                        <tr className="ingredients-total-row">
                          <td colSpan={3}><strong>Total Ingredient Cost</strong></td>
                          <td><strong className="ingredients-total-value">
                            {totalIngredientCost !== null ? formatCurrency(totalIngredientCost) : '—'}
                          </strong></td>
                          {!isViewMode && <td></td>}
                        </tr>
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

      {isProductDetailsModalOpen && selectedItem && (
        <ProductDetailsModal
          product={selectedItem}
          computedStatus={getStatusDetails(selectedItem)}
          isArchiving={isArchiving}
          onArchive={() => {
            setIsProductDetailsModalOpen(false);
            handleArchive(selectedItem);
          }}
          onRestore={() => openRestoreModal(selectedItem)}
          onClose={() => setIsProductDetailsModalOpen(false)}
        />
      )}

      {isRestoreModalOpen && selectedItem && (
        <ProductRestoreModal
          product={selectedItem}
          isSubmitting={isArchiving}
          onConfirm={confirmRestore}
          onClose={() => setIsRestoreModalOpen(false)}
        />
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

      {/* ============ BULK ARCHIVE MODAL ============ */}
      {isBulkArchiveOpen && (
        <div className="modal-overlay" onClick={() => { if (!isArchiving) setIsBulkArchiveOpen(false); }}>
          <div className="modal-content modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Archive Selected Products</h3>
              <button className="modal-close-btn" onClick={() => { if (!isArchiving) setIsBulkArchiveOpen(false); }}>
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <div className="confirmation-content">
                <div className="confirmation-icon warning">
                  <FaArchive size={32} />
                </div>
                <h4>Archive {selectedIds.length} selected product(s)?</h4>
                <p>
                  You are about to archive <strong>{selectedIds.length} product(s)</strong>.
                  Archived products are hidden from the active list but can be restored later.
                </p>
                <div className="item-details">
                  <p><strong>Selected:</strong> {selectedIds.length} product(s)</p>
                  <p><strong>Products:</strong> {selectedNamesList}</p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsBulkArchiveOpen(false)} disabled={isArchiving}>
                Cancel
              </button>
              <button className="btn-warning" onClick={handleBulkArchive} disabled={isArchiving}>
                {isArchiving ? 'Archiving...' : <><FaArchive /> Archive Products</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductManagement;