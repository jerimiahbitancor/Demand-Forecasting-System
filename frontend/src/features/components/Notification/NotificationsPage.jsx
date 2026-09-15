// pages/NotificationsPage.jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaRegBell,
  FaCheckCircle,
  FaExclamationCircle,
  FaInfoCircle,
  FaTimes,
  FaUpload,
  FaFileAlt,
  FaClock,
  FaArrowLeft,
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import './NotificationsPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const NotificationsPage = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();

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
      const response = await apiClient.get('/notifications', { params: { limit: 100 } });
      if (response.data.success) {
        setNotifications(response.data.data || []);
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
  }, [apiClient, navigate]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleNotificationClick = async (notification) => {
    if (!notification.read) {
      try {
        await apiClient.patch(`/notifications/${notification.id}/read`);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
        );
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  const handleMarkAllAsRead = async () => {
    setBusy(true);
    try {
      await apiClient.patch('/notifications/mark-all-read');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success('All notifications marked as read');
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

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="inventory-component notifications-page">
      <div className="notifications-page-header">
        <button className="notifications-back-btn" onClick={() => navigate('/dashboard')} aria-label="Back to dashboard">
          <FaArrowLeft />
        </button>
        <h2>Notifications</h2>
        <div className="notifications-page-actions">
          {unreadCount > 0 && (
            <button className="notifications-action-btn" onClick={handleMarkAllAsRead} disabled={busy}>
              Mark all as read
            </button>
          )}
          {notifications.length > 0 && (
            <button className="notifications-action-btn danger" onClick={handleClearAll} disabled={busy}>
              Clear all
            </button>
          )}
          <button className="notifications-action-btn" onClick={fetchNotifications} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="notification-card">
        {loading ? (
          <div className="notification-loading">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="notification-empty">
            <FaRegBell size={40} />
            <p>No notifications</p>
            <span>You are all caught up</span>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;