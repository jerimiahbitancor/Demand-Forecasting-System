// components/Navbar.jsx
import { useState, useEffect } from 'react';
import { NavLink, useNavigate, } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useAuth } from '../../../context/AuthContext';
import { 
  FaChartBar,
  FaDatabase,
  FaChartPie,
  FaChevronDown,
  FaCog,
  FaRegQuestionCircle,
  FaUser
} from 'react-icons/fa';
import NotificationDropdown from '../Notification/NotificationDropdown';
import './Navbar.css';

const Navbar = () => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileProfileOpen, setIsMobileProfileOpen] = useState(false);
  const navigate = useNavigate();
  const { logout, user, hasUploadedData } = useAuth();

  const handleGatedNav = (path, e) => {
    if (!hasUploadedData) {
      e.preventDefault();
      // toast.error('Please upload your sales data first to unlock this page');
      return;
    }
    setIsMobileMenuOpen(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isDropdownOpen && !event.target.closest('.nav-dropdown')) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleNavigation = (path) => {
    navigate(path);
    setIsMobileMenuOpen(false);
    setIsDropdownOpen(false);
    setIsMobileProfileOpen(false);
  };

  const handleDropdownItemClick = (path) => {
    navigate(path);
    setIsDropdownOpen(false);
    setIsMobileMenuOpen(false);
    setIsMobileProfileOpen(false);
  };

  const handleLogout = async () => {
    const confirmation = await Swal.fire({
      title: 'Are you sure?',
      text: 'Do you want to log out?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, log out',
      cancelButtonText: 'Cancel',
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    Swal.fire({
      title: 'Logging out...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    const result = await logout();
    Swal.close();

    if (result.success) {
      await Swal.fire({
        icon: 'success',
        title: 'Logged out',
        text: 'You have been signed out successfully.',
        timer: 1200,
        showConfirmButton: false,
      });
      navigate('/login');
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Logout failed',
        text: result.error || 'Please try again.',
      });
      console.error('Logout failed:', result.error);
    }

    setIsDropdownOpen(false);
    setIsMobileProfileOpen(false);
    setIsMobileMenuOpen(false);
  };

  // ✅ Get user's display name
  const displayName = user?.name || user?.email?.split('@')[0] || 'User';
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <header className="navbar">
      {/* Logo and Brand */}
      <div className="navbar-brand" onClick={() => handleNavigation('/')}>
        <div className="brand-logo">
          <img
            alt="Chef Duo Logo"
            className="logo"
            src="/logo.png"
          />
        </div>
        <span className="brand-text">Sales Forecasting</span>
      </div>

      {/* Navigation */}
      <nav className="navbar-nav">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''} ${!hasUploadedData ? 'nav-link-disabled' : ''}`
          }
          onClick={(e) => handleGatedNav('/dashboard', e)}
        >
          <FaChartBar className="nav-icon" />
          Dashboard
        </NavLink>

        <NavLink 
          to="/data-management" 
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <FaDatabase className="nav-icon" />
          Data Management
        </NavLink>
        
        <NavLink
          to="/analytics"
          className={({ isActive }) =>
            `nav-link ${isActive ? 'active' : ''} ${!hasUploadedData ? 'nav-link-disabled' : ''}`
          }
          onClick={(e) => handleGatedNav('/analytics', e)}
        >
          <FaChartPie className="nav-icon" />
          Analytics
        </NavLink>

        <NavLink 
          to="/settings" 
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <FaCog className="nav-icon" />
          Settings
        </NavLink>
      </nav>

      {/* Header Actions */}
      <div className="navbar-actions">
        {/* Notification Dropdown Component */}
        <NotificationDropdown />

        <button className="action-btn" aria-label="Help">
          <FaRegQuestionCircle className="action-icon" />
        </button>

        <div className="nav-dropdown">
          <button className="profile-section" type="button" onClick={toggleDropdown}>
            <div className="profile-avatar">
              <span className="profile-initial">{userInitial}</span>
            </div>
            <div className="profile-info">
              <span className="profile-name">{displayName}</span>
              <span className="profile-role">Administrator</span>
            </div>
            <FaChevronDown className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} />
          </button>

          {isDropdownOpen && (
            <div className="dropdown-menu">
              <button className="dropdown-item logout-item" type="button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
        
        {/* Mobile Menu Toggle */}
        <button 
          className="navbar-toggle" 
          onClick={toggleMobileMenu}
          aria-label="Toggle menu"
        >
          <span className="hamburger-icon">☰</span>
        </button>
      </div>

      {/* Mobile Menu */}
      <div className={`navbar-menu ${isMobileMenuOpen ? 'open' : ''}`}>
        <NavLink 
          to="/dashboard" 
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => handleNavigation('/dashboard')}
        >
          <FaChartBar className="nav-icon" />
          Dashboard
        </NavLink>

        <NavLink 
          to="/data-management" 
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => handleNavigation('/data-management')}
        >
          <FaDatabase className="nav-icon" />
          Data Management
        </NavLink>

        <NavLink
          to="/analytics"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => handleNavigation('/analytics')}
        >
          <FaChartPie className="nav-icon" />
          Analytics
        </NavLink>

        <NavLink 
          to="/settings" 
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => handleNavigation('/settings')}
        >
          <FaCog className="nav-icon" />
          Settings
        </NavLink>

        <div className="mobile-dropdown">
          <button 
            className="dropdown-toggle" 
            type="button" 
            onClick={() => setIsMobileProfileOpen(!isMobileProfileOpen)}
          >
            <span>{displayName}</span>
            <FaChevronDown className={`dropdown-arrow ${isMobileProfileOpen ? 'open' : ''}`} />
          </button>
          {isMobileProfileOpen && (
            <div className="mobile-dropdown-menu">
              <button className="dropdown-item" type="button" onClick={() => handleDropdownItemClick('/profile')}>
                Profile
              </button>
              <button className="dropdown-item logout-item" type="button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;