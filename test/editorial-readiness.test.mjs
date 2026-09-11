import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEditorialReadiness, resolveEditorialMode } from '../server/features/articles/domain/editorial-readiness.mjs';

function editorial() {
  return {
    confirmed_facts: '官方公告与报道已经确认：该功能在 2026 年 9 月上线。',
    author_opinions: '我认为真正值得讨论的是上线后的责任边界。',
    research_basis: '',
    adopted_research_points: [],
    material_brief: {
      reader_consequence: '读者需要重新判断自己的使用成本和迁移风险。',
      conflict: '平台希望扩大覆盖，用户承担迁移和学习成本。',
    },
    forbidden_claims: '',
  };
}

test('手动补选模式没有研判点时不阻断编辑底稿锁定', () => {
  const candidate = {
    editorial_mode: 'manual',
    pool_role: '人工补选',
    angle: '从责任边界分析功能上线',
    thesis: '功能上线不等于责任边界已经解决',
    tracks: [{ track: 'article', pool_role: '人工补选' }],
  };
  const result = evaluateEditorialReadiness({ candidate, editorial: editorial() });
  assert.equal(resolveEditorialMode(candidate), 'manual');
  assert.equal(result.mode, 'manual');
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.fields.find((field) => field.key === 'adopted_research_points').required, false);
  assert.equal(result.fields.find((field) => field.key === 'research_basis').required, false);
});

test('研判驱动模式仍要求研判点和研判主线', () => {
  const candidate = {
    editorial_mode: 'research',
    pool_role: '核心8条',
    angle: '从责任边界分析功能上线',
    thesis: '功能上线不等于责任边界已经解决',
    tracks: [{ track: 'article', pool_role: '核心8条' }],
    research_context: { candidate_coverage: 'covered' },
  };
  const result = evaluateEditorialReadiness({ candidate, editorial: editorial() });
  assert.equal(resolveEditorialMode(candidate), 'research');
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['采用的研判拓展点', '采用的研判主线']);
});

test('研判分不参与模式判断，只认候选覆盖关系', () => {
  const candidate = {
    editorial_mode: 'research',
    research_value: 0,
    pool_role: '事件热榜研判',
    angle: '从成本变化切入',
    thesis: '成本变化会重新分配收益与代价。',
    tracks: [{ track: 'article', pool_role: '事件热榜研判' }],
    research_context: { candidate_coverage: 'covered' },
  };
  const result = evaluateEditorialReadiness({ candidate, editorial: editorial() });
  assert.equal(resolveEditorialMode(candidate), 'research');
  assert.equal(result.ready, false);
});

test('未命中研判报告候选覆盖关系时按手动模式', () => {
  assert.equal(resolveEditorialMode({
    editorial_mode: 'research',
    research_context: { status: 'no_matching_event', candidate_coverage: 'uncovered' },
  }), 'manual');
});
