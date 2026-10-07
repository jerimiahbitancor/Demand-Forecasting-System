// tests/staleDays.test.js — run: node --test tests/staleDays.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { countMissingOperatingDays, resolveOperatingDays } = require('../utils/staleDays');

const MON_SAT = new Set([0, 1, 2, 3, 4, 5]);
const count = (p) => countMissingOperatingDays(p);

// Oct 2026: Sat 3, Sun 4, Mon 5, Tue 6, Wed 7.

test('Sat last open + Sunday not operating -> 0 on Monday', () => {
  const r = count({ lastConfirmedDate: '2026-10-03', today: '2026-10-05', operatingDays: MON_SAT });
  assert.equal(r.missingOperatingDays, 0);
  assert.deepEqual(r.missingDates, []);
});

test('Monday missing -> 1 on Tuesday (the production case: raw stale_days was 2)', () => {
  const r = count({ lastConfirmedDate: '2026-10-03', today: '2026-10-06', operatingDays: MON_SAT });
  assert.equal(r.missingOperatingDays, 1);
  assert.deepEqual(r.missingDates, ['2026-10-05']);
});

test('Monday uploaded (confirmed open) -> 0 on Tuesday', () => {
  const r = count({ lastConfirmedDate: '2026-10-03', today: '2026-10-06', operatingDays: MON_SAT, recordedDates: ['2026-10-05'] });
  assert.equal(r.missingOperatingDays, 0);
});

test('a confirmed-closed weekday -> 0', () => {
  // Mon Oct 5 marked closed (a holiday); nothing else in between.
  const r = count({ lastConfirmedDate: '2026-10-03', today: '2026-10-06', operatingDays: MON_SAT, recordedDates: new Set(['2026-10-05']) });
  assert.equal(r.missingOperatingDays, 0);
});

test('today itself and the last confirmed date are never counted', () => {
  const r = count({ lastConfirmedDate: '2026-10-05', today: '2026-10-06', operatingDays: MON_SAT });
  assert.equal(r.missingOperatingDays, 0);
});

test('several missing days, Sundays skipped', () => {
  // Last open Thu Oct 1; today Wed Oct 7. Between: Fri 2, Sat 3, Sun 4, Mon 5, Tue 6.
  const r = count({ lastConfirmedDate: '2026-10-01', today: '2026-10-07', operatingDays: MON_SAT });
  assert.deepEqual(r.missingDates, ['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06']);
});

test('operating_days null -> Mon-Fri default, same as ml-service', () => {
  const { days, source } = resolveOperatingDays(null);
  assert.equal(source, 'default');
  assert.deepEqual([...days].sort(), [0, 1, 2, 3, 4]);
  // Default: Saturday is NOT an operating day.
  const r = count({ lastConfirmedDate: '2026-10-02', today: '2026-10-06', operatingDays: days });
  assert.deepEqual(r.missingDates, ['2026-10-05'], 'Sat 3 and Sun 4 skipped, Mon 5 missing');
});

test('resolveOperatingDays: configured list, bad values fall back', () => {
  assert.equal(resolveOperatingDays([0, 1, 2, 3, 4, 5]).source, 'configured');
  assert.equal(resolveOperatingDays([]).source, 'configured');
  assert.equal(resolveOperatingDays(undefined).source, 'default');
  assert.equal(resolveOperatingDays([0, 9]).source, 'default');
  assert.equal(resolveOperatingDays('0,1').source, 'default');
});

test('no last confirmed date, or a bad date -> 0', () => {
  assert.equal(count({ lastConfirmedDate: null, today: '2026-10-06', operatingDays: MON_SAT }).missingOperatingDays, 0);
  assert.equal(count({ lastConfirmedDate: '2026-02-31', today: '2026-10-06', operatingDays: MON_SAT }).missingOperatingDays, 0);
  assert.equal(count({ lastConfirmedDate: '2026-10-07', today: '2026-10-06', operatingDays: MON_SAT }).missingOperatingDays, 0);
});

test('month and year boundaries', () => {
  const r = count({ lastConfirmedDate: '2025-12-30', today: '2026-01-03', operatingDays: new Set([0, 1, 2, 3, 4, 5, 6]) });
  assert.deepEqual(r.missingDates, ['2025-12-31', '2026-01-01', '2026-01-02']);
});
