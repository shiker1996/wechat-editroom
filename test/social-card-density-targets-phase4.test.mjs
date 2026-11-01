import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSocialCardDensityTargets, resolveSocialCardDensityTarget } from '../server/features/social-cards/rendering/social-card-density-targets.mjs';

test('阶段 4 角色目标利用率区分普通页、续页和封面', () => {
  assert.equal(resolveSocialCardDensityTarget({ kind: 'content', role: 'feature' }), 0.72);
  assert.equal(resolveSocialCardDensityTarget({ kind: 'content', role: 'feature', continuation_index: 2 }), 0.62);
  assert.equal(resolveSocialCardDensityTarget({ kind: 'content', role: 'steps' }), 0.68);
  assert.equal(resolveSocialCardDensityTarget({ kind: 'cover' }), 0.45);
});

test('阶段 4 只把硬门禁通过但视觉偏空的页面标为校准目标', () => {
  const report = { pages: [
    { page: 1, valid: true, utilization: 59, issues: [] },
    { page: 2, valid: false, utilization: 43, issues: ['underfilled'] },
    { page: 3, valid: false, utilization: 40, issues: ['overflow'] },
  ] };
  const plan = [
    { kind: 'content', role: 'feature', content_blocks: [{ type: 'text', content: 'a' }] },
    { kind: 'content', role: 'steps', content_blocks: [{ type: 'steps', items: ['a'] }] },
    { kind: 'content', role: 'feature', content_blocks: [{ type: 'text', content: 'a' }] },
  ];
  const result = assessSocialCardDensityTargets(report, plan, { templatePackId: 'clean-v1' });
  assert.deepEqual(result.pages.map((page) => page.page), [1, 2]);
  assert.equal(result.pages[0].target, 72);
  assert.equal(result.pages[1].target, 68);
});
