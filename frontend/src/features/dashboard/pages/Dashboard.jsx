// Dashboard.jsx
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import apiClient from '../../../services/apiClient';
import usePolling from '../../../hooks/usePolling';
import { describeChange, onDataChanged } from '../../../utils/appEvents';
import './Dashboard.css';

import DashboardLoading from '../components/DashboardLoading.jsx';
import ConnectionProblem from '../states/ConnectionProblem.jsx';
import Navbar from '../../components/Navbar/Navbar';

// Import the image directly
import dashboardBg from '../../../assets/images/Dashboard.png';

// Code-split per state. FullyOperational alone is ~1MB (recharts plus the
// Dashboard background photo), and eagerly importing all seven meant an owner
// on the "no data" screen paid for the fully-operational dashboard's
// JavaScript before the first paint.
//
// Plain loader functions rather than React.lazy on purpose. lazy() resolves its
// component on first *render*, which meant the sequence was: splash, state
// answer arrives, swap, lazy suspends again, splash again, chunk lands, screen
// finally paints — the double "loading" this file used to cause. Here the chunk
// is awaited during the splash, so the resolved screen mounts with its code
// already in hand and there is nothing left to wait for.
const STATE_LOADERS = {
  FullyOperational: () => import('../states/FullyOperational'),
  NoData: () => import('../states/NoData.jsx'),
  UploadedInsufficient: () => import('../states/UploadedInsufficient.jsx'),
  ReadyToTrain: () => import('../states/ReadyToTrain.jsx'),
  TrainingInProgress: () => import('../states/TrainingInProgress.jsx'),
  ForecastsReady: () => import('../states/ForecastsReady.jsx'),
  DataNeedsAttention: () => import('../states/DataNeedsAttention.jsx')
};

// How often the dashboard re-checks its state. One check at a time, paused
// while the tab is hidden (see hooks/usePolling.js).
const DASHBOARD_POLL_MS = 60000;

// Backend state name -> screen. Frozen at module scope: this never changes, and
// rebuilding seven objects on every poll would be pure waste.
const stateMap = {
  'no-data': 'NoData',
  'uploaded-insufficient': 'UploadedInsufficient',
  'ready-to-train': 'ReadyToTrain',
  'training-in-progress': 'TrainingInProgress',
  'forecasts-ready-recipes-pending': 'ForecastsReady',
  'data-needs-attention': 'DataNeedsAttention',
  'fully-operational': 'FullyOperational'
};

// Configuration for each state with background
const STATE_CONFIG = {
  FullyOperational: {
    label: '✅ Fully Operational',
    color: '#22c55e',
    description: 'All systems running normally',
    backgroundImage: dashboardBg
  },
  NoData: {
    label: '📭 No Data',
    color: '#6b7280',
    description: 'No data uploaded yet',
    backgroundColor: '#ffffff'
  },
  UploadedInsufficient: {
    label: '⚠️ Insufficient Data',
    color: '#eab308',
    description: 'Data uploaded but insufficient',
    backgroundColor: '#fffbeb'
  },
  ReadyToTrain: {
    label: '🟢 Ready to Train',
    color: '#0F9918',
    description: 'Enough data uploaded — training not started yet',
    backgroundColor: '#f0fdf4'
  },
  TrainingInProgress: {
    label: '🔄 Training in Progress',
    color: '#06b6d4',
    description: 'Model is currently training',
    backgroundColor: '#ecfdf5'
  },
  ForecastsReady: {
    label: '📊 Forecasts Ready',
    color: '#3b82f6',
    description: 'Forecasts are ready to view',
    backgroundColor: '#eff6ff'
  },
  DataNeedsAttention: {
    label: '🔴 Needs Attention',
    color: '#ef4444',
    description: 'Data issues require attention',
    backgroundColor: '#fef2f2'
  }
};

const getBackgroundStyle = (stateKey) => {
  const state = STATE_CONFIG[stateKey];
  if (state.backgroundImage) {
    return {
      backgroundImage: `url(${state.backgroundImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed',
      minHeight: '100vh'
    };
  }
  return {
    backgroundColor: state.backgroundColor,
    minHeight: '100vh'
  };
};

// Loads a screen's chunk, falling back to the "no data" screen if that
// download fails. Without the fallback a single failed chunk request would
// leave the owner staring at the splash forever, which is worse than
// showing them the wrong screen. Retrying the same specifier is not useful
// — the module loader caches the rejected promise — so the fallback goes to
// a different module.
const loadScreen = async (nextKey) => {
  try {
    return (await STATE_LOADERS[nextKey]()).default;
  } catch (err) {
    console.error(`Failed to load the ${nextKey} screen:`, err);
    if (nextKey === 'NoData') return null;
    try {
      return (await STATE_LOADERS.NoData()).default;
    } catch (fallbackErr) {
      console.error('Failed to load the fallback screen:', fallbackErr);
      return null;
    }
  }
};

// One dashboard check. Resolves to { key, payload } for the state screens.
//
// A failed check THROWS. It must never pick a business state: a timeout, a
// 429 or a 500 must not look like "Uploaded Insufficient" or "No Data",
// which are real answers. usePolling keeps the last good state and reports
// the error instead.
const loadDashboardState = async (signal) => {
  const response = await apiClient.get('/upload/dashboard-state', { signal });
  const payload = response.data.success ? response.data.data : null;
  let state = payload ? payload.state : 'no-data';

  // The backend only knows about uploads it has ingested, so a file the
  // owner just dropped can still read as 'no-data' here. Ask whether an
  // upload exists at all before believing that.
  if (state === 'no-data') {
    const uploadsResponse = await apiClient.get('/upload?limit=1', { signal });
    const uploadCount = uploadsResponse.data.count
      || uploadsResponse.data.data?.length
      || 0;

    if (uploadCount > 0) {
      state = 'uploaded-insufficient';
    }
  }

  return { key: stateMap[state] || 'NoData', payload };
};

const Dashboard = () => {
  const {
    data, error, lastSuccessAt, lastErrorAt, refresh,
  } = usePolling(loadDashboardState, DASHBOARD_POLL_MS);
  const stateKey = data ? data.key : null;
  const payload = data ? data.payload : null;

  // { key, Component, payload } — null until the state answer has landed *and*
  // the matching screen's code has finished downloading. The payload is the
  // one that came with the answer for this key: each screen seeds itself from
  // it on mount and then polls its own live numbers, so holding it costs
  // nothing and keeps the identity stable across refreshes.
  const [resolved, setResolved] = useState(null);

  // A state screen that wants the dashboard re-checked right away (e.g.
  // right after the owner marks dates closed) calls this instead of waiting
  // for the next poll.
  const requestRefresh = refresh;

  // The notification bell signals a new upload / training / forecast
  // notification (utils/appEvents.js): re-check now instead of waiting up
  // to 60 s, and say so with one toast (same id, so they never stack).
  useEffect(() => onDataChanged((detail) => {
    refresh();
    const { text, failed } = describeChange(detail);
    (failed ? toast.error : toast.success)(text, { id: 'dfs-data-changed' });
  }), [refresh]);

  // Downloads the screen's chunk as soon as its key is known (and again only
  // when the key changes — `loadScreen` caches, and setResolved bails out
  // below when nothing moved).
  useEffect(() => {
    if (!stateKey) return undefined;
    let cancelled = false;

    loadScreen(stateKey).then((Component) => {
      if (!Component || cancelled) return;
      setResolved((current) => (
        current && current.key === stateKey
          ? current
          : { key: stateKey, Component, payload }
      ));
    });

    return () => {
      cancelled = true;
    };
  }, [stateKey, payload]);

  // Memoised on the resolved state: a new object identity every render would
  // make React rewrite the wrapper's inline style on every poll.
  const backgroundStyle = useMemo(
    () => (resolved ? getBackgroundStyle(resolved.key) : null),
    [resolved]
  );

  // Login problem (401/403): polling has stopped (see usePolling). Show the
  // log-in screen even if data loaded before; never log out automatically.
  // Never loaded in this visit + any failure: the full problem screen.
  if (error?.kind === 'auth' || (!stateKey && error)) {
    return (
      <div className="dashboard-wrapper" style={{ backgroundImage: `url(${dashboardBg})`, backgroundSize: 'cover', backgroundPosition: 'center', minHeight: '100vh' }}>
        <Navbar />
        <ConnectionProblem mode="full" error={error} onRetry={refresh} />
      </div>
    );
  }

  // Still resolving: state answer or the screen's own chunk. Either way there
  // is nothing to paint yet, so the splash stays up rather than flashing a
  // half-built screen.
  if (!resolved) {
    return <DashboardLoading />;
  }

  // Loaded before, but the latest check failed: keep showing the last good
  // state, with a banner saying so.
  const showStaleBanner = Boolean(error) && lastErrorAt && (!lastSuccessAt || lastErrorAt > lastSuccessAt);

  const { Component, payload: initialState } = resolved;

  return (
    <div className="dashboard-wrapper" style={backgroundStyle}>
      {/* No Suspense here on purpose: the chunk was awaited during the splash,
          so this render is synchronous and the screen appears fully painted.
          The wrapper stays mounted across a state change, so the page
          background never flashes on the way between states. */}
      <Component onRefreshState={requestRefresh} initialState={initialState} />
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
