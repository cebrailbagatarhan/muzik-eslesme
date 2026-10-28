import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkHealth, main, parseOptions } from './check-health.mjs';

test('defaults to the local API and accepts explicit port and timeout', () => {
  assert.deepEqual(parseOptions([]), { port: 4000, timeoutMs: 3000 });
  assert.deepEqual(parseOptions(['--port', '4050', '--timeout-ms', '500']), { port: 4050, timeoutMs: 500 });
});

test('rejects malformed options before any request', () => {
  assert.throws(() => parseOptions(['--port', '0']), /Port/);
  assert.throws(() => parseOptions(['--port', '99999']), /Port/);
  assert.throws(() => parseOptions(['--timeout-ms', '50']), /Timeout/);
  assert.throws(() => parseOptions(['--host', 'example.com']), /Usage/);
  assert.throws(() => parseOptions(['--json', '--json']), /Usage/);
  assert.throws(() => parseOptions(['--port', '--json']), /Usage/);
});

test('checks only loopback health and verifies status body', async () => {
  let url;
  const result = await checkHealth({ port: 4050 }, async (input, options) => {
    url = input;
    assert.equal(options.method, 'GET');
    return { ok: true, json: async () => ({ status: 'ok' }) };
  });
  assert.equal(result, true);
  assert.equal(url, 'http://127.0.0.1:4050/health');
  assert.equal(await checkHealth({}, async () => ({ ok: true, json: async () => ({ status: 'down' }) })), false);
  assert.equal(await checkHealth({}, async () => ({ ok: false })), false);
});

test('returns false on network errors and invalid JSON', async () => {
  assert.equal(await checkHealth({}, async () => { throw new Error('connection refused'); }), false);
  assert.equal(await checkHealth({}, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } })), false);
});

test('main returns expected exit codes', async () => {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(await main([], async () => ({ ok: true, json: async () => ({ status: 'ok' }) })), 0);
    assert.equal(await main([], async () => ({ ok: false })), 1);
    assert.equal(await main(['--port', 'bad'], async () => { throw new Error('should not request'); }), 2);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test('JSON output reports healthy and unhealthy statuses without changing exit codes', async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const output = [];
  const errors = [];
  console.log = (message) => output.push(message);
  console.error = (message) => errors.push(message);
  try {
    assert.deepEqual(parseOptions(['--json', '--port', '4050']), { port: 4050, timeoutMs: 3000, json: true });
    assert.equal(await main(['--port', '4050', '--json'], async () => ({ ok: true, json: async () => ({ status: 'ok' }) })), 0);
    assert.deepEqual(JSON.parse(output.pop()), { status: 'ok', port: 4050 });
    assert.equal(await main(['--json'], async () => ({ ok: false })), 1);
    assert.deepEqual(JSON.parse(output.pop()), { status: 'unavailable', port: 4000 });
    assert.deepEqual(errors, []);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});
