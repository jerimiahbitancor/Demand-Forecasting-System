// components/IngredientManagement.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "./Inventory.css";
import "../InventoryControls.css";
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
import { canonicalUnitName, parseRecipeQuantity, RECIPE_EXTRA_UNITS, setUnitMetadata } from "../../../utils/recipeUnits";
import { formatStockQty } from "../../../utils/formatStockQty.js";
import { packQuantityKind, pricePerUnitFromPack } from "../../../utils/ingredientPackPrice";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import AddIngredientModal from '../components/ingredients modal/AddIngredientModal';
import EditIngredientModal from '../components/ingredients modal/EditIngredientModal';
import InventoryConfirmationModal from '../components/ingredients modal/InventoryConfirmationModal';
import InventoryModal from '../components/InventoryModal';
import RestockModal from '../components/ingredients modal/RestockModal';
import HistoryModal from '../components/ingredients modal/HistoryModal';
import ArchiveModal from '../components/ingredients modal/ArchiveModal';
import { buildPageItems, ELLIPSIS } from "../../../utils/pagination";
import { peso } from "../../../utils/formatNumber.js";

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
  const [units, setUnits] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [summaryStats, setSummaryStats] = useState({
    totalStockValue: 0,
    totalItems: 0,
    lowStockAlerts: 0,
    outOfStockItems: 0,
    forecastedDeduction: 0,
    excessStock: 0,
    normalStock: 0,
    criticalStock: 0,
    archivedItems: 0,
    unassignedIngredients: 0
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
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkArchiveOpen, setIsBulkArchiveOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Inline stock count in the table (the row that is being edited right now).
  const [editingStockId, setEditingStockId] = useState(null);
  const [editingStockValue, setEditingStockValue] = useState('');
  const [savingStock, setSavingStock] = useState(false);

  // Refs for preventing multiple requests
  const isInitialMount = useRef(true);
  const fetchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const legacyModalsEnabled = () => false;

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    unit: 'Kilograms (kg)',
    quantity: '',
    price: '',
    batch: '',
    min_stock: '',
    market_price: '',
    material_type: 'dry',
    pieces_per_pack: '',
    grams_per_pack: '',
    pack_price: ''
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

  const getStatusPresentation = useCallback((label, hint) => {
    const styles = {
      'Out of Stock': ['status-critical', '#dc2626'],
      'Low Stock': ['status-low', '#f59e0b'],
      'Normal Stock': ['status-normal', '#16a34a'],
      'Excess Stock': ['status-excess', '#3b82f6'],
      Excess: ['status-excess', '#3b82f6'],
      Unassigned: ['status-no-forecast', '#9ca3af'],
      Archived: ['status-archived', '#6b7280'],
    };
    const [className, color] = styles[label] || styles.Unassigned;
    return { label, className, color, hint };
  }, []);

  const getStockStatuses = useCallback((item) => {
    if (!item) {
      return {
        current: getStatusPresentation('Unassigned', ''),
        unassigned: false,
      };
    }
    const current = item.is_archived
      ? getStatusPresentation('Archived', 'This ingredient is archived.')
      : getStatusPresentation(
        item.current_stock_status || 'Unassigned',
        item.ideal_level_set === false
          ? 'No ideal stock level is set for this ingredient, so the stock cannot be measured as a percentage. Edit the ingredient to set one.'
          : `${item.current_stock_pct ?? 0}% of the ideal stock level (${formatStockQty(item.min_stock || 0, item.unit)} ${item.unit || ''}). ${item.material_type === 'wet' ? 'Wet' : 'Dry'} raw material: Low Stock below ${item.current_low_threshold_pct ?? (item.material_type === 'wet' ? 50 : 20)}%, Excess Stock above ${item.current_excess_threshold_pct ?? 100}%.`
      );
    return { current, unassigned: !item.is_mapped_to_product && !item.is_archived };
  }, [getStatusPresentation]);

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

      params.statusField = 'current';
      if (statusFilter === "Archived") {
        params.archived = true;
      } else if (statusFilter !== "All") {
        params.status = statusFilter;
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
          archivedItems: summary.archivedItems ?? 0,
          unassignedIngredients: summary.unassignedIngredients ?? 0
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
  }, [apiClient, searchTerm, sortField, sortDirection, currentPage, itemsPerPage, selectedCategory, statusFilter]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await apiClient.get('/categories');
      if (response.data.success) {
        const categoryData = response.data.data || [];
        setCategories(categoryData.includes('All') ? categoryData : ['All', ...categoryData]);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, [apiClient]);

  const fetchUnits = useCallback(async () => {
    try {
      const response = await apiClient.get('/units');
      if (response.data.success) {
        const rows = response.data.data || [];
        setUnits(rows);
        // The unit rows carry the family (mass / volume / count) and the piece
        // weights. The forms use them to tell a kilo from a piece, so they
        // have to be known here too.
        setUnitMetadata(rows);
      }
    } catch (error) {
      console.error('Error fetching units:', error);
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
        fetchUnits();
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
  }, [fetchInventory, fetchCategories, fetchUnits, debouncedFetch, searchTerm, sortField, sortDirection, currentPage, selectedCategory, statusFilter]);

  // ============ CRUD OPERATIONS ============
  // The stock is NOT part of an edit: the Current Stock field in the edit
  // window is locked, and sending a stale number would overwrite a movement
  // that happened while the window was open. The stock is set in the Current
  // Stock column of the list or with Add Stock.
  const buildItemPayload = ({ includeQuantity = true } = {}) => {
    const piecesPerPack = String(formData.pieces_per_pack ?? '').trim();
    const gramsPerPack = String(formData.grams_per_pack ?? '').trim();
    const packPrice = String(formData.pack_price ?? '').trim();
    const payload = {
      ...formData,
      price: parseFloat(formData.price),
      market_price: parseFloat(formData.market_price) || 0,
      min_stock: parseRecipeQuantity(formData.min_stock) || 0,
      pieces_per_pack: piecesPerPack === '' ? null : parseRecipeQuantity(piecesPerPack),
      grams_per_pack: gramsPerPack === '' ? null : parseRecipeQuantity(gramsPerPack),
      pack_price: packPrice === '' ? null : parseRecipeQuantity(packPrice)
    };
    if (includeQuantity) payload.quantity = parseRecipeQuantity(formData.quantity);
    else delete payload.quantity;
    return payload;
  };

  const handleAddItem = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    try {
      const response = await apiClient.post('/inventory/items', buildItemPayload());

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
      const response = await apiClient.put(`/inventory/items/${selectedItem.id}`, buildItemPayload({ includeQuantity: false }));

      if (response.data.success) {
        // The stock is not touched by an edit, but the row and the detail
        // panel have to show the saved item right away.
        const updatedItem = response.data?.data;
        if (updatedItem) {
          setSelectedItem((current) => (current ? { ...current, ...updatedItem } : current));
        }
        toast.success('Item updated successfully!');
        resetForm();
        setIsEditModalOpen(false);
        await fetchInventory();
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
    const enteredQuantity = parseRecipeQuantity(restockData.quantity);
    if (!Number.isFinite(enteredQuantity) || enteredQuantity <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    setIsSubmitting(true);
    try {
      const restockPayload = {
        quantity: String(restockData.quantity).trim(),
        unit: selectedItem.unit,
        reason: restockData.reason,
        notes: restockData.notes
      };
      const response = await apiClient.post(`/inventory/items/${selectedItem.id}/restock`, restockPayload);

      if (response.data.success) {
        toast.success(response.data.message || 'Item restocked successfully!');
        // The stock balance moved, so the modal and the row have to show the
        // new amount instead of the one they were opened with.
        const updatedQuantity = response.data?.data?.quantity;
        if (updatedQuantity !== undefined && updatedQuantity !== null) {
          setSelectedItem((current) => (
            current ? { ...current, quantity: updatedQuantity } : current
          ));
        }
        setRestockData({ quantity: '', reason: '', notes: '' });
        setIsRestockModalOpen(false);
        await fetchInventory();
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
        toast.success('Item unarchived successfully!');
        setIsRestoreModalOpen(false);
        setSelectedItem(null);
        setTimeout(() => fetchInventory(), 500);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to unarchive item');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============ BULK SELECTION HANDLERS ============
  const toggleSelectItem = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const selectableIds = inventoryItems.filter((i) => !i.is_archived).map((i) => i.id);
    const allSelected =
      selectableIds.length > 0 &&
      selectableIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : selectableIds);
  };

  const allPageSelected =
    inventoryItems.filter((i) => !i.is_archived).length > 0 &&
    inventoryItems
      .filter((i) => !i.is_archived)
      .every((i) => selectedIds.includes(i.id));

  const selectedNamesList = (() => {
    const names = selectedIds
      .map((id) => inventoryItems.find((i) => i.id === id)?.name)
      .filter(Boolean);
    if (names.length > 5) return `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`;
    return names.join(', ') || 'N/A';
  })();

  const handleBulkArchive = async () => {
    const idsToArchive = selectedIds.filter((id) => {
      const item = inventoryItems.find((i) => i.id === id);
      return item && !item.is_archived;
    });
    if (!idsToArchive.length) {
      toast.error('No active items are selected to archive');
      setIsBulkArchiveOpen(false);
      return;
    }

    setIsSubmitting(true);
    let archived = 0;
    try {
      for (const id of idsToArchive) {
        const response = await apiClient.patch(`/inventory/items/${id}/archive`);
        if (response.data.success) archived += 1;
      }
      toast.success(`${archived} item(s) archived successfully!`);
      setIsBulkArchiveOpen(false);
      setSelectedIds([]);
      setTimeout(() => fetchInventory(), 500);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to archive selected items');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============ FORM HANDLERS ============
  // Inline stock count in the table: click the Current Stock cell, type the
  // counted amount and press Enter (or Save). Only the quantity is sent, so
  // the price and the minimum stock stay as they are.
  const startStockEdit = (item) => {
    setEditingStockId(item.id);
    setEditingStockValue(item.quantity === null || item.quantity === undefined ? '' : String(item.quantity));
  };

  const cancelStockEdit = () => {
    setEditingStockId(null);
    setEditingStockValue('');
  };

  const saveStockEdit = async (item) => {
    const amount = parseRecipeQuantity(editingStockValue);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid stock amount');
      return;
    }
    setSavingStock(true);
    try {
      const response = await apiClient.put(`/inventory/items/${item.id}`, { quantity: amount });
      if (response.data.success) {
        const savedQuantity = response.data?.data?.quantity;
        const newQuantity = savedQuantity === null || savedQuantity === undefined
          ? amount
          : Number(savedQuantity);
        // A stock count is also what clears an open sales shortfall, so the
        // number the database holds now is the one that is shown.
        const openShortfall = Number(response.data?.data?.open_shortfall) || 0;
        const openShortfallSales = Number(response.data?.data?.open_shortfall_sales) || 0;
        setInventoryItems((items) => items.map((row) => (
          row.id === item.id
            ? { ...row, quantity: newQuantity, open_shortfall: openShortfall, open_shortfall_sales: openShortfallSales }
            : row
        )));
        setSelectedItem((current) => (
          current && current.id === item.id
            ? { ...current, quantity: newQuantity, open_shortfall: openShortfall, open_shortfall_sales: openShortfallSales }
            : current
        ));
        toast.success(`${item.name} stock set to ${formatStockQty(newQuantity, item.unit)} ${item.unit || 'pcs'}.`);
        cancelStockEdit();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update the stock');
    } finally {
      setSavingStock(false);
    }
  };

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
    } else if (!Number.isFinite(parseRecipeQuantity(formData.quantity)) || parseRecipeQuantity(formData.quantity) < 0) {
      errors.quantity = 'Quantity must be a valid number';
    }
    if (!formData.price || formData.price === '') {
      errors.price = 'Price is required';
    } else if (!Number.isFinite(Number(formData.price)) || Number(formData.price) <= 0) {
      errors.price = 'Price must be greater than 0';
    }
    const piecesPerPack = String(formData.pieces_per_pack ?? '').trim();
    const gramsPerPack = String(formData.grams_per_pack ?? '').trim();
    const packPrice = String(formData.pack_price ?? '').trim();
    const packKind = packQuantityKind(formData.unit);
    if (packKind === 'pieces' && piecesPerPack !== '') {
      const parsedPiecesPerPack = parseRecipeQuantity(piecesPerPack);
      if (!Number.isFinite(parsedPiecesPerPack) || parsedPiecesPerPack <= 0) {
        errors.pieces_per_pack = 'Pieces per pack must be a valid number greater than 0';
      }
    }
    if (packKind === 'grams' && gramsPerPack !== '') {
      const parsedGramsPerPack = parseRecipeQuantity(gramsPerPack);
      if (!Number.isFinite(parsedGramsPerPack) || parsedGramsPerPack <= 0) {
        errors.grams_per_pack = 'Grams per pack must be a valid number greater than 0';
      }
    }
    if (packKind !== null && packPrice !== '') {
      const parsedPackPrice = parseRecipeQuantity(packPrice);
      if (!Number.isFinite(parsedPackPrice) || parsedPackPrice <= 0) {
        errors.pack_price = 'Pack price must be a valid number greater than 0';
      } else {
        const hasPackQuantity = packKind === 'grams' ? gramsPerPack !== '' : piecesPerPack !== '';
        if (!hasPackQuantity) {
          if (packKind === 'grams') {
            errors.grams_per_pack = 'Enter grams per pack to compute the cost per unit';
          } else {
            errors.pieces_per_pack = 'Enter pieces per pack to compute the cost per unit';
          }
        }
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      unit: 'Kilograms (kg)',
      quantity: '',
      price: '',
      batch: '',
      min_stock: '',
      market_price: '',
      material_type: 'dry',
      pieces_per_pack: '',
      grams_per_pack: '',
      pack_price: ''
    });
    setFormErrors({});
  };

  const openEditModal = (item) => {
    setSelectedItem(item);
    const unit = canonicalUnitName(item.unit) || 'Kilograms (kg)';
    const packKind = packQuantityKind(unit);
    const piecesPerPack = packKind === 'pieces' && item.pieces_per_pack !== null && item.pieces_per_pack !== undefined
      ? item.pieces_per_pack.toString()
      : '';
    const gramsPerPack = packKind === 'grams' && item.grams_per_pack !== null && item.grams_per_pack !== undefined
      ? item.grams_per_pack.toString()
      : '';
    const packPrice = packKind !== null && item.pack_price !== null && item.pack_price !== undefined
      ? item.pack_price.toString()
      : '';
    const derivedPrice = pricePerUnitFromPack({
      unit,
      pieces_per_pack: piecesPerPack,
      grams_per_pack: gramsPerPack,
      pack_price: packPrice,
    });
    setFormData({
      name: item.name || '',
      category: item.category || '',
      unit,
      quantity: item.quantity?.toString() || '',
      price: derivedPrice !== null ? String(derivedPrice) : item.price?.toString() || '',
      batch: item.batch || '',
      min_stock: item.min_stock?.toString() || '',
      market_price: item.market_price?.toString() || '',
      material_type: item.material_type || 'dry',
      pieces_per_pack: piecesPerPack,
      grams_per_pack: gramsPerPack,
      pack_price: packPrice
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
    return peso(amount, { space: true });
  };

  const packBadgeFor = (item) => {
    const kind = packQuantityKind(item.unit);
    const packPrice = Number(item.pack_price) > 0
      ? ` Pack price: ${formatCurrency(item.pack_price)}.`
      : '';
    if (kind === 'pieces' && Number(item.pieces_per_pack) > 0) {
      const pieces = formatStockQty(item.pieces_per_pack, 'Pieces (pcs)');
      return (
        <span className="ingredient-pack-badge" title={`One pack holds ${pieces} pieces.${packPrice}`}>
          {pieces} pcs/pack
        </span>
      );
    }
    if (kind === 'grams' && Number(item.grams_per_pack) > 0) {
      const grams = formatStockQty(item.grams_per_pack, 'Grams (g)');
      return (
        <span className="ingredient-pack-badge" title={`One pack weighs ${grams} g.${packPrice}`}>
          {grams} g/pack
        </span>
      );
    }
    return <span className="market-price-empty">—</span>;
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
    { label: 'Unassigned', color: '#9ca3af', className: 'legend-no-forecast' },
    { label: 'Archived', color: '#6b7280', className: 'legend-archived' },
    { label: 'Excess Stock', color: '#3b82f6', className: 'legend-excess' },
    { label: 'Normal Stock', color: '#16a34a', className: 'legend-normal' },
    { label: 'Low Stock', color: '#f59e0b', className: 'legend-low' },
    { label: 'Out of Stock', color: '#dc2626', className: 'legend-critical' }
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
                    <span>Shows the total value of all your active ingredients currently in stock. Each ingredient's current quantity is multiplied by its unit price.</span>
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
                    <span>Your stock value went up ₱740 (+12%) from last month. This is fine if sales went up too — it means you're prepared for more orders. But if sales stayed the same, it may mean you bought more ingredients than you needed this month.</span>
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
                placement="bottom"
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
              <p className="inventory-stat-card-label">Stock Alerts</p>
              <Tippy
                content={(
                  <div className="inventory-card-tooltip">
                    <strong>Low Stock Alerts</strong>
                    <span>This counts ingredients that are Low Stock or Out of Stock: stock below 50% of the ideal stock level for wet raw materials, or below 20% for dry raw materials (changeable in Settings).</span>
                    <span>Stock Status compares the stock on hand with the ideal stock level. Ingredients not mapped to any product are also marked Unassigned.</span>
                    <span>Click to view the Shopping List to see which ingredients need restocking right away.</span>
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
              <p className="inventory-stat-card-label">Unassigned Ingredients</p>
              <Tippy
                content={(
                  <div className="inventory-card-tooltip">
                    <strong>Unassigned Ingredients</strong>
                    <span>These are ingredients that exist in your inventory but aren't connected to any product recipe yet.</span>
                    <span>This count is based on product-recipe mapping, not stock level or forecast availability. An ingredient is removed from Unassigned as soon as it is mapped to a product, and its current stock status stays based on its quantity and ideal stock level.</span>
                    <span>Go to the Product Management tab and add these ingredients to the recipes of the dishes that use them.</span>
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
                <span className="inventory-card-info" tabIndex={0} aria-label="Unassigned ingredients information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value">{summaryStats.unassignedIngredients}</p>
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
            aria-label="Filter by current stock status"
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="All">All Stock Statuses</option>
            <option value="Unassigned">Unassigned</option>
            <option value="Archived">Archived</option>
            <option value="Excess">Excess</option>
            <option value="Normal Stock">Normal Stock</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Out of Stock">Out of Stock</option>
          </select>

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

          {selectedIds.length > 0 && (
            <>
              <button 
                className="btn-warning"
                onClick={() => setIsBulkArchiveOpen(true)}
                aria-label={`Archive ${selectedIds.length} selected item(s)`}
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
            <table className="inventory-table ingredient-management-table">
              <thead>
                <tr>
                  <th className="inventory-checkbox-cell">
                    <input
                      type="checkbox"
                      className="inventory-row-checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all items on this page"
                    />
                  </th>
                  <th>#</th>
                  <th className="sortable" onClick={() => handleSort('name')}>
                    Item Name {sortField === 'name' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('category')}>
                    Category {sortField === 'category' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="sortable" onClick={() => handleSort('quantity')}>
                    Current Stock {sortField === 'quantity' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th title="How many pieces or grams one purchase pack holds (e.g. 30 pcs for a tray of eggs, 250 g for a bag).">
                    Pack
                  </th>
                  <th className="sortable" onClick={() => handleSort('price')}>
                    Unit Cost {sortField === 'price' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th title="Average of the latest recorded price across all market price sources (Robinson's, SM, Puregold, Wet Market, DA Reference).">Avg Market Price</th>
                  <th className="sortable" onClick={() => handleSort('updated_at')}>
                    Last Updated {sortField === 'updated_at' && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
                  </th>
                  <th className="ingredient-stock-status-heading">Stock Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((item, index) => {
                  const statuses = getStockStatuses(item);
                  const displayIndex = (currentPage - 1) * itemsPerPage + index + 1;
                  const isArchived = item.is_archived;
                  return (
                    <tr key={item.id || index} className={isArchived ? 'archived-row' : ''}>
                      <td data-label="Select" className="inventory-checkbox-cell">
                        <input
                          type="checkbox"
                          className="inventory-row-checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggleSelectItem(item.id)}
                          disabled={isArchived}
                          aria-label={`Select ${item.name || 'item'}`}
                        />
                      </td>
                      <td data-label="#">{displayIndex}</td>
                      <td data-label="Item Name" className="inventory-item-name-cell">
                        <span className="inventory-item-name">{item.name || 'Unnamed'}</span>
                      </td>
                      <td data-label="Category"><span className="category-badge">{item.category || 'Uncategorized'}</span></td>
                      <td data-label="Current Stock" className={
                        statuses.current.className === 'status-critical' ? 'inventory-critical-stock' :
                        statuses.current.className === 'status-low' ? 'inventory-low-stock' :
                        statuses.current.className === 'status-excess' ? 'inventory-excess-stock' :
                        statuses.current.className === 'status-normal' ? 'inventory-normal-stock' : ''
                      }>
                        {editingStockId === item.id ? (
                          <div className="inventory-inline-stock">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="form-input"
                              value={editingStockValue}
                              autoFocus
                              onChange={(event) => setEditingStockValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  saveStockEdit(item);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelStockEdit();
                                }
                              }}
                              aria-label={`Set the stock of ${item.name || 'this item'}`}
                            />
                            {/* The buttons sit UNDER the input: side by side they
                                were narrower than the column and spilled into the
                                next one. */}
                            <div className="inventory-inline-stock-actions">
                              <button
                                type="button"
                                className="inventory-inline-stock-btn save"
                                onClick={() => saveStockEdit(item)}
                                disabled={savingStock}
                                title="Save the stock"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="inventory-inline-stock-btn cancel"
                                onClick={cancelStockEdit}
                                disabled={savingStock}
                                title="Cancel"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="inventory-stock-value"
                            onClick={() => startStockEdit(item)}
                            title="Click to set the current stock"
                          >
                            {formatStockQty(item.quantity ?? 0, item.unit)} {item.unit || 'pcs'}
                          </button>
                        )}
                        {/* The demand a sale could not cover. It stays open until
                            a stock count records what is really on hand. */}
                        {editingStockId !== item.id && Number(item.open_shortfall) > 0 && (
                          <div
                            className="inventory-stock-short"
                            title="A sale could not be fully served. A stock count (set the current stock) clears this."
                          >
                            {formatStockQty(item.open_shortfall, item.unit)} {item.unit || 'pcs'} short
                            {Number(item.open_shortfall_sales) === 1
                              ? ' from 1 sale'
                              : ` from ${Number(item.open_shortfall_sales) || 0} sales`}
                          </div>
                        )}
                      </td>
                      <td data-label="Pack" className="ingredient-pack-cell">
                        {packBadgeFor(item)}
                      </td>
                      <td data-label="Unit Cost">{formatCurrency(item.price)}/{item.unit || 'pcs'}</td>
                      <td data-label="Avg Market Price">
                        {item.avg_market_price !== null && item.avg_market_price !== undefined
                          ? formatCurrency(item.avg_market_price)
                          : <span className="market-price-empty">—</span>}
                      </td>
                      <td data-label="Last Updated">{formatDate(item.updated_at || item.created_at)}</td>
                      <td data-label="Stock Status" className="ingredient-stock-status-cell">
                        <div className="inventory-status-pair">
                          <div className="inventory-status-entry">
                            <Tippy
                              content={<div className="inventory-status-tooltip">{statuses.current.hint}</div>}
                              placement="top"
                              theme="dark"
                            >
                              <span className={`inventory-stock-status ${statuses.current.className}`}>
                                <span className="inventory-status-dot" style={{ backgroundColor: statuses.current.color }}></span>
                                {statuses.current.label}
                              </span>
                            </Tippy>
                          </div>
                          {statuses.unassigned && (
                            <div className="inventory-status-entry">
                              <Tippy
                                content={<div className="inventory-status-tooltip">This ingredient is not mapped to any product.</div>}
                                placement="top"
                                theme="dark"
                              >
                                <span className={`inventory-stock-status ${getStatusPresentation('Unassigned').className}`}>
                                  <span className="inventory-status-dot" style={{ backgroundColor: getStatusPresentation('Unassigned').color }}></span>
                                  Unassigned
                                </span>
                              </Tippy>
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-label="Actions">
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
                          {isArchived ? (
                            <button 
                              className="inventory-action-btn restore"
                              onClick={() => openRestoreModal(item)}
                              title="Unarchive Item"
                            >
                              <FaUndo size={14} />
                            </button>
                          ) : (
                            <button 
                              className="inventory-action-btn archive"
                              onClick={() => openArchiveModal(item)}
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
          </div>

          {/* Pagination — always visible so it's clear the table is split 10 per page */}
          {inventoryItems.length > 0 && (
            <div className="inventory-pagination">
              <span className="inventory-pagination-info">
                Showing {(currentPage - 1) * itemsPerPage + 1}–
                {Math.min(currentPage * itemsPerPage, totalItems || inventoryItems.length)} of {totalItems || inventoryItems.length} items
              </span>

              <div className="inventory-pagination-controls">
                <button 
                  className="inventory-pagination-btn"
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                >
                  <FaArrowLeft /> Previous
                </button>
                
                <div className="inventory-pagination-numbers">
                  {buildPageItems(currentPage, totalPages).map((item, index) =>
                    item === ELLIPSIS ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="inventory-pagination-ellipsis"
                        aria-hidden="true"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        className={`inventory-pagination-number ${currentPage === item ? 'active' : ''}`}
                        onClick={() => setCurrentPage(item)}
                        aria-label={`Page ${item}`}
                        aria-current={currentPage === item ? 'page' : undefined}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>

                <button 
                  className="inventory-pagination-btn"
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                >
                  Next <FaArrowRight />
                </button>
              </div>

              <div className="inventory-pagination-anchor" aria-hidden="true"></div>
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
        units={units}
        onChange={setFormData}
        onSubmit={handleAddItem}
        onClose={() => {
          setIsAddModalOpen(false);
          resetForm();
        }}
      />
      <EditIngredientModal
        key={selectedItem?.id}
        isOpen={isEditModalOpen}
        isSubmitting={isSubmitting}
        formData={formData}
        formErrors={formErrors}
        categories={categories}
        units={units}
        itemId={selectedItem?.id}
        openShortfall={Number(selectedItem?.open_shortfall) || 0}
        openShortfallSales={Number(selectedItem?.open_shortfall_sales) || 0}
        apiClient={apiClient}
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

      {/* Bulk Archive Modal */}
      {isBulkArchiveOpen && (
        <InventoryModal className="modal-md inventory-confirmation-modal" onClose={() => { if (!isSubmitting) setIsBulkArchiveOpen(false); }}>
          <div className="modal-header inventory-modal-header">
            <h3 className="modal-title">Archive Selected Items</h3>
            <button className="modal-close-btn" onClick={() => { if (!isSubmitting) setIsBulkArchiveOpen(false); }}>
              <FaTimes />
            </button>
          </div>
          <div className="modal-body inventory-modal-body">
            <div className="confirmation-content">
              <div className="confirmation-icon warning">
                <FaArchive size={32} />
              </div>
              <h4>Archive {selectedIds.length} selected ingredient(s)?</h4>
              <p>
                You are about to archive <strong>{selectedIds.length} ingredient(s)</strong>.
                Archived items are hidden from the main inventory but can be restored later.
              </p>
              <div className="item-details">
                <p><strong>Selected:</strong> {selectedIds.length} ingredient(s)</p>
                <p><strong>Items:</strong> {selectedNamesList}</p>
              </div>
            </div>
          </div>
          <div className="modal-footer inventory-modal-footer">
            <button className="btn-secondary" onClick={() => setIsBulkArchiveOpen(false)} disabled={isSubmitting}>
              Cancel
            </button>
            <button className="btn-warning" onClick={handleBulkArchive} disabled={isSubmitting}>
              {isSubmitting ? 'Archiving...' : <><FaArchive /> Archive Items</>}
            </button>
          </div>
        </InventoryModal>
      )}

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
                    {RECIPE_EXTRA_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Material Type</label>
                  <select
                    className="form-input"
                    value={formData.material_type || 'dry'}
                    onChange={(e) => setFormData({...formData, material_type: e.target.value})}
                  >
                    <option value="wet">Wet Raw Materials</option>
                    <option value="dry">Dry Raw Materials</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Ideal Stock Level <span className="required-star">*</span></label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.min_stock ? 'error' : ''}`}
                    value={formData.min_stock ?? ''}
                    onChange={(e) => setFormData({...formData, min_stock: e.target.value})}
                    placeholder="e.g. 40"
                    min="0"
                    step="any"
                  />
                  <small className="form-hint">
                    The amount you normally want on hand, in the stock unit. Low Stock below{' '}
                    {formData.material_type === 'wet' ? '50% (wet)' : '20% (dry)'} of this by default.
                  </small>
                  {formErrors.min_stock && <span className="form-error">{formErrors.min_stock}</span>}
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
                    {RECIPE_EXTRA_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Material Type</label>
                  <select
                    className="form-input"
                    value={formData.material_type || 'dry'}
                    onChange={(e) => setFormData({...formData, material_type: e.target.value})}
                  >
                    <option value="wet">Wet Raw Materials</option>
                    <option value="dry">Dry Raw Materials</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Ideal Stock Level <span className="required-star">*</span></label>
                  <input
                    type="number"
                    className={`form-input ${formErrors.min_stock ? 'error' : ''}`}
                    value={formData.min_stock ?? ''}
                    onChange={(e) => setFormData({...formData, min_stock: e.target.value})}
                    placeholder="e.g. 40"
                    min="0"
                    step="any"
                  />
                  <small className="form-hint">
                    The amount you normally want on hand, in the stock unit. Low Stock below{' '}
                    {formData.material_type === 'wet' ? '50% (wet)' : '20% (dry)'} of this by default.
                  </small>
                  {formErrors.min_stock && <span className="form-error">{formErrors.min_stock}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Current Stock <span className="required-star">*</span></label>
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
                  <p><strong>Quantity:</strong> {formatStockQty(selectedItem?.quantity ?? 0, selectedItem?.unit)} {selectedItem?.unit || 'pcs'}</p>
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
                  <p><strong>Current Stock:</strong> {formatStockQty(selectedItem?.quantity ?? 0, selectedItem?.unit)} {selectedItem?.unit || 'pcs'}</p>
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
                  <p><strong>Quantity:</strong> {formatStockQty(selectedItem?.quantity ?? 0, selectedItem?.unit)} {selectedItem?.unit || 'pcs'}</p>
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
                    <Tippy
                      content={<div className="inventory-status-tooltip">{getStockStatuses(selectedItem).current.hint}</div>}
                      placement="top"
                      theme="dark"
                    >
                      <span className={`status-badge ${getStockStatuses(selectedItem).current.className}`}>
                        {getStockStatuses(selectedItem).current.label}
                      </span>
                    </Tippy>
                    {getStockStatuses(selectedItem).unassigned && (
                      <span className="status-badge status-no-forecast">Unassigned</span>
                    )}
                  </div>

                  <div className="detail-grid">
                    <div className="detail-item">
                      <label>Category</label>
                      <p>{selectedItem.category || 'N/A'}</p>
                    </div>
                    <div className="detail-item">
                      <label>Current Stock</label>
                      <p>{formatStockQty(selectedItem.quantity ?? 0, selectedItem.unit)} {selectedItem.unit || 'pcs'}</p>
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
                      <label>Ideal Stock Level</label>
                      <p>{formatStockQty(selectedItem.min_stock ?? 0, selectedItem.unit)}</p>
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