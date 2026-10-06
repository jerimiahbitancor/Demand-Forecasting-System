// Dashboard.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import './Dashboard.css';

import DashboardLoading from '../components/DashboardLoading.jsx';

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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const POLL_MS = 5000;

// One client for the page instead of axios.get(URL, { headers }) at every call
// site. The token is read per request, not captured once, so a login that
// happens after this module loads still authenticates.
const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' }
});

apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('access_token') || localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Backend state name -> screen. Frozen at module scope: this never changes, and
// rebuilding seven objects on every poll (every 5s, forever) was pure waste.
const STATE_MAP = {
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

const Dashboard = () => {
  // { key, Component, payload } — null until the first answer arrives *and*
  // the matching screen's code has finished downloading.
  //
  // This used to start at 'NoData', which meant every visit painted the "no
  // data" screen first and then swapped it out — so an owner with a trained
  // model watched an upload CTA flash past.
  //
  // `payload` is the dashboard-state response, handed to the screen so it can
  // paint real numbers on its very first frame instead of firing the same
  // requests again and showing zeros while it waits.
  const [resolved, setResolved] = useState(null);
  // Bumped by a state screen that wants the dashboard re-checked right away
  // (e.g. right after the owner marks dates closed) instead of waiting up
  // to 5 seconds for the next poll. The effect below re-runs on change.
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Guards against the classic stale-response race: a slow first poll and a
  // fast refresh could otherwise resolve out of order and leave the dashboard
  // showing the answer to the older question.
  const latestRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;
    // Real cancellation, so unmounting mid-request doesn't pay for a response
    // nobody will read.
    const controller = new AbortController();
    const { signal } = controller;
    const wasCancelled = () => cancelled || signal.aborted;

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

    const applyState = async (nextKey, payload) => {
      if (wasCancelled()) return;

      // The chunk download starts now, in parallel with whatever the screen
      // still needs — not when React first tries to render it. Awaited here so
      // the splash stays up until there is genuinely nothing left to load.
      const Component = await loadScreen(nextKey);
      if (!Component || wasCancelled()) return;

      // Bail when nothing moved: this runs every 5s for the life of the page,
      // and re-rendering the whole screen for an identical answer is the
      // difference between a dashboard that sits idle and one that doesn't.
      // Each screen keeps its own polling for live numbers, so holding the
      // first payload costs nothing.
      setResolved((current) => (
        current && current.key === nextKey ? current : { key: nextKey, Component, payload }
      ));
    };

    const resolveUploadFallback = async () => {
      const uploadsResponse = await apiClient.get('/upload', {
        params: { limit: 1 },
        signal
      });
      const uploadCount = uploadsResponse.data.count
        || uploadsResponse.data.data?.length
        || 0;
      return uploadCount > 0 ? 'UploadedInsufficient' : 'NoData';
    };

    const loadDashboardState = async () => {
      const requestId = latestRequest.current + 1;
      latestRequest.current = requestId;

      try {
        const response = await apiClient.get('/upload/dashboard-state', { signal });
        const payload = response.data.success ? response.data.data : null;
        let state = payload ? payload.state : 'no-data';

        // The backend only knows about uploads it has ingested, so a file the
        // owner just dropped can still read as 'no-data' here. Ask whether an
        // upload exists at all before believing that.
        if (state === 'no-data') {
          state = await resolveUploadFallback();
        }

        if (requestId !== latestRequest.current) return;
        await applyState(STATE_MAP[state] || 'NoData', payload);
      } catch (error) {
        if (wasCancelled() || axios.isCancel(error)) return;
        console.error('Error loading dashboard state:', error);
        try {
          const fallbackState = await resolveUploadFallback();
          if (requestId !== latestRequest.current) return;
          await applyState(fallbackState, null);
        } catch (fallbackError) {
          if (wasCancelled() || axios.isCancel(fallbackError)) return;
          console.error('Error loading upload fallback:', fallbackError);
          await applyState('NoData', null);
        }
      }
    };

    // Don't start the poll until the first answer has landed. A cold backend
    // can take longer than POLL_MS to answer, and the old code was already
    // queueing a second identical request behind the first.
    loadDashboardState().finally(() => {
      if (wasCancelled()) return;
      intervalId = setInterval(() => {
        // Nothing is rendered off-screen; skip the work while the tab is
        // hidden and catch up the moment it comes back.
        if (document.visibilityState === 'hidden') return;
        loadDashboardState();
      }, POLL_MS);
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadDashboardState();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      controller.abort();
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshKey]);

  // Memoised on the resolved state: a new object identity every render would
  // make React rewrite the wrapper's inline style on every poll.
  const backgroundStyle = useMemo(
    () => (resolved ? getBackgroundStyle(resolved.key) : null),
    [resolved]
  );

  // Still resolving: state answer or the screen's own chunk. Either way there
  // is nothing to paint yet, so the splash stays up rather than flashing a
  // half-built screen.
  if (!resolved) {
    return <DashboardLoading />;
  }

  const { Component, payload } = resolved;

  return (
    <div className="dashboard-wrapper" style={backgroundStyle}>
      {/* No Suspense here on purpose: the chunk was awaited during the splash,
          so this render is synchronous and the screen appears fully painted.
          The wrapper stays mounted across a state change, so the page
          background never flashes on the way between states. */}
      <Component onRefreshState={requestRefresh} initialState={payload} />
    </div>
  );
};

export default Dashboard;