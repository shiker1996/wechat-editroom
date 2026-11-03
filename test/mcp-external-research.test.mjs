import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { Store } from '../server/platform/core/store.mjs';
import { batchTopicsDir } from '../server/platform/core/workspace-paths.mjs';
import { resolveStableBatchEvents } from '../server/features/research/application/stable-event-service.mjs';
import { handleTaskRoutes } from '../server/platform/http/routes/task-routes.mjs';

test('独立 MCP 进程通过 HTTP 领取真实研判阶段', { timeout: 30000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jianzi-mcp-research-'));
  const store = new Store(path.join(root, 'workbench.db'));
  const date = new Date().toISOString().slice(0, 10);
  const batch = store.createBatch({ date, title: 'MCP 隔离测试' });
  store.addHotspots(batch.id, 'rsshub', [{ id: 'one', title: '公司发布工具',
    url: 'https://example.com/a', publishedAt: new Date().toISOString() }]);
  const hotspot = store.getBatch(batch.id).hotspots[0];
  store.updateHotspotTags(hotspot.id, { eventKey: '公司|发布|工具', eventParts: { who: '公司', what: '发布工具' }, preScores: { audience: 10 } });
  const current = store.getBatch(batch.id);
  const events = resolveStableBatchEvents({ store, workspaceRoot: root, batch: current, hotspots: current.hotspots });
  const dir = path.join(batchTopicsDir(root, current), 'sources');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'event-cards.json'), JSON.stringify({ items: events.map((event) => ({
    event_id: event.event_id, conclusion: '工具已发布', confirmed_facts: [`${date} 发布工具`] })) }));
  const server = http.createServer(async (req, res) => {
    const json = (response, status, data) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); };
    if (req.url === '/api/security/session') return json(res, 200, { csrfToken: 'fixture' });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    try {
      const handled = await handleTaskRoutes({ request: req, response: res, pathname: new URL(req.url, 'http://localhost').pathname,
        store, config: { workspaceRoot: root }, batchMaxAgeHours: () => 168, body: async () => input, json });
      if (!handled && !res.writableEnded) json(res, 404, { error: 'not found' });
    } catch (error) { if (!res.writableEnded) json(res, 500, { error: error.message }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['scripts/agent-integration/mcp-server.mjs'], {
    cwd: process.cwd(), env: { ...process.env, JIANZI_WORKBENCH_URL: `http://127.0.0.1:${server.address().port}` },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => { child.kill(); await new Promise((resolve) => server.close(resolve)); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  lines.on('line', (line) => { const message = JSON.parse(line); pending.get(message.id)?.(message); pending.delete(message.id); });
  let id = 0;
  const call = (method, params = {}) => new Promise((resolve) => { const next = ++id; pending.set(next, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: next, method, params })}\n`); });
  const initialized = await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.result.serverInfo.name, 'jianzi-workbench');
  const response = await call('tools/call', { name: 'jianzi_research_stage_prepare', arguments: { batchId: batch.id } });
  assert.equal(response.result.isError, false);
  const task = JSON.parse(response.result.content[0].text);
  assert.equal(task.status, 'pending');
  assert.equal(task.stageId, 'discussion-research.reader_screening');
  const bad = await call('tools/call', { name: 'jianzi_research_stage_submit', arguments: { batchId: batch.id, taskId: task.taskId } });
  assert.equal(bad.result.isError, true);
});
