// pages/MarketPriceManagement.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "./Inventory.css";
import "../InventoryControls.css";
import {
  FaPlus,
  FaEdit,
  FaTrash,
  FaSortAmountDown,
  FaSortAmountUp,
  FaArrowLeft,
  FaArrowRight,
  FaInfoCircle,
  FaTimes,
  FaExternalLinkAlt,
  FaFileCsv,
  FaChartLine,
  FaCheck,
  FaPencilAlt,
  FaStore,
  FaLightbulb,
  FaPiggyBank,
  FaExclamationTriangle,
} from 'react-icons/fa';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from "../../../context/AuthContext";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import InventoryModal from '../components/InventoryModal';
import MarketPriceModal from '../components/market modal/MarketPriceModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const DEFAULT_SOURCES = [
  { key: "robinsons", label: "Robinson's", tooltip: "Manually recorded from in-store visit. Last verified by staff." },
  { key: "sm", label: "SM", tooltip: "Manually recorded from in-store visit. Last verified by staff." },
  { key: "puregold", label: "Puregold", tooltip: "Manually recorded from in-store visit. Last verified by staff." },
  { key: "wet_market", label: "Wet Market", tooltip: "Manually recorded from in-store visit. Last verified by staff." },
  { key: "da_reference", label: "DA Reference", tooltip: "Manually copied from DA Bantay Presyo (da.gov.ph/price-monitoring). Official government reference price." },
];

const LINE_PALETTE = [
  "#3b82f6", "#f59e0b", "#16a34a", "#8b5cf6", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#7c3aed", "#f97316",
  "#14b8a6", "#eab308",
];

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return '₱ 0.00';
  return `₱ ${parseFloat(amount).toFixed(2)}`;
};

// Client-side summary computation (used as a fallback; the server returns a
// summary computed over the whole filtered dataset so pagination never
// skews the numbers).
const computeSummaryStats = (data, sources = DEFAULT_SOURCES) => {
  const sourceSums = {};
  sources.forEach((s) => { sourceSums[s.key] = []; });

  let sumLowest = 0;
  let countLowest = 0;
  let biggestGap = null;
  let biggestGapIngredient = null;
  let maxLastUpdated = null;

  (data || []).forEach((row) => {
    sources.forEach((s) => {
      if (row[s.key] !== null && row[s.key] !== undefined) sourceSums[s.key].push(Number(row[s.key]));
    });
    if (row.lowest !== null && row.lowest !== undefined) {
      sumLowest += Number(row.lowest);
      countLowest += 1;
    }
    if (row.highest !== null && row.lowest !== null) {
      const gap = Number(row.highest) - Number(row.lowest);
      if (biggestGap === null || gap > biggestGap) {
        biggestGap = gap;
        biggestGapIngredient = row.ingredient;
      }
    }
    if (row.lastUpdated && (!maxLastUpdated || new Date(row.lastUpdated) > new Date(maxLastUpdated))) {
      maxLastUpdated = row.lastUpdated;
    }
  });

  let cheapestSource = null;
  let cheapestAvg = null;
  sources.forEach((s) => {
    if (sourceSums[s.key].length) {
      const avg = sourceSums[s.key].reduce((sum, v) => sum + v, 0) / sourceSums[s.key].length;
      if (cheapestAvg === null || avg < cheapestAvg) {
        cheapestAvg = avg;
        cheapestSource = s.label;
      }
    }
  });

  return {
    cheapestSource: cheapestSource ? `${cheapestSource} (avg ${formatCurrency(cheapestAvg)})` : "-",
    avgPrice: countLowest ? sumLowest / countLowest : 0,
    biggestGap: biggestGap !== null ? { value: Number(biggestGap.toFixed(2)), ingredient: biggestGapIngredient } : 0,
    lastUpdated: maxLastUpdated || null,
  };
};

const mapServerSummary = (summary) => {
  if (!summary) {
    return {
      cheapestSource: "-",
      avgPrice: 0,
      biggestGap: 0,
      lastUpdated: null,
    };
  }
  return {
    cheapestSource: summary.cheapestSource
      ? `${summary.cheapestSource.label} (avg ${formatCurrency(summary.cheapestSource.avg)})`
      : "-",
    avgPrice: summary.avgPrice || 0,
    biggestGap: summary.biggestGap
      ? { value: summary.biggestGap.value, ingredient: summary.biggestGap.ingredient }
      : 0,
    lastUpdated: summary.lastUpdated || null,
  };
};

const SortableHeader = ({ label, field, activeSortField, sortDirection, onSort }) => (
  <span
    className="market-source-header"
    onClick={() => onSort(field)}
    style={{ cursor: 'pointer' }}
  >
    {label}
    {activeSortField === field && (sortDirection === 'asc' ? <FaSortAmountUp /> : <FaSortAmountDown />)}
  </span>
);

const SourceHeader = ({ label, tooltip }) => (
  <Tippy
    content={tooltip}
    placement="top"
    animation="scale"
    duration={200}
    theme="dark"
    arrow
    delay={[100, 0]}
    interactive
    trigger="mouseenter focus click"
    appendTo={() => document.body}
    zIndex={100000}
  >
    <span className="market-source-header">
      {label}
      <FaInfoCircle className="market-source-info-icon" tabIndex={0} />
    </span>
  </Tippy>
);

const MarketPriceManagement = () => {
  const { getToken } = useAuth();

  // ============ STATE ============
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSource, setSelectedSource] = useState("All");
  const [sortField, setSortField] = useState("ingredient");
  const [sortDirection, setSortDirection] = useState("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [categories, setCategories] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [summaryStats, setSummaryStats] = useState({
    cheapestSource: "-",
    avgPrice: 0,
    biggestGap: 0,
    lastUpdated: null,
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [selectedRow, setSelectedRow] = useState(null);
  const [modalKey, setModalKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Market sources are loaded from the server so staff can add their own stores.
  const [sources, setSources] = useState(DEFAULT_SOURCES);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [newSourceLabel, setNewSourceLabel] = useState("");
  const [newSourceTooltip, setNewSourceTooltip] = useState("");
  const [sourceActionLoading, setSourceActionLoading] = useState(false);

  // Inline cell editing state
  const [editingCell, setEditingCell] = useState(null); // { ingredientId, source }
  const [editValue, setEditValue] = useState("");
  const [savingCell, setSavingCell] = useState(null);   // { ingredientId, source }
  const cancelBlurRef = useRef(false);

  // Optional trend chart state
  const [showTrend, setShowTrend] = useState(false);
  const [trendIngredientId, setTrendIngredientId] = useState("");
  const [trendChartType, setTrendChartType] = useState("line");
  const [trendRows, setTrendRows] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);

  // Refs for preventing multiple requests
  const isInitialMount = useRef(true);
  const fetchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const trendAbortRef = useRef(null);

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

  // ============ HELPERS ============
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

  // `now` is kept in state (refreshed by a timer) so relative times render
  // deterministically and we never call Date.now() directly during render.
  const [now, setNow] = useState(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const timeAgo = (dateString, nowValue) => {
    if (!dateString) return "-";
    if (nowValue === null || nowValue === undefined) return "-";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "-";
      const seconds = Math.floor((nowValue - date.getTime()) / 1000);
      if (seconds < 60) return "Just now";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
      const months = Math.floor(days / 30);
      if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
      const years = Math.floor(months / 12);
      return `${years} year${years > 1 ? 's' : ''} ago`;
    } catch {
      return "-";
    }
  };

  // ============ DATA FETCHING ============
  const labelOf = (key) => (sources.find((s) => s.key === key) || {}).label || key;
  const colorOf = (index) => LINE_PALETTE[index % LINE_PALETTE.length];

  const fetchComparison = useCallback(async () => {
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
        limit: itemsPerPage,
      };

      if (selectedCategory !== "All") {
        params.category = selectedCategory;
      }
      if (selectedSource !== "All") {
        params.source = selectedSource;
      }

      const response = await apiClient.get('/market-prices/comparison', {
        params,
        signal: abortControllerRef.current.signal
      });

      if (response.data.success) {
        const data = response.data.data || [];
        setRows(data);
        setTotalItems(response.data.total ?? 0);

        setSummaryStats(
          response.data.summary
            ? mapServerSummary(response.data.summary)
            : computeSummaryStats(data, sources)
        );
      }
    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        return;
      }
      console.error('Error fetching market prices:', error);
      if (error.response?.status !== 401 && error.response?.status !== 429) {
        toast.error('Failed to load market prices');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient, searchTerm, sortField, sortDirection, currentPage, itemsPerPage, selectedCategory, selectedSource, sources]);

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

  const fetchIngredients = useCallback(async () => {
    try {
      const response = await apiClient.get('/inventory/items', { params: { limit: 1000 } });
      if (response.data.success) {
        setIngredients(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching ingredients:', error);
    }
  }, [apiClient]);

  const fetchSources = useCallback(async () => {
    try {
      const response = await apiClient.get('/market-prices/sources');
      if (response.data.success) {
        const loaded = response.data.data || [];
        setSources(loaded.length ? loaded : DEFAULT_SOURCES);
      }
    } catch (error) {
      console.error('Error fetching market sources:', error);
    }
  }, [apiClient]);

  const debouncedFetch = useCallback(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
    fetchTimeoutRef.current = setTimeout(() => {
      fetchComparison();
    }, 300);
  }, [fetchComparison]);

  // ============ INITIAL LOAD ============
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      setTimeout(() => {
        fetchComparison();
        fetchCategories();
        fetchIngredients();
        fetchSources();
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
  }, [fetchComparison, fetchCategories, fetchIngredients, fetchSources, debouncedFetch, searchTerm, sortField, sortDirection, currentPage, selectedCategory, selectedSource]);

  // ============ SORT ============
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  // ============ MODAL ACTIONS ============
  const openCreateModal = () => {
    setModalMode("create");
    setSelectedRow(null);
    setModalKey((prev) => prev + 1);
    setIsModalOpen(true);
  };

  const openEditModal = (row) => {
    setModalMode("edit");
    setSelectedRow(row);
    setModalKey((prev) => prev + 1);
    setIsModalOpen(true);
  };

  const openDeleteModal = (row) => {
    setSelectedRow(row);
    setIsDeleteOpen(true);
  };

  // ============ SOURCE MANAGEMENT ============
  const refreshAfterSourcesChanged = () => {
    fetchSources();
    fetchComparison();
  };

  const handleAddSource = async () => {
    const label = newSourceLabel.trim();
    if (!label) {
      toast.error('Enter a name for the new market source');
      return;
    }
    setSourceActionLoading(true);
    try {
      const response = await apiClient.post('/market-prices/sources', {
        label,
        tooltip: newSourceTooltip.trim() || undefined,
      });
      if (response.data.success) {
        toast.success(response.data.message || 'Source added');
        setNewSourceLabel("");
        setNewSourceTooltip("");
        refreshAfterSourcesChanged();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add source');
    } finally {
      setSourceActionLoading(false);
    }
  };

  const handleDeleteSource = async (src) => {
    if (!src.id) {
      toast.error('This is a built-in source and cannot be removed');
      return;
    }
    if (!window.confirm(`Remove market source "${src.label}"? Existing price records for it will stop appearing.`)) {
      return;
    }
    setSourceActionLoading(true);
    try {
      const response = await apiClient.delete(`/market-prices/sources/${src.id}`);
      if (response.data.success) {
        toast.success(response.data.message || 'Source removed');
        if (selectedSource === src.key) setSelectedSource("All");
        refreshAfterSourcesChanged();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to remove source');
    } finally {
      setSourceActionLoading(false);
    }
  };

  const handleSubmit = async (payload) => {
    setIsSubmitting(true);
    try {
      const response = await apiClient.post('/market-prices/bulk-upsert', payload);
      if (response.data.success) {
        toast.success(response.data.message || 'Prices saved successfully!');
        setIsModalOpen(false);
        setSelectedRow(null);
        setTimeout(() => fetchComparison(), 300);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save prices');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRow = async () => {
    const ids = selectedRow?.sourceIds || {};
    const idsToDelete = Object.values(ids).filter((id) => id !== null && id !== undefined);
    if (!idsToDelete.length) {
      toast.error('No recorded prices to delete');
      setIsDeleteOpen(false);
      return;
    }

    setIsSubmitting(true);
    let deleted = 0;
    try {
      for (const id of idsToDelete) {
        const response = await apiClient.delete(`/market-prices/${id}`);
        if (response.data.success) deleted += 1;
      }
      toast.success(`${deleted} price record(s) deleted successfully!`);
      setIsDeleteOpen(false);
      setSelectedRow(null);
      setTimeout(() => fetchComparison(), 300);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete price records');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============ EXPORT CSV (client-side Blob, no server call) ============
  const handleExportCsv = async () => {
    try {
      const params = {
        search: searchTerm || null,
        sortBy: sortField,
        sortOrder: sortDirection,
        page: 1,
        limit: 10000,
      };
      if (selectedCategory !== "All") params.category = selectedCategory;
      if (selectedSource !== "All") params.source = selectedSource;

      const response = await apiClient.get('/market-prices/comparison', { params });
      const data = response.data.success ? (response.data.data || []) : [];

      const header = ['Ingredient', 'Unit', 'Category', ...sources.map((s) => s.label), 'Lowest', 'Your Price', 'Savings', 'Last Updated'];
      const escapeCell = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };

      const lines = [header.map(escapeCell).join(',')];
      data.forEach((row) => {
        lines.push([
          row.ingredient,
          row.unit,
          row.category,
          ...sources.map((s) => row[s.key]),
          row.lowest,
          row.yourPrice,
          row.savings,
          row.lastUpdated ? formatDate(row.lastUpdated) : '',
        ].map(escapeCell).join(','));
      });

      const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `market-prices-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} row(s) to CSV`);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  // ============ TREND CHART ============
  const fetchHistory = useCallback(async (ingredientId) => {
    if (trendAbortRef.current) trendAbortRef.current.abort();
    trendAbortRef.current = new AbortController();

    try {
      setTrendLoading(true);
      const response = await apiClient.get(`/market-prices/history/${ingredientId}`, {
        signal: trendAbortRef.current.signal
      });
      if (response.data.success) {
        setTrendRows(response.data.data || []);
      }
    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return;
      console.error('Error fetching price history:', error);
      toast.error('Failed to load price history');
    } finally {
      setTrendLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    if (!showTrend || !trendIngredientId) return;
    const timer = setTimeout(() => {
      fetchHistory(trendIngredientId);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (trendAbortRef.current) trendAbortRef.current.abort();
    };
  }, [showTrend, trendIngredientId, fetchHistory]);

  const trendChartData = useMemo(() => {
    const pointMap = {};
    (trendRows || []).forEach((row) => {
      let dateKey = 'N/A';
      try {
        dateKey = new Date(row.scraped_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch {
        /* ignore malformed dates */
      }
      if (!pointMap[dateKey]) pointMap[dateKey] = { date: dateKey };
      pointMap[dateKey][row.source] = Number(row.price);
    });
    return Object.values(pointMap);
  }, [trendRows]);

  const presentTrendSources = useMemo(() => {
    const present = new Set();
    (trendRows || []).forEach((row) => present.add(row.source));
    return (sources || []).filter((s) => present.has(s.key));
  }, [trendRows, sources]);

  const toggleTrend = (ingredientId) => {
    if (showTrend && trendIngredientId === ingredientId) {
      setShowTrend(false);
      setTrendIngredientId("");
      return;
    }
    setTrendIngredientId(ingredientId);
    setShowTrend(true);
  };

  // ============ INLINE CELL EDITING ============
  const startEdit = (row, key) => {
    if (savingCell) return;
    setEditingCell({ ingredientId: row.ingredientId, source: key });
    setEditValue(row[key] !== null && row[key] !== undefined ? String(row[key]) : "");
  };

  const cancelEdit = () => {
    cancelBlurRef.current = true;
    setEditingCell(null);
    setEditValue("");
  };

  const doSaveEdit = () => {
    const cell = editingCell;
    if (!cell || savingCell) return;
    const row = rows.find((r) => String(r.ingredientId) === String(cell.ingredientId));
    if (!row) {
      cancelEdit();
      return;
    }
    const value = editValue.trim();
    if (value === "") {
      toast.error('Enter a price or Cancel to keep the current value');
      return;
    }
    if (Number.isNaN(Number(value)) || Number(value) < 0) {
      toast.error('Price must be a valid number >= 0');
      return;
    }

    const newPrice = Number(Number(value).toFixed(2));

    // Commit visually right away so the typed price shows in the table
    // immediately, then persist it and re-sync with the server.
    setRows((prev) => prev.map((r) => {
      if (String(r.ingredientId) !== String(cell.ingredientId)) return r;
      return applyDraftToRow(r, cell.source, newPrice);
    }));
    setEditingCell(null);
    setEditValue("");
    setSavingCell(cell);

    const payload = {
      ingredientId: Number(cell.ingredientId),
      entries: [
        {
          source: cell.source,
          price: newPrice,
          unit: row.unit || 'kg',
          is_manual_entry: true,
          scraped_at: new Date().toISOString(),
        },
      ],
    };

    apiClient
      .post('/market-prices/bulk-upsert', payload)
      .then((res) => {
        if (res.data.success) {
          toast.success(res.data.message || 'Price updated successfully!');
          fetchComparison();
        }
      })
      .catch((err) => {
        toast.error(err.response?.data?.error || 'Failed to save price');
        fetchComparison();
      })
      .finally(() => setSavingCell(null));
  };

  // ============ RENDER HELPERS ============
  // Recompute the lowest/highest/savings for a row after one source price changes.
  const applyDraftToRow = (row, source, value) => {
    const draft = { ...row };
    const num = Number(Number(value).toFixed(2));
    draft[source] = num;
    const vals = sources
      .map((c) => draft[c.key])
      .filter((v) => v !== null && v !== undefined)
      .map(Number);
    draft.lowest = vals.length ? Math.min(...vals) : null;
    draft.highest = vals.length ? Math.max(...vals) : null;
    draft.savings = (draft.yourPrice !== null && draft.yourPrice !== undefined && draft.lowest !== null)
      ? Number(Number(draft.yourPrice - draft.lowest).toFixed(2))
      : null;
    return draft;
  };

  // When a cell is being edited, produce a "draft" row that reflects the
  // value the user is typing so Lowest/Savings/summary update live.
  const getEffectiveRow = (row) => {
    const isCurrentEdit = editingCell && String(editingCell.ingredientId) === String(row.ingredientId);
    if (!isCurrentEdit) return row;
    const num = Number(editValue);
    if (editValue === "" || Number.isNaN(num) || num < 0) return row;
    return applyDraftToRow(row, editingCell.source, num);
  };

  const findLowestSource = (row) => {
    const match = sources.find((col) => row[col.key] === row.lowest && row[col.key] !== null);
    return match ? match.key : null;
  };

  const renderPriceCell = (row, key) => {
    const value = row[key];
    const isEditing = editingCell && String(editingCell.ingredientId) === String(row.ingredientId) && editingCell.source === key;
    const isSaving = savingCell && String(savingCell.ingredientId) === String(row.ingredientId) && savingCell.source === key;

    if (isEditing) {
      return (
        <span className="market-inline-edit">
          <input
            type="number"
            min="0"
            step="0.01"
            autoFocus
            className="market-inline-edit-input"
            value={editValue}
            disabled={isSaving}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSaveEdit();
              else if (e.key === 'Escape') cancelEdit();
            }}
            onBlur={() => {
              if (cancelBlurRef.current) {
                cancelBlurRef.current = false;
                return;
              }
              doSaveEdit();
            }}
            placeholder="0.00"
          />
          <button
            className="market-inline-edit-btn save"
            title="Save price"
            onMouseDown={(e) => e.preventDefault()}
            onClick={doSaveEdit}
          >
            <FaCheck size={10} />
          </button>
          <button
            className="market-inline-edit-btn cancel"
            title="Cancel"
            onMouseDown={() => { cancelBlurRef.current = true; }}
            onClick={cancelEdit}
          >
            <FaTimes size={10} />
          </button>
        </span>
      );
    }

    if (value === null || value === undefined) {
      return (
        <span className="market-price-cell-edit" onClick={() => startEdit(row, key)} title="Click to add a price">
          <span className="market-price-empty">—</span>
          <FaPencilAlt className="market-edit-icon" size={8} />
        </span>
      );
    }
    let cls = "market-table-price";
    if (value === row.lowest) cls += " market-price-lowest";
    if (row.highest !== null && value === row.highest && row.lowest !== row.highest) cls += " market-price-highest";
    return (
      <span className="market-price-cell-edit" onClick={() => startEdit(row, key)} title="Click to edit price">
        <span className={cls}>{formatCurrency(value)}</span>
        <FaPencilAlt className="market-edit-icon" size={8} />
      </span>
    );
  };

  const renderLowest = (row) => {
    if (row.lowest === null || row.lowest === undefined) {
      return <span className="market-price-empty">—</span>;
    }
    const sourceKey = findLowestSource(row);
    const label = sourceKey ? labelOf(sourceKey) : 'Lowest';
    return (
      <span className="market-table-price market-price-lowest">
        {label} — {formatCurrency(row.lowest)}
      </span>
    );
  };

  const renderSavings = (row) => {
    if (row.lowest === null || row.lowest === undefined || row.yourPrice === null || row.yourPrice === undefined) {
      return <span className="market-price-empty">—</span>;
    }
    const savings = Number(Number(row.yourPrice - row.lowest).toFixed(2));
    if (savings > 0) {
      return <span className="market-savings-positive">Save {formatCurrency(savings)}</span>;
    }
    if (savings < 0) {
      return <span className="market-savings-negative">Pay {formatCurrency(Math.abs(savings))} more</span>;
    }
    return <span className="market-price-empty">Same</span>;
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  const trendIngName = (ingredients || []).find((i) => String(i.id) === String(trendIngredientId))?.name || "";

  // Recompute summary live while a price is being typed.
  const displaySummary = editingCell
    ? computeSummaryStats(rows.map(getEffectiveRow), sources)
    : summaryStats;


  const insights = useMemo(() => {
    const tips = [];

    // 1. Cheapest store overall (whole filtered dataset, from the server summary).
    if (displaySummary.cheapestSource && displaySummary.cheapestSource !== "-") {
      const label = String(displaySummary.cheapestSource).split(' (avg')[0];
      tips.push({
        tone: 'positive',
        text: `${label} is the cheapest store across the ingredients you compare. Doing your price-checked purchases there can lower your food cost.`,
      });
    }

    // 2. Potential savings by buying at the lowest market price (visible items).
    let savingCount = 0;
    let savingSum = 0;
    let biggestSave = null;
    (rows || []).forEach((row) => {
      const saving = Number(row.savings);
      if (row.savings !== null && row.savings !== undefined && saving > 0) {
        savingCount += 1;
        savingSum += saving;
        if (!biggestSave || saving > biggestSave.saving) {
          biggestSave = { ingredient: row.ingredient, saving };
        }
      }
    });
    if (savingCount === 1 && biggestSave) {
      tips.push({
        tone: 'positive',
        text: `You can save ${formatCurrency(biggestSave.saving)} on ${biggestSave.ingredient} by buying it at the lowest market price recorded above.`,
      });
    } else if (savingCount > 1) {
      tips.push({
        tone: 'positive',
        text: `You can save about ${formatCurrency(savingSum)} across ${savingCount} ingredient(s) above by sourcing at the lowest market price.`,
      });
    }

    // 3. Biggest price gap — where shopping around pays most.
    if (displaySummary.biggestGap && displaySummary.biggestGap.value) {
      tips.push({
        tone: 'info',
        text: `The widest price difference is ${formatCurrency(displaySummary.biggestGap.value)} on ${displaySummary.biggestGap.ingredient || 'an ingredient'}. Comparing suppliers here can save you the most.`,
      });
    }

    // 4. Trend insight for the selected ingredient's history.
    if (trendIngredientId && trendRows && trendRows.length) {
      const perSource = {};
      (trendRows || []).forEach((t) => {
        if (!perSource[t.source]) perSource[t.source] = [];
        perSource[t.source].push(Number(t.price));
      });
      let best = null;
      Object.keys(perSource).forEach((src) => {
        const avg = perSource[src].reduce((a, b) => a + b, 0) / perSource[src].length;
        if (!best || avg < best.avg) best = { src, avg };
      });
      if (best) {
        const ingName = (ingredients || []).find((i) => String(i.id) === String(trendIngredientId))?.name;
        tips.push({
          tone: 'info',
          text: `Over the recorded history${ingName ? ` for ${ingName}` : ''}, ${labelOf(best.src)} has held the lowest average price (${formatCurrency(best.avg)}) — stick with it for this ingredient.`,
        });
      }
    }

    // 5. Low-stock cross-reference from the inventory list.
    const lowItems = (ingredients || []).filter((ing) => {
      const q = Number(ing.quantity) || 0;
      const ms = Number(ing.min_stock) || 0;
      return q === 0 || q <= ms;
    });
    if (lowItems.length) {
      tips.push({
        tone: 'warning',
        text: `${lowItems.length} ingredient(s) in your inventory are low or out of stock (e.g. ${lowItems.slice(0, 3).map((i) => i.name).join(', ')}). Restock soon so your menu stays available.`,
      });
    }

    // 6. Data freshness reminder.
    if (!displaySummary.lastUpdated) {
      tips.push({
        tone: 'info',
        text: 'No price records yet — record your first prices above and these recommendations will tailor to your actual data.',
      });
    }

    return tips;
  }, [displaySummary, rows, trendIngredientId, trendRows, ingredients, sources]);

  // ============ RENDER ============
  return (
    <div className="inventory-component">
      

      {/* Stats Cards - 4 Cards */}
      <div className="inventory-stats-cards">
        <div className="inventory-stat-card market-card-source">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Cheapest Source</p>
              <Tippy
                content="The store with the lowest average price across all recorded ingredients. Computed from the supplier columns of every comparison row."
                placement="bottom"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Cheapest source information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value is-small">{displaySummary.cheapestSource}</p>
            <p className="inventory-stat-card-change">Lowest average price per source</p>
          </div>
        </div>

        <div className="inventory-stat-card market-card-avg">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Average Price</p>
              <Tippy
                content="The mean of the lowest recorded price for every ingredient. Tells you roughly how much the cheapest source charges, on average."
                placement="bottom"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Average price information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value is-medium">{formatCurrency(displaySummary.avgPrice)}</p>
            <p className="inventory-stat-card-change">Mean of lowest prices</p>
          </div>
        </div>

        <div className="inventory-stat-card market-card-gap">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Biggest Price Gap</p>
              <Tippy
                content="The largest difference between the highest and the lowest recorded price for a single ingredient."
                placement="bottom"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Biggest price gap information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value is-small">
              {displaySummary.biggestGap && displaySummary.biggestGap.value
                ? `${formatCurrency(displaySummary.biggestGap.value)} (${displaySummary.biggestGap.ingredient || ''})`
                : "-"}
            </p>
            <p className="inventory-stat-card-change">High vs lowest price</p>
          </div>
        </div>

        <div className="inventory-stat-card market-card-updated">
          <div className="inventory-stat-card-content">
            <div className="inventory-stat-card-header">
              <p className="inventory-stat-card-label">Last Updated</p>
              <Tippy
                content={displaySummary.lastUpdated ? `Exact date: ${formatDate(displaySummary.lastUpdated)}` : "No price records yet."}
                placement="bottom"
                animation="scale"
                duration={200}
                theme="dark"
                arrow
                delay={[100, 0]}
                interactive
                trigger="mouseenter focus click"
                appendTo={() => document.body}
                zIndex={100000}
              >
                <span className="inventory-card-info" tabIndex={0} aria-label="Last updated information">
                  <FaInfoCircle />
                </span>
              </Tippy>
            </div>
            <p className="inventory-stat-card-value is-small">{timeAgo(displaySummary.lastUpdated, now)}</p>
            <p className="inventory-stat-card-change">Most recent manual recording</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="inventory-controls">
        <div className="inventory-search-box">
          <input
            type="text"
            className="inventory-search-input"
            placeholder="Search by ingredient name..."
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
            aria-label="Filter by category"
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
            value={selectedSource}
            aria-label="Filter by source"
            onChange={(e) => {
              setSelectedSource(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="All">All Sources</option>
            {(sources || []).map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          <select
            className="inventory-sort-select"
            value={sortField}
            onChange={(e) => handleSort(e.target.value)}
          >
            <option value="ingredient">Sort By: Ingredient</option>
            <option value="category">Sort By: Category</option>
            <option value="lowest">Sort By: Lowest Price</option>
            <option value="savings">Sort By: Savings</option>
          </select>

          <Tippy
            content="Opens the official DA price monitoring page in a new tab. Nothing is downloaded automatically — enter prices manually after reviewing."
            placement="bottom"
            animation="scale"
            duration={200}
            theme="dark"
            arrow
            delay={[100, 0]}
            interactive
            trigger="mouseenter focus click"
            appendTo={() => document.body}
            zIndex={100000}
          >
            <button
              className="btn-secondary"
              onClick={() => window.open('https://www.da.gov.ph/price-monitoring/', '_blank', 'noopener,noreferrer')}
            >
              <FaExternalLinkAlt /> DA Bantay Presyo
            </button>
          </Tippy>

          <button className="btn-secondary" onClick={handleExportCsv}>
            <FaFileCsv /> Export CSV
          </button>

          <button className="btn-secondary" onClick={() => setIsSourcesOpen(true)}>
            <FaStore /> Manage Sources
          </button>

          <button className="btn-primary" onClick={openCreateModal}>
            <FaPlus /> Add Price Entry
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="inventory-loading-state">
          <div className="inventory-spinner"></div>
          <p>Loading market prices...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="inventory-empty-state">
          <FaChartLine size={48} />
          <h3>No Market Prices</h3>
          <p>Record your first ingredient price to start comparing stores.</p>
          <button className="inventory-btn-add-item" onClick={openCreateModal}>
            Add Price Entry
          </button>
        </div>
      ) : (
        <>
          <div className="inventory-table-responsive">
            <table className="inventory-table market-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="sortable"><SortableHeader label="Ingredient" field="ingredient" activeSortField={sortField} sortDirection={sortDirection} onSort={handleSort} /></th>
                  <th>Unit</th>
                  <th className="sortable"><SortableHeader label="Category" field="category" activeSortField={sortField} sortDirection={sortDirection} onSort={handleSort} /></th>
                  {(sources || []).map((s) => (
                    <th key={s.key}>
                      <SourceHeader label={s.label} tooltip={s.tooltip || `Manually recorded prices from ${s.label}.`} />
                    </th>
                  ))}
                  <th className="sortable"><SortableHeader label="Lowest" field="lowest" activeSortField={sortField} sortDirection={sortDirection} onSort={handleSort} /></th>
                  <th>
                    <Tippy
                      content="Difference between your current ingredient cost and the lowest recorded market price."
                      placement="top"
                      animation="scale"
                      duration={200}
                      theme="dark"
                      arrow
                      delay={[100, 0]}
                      interactive
                      trigger="mouseenter focus click"
                      appendTo={() => document.body}
                      zIndex={100000}
                    >
                      <span className="market-source-header">
                        Savings vs Your Price
                        <FaInfoCircle className="market-source-info-icon" tabIndex={0} />
                      </span>
                    </Tippy>
                  </th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const displayIndex = (currentPage - 1) * itemsPerPage + index + 1;
                  const effectiveRow = getEffectiveRow(row);
                  return (
                    <tr key={row.ingredientId || index}>
                      <td>{displayIndex}</td>
                      <td className="inventory-item-name-cell">
                        <span className="inventory-item-name">{row.ingredient || 'Unnamed'}</span>
                      </td>
                      <td>{row.unit || 'pcs'}</td>
                      <td>
                        {row.category ? (
                          <span className="category-badge">{row.category}</span>
                        ) : (
                          <span className="market-price-empty">—</span>
                        )}
                      </td>
                      {(sources || []).map((s) => (
                        <td key={s.key}>{renderPriceCell(effectiveRow, s.key)}</td>
                      ))}
                      <td>{renderLowest(effectiveRow)}</td>
                      <td>{renderSavings(effectiveRow)}</td>
                      <td>{row.lastUpdated ? formatDate(row.lastUpdated) : <span className="market-price-empty">—</span>}</td>
                      <td>
                        <div className="inventory-action-buttons">
                          <button
                            className="inventory-action-btn edit"
                            onClick={() => openEditModal(row)}
                            title="Edit prices"
                          >
                            <FaEdit size={14} />
                          </button>
                         
                          <button
                            className="inventory-action-btn history"
                            onClick={() => toggleTrend(row.ingredientId)}
                            title="View price trend"
                          >
                            <FaChartLine size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination — always visible so it's clear the table is split 10 per page */}
          {rows.length > 0 && (
            <div className="inventory-pagination">
              <span className="inventory-pagination-info">
                Showing {(currentPage - 1) * itemsPerPage + 1}–
                {Math.min(currentPage * itemsPerPage, totalItems || rows.length)} of {totalItems || rows.length} items
              </span>

              <div className="inventory-pagination-controls">
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

              <div className="inventory-pagination-anchor" aria-hidden="true"></div>
            </div>
          )}
        </>
      )}

      {/* ============ PRICE TREND MODAL ============ */}
      {showTrend && trendIngredientId && (
        <InventoryModal
          className="modal-lg market-trend-modal inventory-confirmation-modal"
          onClose={() => {
            setShowTrend(false);
            setTrendIngredientId("");
          }}
        >
          <div className="modal-header inventory-modal-header">
            <h3 className="modal-title">
              <FaChartLine /> Price Trend{trendIngName ? ` — ${trendIngName}` : ''}
            </h3>
            <button
              className="modal-close-btn"
              onClick={() => {
                setShowTrend(false);
                setTrendIngredientId("");
              }}
            >
              <FaTimes />
            </button>
          </div>
          <div className="modal-body inventory-modal-body">
            <div className="market-price-chart-picker">
              <select
                className="inventory-sort-select"
                value={trendChartType}
                onChange={(e) => setTrendChartType(e.target.value)}
                aria-label="Pick chart type for price trend"
              >
                <option value="line">Line Chart</option>
                <option value="bar">Bar Chart</option>
                <option value="area">Area Chart</option>
              </select>
            </div>

            {trendLoading ? (
              <div className="inventory-loading-state" style={{ padding: '30px 20px' }}>
                <div className="inventory-spinner"></div>
                <p>Loading price history...</p>
              </div>
            ) : presentTrendSources.length === 0 ? (
              <div className="inventory-empty-state" style={{ padding: '30px 20px' }}>
                <FaChartLine size={40} />
                <p>No recorded prices for this ingredient yet.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                {trendChartType === 'bar' ? (
                  <BarChart data={trendChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {presentTrendSources.map((col, i) => (
                      <Bar key={col.key} dataKey={col.key} name={labelOf(col.key)} fill={colorOf(i)} />
                    ))}
                  </BarChart>
                ) : trendChartType === 'area' ? (
                  <AreaChart data={trendChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {presentTrendSources.map((col, i) => (
                      <Area key={col.key} type="monotone" dataKey={col.key} name={labelOf(col.key)} stroke={colorOf(i)} fill={colorOf(i)} fillOpacity={0.15} />
                    ))}
                  </AreaChart>
                ) : (
                  <LineChart data={trendChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {presentTrendSources.map((col, i) => (
                      <Line
                        key={col.key}
                        type="monotone"
                        dataKey={col.key}
                        name={labelOf(col.key)}
                        stroke={colorOf(i)}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            )}

            {insights.length > 0 && (
              <div className="market-price-insights">
                <div className="market-price-insights-title">
                                    <FaLightbulb size={14} />

                  Insights &amp; Recommendations
                </div>
                <ul className="market-price-insights-list">
                  {insights.map((tip, i) => (
                    <li key={i} className={`market-price-insight market-price-insight-${tip.tone}`}>
                      <span className="market-price-insight-icon">{tip.icon}</span>
                      <span className="market-price-insight-text">{tip.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </InventoryModal>
      )}

      {/* ============ MODALS ============ */}
      {isModalOpen && (
        <MarketPriceModal
          key={modalKey}
          isOpen={isModalOpen}
          mode={modalMode}
          row={selectedRow}
          ingredients={ingredients}
          sources={sources}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onClose={() => {
            if (!isSubmitting) {
              setIsModalOpen(false);
              setSelectedRow(null);
            }
          }}
        />
      )}

      {/* ============ MANAGE SOURCES MODAL ============ */}
      {isSourcesOpen && (
        <InventoryModal
          className="modal-md inventory-confirmation-modal"
          onClose={() => {
            if (!sourceActionLoading) setIsSourcesOpen(false);
          }}
        >
          <div className="modal-header inventory-modal-header">
            <h3 className="modal-title">Manage Market Sources</h3>
            <button
              className="modal-close-btn"
              onClick={() => {
                if (!sourceActionLoading) setIsSourcesOpen(false);
              }}
            >
              <FaTimes />
            </button>
          </div>
          <div className="modal-body inventory-modal-body">
            <p className="form-label" style={{ marginBottom: 8 }}>
              Add your own store or market. It becomes a new column in the price table.
            </p>
            <div className="market-source-add-row">
              <input
                type="text"
                className="form-input"
                placeholder="Store name, e.g. Gaisano, Metro, S&R..."
                value={newSourceLabel}
                onChange={(e) => setNewSourceLabel(e.target.value)}
                disabled={sourceActionLoading}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Optional note (shown on hover)"
                value={newSourceTooltip}
                onChange={(e) => setNewSourceTooltip(e.target.value)}
                disabled={sourceActionLoading}
              />
              <button className="btn-primary" onClick={handleAddSource} disabled={sourceActionLoading}>
                <FaPlus /> {sourceActionLoading ? 'Adding...' : 'Add'}
              </button>
            </div>

            <div className="market-source-list">
              {(sources || []).map((s, i) => (
                <div className="market-source-list-row" key={s.key || i}>
                  <span className="market-source-swatch" style={{ backgroundColor: colorOf(i) }} />
                  <span className="market-source-list-label">{s.label}</span>
                  <button
                    className="market-source-remove-btn"
                    title={s.id ? `Remove ${s.label}` : 'Built-in source (cannot be removed)'}
                    onClick={() => handleDeleteSource(s)}
                    disabled={sourceActionLoading || !s.id}
                  >
                    <FaTrash size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer inventory-modal-footer">
            <button className="btn-secondary" onClick={() => setIsSourcesOpen(false)} disabled={sourceActionLoading}>
              Done
            </button>
          </div>
        </InventoryModal>
      )}

      {/* Delete confirmation */}
      {isDeleteOpen && (
        <InventoryModal
          className="modal-md inventory-confirmation-modal"
          onClose={() => {
            if (!isSubmitting) setIsDeleteOpen(false);
          }}
        >
          <div className="modal-header inventory-modal-header">
            <h3 className="modal-title">Delete Price Entries</h3>
            <button
              className="modal-close-btn"
              onClick={() => {
                if (!isSubmitting) setIsDeleteOpen(false);
              }}
            >
              <FaTimes />
            </button>
          </div>
          <div className="modal-body inventory-modal-body">
            <div className="confirmation-content">
              <div className="confirmation-icon danger">
                <FaTrash size={32} />
              </div>
              <h4>Delete all recorded prices for "{selectedRow?.ingredient}"?</h4>
              <p>
                This removes every manual price record you entered for this ingredient. This action
                cannot be undone.
              </p>
            </div>
          </div>
          <div className="modal-footer inventory-modal-footer">
            <button
              className="btn-secondary"
              onClick={() => {
                if (!isSubmitting) setIsDeleteOpen(false);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              className="btn-danger"
              onClick={handleDeleteRow}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting...' : <><FaTrash /> Delete</>}
            </button>
          </div>
        </InventoryModal>
      )}
    </div>
  );
};

export default MarketPriceManagement;