// components/NotificationDropdown.jsx
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
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
import sharedApiClient from '../../../services/apiClient';
import usePolling from '../../../hooks/usePolling';
import { createChangeDetector, createNewestDetector, emitDataChanged, onNotificationCheck } from '../../../utils/appEvents';
import './NotificationDropdown.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Session storage keys
const STORAGE_KEYS = {
  NOTIFICATIONS: 'notifications_data',
  UNREAD_COUNT: 'notifications_unread_count',
  LAST_FETCH: 'notifications_last_fetch'
};

// How often the bell checks for new notifications.
const NOTIFICATION_POLL_MS = 30000;

// Spots a NEW upload / training / forecast notification and tells the
// dashboard to refresh (utils/appEvents.js). Kept outside the component on
// purpose: the bell is re-created whenever the dashboard switches screens,
// and a per-mount baseline could miss the very notification that caused
// the switch.
const detectDataChange = createChangeDetector();

// Reports ANY new notification so it can pop out as a toast. Module-scope for
// the same reason as detectDataChange: the bell remounts on navigation, and a
// per-mount baseline would re-toast the newest notification every time.
const detectNewest = createNewestDetector();

// Pure render helpers shared by the list and the pop-out toast.
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

// How long a popped-out notification stays on screen before sliding away.
const POPUP_DURATION_MS = 6000;
const POPUP_EXIT_MS = 250;

// A single pop-out notification card. Rendered through a portal (see
// NotificationDropdown) instead of react-hot-toast so it is guaranteed to
// appear and can reuse the exact notification-list markup/styles.
const NotificationPopup = ({ notificationKey, notification, onOpen, onDismiss }) => {
  const [leaving, setLeaving] = useState(false);
  const exitTimer = useRef(null);

  const dismiss = useCallback(() => {
    setLeaving(true);
    exitTimer.current = setTimeout(() => onDismiss(notificationKey), POPUP_EXIT_MS);
  }, [onDismiss, notificationKey]);

  useEffect(() => {
    const timer = setTimeout(dismiss, POPUP_DURATION_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(exitTimer.current);
    };
  }, [dismiss]);

  const open = () => {
    onOpen(notification);
    dismiss();
  };

  return (
    <div
      className={`notification-toast ${getNotificationTypeClass(notification.type)} ${leaving ? 'notification-toast-exit' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className={`notification-toast-icon ${getNotificationTypeClass(notification.type)}`}>
        {getNotificationIcon(notification.type)}
      </div>
      <div className="notification-toast-body">
        <div className="notification-toast-title">{notification.title}</div>
        {notification.message && (
          <div className="notification-toast-message">{notification.message}</div>
        )}
        <div className="notification-toast-time">{formatTime(notification.created_at)}</div>
      </div>
      <button
        type="button"
        className="notification-toast-close"
        aria-label="Dismiss notification"
        onClick={(event) => {
          event.stopPropagation();
          dismiss();
        }}
      >
        <FaTimes />
      </button>
      <span className="notification-toast-progress" aria-hidden="true" />
    </div>
  );
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

  // Newly-arrived notifications that pop out on the right. Each gets a
  // monotonic key so React keeps them independent while they animate.
  const [popups, setPopups] = useState([]);
  const popupKeyRef = useRef(0);

  const removePopup = useCallback((key) => {
    setPopups((prev) => prev.filter((popup) => popup.key !== key));
  }, []);

  const pushPopup = useCallback((notification) => {
    popupKeyRef.current += 1;
    const key = popupKeyRef.current;
    setPopups((prev) => [...prev, { key, notification }]);
  }, []);

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

  // Every 30 s: the newest notification plus the unread count, in one
  // request. Replaces the old unread-count interval. usePolling runs one
  // check at a time, pauses while the tab is hidden (and checks once when
  // it is shown again), and stops on a login problem.
  const checkNewest = useCallback(async (signal) => {
    const response = await sharedApiClient.get('/notifications', {
      params: { limit: 1 },
      signal,
    });
    if (!response.data.success) return;

    const count = response.data.unreadCount || 0;
    setUnreadCount(count);
    sessionStorage.setItem(STORAGE_KEYS.UNREAD_COUNT, count.toString());

    const newest = (response.data.data || [])[0] || null;

    const change = detectDataChange(newest);
    if (change) emitDataChanged(change);

    // Pop the new one out on the right (styled like the notification list).
    const popped = detectNewest(newest);
    console.info('[notification-popup] poll', {
      count,
      newestId: newest ? newest.id : null,
      popped: popped ? popped.id : null,
    });
    if (popped) pushPopup(popped);
  }, [pushPopup]);

  const { refresh: refreshNotifications } = usePolling(checkNewest, NOTIFICATION_POLL_MS);

  // Actions that create a notification (upload/training/forecast/saving
  // prices/...) dispatch this so the new card pops out right away. The server
  // usually writes the row a moment AFTER it answers the request (and some
  // notifications are fire-and-forget), so check now and again over the next
  // couple of seconds. detectNewest de-dupes by id, so the extra checks never
  // re-pop the same notification.
  useEffect(() => {
    let timers = [];
    const check = () => refreshNotifications();
    const handler = () => {
      check();
      timers.forEach(clearTimeout);
      timers = [500, 1200, 2500].map((ms) => setTimeout(check, ms));
    };
    const off = onNotificationCheck(handler);
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, [refreshNotifications]);

  // TEMP diagnostic: from the browser console run
  //   __popNotification({ id: 1, type: 'info', title: 'Test', message: 'Hello', created_at: new Date().toISOString() })
  // If the card slides in from the right, rendering works and the problem is
  // the new-notification detection; if nothing appears, rendering is the issue.
  useEffect(() => {
    window.__popNotification = pushPopup;
    return () => {
      if (window.__popNotification === pushPopup) delete window.__popNotification;
    };
  }, [pushPopup]);

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
  }, [fetchNotifications]);

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
        setUnreadCount(prev => {
          const next = Math.max(0, prev - 1);
          sessionStorage.setItem(STORAGE_KEYS.UNREAD_COUNT, next.toString());
          return next;
        });
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
    
    if (notification.link) {
      const target =
        notification.link === '/ingredient-management'
          ? '/inventory-management'
          : notification.link;
      navigate(target);
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

  return (
    <>
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

      {createPortal(
        <div className="notification-popup-host">
          {popups.map(({ key, notification }) => (
            <NotificationPopup
              key={key}
              notificationKey={key}
              notification={notification}
              onOpen={handleNotificationClick}
              onDismiss={removePopup}
            />
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

export default NotificationDropdown;