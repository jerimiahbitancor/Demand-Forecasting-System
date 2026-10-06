// tests/logger.test.js — run: node --test tests/logger.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../utils/logger');
const { requestStore } = require('../utils/requestStore');

// Captures what the logger writes to stdout while `fn` runs.
function capture(fn) {
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return lines;
}

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('writes one parseable JSON line with the fixed fields', () => {
  const lines = withEnv({ LOG_LEVEL: 'debug' }, () => capture(() => logger.info('hello', { a: 1 })));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\n'));
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, 'info');
  assert.equal(entry.service, 'api');
  assert.equal(entry.msg, 'hello');
  assert.equal(entry.a, 1);
  assert.ok(!Number.isNaN(Date.parse(entry.ts)));
});

test('hides secret-looking keys, also nested, case-insensitive', () => {
  const lines = withEnv({ LOG_LEVEL: 'debug' }, () =>
    capture(() =>
      logger.info('x', {
        password: 'p1',
        user: { Access_Token: 't', profile: { OTP: '123456', name: 'ok' } },
        headers: { Authorization: 'Bearer abc', cookie: 'c' },
        apiKey: 'k',
        SUPABASE_SERVICE_ROLE: 's',
      })
    )
  );
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.password, '[hidden]');
  assert.equal(entry.user.Access_Token, '[hidden]');
  assert.equal(entry.user.profile.OTP, '[hidden]');
  assert.equal(entry.user.profile.name, 'ok');
  assert.equal(entry.headers.Authorization, '[hidden]');
  assert.equal(entry.headers.cookie, '[hidden]');
  assert.equal(entry.apiKey, '[hidden]');
  assert.equal(entry.SUPABASE_SERVICE_ROLE, '[hidden]');
  assert.ok(!lines[0].includes('Bearer abc'));
  assert.ok(!lines[0].includes('123456'));
});

test('level threshold: LOG_LEVEL and the NODE_ENV default', () => {
  const warnOnly = withEnv({ LOG_LEVEL: 'warn' }, () =>
    capture(() => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
    })
  );
  assert.deepEqual(warnOnly.map((l) => JSON.parse(l).msg), ['w', 'e']);

  const prodDefault = withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'production' }, () =>
    capture(() => {
      logger.debug('d');
      logger.info('i');
    })
  );
  assert.deepEqual(prodDefault.map((l) => JSON.parse(l).msg), ['i']);

  const devDefault = withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'development' }, () =>
    capture(() => logger.debug('d'))
  );
  assert.equal(devDefault.length, 1);
});

test('a circular object does not throw', () => {
  const a = { name: 'a' };
  a.self = a;
  const lines = withEnv({ LOG_LEVEL: 'debug' }, () => capture(() => logger.info('circ', { a })));
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.a.self, '[circular]');
});

test('errors become {name, message, code}; stack only outside production', () => {
  const err = new Error('boom');
  err.code = 'E_TEST';
  const dev = withEnv({ LOG_LEVEL: 'debug', NODE_ENV: 'development' }, () =>
    capture(() => logger.error('failed', { err }))
  );
  const devEntry = JSON.parse(dev[0]);
  assert.equal(devEntry.err.name, 'Error');
  assert.equal(devEntry.err.message, 'boom');
  assert.equal(devEntry.err.code, 'E_TEST');
  assert.ok(devEntry.err.stack);

  const prod = withEnv({ LOG_LEVEL: 'debug', NODE_ENV: 'production' }, () =>
    capture(() => logger.error('failed', { err }))
  );
  assert.equal(JSON.parse(prod[0]).err.stack, undefined);
});

test('picks up the request ID from the request store', () => {
  const lines = withEnv({ LOG_LEVEL: 'debug' }, () =>
    capture(() => requestStore.run({ requestId: 'req-abc-123' }, () => logger.info('inside')))
  );
  assert.equal(JSON.parse(lines[0]).requestId, 'req-abc-123');
});

test('never throws, even when a value cannot be serialized', () => {
  const bad = {};
  Object.defineProperty(bad, 'boom', {
    enumerable: true,
    get() {
      throw new Error('getter exploded');
    },
  });
  assert.doesNotThrow(() =>
    withEnv({ LOG_LEVEL: 'debug' }, () => capture(() => logger.info('bad', { bad })))
  );
});
