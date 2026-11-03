import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/platform/core/store.mjs';
import { batchTopicsDir } from '../server/platform/core/workspace-paths.mjs';
import { resolveStableBatchEvents } from '../server/features/research/application/stable-event-service.mjs';
import { createCandidateSelectionService } from '../server/features/research/application/store-service-factory.mjs';
import { advanceExternalResearch } from '../server/features/research/application/external-research-stage-bridge.mjs';
import { handleTaskRoutes } from '../server/platform/http/routes/task-routes.mjs';

test('阶段提交缺少结果时返回错误而非领取新任务', async () => {
  let received;
  await handleTaskRoutes({ request: { method: 'POST' }, response: {},
    pathname: '/api/batches/example/external/research-stage/submit',
    store: { getBatch: () => ({ id: 'example' }) }, body: async () => ({ taskId: 'task' }),
    json: (_response, status, data) => { received = { status, data }; } });
  assert.equal(received.status, 400);
  assert.match(received.data.error, /taskId 和 output/);
});

test('外部研判在无模型配置时领取原 pipeline 任务并在提交后继续', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-research-'));
  const store = new Store(path.join(root, 'workbench.db'), { candidateSelectionServiceFactory:
    ({ db, repositories, candidateQueries }) => createCandidateSelectionService(db, repositories, candidateQueries) });
  let eliminationWrites = 0;
  const saveEliminationReasons = store.saveEliminationReasons.bind(store);
  store.saveEliminationReasons = (...args) => { eliminationWrites += 1; return saveEliminationReasons(...args); };
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const date = new Date().toISOString().slice(0, 10);
  const batch = store.createBatch({ date, title: '外部研判回归' });
  store.addHotspots(batch.id, 'rsshub', [{ id: 'one', title: '某公司发布开发者工具',
    url: 'https://example.com/one', publishedAt: new Date().toISOString(), summary: '工具发布并提供开发者使用文档。' }]);
  const hotspot = store.getBatch(batch.id).hotspots[0];
  store.updateHotspotTags(hotspot.id, { eventKey: '某公司|发布|开发者工具',
    eventParts: { who: '某公司', what: '发布开发者工具' }, category: '🤖 AI/技术动态', chinaRelevance: 12,
    keywords: ['开发者', '工具', '发布', '文档', '使用'],
    preScores: { conflict: 10, audience: 20, informationGain: 10, emotion: 5,
      timeliness: 8, impact: 7, sourceReliability: 8 } });
  const current = store.getBatch(batch.id);
  const events = resolveStableBatchEvents({ store, workspaceRoot: root, batch: current, hotspots: current.hotspots });
  const dir = path.join(batchTopicsDir(root, current), 'sources');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'event-cards.json'), JSON.stringify({ items: events.map((event) => ({
    event_id: event.event_id, title: event.representative_title, conclusion: '开发者工具已发布',
    confirmed_facts: [`${date} 发布公告已公开`, '工具面向开发者', '公开文档已发布'],
    timeline: [{ time: date, fact: '公开发布' }, { time: date, fact: '提供文档' }], disagreements: ['实际使用效果有待验证'] })) }));

  const first = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root, maxAgeHours: 168 });
  assert.equal(first.status, 'pending');
  assert.equal(first.jsonMode, true);
  assert.ok(first.messages.some((message) => message.role === 'system'));
  const again = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root, maxAgeHours: 168 });
  assert.equal(again.taskId, first.taskId);
  const next = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: first.taskId, output: { items: [] } });
  assert.equal(next.status, 'pending');
  assert.notEqual(next.taskId, first.taskId);
  assert.equal(next.stageId, 'discussion-research.single_event');
  const retried = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: first.taskId, output: { items: [] } });
  assert.equal(retried.taskId, next.taskId);
  const retryLedgerPath = path.join(dir, 'external-research-stage-results.json');
  const retryLedger = JSON.parse(fs.readFileSync(retryLedgerPath, 'utf8'));
  const savedHash = retryLedger.responses[0].requestHash;
  retryLedger.responses[0].requestHash = 'changed';
  fs.writeFileSync(retryLedgerPath, JSON.stringify(retryLedger));
  await assert.rejects(advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: next.taskId, output: '报告' }), { code: 'EXTERNAL_STAGE_REPLAY_CONFLICT' });
  const afterFailure = JSON.parse(fs.readFileSync(retryLedgerPath, 'utf8'));
  assert.equal(afterFailure.pending.taskId, next.taskId);
  assert.equal(afterFailure.responses.length, 1);
  afterFailure.responses[0].requestHash = savedHash;
  fs.writeFileSync(retryLedgerPath, JSON.stringify(afterFailure));
  const report = `# 事件研判报告

## 事件内研判

### 反常
- 结论：公开公告已经发布；预期：开发者期待工具；观察：功能刚上线；落差：实际效果尚无验证；为什么值得讨论：读者需要决定是否试用；来源：hotspot:${hotspot.id}

### 利益冲突
- 结论：现有证据不足，暂不判断；来源：hotspot:${hotspot.id}

### 可发散方向
- 方向：验证工具能力；问题：能否完成既定任务？；基线：原有工具；影响：可能影响开发者选择；来源：hotspot:${hotspot.id}

## 事件外研判

### 对比关系
- 当前资料不足，不建立跨事件关系。

## 来源
- [S1] 发布公告｜https://example.com/one｜摘要：工具发布事实
`;
  const topic = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: next.taskId, output: report });
  assert.equal(topic.status, 'pending');
  assert.equal(topic.stageId, 'discussion-research.topic_generation');
  const checkpointFile = path.join(dir, 'discussion-research-stage3-input.json');
  const checkpointText = fs.readFileSync(checkpointFile, 'utf8');
  const alteredCheckpoint = JSON.parse(checkpointText);
  alteredCheckpoint.base_report.mode = 'changed';
  fs.writeFileSync(checkpointFile, JSON.stringify(alteredCheckpoint));
  await assert.rejects(advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root, maxAgeHours: 168 }),
    /阶段快照已变化/);
  fs.writeFileSync(checkpointFile, checkpointText);
  const completed = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: topic.taskId, output: { topic_candidates: [],
      event_coverage: [{ event_id: events[0].event_id, status: 'uncovered', candidate_indexes: [], reason: '证据不足' }] } });
  assert.equal(completed.status, 'completed');
  assert.ok(fs.existsSync(path.join(dir, 'social-card-ranking.json')));
  assert.ok(fs.existsSync(path.join(dir, 'topic-preselection-ranking.json')));
  const previousEliminationWrites = eliminationWrites;
  const saved = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root, maxAgeHours: 168 });
  assert.equal(saved.status, 'completed');
  const ledgerPath = path.join(dir, 'external-research-stage-results.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.completed = null;
  ledger.responses[ledger.checkpoint.offset].requestHash = 'changed';
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  await assert.rejects(advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root, maxAgeHours: 168 }),
    { code: 'EXTERNAL_STAGE_REPLAY_CONFLICT' });
  const restarted = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, reset: true });
  assert.equal(restarted.status, 'pending');
  assert.notEqual(restarted.taskId, first.taskId);
  const nextReport = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: restarted.taskId, output: { items: [] } });
  const nextTopic = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: nextReport.taskId, output: report });
  const brainstorm = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: nextTopic.taskId, output: { topic_candidates: [{
      candidate_title: '开发者工具发布后如何验证可用性', event_ids: [events[0].event_id],
      core_question: '如何验证新工具适用场景？', angle: '从开发者的使用成本切入', thesis_seed: '工具发布后仍需验证实际可用性',
      target_reader: '开发者', click_reason: '判断新工具是否适合自己的工作', title_hook: '如何验证可用性',
      reader_payoff: '获得核验工具实际使用成本的思路', reader_entry_score: 16,
      material_ids: [`RM-discussion_report-${events[0].event_id}`], timeliness_status: 'current',
      freshness_date: date, freshness_basis: '发布公告记录了近期动作', freshness_source_ids: [`hotspot:${hotspot.id}`],
      answerability_status: 'answerable', answerability_basis: '公告与事件研判提供了核验依据' }],
    event_coverage: [{ event_id: events[0].event_id, status: 'covered', candidate_indexes: [1] }] } });
  assert.equal(brainstorm.status, 'pending');
  assert.equal(brainstorm.stageId, 'hotspot-brainstorm-explore');
  assert.equal(eliminationWrites, previousEliminationWrites);
  const synthesis = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: brainstorm.taskId, output: { items: [{ candidateId: 'C001', status: 'PASS',
      angle: '验证工具适用场景', thesis: '需要验证工具的实际使用成本',
      hypotheses: [{ claim: '工具支持开发者使用', support: '公开公告', verify: '核查文档', readerValue: '了解使用边界' }],
      packaging: { distributionLane: '实验池', readerStake: '开发者可判断工具是否适合自己的工作',
        readerStakeScore: 5, readerTarget: '开发者', readerAction: '核查工具文档' },
      bScores: { angleUniqueness: 4, emotionSpread: 3, titleHook: 4, readerStakeScore: 5, factSupport: 5 },
      hProfile: { historicalType: 'technology', fiveSenseCount: 2, fiveQuestionCount: 4, recommendationFit: 5,
        emotionTheme: 2, searchFriendly: 4 } }] } });
  assert.equal(synthesis.status, 'pending');
  assert.equal(synthesis.stageId, 'hotspot-synthesis-provisional');
  const positive = await advanceExternalResearch({ store, batchId: batch.id, workspaceRoot: root,
    maxAgeHours: 168, taskId: synthesis.taskId, output: { items: [{ candidateId: 'C001',
      saturationPenalty: 0, duplicatePenalty: 0, readerStakeScore: 5, reason: '读者有明确的验证需求' }] } });
  assert.equal(positive.status, 'completed');
  assert.equal(eliminationWrites, previousEliminationWrites + 1);
  assert.ok(store.listCandidates(batch.id, 'article').length > 0);
  assert.ok(store.listCandidates(batch.id, 'social_cards').length > 0);
});
