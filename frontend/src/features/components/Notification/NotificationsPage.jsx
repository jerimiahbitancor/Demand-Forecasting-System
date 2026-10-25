// pages/NotificationsPage.jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaInfoCircle,
  FaTimes,
  FaUpload,
  FaFileAlt,
  FaClock,
  FaArrowLeft,
  FaChevronLeft,
  FaChevronRight,
  FaInbox,
} from 'react-icons/fa';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import './NotificationsPage.css';
import { resolveNotificationLink } from './notificationLinks';
import UploadStockShortfallSummary from './UploadStockShortfallSummary';
import { buildPageItems, ELLIPSIS } from '../../../utils/pagination';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const ITEMS_PER_PAGE = 10;

const NotificationsPage = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readFilter, setReadFilter] = useState('all');
  const [selectedUploadSummary, setSelectedUploadSummary] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();
  const uploadSummaryFromNavigation = location.state?.uploadStockSummary?.metadata?.kind === 'upload_blocked_stock'
    ? location.state.uploadStockSummary
    : null;
  const activeUploadSummary = selectedUploadSummary || uploadSummaryFromNavigation;

  const getAuthToken = useCallback(() => {
    return sessionStorage.getItem('token') || sessionStorage.getItem('access_token');
  }, []);

  const apiClient = useMemo(() => {
    const client = axios.create({
      baseURL: API_URL,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    client.interceptors.request.use((config) => {
      const token = getAuthToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return client;
  }, [getAuthToken]);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page, limit: ITEMS_PER_PAGE };
      if (readFilter !== 'all') params.read = readFilter;
      const response = await apiClient.get('/notifications', { params });
      if (response.data.success) {
        setNotifications(response.data.data || []);
        setTotal(response.data.total ?? 0);
        setTotalPages(response.data.totalPages || 1);
        setUnreadCount(response.data.unreadCount ?? 0);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      if (error.response?.status === 401) {
        toast.error('Session expired. Please login again.');
        navigate('/login');
      } else {
        toast.error('Failed to load notifications');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient, navigate, page, readFilter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleFilterChange = (filter) => {
    setReadFilter(filter);
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    setPage(newPage);
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.read) {
      try {
        await apiClient.patch(`/notifications/${notification.id}/read`);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
    if (notification.metadata?.kind === 'upload_blocked_stock') {
      setSelectedUploadSummary(notification);
      return;
    }
    const target = resolveNotificationLink(notification);
    if (target) {
      navigate(target);
    }
  };

  const handleMarkAllAsRead = async () => {
    setBusy(true);
    try {
      await apiClient.patch('/notifications/mark-all-read');
      toast.success('All notifications marked as read');
      setUnreadCount(0);
      setPage(1);
      await fetchNotifications();
    } catch (error) {
      console.error('Error marking all as read:', error);
      toast.error('Failed to mark all as read');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    setBusy(true);
    try {
      await apiClient.delete('/notifications/clear-all');
      setNotifications([]);
      setTotal(0);
      setTotalPages(1);
      setUnreadCount(0);
      toast.success('All notifications cleared');
    } catch (error) {
      console.error('Error clearing notifications:', error);
      toast.error('Failed to clear notifications');
    } finally {
      setBusy(false);
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'success': return <FaCheckCircle />;
      case 'warning': return <FaExclamationCircle />;
      case 'error': return <FaTimes />;
      case 'upload': return <FaUpload />;
      case 'file': return <FaFileAlt />;
      case 'pending': return <FaClock />;
      default: return <FaInfoCircle />;
    }
  };

  const getNotificationTypeClass = (type) => {
    switch (type) {
      case 'success': return 'notification-success';
      case 'warning': return 'notification-warning';
      case 'error': return 'notification-error';
      case 'upload': return 'notification-upload';
      case 'file': return 'notification-file';
      case 'pending': return 'notification-pending';
      default: return 'notification-info';
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return 'Just now';
    try {
      const date = new Date(dateString);
      const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      return date.toLocaleDateString();
    } catch {
      return 'Just now';
    }
  };

  const pageItems = useMemo(() => buildPageItems(page, totalPages), [page, totalPages]);

  const filterTabs = [
    { key: 'all', label: 'All', count: total },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'read', label: 'Read', count: total - unreadCount },
  ];

  const startIndex = total === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1;
  const endIndex = Math.min(page * ITEMS_PER_PAGE, total);

  return (
    <div className="inventory-component notifications-page">
      <div className="notifications-page-header">
        <button className="notifications-back-btn" onClick={() => navigate('/dashboard')} aria-label="Back to dashboard">
          <FaArrowLeft />
        </button>
        <h2>
          Notifications
          {unreadCount > 0 && <span className="notifications-unread-badge">{unreadCount} unread</span>}
        </h2>
        <div className="notifications-page-actions">
          {unreadCount > 0 && (
            <button className="notifications-action-btn" onClick={handleMarkAllAsRead} disabled={busy || loading}>
              Mark all as read
            </button>
          )}
          {total > 0 && (
            <button className="notifications-action-btn danger" onClick={handleClearAll} disabled={busy || loading}>
              Clear all
            </button>
          )}
          <button className="notifications-action-btn" onClick={fetchNotifications} disabled={loading}>
            Refresh
          </button>
        </div>
        {activeUploadSummary && (
          <UploadStockShortfallSummary
            notification={activeUploadSummary}
            onClose={() => {
              setSelectedUploadSummary(null);
              if (uploadSummaryFromNavigation) {
                navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
              }
            }}
          />
        )}
      </div>

      {total > 0 && (
        <div className="notification-filter-tabs">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              className={`notification-filter-tab ${readFilter === tab.key ? 'active' : ''}`}
              onClick={() => handleFilterChange(tab.key)}
            >
              {tab.label}
              <span className="notification-filter-count">{tab.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="notification-card">
        {loading ? (
          <div className="notification-loading">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="notification-empty">
            <FaInbox size={40} />
            <p>{readFilter === 'all' ? 'No notifications' : readFilter === 'unread' ? 'No unread notifications' : 'No read notifications'}</p>
            <span>You are all caught up</span>
          </div>
        ) : (
          <>
            <div className="notification-list notification-list-page">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-item ${!notification.read ? 'unread' : ''}`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className={`notification-icon ${getNotificationTypeClass(notification.type)}`}>
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-time">{formatTime(notification.created_at)}</div>
                  </div>
                  {!notification.read && <div className="notification-unread-dot"></div>}
                </div>
              ))}
            </div>

            <div className="notification-pagination">
              <span className="notification-pagination-info">
                Showing {startIndex}–{endIndex} of {total} notification{total !== 1 ? 's' : ''}
              </span>
              <div className="notification-pagination-controls">
                <button
                  className="notification-page-btn"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || loading}
                  aria-label="Previous page"
                >
                  <FaChevronLeft /> Prev
                </button>
                <div className="notification-pagination-numbers">
                  {pageItems.map((item, index) =>
                    item === ELLIPSIS ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="notification-page-ellipsis"
                        aria-hidden="true"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        className={`notification-page-number ${item === page ? 'active' : ''}`}
                        onClick={() => handlePageChange(item)}
                        disabled={loading}
                        aria-label={`Page ${item}`}
                        aria-current={item === page ? 'page' : undefined}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>
                <button
                  className="notification-page-btn"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || loading}
                  aria-label="Next page"
                >
                  Next <FaChevronRight />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {selectedUploadSummary && (
        <UploadStockShortfallSummary
          notification={selectedUploadSummary}
          onClose={() => setSelectedUploadSummary(null)}
        />
      )}
    </div>
  );
};

export default NotificationsPage;