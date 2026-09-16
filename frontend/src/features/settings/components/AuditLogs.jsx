// AuditLogs.jsx
import { useCallback, useEffect, useState } from "react";
import { FiRefreshCw, FiX, FiInbox, FiChevronLeft, FiChevronRight, FiDownload, FiFileText } from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import { buildAuditLogsPDF } from "../../../services/reportService";
import "./AuditLogs.css";
import "../../../features/inventory/InventoryControls.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const getAuthToken = () => sessionStorage.getItem('access_token') || localStorage.getItem('token');

const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
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

const ACTION_LABELS = {
  price_recorded: 'Price Recorded',
  price_updated: 'Price Updated',
  price_deleted: 'Price Deleted',
  category_created: 'Category Created',
  category_updated: 'Category Updated',
  category_deleted: 'Category Deleted',
  unit_created: 'Unit Created',
  unit_updated: 'Unit Updated',
  unit_deleted: 'Unit Deleted',
  product_category_created: 'Product Category Created',
  product_category_updated: 'Product Category Updated',
  product_category_deleted: 'Product Category Deleted',
  item_created: 'Item Added',
  item_updated: 'Item Updated',
  item_deleted: 'Item Deleted',
  item_archived: 'Item Archived',
  item_restored: 'Item Restored',
  item_restocked: 'Item Restocked',
  product_created: 'Product Created',
  product_updated: 'Product Updated',
  product_deleted: 'Product Deleted',
  product_archived: 'Product Archived',
  product_reactivated: 'Product Reactivated',
  products_synced: 'Products Synced',
  upload_sales: 'Sales Data Uploaded',
  upload_menu: 'Menu Data Uploaded',
  upload_updated: 'Upload Updated',
  upload_deleted: 'Upload Deleted',
  adjust_items_archive: 'Item Archived',
  adjust_items_restore: 'Item Restored',
  create_items_restock: 'Item Restocked',
  create_register: 'User Registered',
  create_verify_otp: 'Email Verified',
  create_password: 'Password Set',
  create_resend_otp: 'OTP Resent',
  business_profile_created: 'Business Profile Created',
  business_profile_updated: 'Business Profile Updated',
  business_logo_updated: 'Business Logo Updated',
  backup_created: 'Backup Created',
  backup_deleted: 'Backup Deleted',
  data_reset: 'Data Reset',
  notification_read: 'Notification Read',
  notification_updated: 'Notification Updated',
  notification_deleted: 'Notification Deleted',
  notification_clear_all: 'All Notifications Cleared',
  notification_mark_all_read: 'All Notifications Marked Read',
  business_day_closed: 'Business Day Closed',
  ml_training_started: 'Model Training Started',
  forecast_generated: 'Forecast Generated',
  password_change_code_sent: 'Password Change Code Sent',
  password_changed: 'Password Changed',
  user_updated: 'User Updated',
  user_deleted: 'User Deleted',
  product_cache_refreshed: 'Product Cache Refreshed',
  report_generated: 'Report Generated',

  // Legacy action types produced by the old auto-trail middleware.
  adjust_notifications_read: 'Notification Read',
  adjust_notifications_mark_all_read: 'All Notifications Marked Read',
  delete_notifications_clear_all: 'All Notifications Cleared',
  adjust_business_days_close: 'Business Day Closed',
};

const labelFor = (action) =>
  ACTION_LABELS[action] ||
  String(action || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const getActionType = (value) => {
  const key = String(value || '').trim();
  if (key.startsWith('item')) return 'item';
  if (key.startsWith('category')) return 'category';
  if (key.startsWith('unit')) return 'unit';
  if (key.startsWith('product_category')) return 'product_category';
  if (key.startsWith('product')) return 'product';
  if (key.startsWith('price')) return 'price';
  if (key.startsWith('upload')) return 'upload';
  return 'other';
};

function AuditLogs() {
  const [filters, setFilters] = useState({ action: '', search: '', from: '', to: '' });
  const [appliedFilters, setAppliedFilters] = useState({ action: '', search: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [distinctActions, setDistinctActions] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchLogs = useCallback(
    async (targetPage) => {
      setLoading(true);
      try {
        const response = await apiClient.get('/audit/logs', {
          params: { ...appliedFilters, page: targetPage, limit: 10 },
        });
        if (response.data.success) {
          setLogs(response.data.data || []);
          setTotal(response.data.total || 0);
          setTotalPages(response.data.totalPages || 0);
          setDistinctActions(response.data.distinctActions || []);
          if (response.data.totalPages > 0 && targetPage > response.data.totalPages) {
            setPage(response.data.totalPages);
          } else {
            setPage(targetPage);
          }
        }
      } catch (error) {
        toast.error(error.response?.data?.error || 'Failed to load audit logs');
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    },
    [appliedFilters]
  );

  useEffect(() => {
    const id = setTimeout(() => {
      fetchLogs(page);
    }, 0);
    return () => clearTimeout(id);
  }, [fetchLogs, page]);

  const applyFilters = () => {
    setAppliedFilters({ ...filters });
    setPage(1);
  };

  const clearFilters = () => {
    const empty = { action: '', search: '', from: '', to: '' };
    setFilters(empty);
    setAppliedFilters(empty);
    setPage(1);
  };

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  // Fetches every log matching the applied filters (paginated, since the
  // API caps each page at 100 rows) so exports include the full set.
  const fetchAllForExport = async () => {
    const limit = 100;
    let targetPage = 1;
    let all = [];
    for (;;) {
      const response = await apiClient.get('/audit/logs', {
        params: { ...appliedFilters, page: targetPage, limit },
      });
      const batch = response.data.data || [];
      all = all.concat(batch);
      if (batch.length < limit) break;
      targetPage += 1;
    }
    return all;
  };

  const fetchBusinessForReport = async () => {
    try {
      const response = await apiClient.get('/settings/business-profile');
      const d = response.data?.data;
      if (d) {
        return {
          name: d.business_name || 'ChefDuo',
          address: d.address || d.business_address || '',
          email: d.business_email || '',
          contact: d.business_contact_number || '',
        };
      }
    } catch {
      // Keep the report usable even if the profile fetch fails.
    }
    return { name: 'ChefDuo', address: '', email: '', contact: '' };
  };

  const reportDateLabel = () => {
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    if (appliedFilters.from && appliedFilters.to) {
      return `${new Date(appliedFilters.from).toLocaleDateString('en-US', opts)} \u2013 ${new Date(appliedFilters.to).toLocaleDateString('en-US', opts)}`;
    }
    if (appliedFilters.from) {
      return `From ${new Date(appliedFilters.from).toLocaleDateString('en-US', opts)}`;
    }
    if (appliedFilters.to) {
      return `Until ${new Date(appliedFilters.to).toLocaleDateString('en-US', opts)}`;
    }
    return 'All time';
  };

  const exportFileLabel = () => `audit-logs-${new Date().toISOString().slice(0, 10)}`;

  const escapeCell = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const data = await fetchAllForExport();
      if (data.length === 0) {
        toast.error('No audit entries to export');
        return;
      }
      const header = ['Date & Time', 'Action', 'Performed By', 'Details'];
      const lines = [header.map(escapeCell).join(',')];
      data.forEach((log) => {
        lines.push([
          formatDateTime(log.performed_at),
          labelFor(log.action_type),
          log.performed_by,
          log.details,
        ].map(escapeCell).join(','));
      });

      const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportFileLabel()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} audit entr${data.length === 1 ? 'y' : 'ies'} to CSV`);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const data = await fetchAllForExport();
      if (data.length === 0) {
        toast.error('No audit entries to export');
        return;
      }
      const business = await fetchBusinessForReport();
      const rows = data.map((log) => ({
        date: formatDateTime(log.performed_at),
        action: labelFor(log.action_type),
        performedBy: log.performed_by || '\u2014',
        details: log.details || '\u2014',
      }));
      const doc = await buildAuditLogsPDF({
        dateRangeLabel: reportDateLabel(),
        business,
        rows,
      });
      doc.save(`${exportFileLabel()}.pdf`);
      toast.success(`Exported ${data.length} audit entr${data.length === 1 ? 'y' : 'ies'} to PDF`);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="audit-logs-container">
      <div className="settings-section audit-section">
        <div className="audit-header-row">
          <div>
            <h3 className="section-title">Audit Logs</h3>
            <p className="section-subtitle">
              Chronological trail of system actions (price recordings, deletions, and management changes).
            </p>
          </div>
          <div className="audit-header-actions">
            <button
              className="audit-export-btn audit-export-csv"
              onClick={handleExportCsv}
              disabled={loading || exporting}
              title="Export audit logs as CSV"
            >
              <FiDownload size={14} />
              CSV
            </button>
            <button
              className="audit-export-btn audit-export-pdf"
              onClick={handleExportPdf}
              disabled={loading || exporting}
              title="Export audit logs as PDF"
            >
              <FiFileText size={14} />
              PDF
            </button>
            <button
              className="audit-refresh-btn"
              onClick={() => fetchLogs(1)}
              disabled={loading}
              title="Refresh logs"
            >
              <FiRefreshCw size={15} className={loading ? 'spinning' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="inventory-controls">
          <div className="inventory-search-box">
            <input
              type="text"
              className="inventory-search-input"
              placeholder="Search details or action..."
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </div>

          <div className="inventory-controls-right">
            <select
              className="inventory-sort-select"
              value={filters.action}
              onChange={(e) => updateFilter('action', e.target.value)}
            >
              <option value="">All Actions</option>
              {distinctActions.map((action) => (
                <option key={action} value={action}>
                  {labelFor(action)}
                </option>
              ))}
            </select>

            <input
              type="date"
              className="inventory-sort-select inventory-date-filter"
              value={filters.from}
              onChange={(e) => updateFilter('from', e.target.value)}
              aria-label="From date"
              title="From date"
            />

            <input
              type="date"
              className="inventory-sort-select inventory-date-filter"
              value={filters.to}
              onChange={(e) => updateFilter('to', e.target.value)}
              aria-label="To date"
              title="To date"
            />

            <button className="audit-apply-btn" onClick={applyFilters}>
              Apply
            </button>
            {(filters.action || filters.search || filters.from || filters.to) && (
              <button className="audit-clear-btn" onClick={clearFilters} title="Clear filters">
                <FiX size={14} />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="audit-table-wrap">
          {loading ? (
            <div className="audit-loading">
              <span className="spinner"></span>
              Loading audit logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="audit-empty">
              <FiInbox size={36} />
              <p>{loaded ? 'No audit entries found for the selected filters.' : 'No audit entries yet.'}</p>
              <p className="audit-empty-hint">
                Actions like recording or deleting a market price will appear here.
              </p>
            </div>
          ) : (
            <table className="audit-table">
              <thead>
                <tr>
                  <th className="audit-th-time">Date &amp; Time</th>
                  <th className="audit-th-action">Action</th>
                  <th className="audit-th-actor">Performed By</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="audit-td-time">{formatDateTime(log.performed_at)}</td>
                    <td>
                      <span className={`audit-badge badge-${getActionType(log.action_type)}`}>
                        {labelFor(log.action_type)}
                      </span>
                    </td>
                    <td className="audit-td-actor">{log.performed_by || '—'}</td>
                    <td className="audit-td-details">{log.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="audit-pagination">
            <span className="audit-page-info">
              Showing {Math.min((page - 1) * 10 + 1, total)}–{Math.min(page * 10, total)} of{' '}
              {total.toLocaleString()} entr{total === 1 ? 'y' : 'ies'}
            </span>

            <div className="audit-page-nav">
              <button
                className="audit-page-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <FiChevronLeft size={14} />
                Previous
              </button>

              <div className="audit-page-numbers">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNumber;
                  if (totalPages <= 5) {
                    pageNumber = i + 1;
                  } else if (page <= 3) {
                    pageNumber = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNumber = totalPages - 4 + i;
                  } else {
                    pageNumber = page - 2 + i;
                  }
                  if (pageNumber > 0 && pageNumber <= totalPages) {
                    return (
                      <button
                        key={pageNumber}
                        className={`audit-page-number ${page === pageNumber ? 'active' : ''}`}
                        onClick={() => setPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    );
                  }
                  return null;
                })}
              </div>

              <button
                className="audit-page-btn"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
              >
                Next
                <FiChevronRight size={14} />
              </button>
            </div>

            <div className="audit-page-anchor" aria-hidden="true"></div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AuditLogs;