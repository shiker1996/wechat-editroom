import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProjectReaderValuesToHeatRanking,
  evaluateProjectReaderValue,
  scoreProjectReaderValue,
  selectProjectReaderValueCandidates,
} from '../server/features/research/domain/project-reader-value.mjs';

const event = (id, title, score = 80) => ({
  event_id: id,
  representative_title: title,
  repositoryMeta: {
    repository: `owner/${id.toLowerCase()}`,
    description: '一个可运行的开发工具',
    language: 'TypeScript',
    stars: 1200,
    topics: ['cli', 'workflow'],
    projectType: 'tool',
    scenarioIds: ['developer-productivity'],
    directUseCase: '改善日常开发效率',
    discoveryChannels: ['ai-search'],
  },
  articles: [{ title, summary: '工具摘要', source: 'GitHub', url: `https://github.com/owner/${id.toLowerCase()}` }],
  tags: { preScores: { audience: 14 } },
  scoreValue: score,
});

test('项目读者价值按六项维度程序化合成并扣除复杂度与 Agent 惩罚', () => {
  const scored = scoreProjectReaderValue({ eventId: 'E1', dailyFit: 10, quickStart: 10, outcomeClarity: 10,
    reusability: 10, novelty: 10, evidenceQuality: 10, installationFriction: 2, agentPenalty: 5 });
  assert.equal(scored.projectReaderValue, 93);
  assert.equal(scored.scoreParts.dailyFit, 35);
  assert.equal(scored.scoreParts.agentPenalty, 5);
});

test('项目读者价值只选项目榜 Top-K 候选', () => {
  const candidates = selectProjectReaderValueCandidates({
    clusters: [event('E1', '项目一'), event('E2', '项目二'), event('E3', '项目三')],
    eventHeatRanking: { rankings: { github_project: { items: [
      { eventId: 'E2', scoreValue: 90 }, { eventId: 'E1', scoreValue: 80 }, { eventId: 'E3', scoreValue: 70 },
    ] } } },
    topK: 5,
  });
  assert.deepEqual(candidates.map((item) => item.eventId), ['E2', 'E1', 'E3']);
});

test('项目读者价值模型调用返回结构化结果，失败不阻塞候选链', async () => {
  const calls = [];
  const gateway = { complete: async (request) => {
    calls.push(request);
    return { content: JSON.stringify({ results: [{ eventId: 'E1', dailyFit: 9, quickStart: 8, outcomeClarity: 9,
      reusability: 8, novelty: 7, evidenceQuality: 8, installationFriction: 1, agentPenalty: 0,
      confidence: 0.9, whyRead: '能直接改善开发效率', directUseCase: '处理日常开发任务', limitations: '需本地安装' }] }), callId: 12, usage: { total_tokens: 100 } };
  } };
  const result = await evaluateProjectReaderValue({ gateway, workspaceRoot: process.cwd(), projects: [event('E1', '项目一')], topK: 5 });
  assert.equal(result.status, 'completed');
  assert.equal(result.results[0].projectReaderValue, 83);
  assert.equal(calls[0].purpose, 'project-reader-value');
  assert.equal(calls[0].jsonMode, true);
});

test('项目图文榜使用 Top-K 读者价值重排，但保留原项目发现分', () => {
  const ranked = applyProjectReaderValuesToHeatRanking({ rankings: { github_project: { items: [
    { eventId: 'E1', scoreValue: 90, previousRank: 1 }, { eventId: 'E2', scoreValue: 80, previousRank: 2 },
  ] } } }, [{ eventId: 'E2', projectReaderValue: 95, scoreParts: {}, whyRead: '实用', limitations: '' }]);
  assert.deepEqual(ranked.rankings.github_project.items.map((item) => item.eventId), ['E2', 'E1']);
  assert.equal(ranked.rankings.github_project.items[0].scoreValue, 95);
  assert.equal(ranked.rankings.github_project.items[0].projectDiscoveryScore, 80);
  assert.equal(ranked.rankings.github_project.items[0].scoreModel, 'projectReaderValue-v1');
});
