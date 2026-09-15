import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citationPolicyForStance,
  deriveWritingStance,
  visualPolicyForStance,
  stanceOverlay,
} from '../server/shared/domain/writing-stance.mjs';
import { buildMaterialBrief } from '../server/shared/domain/material-brief.mjs';
import { buildPublicationClaimRegister, enrichFactBaseClaims } from '../server/features/articles/domain/publication-compliance.mjs';

test('文章类型默认推导写作立场，显式立场优先', () => {
  assert.equal(deriveWritingStance({ articleType: 'wechat-mp-personal-writing' }).stance, 'opinion');
  assert.equal(deriveWritingStance({ articleType: 'wechat-mp-personal-writing', explicit: 'report' }).stance, 'report');
  assert.equal(deriveWritingStance({ articleType: 'wechat-mp-tech-deep' }).stance, 'analysis');
});

test('观点文默认采用簇级归因并关闭自动图表', () => {
  assert.equal(citationPolicyForStance('opinion'), 'cluster');
  const visual = visualPolicyForStance({ stance: 'opinion', articleType: 'wechat-mp-personal-writing' });
  assert.equal(visual.policy, 'off');
  assert.match(stanceOverlay('opinion'), /不重复“据该来源”/);
});

test('编辑底稿中的写作立场会进入规范化 material brief', () => {
  const brief = buildMaterialBrief({
    candidate: { thesis: '判断一个变化的影响' },
    editorial: { material_brief: { writing_stance: 'opinion' } },
  });
  assert.equal(brief.writing_stance, 'opinion');
});

test('事实基座登记按来源簇保留审计字段，观点表达不丢失来源追溯', () => {
  const factBase = { claims: [
    { id: 'c1', claim: '事件发生', status: 'verified', sourceUrl: 'https://example.com/a', sourceTitle: '来源甲' },
    { id: 'c2', claim: '参与方回应', status: 'verified', sourceUrl: 'https://example.com/a', sourceTitle: '来源甲' },
    { id: 'c3', claim: '作者判断', status: 'opinion', sourceType: 'author' },
  ] };
  const enriched = enrichFactBaseClaims(factBase, { citationPolicy: 'cluster' });
  assert.equal(enriched.claims[0].source_group_id, enriched.claims[1].source_group_id);
  assert.equal(enriched.claims[0].visible_citation, 'cluster');
  assert.equal(enriched.claims[2].evidence_kind, 'author_material');
  assert.equal(buildPublicationClaimRegister(factBase, { citationPolicy: 'cluster' })[0].sourceGroupId, enriched.claims[0].source_group_id);
});
