// components/HistoricalData.jsx
import { useState, useEffect } from "react";
import { 
  FiChevronLeft, 
  FiChevronRight, 
  FiDownload,
  
} from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./HistoricalData.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const HistoricalData = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("Newest First");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [historicalData, setHistoricalData] = useState([]);

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

  // Fetch historical data from uploads table
  const fetchHistoricalData = async () => {
    try {
      setLoading(true);
      
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
        fileName: upload.original_name || upload.filename || 'Unknown file',
        records: upload.row_count || 0,
        status: upload.status || 'pending'
      }));

      // Sort by date (newest first)
      transformedData.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

      setHistoricalData(transformedData);

    } catch (error) {
      console.error('Error fetching historical data:', error);
      toast.error('Failed to load historical data');
      setHistoricalData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoricalData();
  }, []);

  // Filter data based on search
  const filteredData = historicalData.filter(item =>
    item.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.uploadDate.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.status && item.status.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Pagination
  const itemsPerPage = 5;
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  // Get page numbers for pagination
  const getPageNumbers = () => {
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
  };

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
       
      </div>

      {/* Search and Filter */}
      <div className="historical-controls">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Search file name, date, or status..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="sort-wrapper">
          <select 
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option>Newest First</option>
            <option>Oldest First</option>
            <option>File Name: A-Z</option>
            <option>File Name: Z-A</option>
            <option>Records: Low to High</option>
            <option>Records: High to Low</option>
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
    </div>
  );
};

export default HistoricalData;