// DataManagement.jsx
import { useState, useEffect } from "react";
import "./DataManagement.css";
import Navbar from "../../components/Navbar/Navbar";
import UploadData from "../components/UploadData";
import axios from 'axios';

// Use environment variable with fallback
const API_URL = typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL 
  ? process.env.REACT_APP_API_URL 
  : 'http://localhost:5000/api';

const DataManagement = () => {
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState("upload");
  const [stats, setStats] = useState({
    total_uploads: 0,
    processed: 0,
    pending: 0,
    failed: 0,
    total_rows: 0,
    menu_items: 0,
    last_sync: null
  });
  const [loading, setLoading] = useState(true);

  // Get auth token from localStorage
  const getAuthToken = () => {
    return localStorage.getItem('token');
  };

  // Axios instance with auth header
  const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  // Add token to requests
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

  // Fetch upload statistics
  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/uploads/stats/summary');
      
      if (response.data.success) {
        setStats({
          total_uploads: response.data.data.total_uploads || 0,
          processed: response.data.data.processed || 0,
          pending: response.data.data.pending || 0,
          failed: response.data.data.failed || 0,
          total_rows: response.data.data.total_rows || 0,
          menu_items: response.data.data.menu_items || 0, // Default if not available
          last_sync: response.data.data.last_sync || new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      // Keep default values if API fails
      setStats({
        total_uploads: 0,
        processed: 0,
        pending: 0,
        failed: 0,
        total_rows: 0,
        menu_items: 0,
        last_sync: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

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

  const handleConfirmUpload = async (file, fileType) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fileType', fileType);

      const response = await apiClient.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        // Refresh stats after successful upload
        await fetchStats();
        return response.data;
      }
      throw new Error('Upload failed');
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
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
        </div>

        <div className="content-grid">
          {/* Summary Cards - Dynamic */}
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-card-content">
                <p className="summary-label">Sales Records</p>
                <p className="summary-val">{loading ? '...' : stats.total_rows || 0}</p>
                <p className="summary-subtext">Total Active</p>
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
                <p className="summary-subtext">{loading ? '...' : new Date(stats.last_sync || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
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