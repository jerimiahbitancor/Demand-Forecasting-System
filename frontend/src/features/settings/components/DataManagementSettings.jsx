// DataManagementSettings.jsx
import { useState, useEffect } from "react";
import { FiInfo, FiAlertTriangle, FiDownload, FiCheck, FiX, FiTrash2, FiRefreshCw, FiDatabase } from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./DataManagementSettings.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function DataManagementSettings() {
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [backupStatus, setBackupStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  // Get auth token
  const getAuthToken = () => {
    return sessionStorage.getItem('access_token') || localStorage.getItem('token');
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

  // Load the list of backups stored in the Supabase "files" bucket
  const fetchBackups = async (silent = true) => {
    if (!silent) setBackupsLoading(true);
    try {
      const response = await apiClient.get('/settings/backups');
      if (response.data.success) {
        setBackups(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching backups:', error);
    } finally {
      setBackupsLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => {
      fetchBackups(true);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownloadBackup = (url) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDeleteBackup = async (name) => {
    const confirmed = window.confirm(
      `Delete backup "${name}"? This will permanently remove the file from the files bucket.`
    );
    if (!confirmed) return;

    try {
      const response = await apiClient.delete(`/settings/backups/${encodeURIComponent(name)}`);
      if (response.data.success) {
        toast.success('Backup deleted');
        fetchBackups(true);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete backup');
    }
  };

  // Backup Database handler
  const handleCreateBackup = async () => {
    setBackupStatus("loading");
    const loadingToast = toast.loading('Creating database backup...');

    try {
      const response = await apiClient.post('/settings/backup');
      
      toast.dismiss(loadingToast);
      if (response.data.success) {
        setBackupStatus("success");
        toast.success('Backup stored in the files bucket!');
        // Download the backup file from Supabase Storage
        if (response.data.data?.url) {
          window.open(response.data.data.url, '_blank', 'noopener,noreferrer');
        }
        fetchBackups(true);
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

      {/* Stored Backups (from the Supabase "files" bucket) */}
      <div className="settings-section backups-section">
        <div className="backups-header">
          <div>
            <h3 className="section-title">Stored Backups</h3>
            <p className="section-subtitle">
              Backup files kept in the Supabase Storage bucket <strong>files</strong>.
            </p>
          </div>
          <button
            className="btn-backups-refresh"
            onClick={() => fetchBackups(false)}
            disabled={backupsLoading}
          >
            <FiRefreshCw size={14} className={backupsLoading ? 'backups-spin' : ''} />
            Refresh
          </button>
        </div>

        {backupsLoading ? (
          <div className="status-message loading backups-loading">
            <span className="spinner"></span>
            Loading backups...
          </div>
        ) : backups.length === 0 ? (
          <div className="backups-empty">
            <FiDatabase size={28} />
            <p>No backups stored yet. Click <strong>CREATE BACKUP</strong> to store your first snapshot.</p>
          </div>
        ) : (
          <div className="backups-list">
            {backups.map((item) => (
              <div className="backup-row" key={item.path}>
                <div className="backup-file">
                  <FiDatabase size={16} className="backup-file-icon" />
                  <div className="backup-file-info">
                    <span className="backup-name" title={item.name}>{item.name}</span>
                    <span className="backup-meta">
                      {item.sizeLabel}
                      {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                    </span>
                  </div>
                </div>
                <div className="backup-actions">
                  <button
                    className="btn-backup-download"
                    onClick={() => handleDownloadBackup(item.url)}
                    disabled={!item.url}
                  >
                    <FiDownload size={14} />
                    Download
                  </button>
                  <button
                    className="btn-backup-delete"
                    onClick={() => handleDeleteBackup(item.name)}
                  >
                    <FiTrash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DataManagementSettings;