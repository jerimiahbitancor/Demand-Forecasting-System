// hooks/usePolling.js
//
// React wrapper around utils/poller.js.
//
//   const { data, error, lastSuccessAt, lastErrorAt, isRefreshing, stopped, refresh }
//     = usePolling((signal) => apiClient.get(url, { signal }).then(r => r.data), 60000);
//
// - One run at a time; the next is scheduled after the current one settles.
// - Pauses while the tab is hidden; runs once right away when it is shown again.
// - Stops on unmount (the in-flight request is aborted).
// - Keeps the last good `data` when a run fails; `error` describes the failure
//   (see utils/apiError.js) and is cleared by the next success.
// - On a login problem (401/403) it STOPS instead of retrying, and sets
//   `stopped`. Only refresh() or a remount starts it again.
// - After a 429 it waits max(intervalMs, Retry-After) before trying again;
//   `error.retryInSec` says how long.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPoller } from '../utils/poller';
import { toApiError } from '../utils/apiError';

export function describeError(err) {
  return (err && err.apiError) || toApiError(err);
}

function retryDelayMs(apiError, intervalMs) {
  if (apiError.kind === 'rate_limited' && apiError.retryAfterSec) {
    return Math.max(intervalMs, apiError.retryAfterSec * 1000);
  }
  return intervalMs;
}

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export default function usePolling(task, intervalMs, { enabled = true, stopOnAuthError = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastSuccessAt, setLastSuccessAt] = useState(null);
  const [lastErrorAt, setLastErrorAt] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stopped, setStopped] = useState(false);

  // Always call the latest `task` without rebuilding the poller each render.
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });

  const pollerRef = useRef(null);
  const authStoppedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    authStoppedRef.current = false;

    const poller = createPoller({
      task: (signal) => taskRef.current(signal),
      intervalMs,
      onStart: () => setIsRefreshing(true),
      onSuccess: (result) => {
        setData(result);
        setError(null);
        setLastSuccessAt(Date.now());
        setIsRefreshing(false);
        setStopped(false);
      },
      onError: (err) => {
        setIsRefreshing(false);
        const apiError = describeError(err);
        if (apiError.kind === 'canceled') return;
        setError({ ...apiError, retryInSec: Math.ceil(retryDelayMs(apiError, intervalMs) / 1000) });
        setLastErrorAt(Date.now());
        if (stopOnAuthError && apiError.kind === 'auth') {
          authStoppedRef.current = true;
          setStopped(true);
          poller.pause();
        }
      },
      delayAfterError: (err) => retryDelayMs(describeError(err), intervalMs),
    });
    pollerRef.current = poller;

    // A hidden tab at mount waits until it is shown.
    if (!isHidden()) poller.start();

    const onVisibilityChange = () => {
      if (isHidden()) {
        poller.pause();
        return;
      }
      if (authStoppedRef.current) return;
      if (poller.isStarted()) poller.resume();
      else poller.start();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [enabled, intervalMs, stopOnAuthError]);

  const refresh = useCallback(() => {
    const poller = pollerRef.current;
    if (!poller) return;
    authStoppedRef.current = false;
    setStopped(false);
    if (poller.isStarted()) poller.refresh();
    else poller.start();
  }, []);

  return { data, error, lastSuccessAt, lastErrorAt, isRefreshing, stopped, refresh };
}
