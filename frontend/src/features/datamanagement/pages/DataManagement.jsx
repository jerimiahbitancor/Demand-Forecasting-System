// DataManagement.jsx
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import "./DataManagement.css";
import Navbar from "../../components/Navbar/Navbar";
import UploadData from "../components/UploadData";
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const DataManagement = () => {
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState("upload");
  const [stats, setStats] = useState({
    total_uploads: 0,
    processed: 0,
    pending: 0,
    failed: 0,
    sales_records: 0,
    menu_items: 0,
    last_sync: null
  });
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  
  // Refs for auto-refresh
  const refreshIntervalRef = useRef(null);
  const isMountedRef = useRef(true);

  // Get auth token from sessionStorage
  const getAuthToken = () => {
    return sessionStorage.getItem('token') || sessionStorage.getItem('access_token');
  };

  // Create axios instance
  const apiClient = useMemo(() => {
    const client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      }
    });

    // Add token to requests from sessionStorage
    client.interceptors.request.use(
      (config) => {
        const token = getAuthToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          console.log('✅ DataManagement - Token added to request:', config.url);
        } else {
          console.warn('⚠️ DataManagement - No token found for request:', config.url);
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return client;
  }, []);

  const fetchStats = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) {
        setLoading(true);
      }
      
      const response = await apiClient.get('/uploads/stats/summary');
      
      if (response.data.success && isMountedRef.current) {
        setStats({
          total_uploads: response.data.data.total_uploads || 0,
          processed: response.data.data.processed || 0,
          pending: response.data.data.pending || 0,
          failed: response.data.data.failed || 0,
          sales_records: response.data.data.sales_records || 0,
          menu_items: response.data.data.menu_items || 0,
          last_sync: response.data.data.last_sync || new Date().toISOString()
        });
        setLastRefreshed(new Date());
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      // If unauthorized, clear session
      if (error.response?.status === 401) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        // Stop auto-refresh on auth error
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      }
      if (isMountedRef.current) {
        setStats({
          total_uploads: 0,
          processed: 0,
          pending: 0,
          failed: 0,
          sales_records: 0,
          menu_items: 0,
          last_sync: new Date().toISOString()
        });
      }
    } finally {
      if (showLoader && isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [apiClient]);

  // Handle visibility change - pause/resume auto-refresh when tab is hidden/shown
  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      // Tab is hidden, pause auto-refresh
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
        console.log('⏸️ Auto-refresh paused (tab hidden)');
      }
    } else {
      // Tab is visible again, resume auto-refresh
      if (!refreshIntervalRef.current) {
        // Immediate refresh when tab becomes visible
        fetchStats(false);
        
        // Restart interval
        refreshIntervalRef.current = setInterval(() => {
          if (isMountedRef.current) {
            fetchStats(false);
          }
        }, 5000);
        console.log('▶️ Auto-refresh resumed (tab visible)');
      }
    }
  }, [fetchStats]);

  // Setup auto-refresh on mount
  useEffect(() => {
    isMountedRef.current = true;
    
    // Initial fetch with loader
    fetchStats(true);
    
    // Set interval for auto-refresh without loader
    refreshIntervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        fetchStats(false);
      }
    }, 5000); // 5 seconds
    
    console.log('🔄 Auto-refresh started (every 5 seconds)');
    
    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      console.log('⏹️ Auto-refresh stopped');
    };
  }, [fetchStats, handleVisibilityChange]);

  // Force refresh when upload completes
  const handleConfirmUpload = async (file, fileType) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileType', fileType);

      const token = getAuthToken();
      console.log('🔑 DataManagement - Upload with token:', token ? 'Yes' : 'No');

      const response = await apiClient.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        // Immediate refresh after upload
        await fetchStats(true);
        return response.data;
      }
      throw new Error('Upload failed');
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setUploadedFile(file);
      console.log("File uploaded:", file.name);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadedFile(file);
      console.log("File selected:", file.name);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDiscard = () => {
    setUploadedFile(null);
    console.log("Upload discarded");
  };

  const handleFixIssue = (row) => {
    console.log(`Fixing issue at row ${row}`);
  };

  // Define tabs configuration
  const tabs = [
    { id: "upload", label: "Sales Data Upload" },
    { id: "mapping", label: "Menu & Ingredient Mapping" },
    { id: "historical", label: "Historical Data Storage" },
  ];

  // Format last sync date
  const formatLastSync = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffHours = Math.floor((now - date) / (1000 * 60 * 60));
      
      if (diffHours < 1) return 'Just now';
      if (diffHours === 1) return '1h ago';
      if (diffHours < 24) return `${diffHours}h ago`;
      
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return 'N/A';
    }
  };

  // Format last refreshed time
  const formatLastRefreshed = (date) => {
    if (!date) return 'Waiting...';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Get status text
  const getStatusText = () => {
    if (loading) return 'Loading...';
    if (stats.total_uploads === 0) return 'No uploads yet';
    return `${stats.total_uploads} upload${stats.total_uploads > 1 ? 's' : ''}`;
  };

  return (
    <div className="data-management-wrapper">
      <Navbar />

      {/* Main Content */}
      <main className="data-management-main">
        <div className="data-management-header">
          <div>
            <h1 className="page-title">Data Management</h1>
            <p className="page-subtitle">
              Upload, manage, and review your sales and mapping datasets.
            </p>
          </div>
          {/* Auto-refresh indicator */}
         
        </div>

        <div className="content-grid">
          {/* Summary Cards - Dynamic */}
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-card-content">
                <p className="summary-label">Sales Records</p>
                <p className="summary-val">{loading ? '...' : stats.sales_records || 0}</p>
                <p className="summary-subtext">Total Sales Rows</p>
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-content">
                <p className="summary-label">Menu Items</p>
                <p className="summary-val">{loading ? '...' : stats.menu_items || 0}</p>
                <p className="summary-subtext">Mapped Items</p>
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-content">
                <p className="summary-label">Last Sync</p>
                <p className="summary-val">{loading ? '...' : formatLastSync(stats.last_sync)}</p>
                <p className="summary-subtext">{loading ? '...' : (stats.last_sync ? new Date(stats.last_sync).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'No uploads yet')}</p>
              </div>
            </div>
          </div>

          {/* Tabbed Container */}
          <UploadData  
            activeTab={activeTab} 
            setActiveTab={setActiveTab}
            tabs={tabs}
            uploadedFile={uploadedFile}
            isDragging={isDragging}
            handleFileDrop={handleFileDrop}
            handleFileSelect={handleFileSelect}
            handleDragOver={handleDragOver}
            handleDragLeave={handleDragLeave}
            handleConfirmUpload={handleConfirmUpload}
            handleDiscard={handleDiscard}
            handleFixIssue={handleFixIssue}
            apiUrl={API_URL}
          />
        </div>
      </main>

  
    </div>
  );
};

export default DataManagement;