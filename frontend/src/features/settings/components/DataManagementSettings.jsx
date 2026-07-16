// DataManagementSettings.jsx
import { useState } from "react";
import { FiInfo, FiAlertTriangle, FiDownload, FiCheck, FiX } from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./DataManagementSettings.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function DataManagementSettings() {
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [backupStatus, setBackupStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);

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

  // Backup Database handler
  const handleCreateBackup = async () => {
    setBackupStatus("loading");
    const loadingToast = toast.loading('Creating database backup...');

    try {
      const response = await apiClient.post('/settings/backup');
      
      toast.dismiss(loadingToast);
      if (response.data.success) {
        setBackupStatus("success");
        toast.success('Database backup created successfully!');
        // Download the backup file
        if (response.data.data?.url) {
          window.open(response.data.data.url, '_blank');
        }
        setTimeout(() => {
          setBackupStatus(null);
        }, 3000);
      } else {
        throw new Error('Backup failed');
      }
    } catch (error) {
      toast.dismiss(loadingToast);
      console.error('Error creating backup:', error);
      setBackupStatus("error");
      toast.error('Failed to create backup');
      setTimeout(() => {
        setBackupStatus(null);
      }, 3000);
    }
  };

  // Reset Historical Data handler
  const handleResetHistoricalData = async () => {
    const confirmed = window.confirm(
      "WARNING: This action cannot be undone. Are you sure you want to reset all historical data?"
    );
    if (!confirmed) return;

    setResetStatus("loading");
    const loadingToast = toast.loading('Resetting historical data...');

    try {
      const response = await apiClient.delete('/settings/reset-data');
      
      toast.dismiss(loadingToast);
      if (response.data.success) {
        setResetStatus("success");
        toast.success('Historical data reset successfully!');
        setTimeout(() => {
          setResetStatus(null);
        }, 3000);
      } else {
        throw new Error('Reset failed');
      }
    } catch (error) {
      toast.dismiss(loadingToast);
      console.error('Error resetting data:', error);
      setResetStatus("error");
      toast.error('Failed to reset historical data');
      setTimeout(() => {
        setResetStatus(null);
      }, 3000);
    }
  };

  // Export Data handler
  const handleExportData = async () => {
    setExportStatus("loading");
    const loadingToast = toast.loading(`Exporting data as ${exportFormat.toUpperCase()}...`);

    try {
      const response = await apiClient.get('/settings/export-data', {
        params: { format: exportFormat },
        responseType: 'blob'
      });
      
      toast.dismiss(loadingToast);
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `data_export.${exportFormat}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      setExportStatus("success");
      toast.success(`Data exported successfully as ${exportFormat.toUpperCase()}!`);
      setTimeout(() => {
        setExportStatus(null);
      }, 3000);
    } catch (error) {
      toast.dismiss(loadingToast);
      console.error('Error exporting data:', error);
      setExportStatus("error");
      toast.error('Failed to export data');
      setTimeout(() => {
        setExportStatus(null);
      }, 3000);
    }
  };

  return (
    <div className="data-management-settings-container">
      <div className="settings-panels-wrapper">
        {/* Left Panel */}
        <div className="left-panel">
          {/* Backup Database Section */}
          <div className="settings-section">
            <h3 className="section-title">Backup Database</h3>

            <div className="info-box">
              <div className="info-icon">
                <FiInfo size={20} />
              </div>
              <p className="info-text">
                Generate a backup file containing all current system records for recovery purposes.
              </p>
            </div>

            {backupStatus === "loading" && (
              <div className="status-message loading">
                <span className="spinner"></span>
                Creating backup...
              </div>
            )}
            {backupStatus === "success" && (
              <div className="status-message success">
                <FiCheck size={16} /> Backup created successfully!
              </div>
            )}
            {backupStatus === "error" && (
              <div className="status-message error">
                <FiX size={16} /> Backup failed
              </div>
            )}

            <button 
              className="btn-action btn-backup" 
              onClick={handleCreateBackup}
              disabled={backupStatus === 'loading'}
            >
              {backupStatus === 'loading' ? 'CREATING...' : 'CREATE BACKUP'}
            </button>
          </div>

          {/* Divider */}
          <div className="section-divider"></div>

          {/* Reset Historical Data Section */}
          <div className="settings-section">
            <h3 className="section-title">Reset Historical Data</h3>

            <div className="warning-box">
              <div className="warning-icon">
                <FiAlertTriangle size={20} />
              </div>
              <p className="warning-text">
                <strong>WARNING:</strong> This action cannot be undone.
              </p>
            </div>

            {resetStatus === "loading" && (
              <div className="status-message loading">
                <span className="spinner"></span>
                Resetting data...
              </div>
            )}
            {resetStatus === "success" && (
              <div className="status-message success">
                <FiCheck size={16} /> Data reset successfully!
              </div>
            )}
            {resetStatus === "error" && (
              <div className="status-message error">
                <FiX size={16} /> Data reset failed
              </div>
            )}

            <button 
              className="btn-action btn-reset" 
              onClick={handleResetHistoricalData}
              disabled={resetStatus === 'loading'}
            >
              {resetStatus === 'loading' ? 'RESETTING...' : 'RESET HISTORICAL DATA'}
            </button>
          </div>
        </div>

        {/* Right Panel */}
        <div className="right-panel">
          {/* Export Data Section */}
          <div className="settings-section">
            <h3 className="section-title">Export All Data</h3>
            <p className="section-subtitle">Choose your export format:</p>

            {/* Format Selection */}
            <div className="format-options">
              <label className="radio-label">
                <input
                  type="radio"
                  name="exportFormat"
                  value="xlsx"
                  checked={exportFormat === "xlsx"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="radio-input"
                />
                <span className="radio-custom"></span>
                <span className="radio-text">Excel (.xlsx)</span>
              </label>

              <label className="radio-label">
                <input
                  type="radio"
                  name="exportFormat"
                  value="csv"
                  checked={exportFormat === "csv"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="radio-input"
                />
                <span className="radio-custom"></span>
                <span className="radio-text">CSV (.csv)</span>
              </label>

              <label className="radio-label">
                <input
                  type="radio"
                  name="exportFormat"
                  value="json"
                  checked={exportFormat === "json"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="radio-input"
                />
                <span className="radio-custom"></span>
                <span className="radio-text">JSON (.json)</span>
              </label>
            </div>

            {exportStatus === "loading" && (
              <div className="status-message loading">
                <span className="spinner"></span>
                Exporting data...
              </div>
            )}
            {exportStatus === "success" && (
              <div className="status-message success">
                <FiCheck size={16} /> Data exported successfully!
              </div>
            )}
            {exportStatus === "error" && (
              <div className="status-message error">
                <FiX size={16} /> Export failed
              </div>
            )}

            <button 
              className="btn-action btn-export" 
              onClick={handleExportData}
              disabled={exportStatus === 'loading'}
            >
              <FiDownload size={16} /> 
              {exportStatus === 'loading' ? 'EXPORTING...' : 'EXPORT DATA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DataManagementSettings;