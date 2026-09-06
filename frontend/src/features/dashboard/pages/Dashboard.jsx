// Dashboard.jsx
import { useEffect, useState } from 'react';
import axios from 'axios';
import './Dashboard.css';

// Import your 6 different state components
import FullyOperational from '../states/FullyOperational';
import NoData from '../states/NoData.jsx';
import UploadedInsufficient from '../states/UploadedInsufficient.jsx';
import TrainingInProgress from '../states/TrainingInProgress.jsx';
import ForecastsReady from '../states/ForecastsReady.jsx';
import DataNeedsAttention from '../states/DataNeedsAttention.jsx';

// Import the image directly
import dashboardBg from '../../../assets/images/Dashboard.png';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const Dashboard = () => {
  const [selectedState, setSelectedState] = useState('NoData');

  useEffect(() => {
    const loadDashboardState = async () => {
      try {
        const token = sessionStorage.getItem('access_token') || localStorage.getItem('token');
        const config = {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        };
        const response = await axios.get(`${API_URL}/upload/dashboard-state`, config);
        let state = response.data.success ? response.data.data.state : 'no-data';

        if (state === 'no-data') {
          const uploadsResponse = await axios.get(`${API_URL}/upload?limit=1`, config);
          const uploadCount = uploadsResponse.data.count
            || uploadsResponse.data.data?.length
            || 0;

          if (uploadCount > 0) {
            state = 'uploaded-insufficient';
          }
        }

        const stateMap = {
          'no-data': 'NoData',
          'uploaded-insufficient': 'UploadedInsufficient',
          training: 'TrainingInProgress',
          'data-needs-attention': 'DataNeedsAttention',
          'fully-operational': 'FullyOperational'
        };
        setSelectedState(stateMap[state] || 'NoData');
      } catch (error) {
        console.error('Error loading dashboard state:', error);
        try {
          const token = sessionStorage.getItem('access_token') || localStorage.getItem('token');
          const uploadsResponse = await axios.get(`${API_URL}/upload?limit=1`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined
          });
          const uploadCount = uploadsResponse.data.count
            || uploadsResponse.data.data?.length
            || 0;
          setSelectedState(uploadCount > 0 ? 'UploadedInsufficient' : 'NoData');
        } catch (fallbackError) {
          console.error('Error loading upload fallback:', fallbackError);
          setSelectedState('NoData');
        }
      }
    };

    loadDashboardState();

    const stateInterval = setInterval(loadDashboardState, 5000);
    return () => clearInterval(stateInterval);
  }, []);

  // Configuration for each state with background
  const stateConfig = {
    FullyOperational: {
      component: FullyOperational,
      label: '✅ Fully Operational',
      color: '#22c55e',
      description: 'All systems running normally',
      backgroundImage: dashboardBg
    },
    NoData: {
      component: NoData,
      label: '📭 No Data',
      color: '#6b7280',
      description: 'No data uploaded yet',
      backgroundColor: '#ffffff'
    },
    UploadedInsufficient: {
      component: UploadedInsufficient,
      label: '⚠️ Insufficient Data',
      color: '#eab308',
      description: 'Data uploaded but insufficient',
      backgroundColor: '#fffbeb'
    },
    TrainingInProgress: {
      component: TrainingInProgress,
      label: '🔄 Training in Progress',
      color: '#06b6d4',
      description: 'Model is currently training',
      backgroundColor: '#ecfdf5'
    },
    ForecastsReady: {
      component: ForecastsReady,
      label: '📊 Forecasts Ready',
      color: '#3b82f6',
      description: 'Forecasts are ready to view',
      backgroundColor: '#eff6ff'
    },
    DataNeedsAttention: {
      component: DataNeedsAttention,
      label: '🔴 Needs Attention',
      color: '#ef4444',
      description: 'Data issues require attention',
      backgroundColor: '#fef2f2'
    }
  };

  const CurrentDashboard = stateConfig[selectedState].component;
  const currentState = stateConfig[selectedState];

  const getBackgroundStyle = () => {
    if (currentState.backgroundImage) {
      return {
        backgroundImage: `url(${currentState.backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
        minHeight: '100vh'
      };
    }
    return {
      backgroundColor: currentState.backgroundColor,
      minHeight: '100vh'
    };
  };

  return (
    <div 
      className="dashboard-wrapper"
      style={getBackgroundStyle()}
    >
      <CurrentDashboard />
    </div>
  );
};

export default Dashboard;