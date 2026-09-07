import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../server/platform/core/store.mjs';
import { applyProjectDiscoveryFeedbackToHeatRanking, applyProjectDiscoveryFeedbackToRanking, buildProjectDiscoveryFeedbackSnapshot } from '../server/features/content-planning/project-discovery-feedback.mjs';

function row(id, scenario, reads, type = 'tool') {
  return { match_status: 'confirmed', content_type: 'social', metric_id: id, import_batch_id: `import-${id}`, metric_title: `项目 ${id}`, published_date: `2026-08-${String(id).padStart(2, '0')}`, reads, shares: Math.round(reads / 100), follows_after_read: Math.round(reads / 1000), content_class: 'github_project', hotspot_url: `https://github.com/acme/project-${id}`, hotspot_raw_json: JSON.stringify({ repository: `acme/project-${id}`, projectType: type, scenarioIds: [scenario], directUseCase: '处理日常工作' }) };
}

test('项目发现反馈按场景和项目类型聚合，并只对达到样本门槛的分组提出调整', () => {
  const rows = [...Array.from({ length: 5 }, (_, index) => row(index + 1, 'file-content', 2000)), ...Array.from({ length: 5 }, (_, index) => row(index + 6, 'terminal-remote', 500))];
  const feedback = buildProjectDiscoveryFeedbackSnapshot(rows);
  assert.equal(feedback.sample_count, 10);
  assert.equal(feedback.matched_project_count, 10);
  assert.equal(feedback.can_apply, true);
  assert.ok(feedback.adjustments.scenarios.some((item) => item.id === 'file-content' && item.delta === 5));
  assert.ok(feedback.adjustments.scenarios.some((item) => item.id === 'terminal-remote' && item.delta === -3));
});

test('项目发现反馈不足时只生成观察结果，不允许应用', () => {
  const feedback = buildProjectDiscoveryFeedbackSnapshot([row(1, 'file-content', 1000)]);
  assert.equal(feedback.can_apply, false);
  assert.match(feedback.unresolved_questions.join(' '), /少于/);
});

test('人工确认后的反馈只对 GitHub 项目榜增加有限偏置', () => {
  const feedback = { adjustments: { scenarios: [{ id: 'file-content', delta: 5 }], project_types: [] } };
  const ranking = applyProjectDiscoveryFeedbackToRanking([
    { eventId: 'E1', title: '项目一', contentClass: 'github_project', finalPreScore: 40, eventValue: 40, t: 40, repositoryMeta: { projectType: 'tool', scenarioIds: ['file-content'] } },
    { eventId: 'E2', title: '事件二', contentClass: 'news_event', finalPreScore: 42, eventValue: 42, t: 42 },
  ], feedback);
  assert.equal(ranking[0].eventId, 'E1');
  assert.equal(ranking[0].repositoryMeta.projectFeedbackAdjustment, 5);
  const heat = applyProjectDiscoveryFeedbackToHeatRanking({ items: [{ eventId: 'E1', contentClass: 'github_project', scoreValue: 40, heatScore: 40, repositoryMeta: { projectType: 'tool', scenarioIds: ['file-content'] } }, { eventId: 'E2', contentClass: 'news_event', scoreValue: 42, heatScore: 42 }], rankings: {} }, feedback);
  assert.equal(heat.items[0].eventId, 'E1');
  assert.equal(heat.items[0].scoreValue, 45);
});

test('项目发现反馈快照支持待确认、已应用和历史读取', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-discovery-feedback-'));
  let store;
  try {
    store = new Store(path.join(root, 'workbench.db'));
    const saved = store.saveGithubProjectFeedbackSnapshot({ sample_count: 5, matched_project_count: 5, confidence: 'medium', can_apply: true, adjustments: { scenarios: [{ id: 'file-content', delta: 5 }] } });
    assert.equal(saved.status, 'pending');
    assert.equal(store.updateGithubProjectFeedbackSnapshotStatus(saved.id, 'applied').status, 'applied');
    assert.equal(store.getLatestAppliedGithubProjectFeedbackSnapshot().id, saved.id);
    assert.equal(store.listGithubProjectFeedbackSnapshots().length, 1);
  } finally {
    store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
