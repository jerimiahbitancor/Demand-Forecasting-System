// frontend/src/features/settings/Settings.jsx
import { useState } from 'react';
import { 
  FiSave, 
  FiUser, 
  FiBriefcase, 
  FiSliders, 
  FiDatabase,
  FiBookOpen,
} from 'react-icons/fi';
import Navbar from '../components/Navbar/Navbar.jsx';
import BusinessProfile from './components/BusinessProfile.jsx';
import AccountSettings from './components/AccountSettings.jsx';
import ForecastConfig from './components/ForecastConfig.jsx';
import DataManagementSettings from './components/DataManagementSettings.jsx';
import Documentation from './components/AboutDocumentation.jsx';
import './Settings.css';

const Settings = () => {
  const [activeTab, setActiveTab] = useState('business');

  const tabs = [
    { id: 'business', label: 'Business Profile', icon: <FiBriefcase size={18} /> },
    { id: 'account', label: 'Account Settings', icon: <FiUser size={18} /> },
    { id: 'forecast', label: 'Forecast Configuration', icon: <FiSliders size={18} /> },
    { id: 'data', label: 'Data Management Settings', icon: <FiDatabase size={18} /> },
    { id: 'documentation', label: 'About & Documentation', icon: <FiBookOpen size={18} /> },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'business':
        return <BusinessProfile />;
      case 'account':
        return <AccountSettings />;
      case 'forecast':
        return <ForecastConfig />;
      case 'data':
        return <DataManagementSettings />;
      case 'documentation':
        return <Documentation />;
      default:
        return <BusinessProfile />;
    }
  };

  return (
    <div className="settings-wrapper">
      <Navbar />

      {/* Main Content */}
      <main className="settings-main">
        <div className="settings-header">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">
              Manage your business profile, account preferences, and system configurations.
            </p>
          </div>
        </div>

        <div className="content-grid">
         

          {/* Tabbed Container */}
          <div className="tabbed-container">
            {/* Tabs Header */}
            <div className="tabs-header">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="tab-icon">{tab.icon}</span>
                  <span className="tab-label">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="tab-content">
              {renderContent()}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Settings;