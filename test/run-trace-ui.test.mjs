import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('日志页面提供 Run Trace 入口并消费聚合指标', () => {
  const html = read('public/index.html');
  const ui = read('public/src/views/logs.js');
  const styles = read('public/assets/styles/topics.css');
  assert.match(html, /id="run-trace-dialog"/);
  assert.match(html, /data-log-type="collection"[^>]*>采集任务/);
  assert.match(ui, /data-open-run-trace/);
  assert.match(ui, /data-cancel-ai-job/);
  assert.match(ui, /\/api\/jobs\/\$\{encodeURIComponent\(cancelButton\.dataset\.cancelAiJob\)\}\/cancel/);
  assert.match(ui, /\/api\/runs\/\$\{encoded\}/);
  assert.match(ui, /\/metrics/);
  assert.match(ui, /Workflow \/ Agent Run/);
  assert.doesNotMatch(ui, /Replay 回放快照/);
  assert.doesNotMatch(ui, /data-trace-extra="replay"/);
  assert.doesNotMatch(ui, /对比另一次运行/);
  assert.doesNotMatch(html, /run-trace-tab[^>]*>摘要/);
  assert.match(ui, /CALL TREE/);
  assert.match(ui, /traceWaterfallEntries/);
  assert.match(ui, /applyTraceSegmentFilter/);
  assert.match(ui, /data-trace-segment/);
  assert.match(ui, /data-trace-ref/);
  assert.match(ui, /traceRecordRef\("model"/);
  assert.match(ui, /traceToolEntries/);
  assert.match(ui, /lifecycleCount/);
  assert.match(ui, /const matchingModel/);
  assert.match(ui, /traceDataFingerprint/);
  assert.match(ui, /startTraceAutoRefresh/);
  assert.match(ui, /RUN_TRACE_POLL_INTERVAL_MS/);
  assert.match(ui, /cache: "no-store"/);
  assert.match(ui, /shouldFollowScrollEnd/);
  assert.match(ui, /data-run-action="cancel"/);
  assert.match(ui, /newRootRunId/);
  assert.match(ui, /正在打开新的 Run Trace/);
  assert.match(ui, /采集 Workflow Trace/);
  assert.match(ui, /const supportsActions = !collectionTrace/);
  assert.match(ui, /sourceRuns/);
  assert.match(html, /id="run-trace-resizer"[^>]*role="separator"/);
  assert.match(ui, /bindTraceOverviewResizer/);
  assert.match(ui, /layout\?\.classList\.add\("has-detail"\)/);
  assert.match(ui, /layout\?\.classList\.remove\("has-detail"\)/);
  assert.match(ui, /applyTraceWaterfallNodeFilter/);
  assert.match(ui, /traceWaterfallExpanded/);
  assert.match(ui, /data-trace-waterfall-id/);
  assert.match(ui, /当前节点及子节点日志/);
  assert.match(ui, /data-focus-model-call/);
  assert.match(ui, /focusTraceModelCall/);
  assert.match(ui, /modelCallId/);
  assert.match(ui, /modelInputForCall/);
  assert.match(ui, /run-trace-detail-input/);
  assert.match(ui, /detailTabButton\("input", "输入"\)/);
  assert.match(styles, /\.run-trace-section-heading\{[^}]*position:sticky/);
  assert.match(ui, /Model Prompt 输入/);
  assert.match(ui, /row\.hidden = !visible;/);
  assert.doesNotMatch(ui, /row\.hidden = !visible \|\| !inFilter/);
  assert.match(html, /id="run-trace-resizer"[^>]*aria-valuemin="0"/);
  assert.match(styles, /\.run-trace-overview\{[^}]*height:var\(--run-trace-overview-height/);
  assert.match(styles, /\.run-trace-overview\{[^}]*min-height:0/);
  assert.match(styles, /\.run-trace-body:not\(\.has-detail\) \.run-trace-content\{[^}]*overflow:auto/);
});

test('技能运行历史共享 Run Trace 详情入口', () => {
  const ui = read('public/src/views/skills.js');
  assert.match(ui, /data-open-run-trace/);
  assert.match(ui, /openRunTrace\(button\.dataset\.openRunTrace\)/);
});

test('统一日志查询返回 Run Trace 关联字段', () => {
  const query = read('server/platform/persistence/queries/workbench-query-service.mjs');
  assert.match(query, /root_run_id, workflow_run_id, agent_run_id, stage_id/);
  assert.match(query, /LEFT JOIN agent_runs ar/);
  assert.match(query, /entry_point='collection'/);
});

test('P1 Run Trace 暴露独立子资源和 Artifact 聚合', () => {
  const routes = read('server/platform/http/routes/system-routes.mjs');
  const runs = read('server/platform/persistence/repositories/agent-run-repository.mjs');
  assert.match(routes, /model-calls\|tool-calls\|artifacts/);
  assert.match(routes, /view === 'artifacts'/);
  assert.match(runs, /const artifacts = artifactWhere.length/);
});

test('日志治理提供可配置留存和立即清理入口', () => {
  const html = read('public/index.html');
  const ui = read('public/src/views/logs.js');
  const routes = read('server/platform/http/routes/system-routes.mjs');
  assert.match(html, /log-governance-model-limit/);
  assert.match(ui, /\/api\/system\/log-governance/);
  assert.match(routes, /pathname === '\/api\/system\/log-governance'/);
});

test('模型调用统一在任务日志查看', () => {
  const html = read('public/index.html');
  const logs = read('public/src/views/logs.js');
  const routes = read('server/platform/http/routes/model-routes.mjs');
  assert.match(html, /id="log-query"/);
  assert.match(html, /id="log-status"/);
  assert.match(html, /data-log-type="model"[^>]*>模型调用/);
  assert.doesNotMatch(logs, /filter\(\(item\) => item\.log_type !== "model"\)/);
  assert.match(logs, /model_call|model-call|模型调用/);
  assert.match(routes, /listModelCalls\(150\)/);
});
