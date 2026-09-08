import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collection-run-trace-'));
  const store = new Store(path.join(root, 'workbench.db'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return store;
}

test('采集任务日志关联 Workflow Trace 和来源执行明细', (t) => {
  const store = workspace(t);
  const batch = store.createBatch({ date: '2026-09-06', title: '采集 Trace' });
  const rootRunId = 'job:collection-trace';
  store.startAgentRun({ id: rootRunId, entryPoint: 'collection', skillId: 'collection', batchId: batch.id,
    provider: 'test', rootRunId, workflowRunId: rootRunId, stageId: 'collect' });
  store.startAgentRun({ id: 'stage:collection:github', entryPoint: 'collection', skillId: 'github-query-plan', batchId: batch.id,
    provider: 'test', rootRunId, workflowRunId: rootRunId, stageId: 'github-query-plan', parentRunId: rootRunId });
  const sourceRunId = store.startSourceRun(batch.id, 'reddit', { rootRunId, workflowRunId: rootRunId, stageId: 'source:reddit' });
  store.finishSourceRun(sourceRunId, 'success', 3);
  store.recordSubscriptionRun(batch.id, { sourceGroup: 'reddit', sourceType: 'reddit', sourceKey: 'reddit:r/test', sourceName: '测试来源', status: 'success', itemCount: 3, durationMs: 12, rootRunId, workflowRunId: rootRunId, stageId: 'collect' }, { indexFailure: false });
  store.finishAgentRun(rootRunId, { status: 'completed' });

  const collectionLogs = store.listLogs({ logType: 'collection' });
  assert.equal(collectionLogs.length, 1);
  const [log] = collectionLogs;
  assert.equal(log.log_type, 'collection');
  assert.equal(log.root_run_id, rootRunId);
  assert.equal(log.agent_run_id, rootRunId);
  assert.equal(store.listLogs().some((item) => item.log_type === 'source'), false);

  const trace = store.getWorkflowRunTrace(rootRunId);
  assert.equal(trace.schemaVersion, 3);
  assert.equal(trace.sourceRuns.length, 1);
  assert.equal(trace.sourceRuns[0].source, 'reddit');
  assert.equal(trace.subscriptionRuns.length, 1);
  assert.equal(trace.subscriptionRuns[0].source_name, '测试来源');
});

test('Workflow Trace 链路存在失败时优先标记失败，不被根 Run 的 completed 覆盖', (t) => {
  const store = workspace(t);
  const batch = store.createBatch({ date: '2026-09-06', title: '失败优先级 Trace' });
  const rootRunId = 'job:failed-trace';
  const stageRunId = 'stage:failed-trace';
  store.startAgentRun({ id: rootRunId, entryPoint: 'collection', batchId: batch.id, provider: 'test', rootRunId, workflowRunId: rootRunId, stageId: 'collect' });
  store.startAgentRun({ id: stageRunId, entryPoint: 'collection', batchId: batch.id, provider: 'test', rootRunId, workflowRunId: rootRunId, stageId: 'source:reddit', parentRunId: rootRunId });
  store.finishAgentRun(stageRunId, { status: 'failed', error: '来源执行失败' });
  store.finishAgentRun(rootRunId, { status: 'completed' });

  const trace = store.getWorkflowRunTrace(rootRunId);
  assert.equal(trace.status, 'failed');
  assert.equal(store.listLogs({ logType: 'collection' })[0].status, 'failed');
  assert.equal(store.listLogs({ logType: 'collection' })[0].workflow_status, 'failed');
});
