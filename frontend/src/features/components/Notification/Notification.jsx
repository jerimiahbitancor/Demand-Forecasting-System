// components/NotificationDropdown.jsx
import { useState, useEffect } from 'react';
import { 
  FaRegBell, 
  FaCheckCircle, 
  FaExclamationCircle, 
  FaInfoCircle, 
  FaUpload, 
  FaFileAlt,
  
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import './NotificationDropdown.css';

const NotificationDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(3);
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      type: 'success',
      icon: <FaCheckCircle />,
      title: 'Upload Successful',
      message: 'Sales data for June 2025 has been uploaded successfully.',
      time: '2 minutes ago',
      read: false,
      link: '/data-management'
    },
    {
      id: 2,
      type: 'warning',
      icon: <FaExclamationCircle />,
      title: 'Data Validation Warning',
      message: '3 records in the recent upload have missing fields.',
      time: '15 minutes ago',
      read: false,
      link: '/data-management'
    },
    {
      id: 3,
      type: 'info',
      icon: <FaInfoCircle />,
      title: 'Forecast Ready',
      message: 'Your sales forecast for July 2025 is now available.',
      time: '1 hour ago',
      read: false,
      link: '/forecasting'
    },
    {
      id: 4,
      type: 'success',
      icon: <FaUpload />,
      title: 'Menu Data Uploaded',
      message: 'New menu items have been added to the system.',
      time: '3 hours ago',
      read: true,
      link: '/data-management'
    },
    {
      id: 5,
      type: 'info',
      icon: <FaFileAlt />,
      title: 'Report Generated',
      message: 'Monthly sales report for June 2025 is ready for download.',
      time: '5 hours ago',
      read: true,
      link: '/analytics'
    },
  ]);

  const navigate = useNavigate();

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
      setNotificationCount(0);
    }
  };

  const handleNotificationClick = (notification) => {
    setNotifications(prev => 
      prev.map(n => n.id === notification.id ? { ...n, read: true } : n)
    );
    if (notification.link) {
      navigate(notification.link);
      setIsOpen(false);
    }
  };

  const handleMarkAllAsRead = () => {
    setNotifications(prev => 
      prev.map(n => ({ ...n, read: true }))
    );
    setNotificationCount(0);
  };

  const handleClearAll = () => {
    setNotifications([]);
    setNotificationCount(0);
    setIsOpen(false);
  };

  const getNotificationTypeClass = (type) => {
    switch(type) {
      case 'success': return 'notification-success';
      case 'warning': return 'notification-warning';
      case 'error': return 'notification-error';
      default: return 'notification-info';
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
        {notificationCount > 0 && (
          <span className="notification-badge">{notificationCount}</span>
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
            {notifications.length === 0 ? (
              <div className="notification-empty">
                <FaRegBell size={32} />
                <p>No notifications</p>
                <span>You're all caught up!</span>
              </div>
            ) : (
              notifications.map((notification) => (
                <div 
                  key={notification.id}
                  className={`notification-item ${!notification.read ? 'unread' : ''}`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className={`notification-icon ${getNotificationTypeClass(notification.type)}`}>
                    {notification.icon}
                  </div>
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-time">{notification.time}</div>
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