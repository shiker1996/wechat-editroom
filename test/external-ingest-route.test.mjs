import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSystemRoutes } from '../server/platform/http/routes/system-routes.mjs';

function context(input = {}) {
  const calls = [];
  const store = {
    repositories: { extensionSettings: { get: () => null, save: () => null, list: () => [] } },
    getBatch: (id) => id === 'batch-1' ? { id } : null,
    startSourceRun: (...args) => { calls.push(['start', ...args]); return 7; },
    addHotspots: (...args) => calls.push(['add', ...args]),
    finishSourceRun: (...args) => calls.push(['finish', ...args]),
  };
  const output = [];
  return {
    request: { method: 'POST', headers: { authorization: 'Bearer secret' } },
    response: {}, pathname: '/api/ingest/items', searchParams: new URLSearchParams(), root: process.cwd(), resourceRoot: process.cwd(),
    config: { collection: { ingestToken: 'secret' } }, store, body: async () => input,
    json: (_response, status, value) => output.push({ status, value }), calls,
    output,
    binaryBody: async () => Buffer.alloc(0), createWorkbenchBackup: async () => null,
  };
}

test('外部采集入口写入指定批次并记录来源运行', async () => {
  const c = context({ batchId: 'batch-1', channel: 'wechat', sourceId: 'mp-demo', items: [{ title: '公众号文章', url: 'https://example.com/a' }] });
  assert.equal(await handleSystemRoutes(c), true);
  assert.equal(c.output[0].status, 202);
  assert.equal(c.output[0].value.accepted, 1);
  assert.equal(c.calls[0][0], 'start');
  assert.equal(c.calls[1][0], 'add');
  assert.equal(c.calls[2][0], 'finish');
});

test('外部采集入口在没有有效令牌时拒绝请求', async () => {
  const c = context({ batchId: 'batch-1', channel: 'x', sourceId: 'demo', items: [{ title: 'x' }] });
  c.request.headers.authorization = 'Bearer wrong';
  assert.equal(await handleSystemRoutes(c), true);
  assert.equal(c.output[0].status, 401);
  assert.equal(c.output[0].value.code, 'INGEST_AUTH_FAILED');
  assert.equal(c.calls.length, 0);
});
