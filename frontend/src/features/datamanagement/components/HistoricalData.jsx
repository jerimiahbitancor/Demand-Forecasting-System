// components/HistoricalData.jsx
import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  FiChevronLeft, 
  FiChevronRight, 
  FiDownload,
  FiSearch,
  FiRefreshCw
} from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./HistoricalData.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Session storage keys
const STORAGE_KEYS = {
  HISTORICAL_DATA: 'historical_data',
  SEARCH_TERM: 'historical_search_term',
  SORT_BY: 'historical_sort_by',
  CURRENT_PAGE: 'historical_current_page',
  LAST_FETCH: 'historical_last_fetch'
};

const HistoricalData = () => {
  // Load from sessionStorage or use defaults
  const [searchTerm, setSearchTerm] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEYS.SEARCH_TERM) || "";
  });
  
  const [sortBy, setSortBy] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEYS.SORT_BY) || "Newest First";
  });
  
  const [currentPage, setCurrentPage] = useState(() => {
    return parseInt(sessionStorage.getItem(STORAGE_KEYS.CURRENT_PAGE)) || 1;
  });
  
  const [loading, setLoading] = useState(true);
  const [historicalData, setHistoricalData] = useState(() => {
    const stored = sessionStorage.getItem(STORAGE_KEYS.HISTORICAL_DATA);
    return stored ? JSON.parse(stored) : [];
  });

  // Get auth token from sessionStorage
  const getAuthToken = useCallback(() => {
    return sessionStorage.getItem('token') || sessionStorage.getItem('access_token');
  }, []);

  // Axios instance
  const apiClient = useMemo(() => {
    const client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      }
    });

    client.interceptors.request.use(
      (config) => {
        const token = getAuthToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return client;
  }, [getAuthToken]);

  // Save to sessionStorage whenever state changes
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.HISTORICAL_DATA, JSON.stringify(historicalData));
  }, [historicalData]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.SEARCH_TERM, searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.SORT_BY, sortBy);
  }, [sortBy]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.CURRENT_PAGE, currentPage.toString());
  }, [currentPage]);

  // Fetch historical data from uploads table
  const fetchHistoricalData = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      
      // Check if we have valid cached data
      const storedData = sessionStorage.getItem(STORAGE_KEYS.HISTORICAL_DATA);
      const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
      
      // Cache is valid for 5 minutes
      const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 5 * 60 * 1000;
      
      if (!forceRefresh && storedData && cacheValid) {
        const parsedData = JSON.parse(storedData);
        setHistoricalData(parsedData);
        setLoading(false);
        return;
      }

      // Fetch uploads from the uploads table
      const response = await apiClient.get('/uploads', {
        params: {
          limit: 100,
          offset: 0
        }
      });

      let uploads = [];
      if (response.data.success) {
        uploads = response.data.data;
      }

      // Transform uploads data to match the table structure
      const transformedData = uploads.map(upload => ({
        id: upload.id,
        uploadDate: upload.upload_date || upload.created_at || new Date().toISOString(),
        fileName: upload.filename || upload.original_name || 'Unknown file',
        records: upload.row_count || 0,
        status: upload.status || 'pending'
      }));

      // Sort by date (newest first)
      transformedData.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

      setHistoricalData(transformedData);
      sessionStorage.setItem(STORAGE_KEYS.HISTORICAL_DATA, JSON.stringify(transformedData));
      sessionStorage.setItem(STORAGE_KEYS.LAST_FETCH, Date.now().toString());

    } catch (error) {
      console.error('Error fetching historical data:', error);
      if (error.response?.status === 401) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        toast.error('Session expired. Please login again.');
      } else {
        toast.error('Failed to load historical data');
      }
      setHistoricalData([]);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  // Initial load - check sessionStorage first
  useEffect(() => {
    const hasStoredData = sessionStorage.getItem(STORAGE_KEYS.HISTORICAL_DATA) !== null;
    const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
    const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 5 * 60 * 1000;
    
    if (hasStoredData && cacheValid) {
      const storedData = sessionStorage.getItem(STORAGE_KEYS.HISTORICAL_DATA);
      if (storedData) {
        setHistoricalData(JSON.parse(storedData));
      }
      setLoading(false);
    } else {
      fetchHistoricalData(false);
    }
  }, [fetchHistoricalData]);

  // Refresh data when tab becomes active
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
        const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 5 * 60 * 1000;
        if (!cacheValid) {
          fetchHistoricalData(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchHistoricalData]);

  // Sort options
  const sortOptions = [
    { value: "Newest First", label: "Newest First" },
    { value: "Oldest First", label: "Oldest First" },
    { value: "File Name: A-Z", label: "File Name: A-Z" },
    { value: "File Name: Z-A", label: "File Name: Z-A" },
    { value: "Records: Low to High", label: "Records: Low to High" },
    { value: "Records: High to Low", label: "Records: High to Low" },
  ];

  // Filter and sort data
  const filteredData = useMemo(() => {
    let filtered = [...historicalData];
    
    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.fileName.toLowerCase().includes(searchLower) ||
        item.uploadDate.toLowerCase().includes(searchLower) ||
        (item.status && item.status.toLowerCase().includes(searchLower))
      );
    }

    // Apply sorting
    switch(sortBy) {
      case 'Oldest First':
        filtered.sort((a, b) => new Date(a.uploadDate) - new Date(b.uploadDate));
        break;
      case 'File Name: A-Z':
        filtered.sort((a, b) => a.fileName.localeCompare(b.fileName));
        break;
      case 'File Name: Z-A':
        filtered.sort((a, b) => b.fileName.localeCompare(a.fileName));
        break;
      case 'Records: Low to High':
        filtered.sort((a, b) => a.records - b.records);
        break;
      case 'Records: High to Low':
        filtered.sort((a, b) => b.records - a.records);
        break;
      case 'Newest First':
      default:
        filtered.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
        break;
    }

    return filtered;
  }, [historicalData, searchTerm, sortBy]);

  // Pagination
  const itemsPerPage = 5;
  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  // Get page numbers for pagination
  const getPageNumbers = useMemo(() => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  // Get status badge class
  const getStatusBadgeClass = (status) => {
    switch(status) {
      case 'processed':
        return 'status-success';
      case 'pending':
        return 'status-pending';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-info';
    }
  };

  // Handle download
  const handleDownload = (item) => {
    toast.success(`Downloading ${item.fileName}...`);
  };

  return (
    <div className="historical-container">
      {/* Header */}
      <div className="historical-header">
        <h2 className="historical-title">Historical Data Storage</h2>
        <button 
          className="btn-refresh" 
          onClick={() => fetchHistoricalData(true)} 
          disabled={loading}
        >
          <FiRefreshCw size={16} className={loading ? 'spinning' : ''} />
        </button>
      </div>

      {/* Search and Filter */}
      <div className="historical-controls">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Search file name, date, or status..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
        <div className="sort-wrapper">
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
        </div>
      </div>

      {/* Historical Data Table */}
      <div className="historical-section">
        <div className="historical-table-wrapper">
          {loading ? (
            <div className="loading-state">Loading historical data...</div>
          ) : currentData.length === 0 ? (
            <div className="empty-state">No historical data found</div>
          ) : (
            <table className="historical-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Upload Date</th>
                  <th>File Name</th>
                  <th>Records</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {currentData.map((item, index) => (
                  <tr key={item.id}>
                    <td>{startIndex + index + 1}</td>
                    <td>{formatDate(item.uploadDate)}</td>
                    <td className="file-name-cell">{item.fileName}</td>
                    <td>{item.records.toLocaleString()}</td>
                    <td>
                      <span className={`status-badge ${getStatusBadgeClass(item.status)}`}>
                        {item.status || 'pending'}
                      </span>
                    </td>
                    <td>
                      <button 
                        className="action-btn download"
                        onClick={() => handleDownload(item)}
                        title="Download file"
                      >
                        <FiDownload size={16} />
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
    </div>
  );
};

export default HistoricalData;