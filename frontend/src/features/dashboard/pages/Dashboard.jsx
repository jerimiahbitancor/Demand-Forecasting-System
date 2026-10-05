// Dashboard.jsx
import apiClient from '../../../services/apiClient';
import usePolling from '../../../hooks/usePolling';
import './Dashboard.css';

// Import the 7 state components
import FullyOperational from '../states/FullyOperational';
import NoData from '../states/NoData.jsx';
import UploadedInsufficient from '../states/UploadedInsufficient.jsx';
import ReadyToTrain from '../states/ReadyToTrain.jsx';
import TrainingInProgress from '../states/TrainingInProgress.jsx';
import ForecastsReady from '../states/ForecastsReady.jsx';
import DataNeedsAttention from '../states/DataNeedsAttention.jsx';
import ConnectionProblem from '../states/ConnectionProblem.jsx';
import Navbar from '../../components/Navbar/Navbar';

// Import the image directly
import dashboardBg from '../../../assets/images/Dashboard.png';

// How often the dashboard re-checks its state. One check at a time, paused
// while the tab is hidden (see hooks/usePolling.js).
const DASHBOARD_POLL_MS = 60000;

const stateMap = {
  'no-data': 'NoData',
  'uploaded-insufficient': 'UploadedInsufficient',
  'ready-to-train': 'ReadyToTrain',
  'training-in-progress': 'TrainingInProgress',
  'forecasts-ready-recipes-pending': 'ForecastsReady',
  'data-needs-attention': 'DataNeedsAttention',
  'fully-operational': 'FullyOperational'
};

// One dashboard check. Resolves to a stateConfig key.
//
// A failed check THROWS. It must never pick a business state: the old
// fallback here turned a timeout, a 429 or a 500 into "Uploaded
// Insufficient" or "No Data", which looked exactly like real data.
// usePolling keeps the last good state and reports the error instead.
const loadDashboardState = async (signal) => {
  const response = await apiClient.get('/upload/dashboard-state', { signal });
  let state = response.data.success ? response.data.data.state : 'no-data';

  if (state === 'no-data') {
    const uploadsResponse = await apiClient.get('/upload?limit=1', { signal });
    const uploadCount = uploadsResponse.data.count
      || uploadsResponse.data.data?.length
      || 0;

    if (uploadCount > 0) {
      state = 'uploaded-insufficient';
    }
  }

  return stateMap[state] || 'NoData';
};

const Dashboard = () => {
  const {
    data, error, lastSuccessAt, lastErrorAt, refresh,
  } = usePolling(loadDashboardState, DASHBOARD_POLL_MS);
  const selectedState = data;
  // A state screen that wants the dashboard re-checked right away (e.g.
  // right after the owner marks dates closed) calls this instead of
  // waiting for the next poll.
  const requestRefresh = refresh;

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
    ReadyToTrain: {
      component: ReadyToTrain,
      label: '🟢 Ready to Train',
      color: '#0F9918',
      description: 'Enough data uploaded — training not started yet',
      backgroundColor: '#f0fdf4'
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

  // Login problem (401/403): polling has stopped (see usePolling). Show the
  // log-in screen even if data loaded before; never log out automatically.
  // Never loaded in this visit + any failure: the full problem screen.
  // Still loading the first time: a neutral loading card, not "No Data".
  if (error?.kind === 'auth' || (!selectedState && error)) {
    return (
      <div className="dashboard-wrapper" style={{ backgroundImage: `url(${dashboardBg})`, backgroundSize: 'cover', backgroundPosition: 'center', minHeight: '100vh' }}>
        <Navbar />
        <ConnectionProblem mode="full" error={error} onRetry={refresh} />
      </div>
    );
  }

  if (!selectedState) {
    return (
      <div className="route-guard-loading">
        <div className="route-guard-card">
          <div className="route-guard-spinner">
            <div className="route-guard-spinner-ring"></div>
          </div>
          <h3 className="route-guard-title">Loading</h3>
          <p className="route-guard-subtitle route-guard-dots">
            Checking your dashboard
          </p>
        </div>
      </div>
    );
  }

  const CurrentDashboard = stateConfig[selectedState].component;
  const currentState = stateConfig[selectedState];
  // Loaded before, but the latest check failed: keep showing the last good
  // state, with a banner saying so.
  const showStaleBanner = Boolean(error) && lastErrorAt && (!lastSuccessAt || lastErrorAt > lastSuccessAt);

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
      <CurrentDashboard onRefreshState={requestRefresh} />
      {showStaleBanner && (
        <ConnectionProblem
          mode="banner"
          error={error}
          onRetry={refresh}
          lastSuccessAt={lastSuccessAt}
          lastErrorAt={lastErrorAt}
        />
      )}
    </div>
  );
};

export default Dashboard;