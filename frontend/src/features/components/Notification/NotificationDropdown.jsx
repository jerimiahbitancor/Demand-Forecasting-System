// components/NotificationDropdown.jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  FaRegBell, 
  FaCheckCircle, 
  FaExclamationCircle, 
  FaInfoCircle, 
  FaTimes,
  FaUpload,
  FaFileAlt,
  FaClock
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import './NotificationDropdown.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Session storage keys
const STORAGE_KEYS = {
  NOTIFICATIONS: 'notifications_data',
  UNREAD_COUNT: 'notifications_unread_count',
  LAST_FETCH: 'notifications_last_fetch'
};

const NotificationDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState(() => {
    const stored = sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    return stored ? JSON.parse(stored) : [];
  });
  const [unreadCount, setUnreadCount] = useState(() => {
    return parseInt(sessionStorage.getItem(STORAGE_KEYS.UNREAD_COUNT)) || 0;
  });
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

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

  // Save to sessionStorage
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.UNREAD_COUNT, unreadCount.toString());
  }, [unreadCount]);

  // Fetch notifications from API
  const fetchNotifications = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      
      // Check cache
      const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
      const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 30000; // 30 seconds cache
      
      if (!forceRefresh && cacheValid) {
        const stored = sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
        if (stored) {
          setNotifications(JSON.parse(stored));
        }
        setLoading(false);
        return;
      }

      const response = await apiClient.get('/notifications', {
        params: { limit: 10 }
      });

      if (response.data.success) {
        const data = response.data.data || [];
        const count = response.data.unreadCount || 0;
        
        setNotifications(data);
        setUnreadCount(count);
        
        sessionStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(data));
        sessionStorage.setItem(STORAGE_KEYS.UNREAD_COUNT, count.toString());
        sessionStorage.setItem(STORAGE_KEYS.LAST_FETCH, Date.now().toString());
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      // If unauthorized, clear session
      if (error.response?.status === 401) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
      }
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  // Fetch unread count only (lighter request)
  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await apiClient.get('/notifications/unread-count');
      if (response.data.success) {
        const count = response.data.count || 0;
        setUnreadCount(count);
        sessionStorage.setItem(STORAGE_KEYS.UNREAD_COUNT, count.toString());
      }
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  }, [apiClient]);

  // Initial load
  useEffect(() => {
    const hasStored = sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) !== null;
    const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
    const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 30000;
    
    if (hasStored && cacheValid) {
      const stored = sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
      if (stored) {
        setNotifications(JSON.parse(stored));
      }
      setUnreadCount(parseInt(sessionStorage.getItem(STORAGE_KEYS.UNREAD_COUNT)) || 0);
    } else {
      fetchNotifications(false);
    }

    // Poll for new notifications every 30 seconds
    const interval = setInterval(() => {
      fetchUnreadCount();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchNotifications, fetchUnreadCount]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && !event.target.closest('.notification-wrapper')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Refresh when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const lastFetch = sessionStorage.getItem(STORAGE_KEYS.LAST_FETCH);
        const cacheValid = lastFetch && (Date.now() - parseInt(lastFetch)) < 30000;
        if (!cacheValid) {
          fetchUnreadCount();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchUnreadCount]);

  const toggleNotifications = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      fetchNotifications(true);
    }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.read) {
      try {
        await apiClient.patch(`/notifications/${notification.id}/read`);
        setNotifications(prev => 
          prev.map(n => n.id === notification.id ? { ...n, read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
        sessionStorage.setItem(STORAGE_KEYS.UNREAD_COUNT, Math.max(0, unreadCount - 1).toString());
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
    
    if (notification.link) {
      navigate(notification.link);
      setIsOpen(false);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await apiClient.patch('/notifications/mark-all-read');
      setNotifications(prev => 
        prev.map(n => ({ ...n, read: true }))
      );
      setUnreadCount(0);
      sessionStorage.setItem(STORAGE_KEYS.UNREAD_COUNT, '0');
      toast.success('All notifications marked as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
      toast.error('Failed to mark all as read');
    }
  };

  const handleClearAll = async () => {
    try {
      await apiClient.delete('/notifications/clear-all');
      setNotifications([]);
      setUnreadCount(0);
      sessionStorage.removeItem(STORAGE_KEYS.NOTIFICATIONS);
      sessionStorage.removeItem(STORAGE_KEYS.UNREAD_COUNT);
      setIsOpen(false);
      toast.success('All notifications cleared');
    } catch (error) {
      console.error('Error clearing notifications:', error);
      toast.error('Failed to clear notifications');
    }
  };

  const getNotificationIcon = (type) => {
    switch(type) {
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
    switch(type) {
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
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      return date.toLocaleDateString();
    } catch {
      return 'Just now';
    }
  };

  return (
    <div className="notification-wrapper">
      <button 
        className="action-btn notification-btn" 
        aria-label="Notifications"
        onClick={toggleNotifications}
      >
        <FaRegBell className="action-icon" />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <h3>Notifications</h3>
            <div className="notification-header-actions">
              {notifications.some(n => !n.read) && (
                <button 
                  className="notification-action-btn mark-read-btn"
                  onClick={handleMarkAllAsRead}
                >
                  Mark all as read
                </button>
              )}
              {notifications.length > 0 && (
                <button 
                  className="notification-action-btn clear-btn"
                  onClick={handleClearAll}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="notification-list">
            {loading ? (
              <div className="notification-loading">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="notification-empty">
                <FaRegBell size={32} />
                <p>No notifications</p>
                <span>You are all caught up</span>
              </div>
            ) : (
              notifications.map((notification) => (
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
                  {!notification.read && (
                    <div className="notification-unread-dot"></div>
                  )}
                </div>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="notification-footer">
              <button 
                className="view-all-btn"
                onClick={() => {
                  navigate('/notifications');
                  setIsOpen(false);
                }}
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationDropdown;