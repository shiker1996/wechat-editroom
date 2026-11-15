import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { batchTopicsDir } from '../server/platform/core/workspace-paths.mjs';
import { resolveStableBatchEvents } from '../server/features/research/application/stable-event-service.mjs';
import { handleTaskRoutes } from '../server/platform/http/routes/task-routes.mjs';

test('外部事件卡超过 200 张时可分批提交并完成覆盖', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-cards-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const date = new Date().toISOString().slice(0, 10);
  const batch = store.createBatch({ date, title: '大批次事件卡' });
  store.addHotspots(batch.id, 'rsshub', Array.from({ length: 201 }, (_, i) => ({
    id: `item-${i}`, title: `企业${i}发布产品`, url: `https://example.com/${i}`,
    publishedAt: new Date().toISOString(),
  })));
  let untagged;
  await handleTaskRoutes({ request: { method: 'GET' }, response: {},
    pathname: `/api/batches/${batch.id}/external/events`, store, config: { workspaceRoot: root },
    batchMaxAgeHours: () => 168, json: (_res, status, data) => { untagged = { status, data }; } });
  assert.equal(untagged.status, 409);
  assert.match(untagged.data.error, /201 条热点缺少完整语义标注/);
  for (const item of store.getBatch(batch.id).hotspots) {
    store.updateHotspotTags(item.id, { eventKey: `企业${item.id}|发布|产品`,
      eventParts: { who: `企业${item.id}`, what: '发布产品' }, preScores: { audience: 10 } });
  }
  const current = store.getBatch(batch.id);
  const events = resolveStableBatchEvents({ store, workspaceRoot: root, batch: current, hotspots: current.hotspots });
  assert.equal(events.length, 201);
  async function submit(items) {
    let result;
    await handleTaskRoutes({ request: { method: 'POST' }, response: {},
      pathname: `/api/batches/${batch.id}/external/event-cards`, store, config: { workspaceRoot: root },
      batchWorkdir: (b) => batchTopicsDir(root, b), batchMaxAgeHours: () => 168,
      body: async () => ({ items }), json: (_res, status, data) => { result = { status, data }; } });
    return result;
  }
  const cards = events.map((event) => ({ event_id: event.event_id, conclusion: '发布事实已确认' }));
  const first = await submit(cards.slice(0, 200));
  assert.equal(first.status, 200);
  assert.equal(first.data.remaining, 1);
  const second = await submit(cards.slice(200));
  assert.equal(second.status, 200);
  assert.equal(second.data.completed, 201);
  assert.equal(second.data.remaining, 0);
});

test('直接外部研判按共享 v3 公式计分并只在报告顶层记录版本', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-research-score-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const date = new Date().toISOString().slice(0, 10);
  const batch = store.createBatch({ date, title: '外部研判评分' });
  store.addHotspots(batch.id, 'rsshub', [{ id: 'one', title: '公司发布工具', url: 'https://example.com/tool',
    category: '🤖 AI/技术动态', market_scope: '全球性', publishedAt: new Date().toISOString() }]);
  const hotspot = store.getBatch(batch.id).hotspots[0];
  store.updateHotspotTags(hotspot.id, { eventKey: '公司|发布|工具', eventParts: { who: '公司', what: '发布工具' },
    preScores: { audience: 10 }, chinaRelevance: 9 });
  const current = store.getBatch(batch.id);
  const events = resolveStableBatchEvents({ store, workspaceRoot: root, batch: current, hotspots: current.hotspots });
  const dir = path.join(batchTopicsDir(root, current), 'sources');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'event-cards.json'), JSON.stringify({ items: events.map((event) => ({
    event_id: event.event_id, conclusion: '公司发布工具' })) }));
  fs.writeFileSync(path.join(dir, 'event-heat-ranking.json'), JSON.stringify({ items: events.map((event) => ({
    eventId: event.event_id, eventValue: 80 })) }));
  let result;
  await handleTaskRoutes({ request: { method: 'POST' }, response: {},
    pathname: `/api/batches/${batch.id}/external/research`, store, config: { workspaceRoot: root },
    batchWorkdir: (item) => batchTopicsDir(root, item), batchMaxAgeHours: () => 168,
    body: async () => ({ items: [{ eventId: events[0].event_id, hotspotIds: [Number(hotspot.id)], thesis: '工具改变开发流程', reason: '已有事实卡支持',
      scoreInputs: { H: 70, B: 80, J: 60, saturationPenalty: 0, duplicatePenalty: 0 } }] }),
    json: (_response, status, data) => { result = { status, data }; } });
  assert.equal(result.status, 200);
  assert.equal(result.data.ranking[0].P, 25);
  assert.equal(result.data.ranking[0].DOM, 75);
  assert.ok(result.data.ranking[0].scoreWeightWarnings.some((warning) => warning.includes('未配置 accountFit')));
  assert.equal(Object.hasOwn(result.data.ranking[0], 'formulaVersion'), false);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'external-research-report.json'), 'utf8'));
  assert.equal(report.formulaVersion, 'v3');
  assert.equal(Object.hasOwn(report.items[0].scoreBreakdown, 'formulaVersion'), false);
});
