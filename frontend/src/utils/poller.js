// utils/poller.js
//
// Runs `task` again and again, safely:
//
// - Never more than one run in flight. The next run is scheduled only after
//   the current one settles (a setTimeout chain, never setInterval), so a
//   slow server can't pile up overlapping requests.
// - refresh() while a run is in flight queues exactly ONE follow-up run.
// - pause() stops scheduling (an in-flight run may still finish);
//   resume() runs immediately, then continues.
// - stop() aborts the in-flight run (its AbortSignal fires) and clears
//   timers. A run aborted by stop() calls neither onSuccess nor onError.
//
// Pure (no React), so it can be tested in plain Node with a fake clock.

export function createPoller({
  task,
  intervalMs,
  onStart = () => {},
  onSuccess = () => {},
  onError = () => {},
  // Optional: delay before the next run after a failure (e.g. honour a
  // rate limit's Retry-After). Return a number of ms, or nothing to use
  // intervalMs.
  delayAfterError = () => undefined,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let started = false;
  let paused = false;
  let timer = null;
  let controller = null;
  let queued = false;
  let nextRunAt = null;
  let lastDelayMs = intervalMs;

  const safeCall = (fn, ...args) => {
    try {
      return fn(...args);
    } catch (err) {
      // A broken callback must not stop the polling loop.
      console.error('poller callback failed:', err);
      return undefined;
    }
  };

  function clearTimer() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    nextRunAt = null;
  }

  function scheduleNext(delayMs = intervalMs) {
    clearTimer();
    if (!started || paused) return;
    lastDelayMs = delayMs;
    nextRunAt = Date.now() + delayMs;
    timer = schedule(() => {
      timer = null;
      nextRunAt = null;
      runNow();
    }, delayMs);
  }

  async function runNow() {
    if (!started) return;
    if (controller) {
      queued = true;
      return;
    }
    clearTimer();

    const myController = new AbortController();
    controller = myController;
    safeCall(onStart);

    let ok = false;
    let result;
    let error;
    try {
      result = await task(myController.signal);
      ok = true;
    } catch (err) {
      error = err;
    }

    if (controller === myController) controller = null;
    // Stopped while running: report nothing, schedule nothing.
    if (myController.signal.aborted) return;

    let delayMs = intervalMs;
    if (ok) {
      safeCall(onSuccess, result);
    } else {
      const custom = safeCall(delayAfterError, error);
      if (typeof custom === 'number' && Number.isFinite(custom) && custom >= 0) delayMs = custom;
      safeCall(onError, error);
    }

    if (!started) return;
    if (queued) {
      queued = false;
      if (!paused) {
        runNow();
        return;
      }
    }
    scheduleNext(delayMs);
  }

  return {
    start() {
      if (started) return;
      started = true;
      paused = false;
      runNow();
    },
    stop() {
      started = false;
      paused = false;
      queued = false;
      clearTimer();
      if (controller) {
        const running = controller;
        controller = null;
        running.abort();
      }
    },
    // Run now (or right after the in-flight run). Also un-pauses.
    refresh() {
      if (!started) return;
      paused = false;
      runNow();
    },
    pause() {
      paused = true;
      queued = false;
      clearTimer();
    },
    resume() {
      if (!started) return;
      paused = false;
      runNow();
    },
    isRunning() {
      return started && !paused;
    },
    isStarted() {
      return started;
    },
    isInFlight() {
      return controller !== null;
    },
    // When the next scheduled run will happen (ms timestamp), or null.
    nextRunAt() {
      return nextRunAt;
    },
    lastDelayMs() {
      return lastDelayMs;
    },
  };
}
