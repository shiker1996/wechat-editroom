import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeProxyEnvironment } from '../server/platform/network/node-proxy-environment.mjs';

test('Node external proxy environment enables built-in proxy support and bypasses loopback', () => {
  const env = nodeProxyEnvironment({ HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: 'api.internal' }, 'linux');
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.example:8080');
  assert.deepEqual(new Set(env.NO_PROXY.split(',')), new Set(['api.internal', 'localhost', '127.0.0.1', '::1']));
});

test('explicitly disabled proxy support stays disabled', () => {
  const source = { HTTPS_PROXY: 'http://proxy.example:8080', NODE_USE_ENV_PROXY: '0' };
  const env = nodeProxyEnvironment(source, 'linux');
  assert.equal(env.NODE_USE_ENV_PROXY, '0');
  assert.equal(env.NO_PROXY, undefined);
  assert.equal(source.NO_PROXY, undefined);
});
