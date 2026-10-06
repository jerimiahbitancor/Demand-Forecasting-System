// Tests utils/poller.js with a fake clock: no overlapping runs, refresh
// queues exactly one run, pause/resume, stop aborts.
//
// Plain Node, no test runner:
//   cd frontend && node tests/poller.test.mjs

const { createPoller } = await import('../src/utils/poller.js');

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}  ${detail}`); failures.push(label); }
}

// Fake timers: nothing runs until fire() is called.
function fakeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    schedule: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    cancel: (id) => { timers.delete(id); },
    pending: () => timers.size,
    delays: () => [...timers.values()].map((t) => t.ms),
    fire() {
      const entries = [...timers.entries()];
      timers.clear();
      for (const [, t] of entries) t.fn();
      return entries.length;
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// A task whose runs finish only when the test says so.
function controllableTask() {
  const runs = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const task = (signal) => new Promise((resolve, reject) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const run = {
      signal,
      resolve: (v) => { inFlight -= 1; resolve(v); },
      reject: (e) => { inFlight -= 1; reject(e); },
    };
    signal.addEventListener('abort', () => { inFlight -= 1; reject(Object.assign(new Error('aborted'), { code: 'ERR_CANCELED' })); });
    runs.push(run);
  });
  return { task, runs, maxInFlight: () => maxInFlight };
}

console.log('a slow task never overlaps');
{
  const clock = fakeClock();
  const t = controllableTask();
  const poller = createPoller({ task: t.task, intervalMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
  poller.start();
  check('first run starts immediately', t.runs.length === 1);
  check('nothing scheduled while a run is in flight', clock.pending() === 0);
  // Even if many timers/refreshes fire, still one in flight.
  poller.refresh();
  poller.refresh();
  poller.resume();
  check('refresh/resume during a run do not start a second run', t.runs.length === 1);
  t.runs[0].resolve('a');
  await flush();
  check('one queued follow-up ran right after', t.runs.length === 2, String(t.runs.length));
  t.runs[1].resolve('b');
  await flush();
  check('then the next run is scheduled (not started)', clock.pending() === 1 && t.runs.length === 2);
  clock.fire();
  check('scheduled run starts when the timer fires', t.runs.length === 3);
  t.runs[2].resolve('c');
  await flush();
  check('max in flight is 1', t.maxInFlight() === 1, String(t.maxInFlight()));
  poller.stop();
}

console.log('refresh while running queues exactly one run');
{
  const clock = fakeClock();
  const t = controllableTask();
  const poller = createPoller({ task: t.task, intervalMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
  poller.start();
  for (let i = 0; i < 5; i++) poller.refresh();
  t.runs[0].resolve(1);
  await flush();
  check('exactly one follow-up', t.runs.length === 2, String(t.runs.length));
  t.runs[1].resolve(2);
  await flush();
  check('no further immediate runs', t.runs.length === 2);
  check('back to the normal schedule', clock.pending() === 1 && clock.delays()[0] === 1000);
  poller.stop();
}

console.log('refresh while idle runs now and resets the timer');
{
  const clock = fakeClock();
  const t = controllableTask();
  const poller = createPoller({ task: t.task, intervalMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
  poller.start();
  t.runs[0].resolve(1);
  await flush();
  poller.refresh();
  check('runs immediately', t.runs.length === 2);
  check('the old timer is cleared', clock.pending() === 0);
  t.runs[1].resolve(2);
  await flush();
  poller.stop();
}

console.log('pause / resume');
{
  const clock = fakeClock();
  const t = controllableTask();
  let successes = 0;
  const poller = createPoller({ task: t.task, intervalMs: 1000, onSuccess: () => { successes += 1; }, schedule: clock.schedule, cancel: clock.cancel });
  poller.start();
  poller.pause();
  check('pause reports not running', poller.isRunning() === false);
  t.runs[0].resolve('x');
  await flush();
  check('an in-flight run still finishes', successes === 1);
  check('nothing scheduled while paused', clock.pending() === 0);
  check('no new run while paused', t.runs.length === 1);
  poller.resume();
  check('resume runs immediately', t.runs.length === 2);
  t.runs[1].resolve('y');
  await flush();
  check('then continues on schedule', clock.pending() === 1);
  poller.stop();
}

console.log('pause drops a queued refresh');
{
  const clock = fakeClock();
  const t = controllableTask();
  const poller = createPoller({ task: t.task, intervalMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
  poller.start();
  poller.refresh(); // queued
  poller.pause();
  t.runs[0].resolve(1);
  await flush();
  check('queued run does not happen while paused', t.runs.length === 1 && clock.pending() === 0);
  poller.stop();
}

console.log('stop aborts');
{
  const clock = fakeClock();
  const t = controllableTask();
  let called = 0;
  const poller = createPoller({
    task: t.task, intervalMs: 1000,
    onSuccess: () => { called += 1; }, onError: () => { called += 1; },
    schedule: clock.schedule, cancel: clock.cancel,
  });
  poller.start();
  const signal = t.runs[0].signal;
  poller.stop();
  check('the signal is aborted', signal.aborted === true);
  await flush();
  check('no callback after stop', called === 0);
  check('no timer after stop', clock.pending() === 0);
  poller.refresh();
  check('refresh after stop does nothing', t.runs.length === 1);
}

console.log('errors keep polling; delayAfterError is honoured');
{
  const clock = fakeClock();
  const t = controllableTask();
  const errors = [];
  const poller = createPoller({
    task: t.task, intervalMs: 1000,
    onError: (e) => errors.push(e.message),
    delayAfterError: (e) => (e.retryMs ? e.retryMs : undefined),
    schedule: clock.schedule, cancel: clock.cancel,
  });
  poller.start();
  t.runs[0].reject(Object.assign(new Error('boom'), { retryMs: 5000 }));
  await flush();
  check('onError called', errors[0] === 'boom');
  check('next run waits the custom delay', clock.delays()[0] === 5000, JSON.stringify(clock.delays()));
  clock.fire();
  t.runs[1].reject(new Error('again'));
  await flush();
  check('without a custom delay, the normal interval', clock.delays()[0] === 1000);
  poller.stop();
}

console.log('onError can pause (how the hook stops on 401)');
{
  const clock = fakeClock();
  const t = controllableTask();
  let poller;
  poller = createPoller({
    task: t.task, intervalMs: 1000,
    onError: () => poller.pause(),
    schedule: clock.schedule, cancel: clock.cancel,
  });
  poller.start();
  t.runs[0].reject(new Error('401'));
  await flush();
  check('nothing scheduled after the pause', clock.pending() === 0 && t.runs.length === 1);
  poller.refresh();
  check('refresh starts it again', t.runs.length === 2 && poller.isRunning());
  poller.stop();
}

console.log('a throwing callback does not break the loop');
{
  const clock = fakeClock();
  const t = controllableTask();
  const realError = console.error;
  console.error = () => {};
  const poller = createPoller({
    task: t.task, intervalMs: 1000,
    onSuccess: () => { throw new Error('bad callback'); },
    schedule: clock.schedule, cancel: clock.cancel,
  });
  poller.start();
  t.runs[0].resolve(1);
  await flush();
  console.error = realError;
  check('still scheduled', clock.pending() === 1);
  poller.stop();
}

console.log('');
if (failures.length) { console.log(`FAILED: ${failures.length}: ${JSON.stringify(failures)}`); process.exit(1); }
console.log('All poller checks passed.');
