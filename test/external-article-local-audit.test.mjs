import test from 'node:test';
import assert from 'node:assert/strict';
import { auditExternalArticleLocally } from '../server/features/articles/application/external-article-local-audit.mjs';
import { buildArticleFactBaseRequest } from '../server/features/articles/application/article-pipeline.mjs';
import { ARTICLE_PROMPTS } from '../server/features/articles/application/article-prompts.mjs';

test('外部文章本地检查复用文章结构与字数规则，明确保留事实复核', () => {
  const invalid = auditExternalArticleLocally({ article: '没有一级标题的正文' });
  assert.match(invalid.outputIssue, /一级标题/);
  assert.equal(invalid.length.valid, false);
  const valid = auditExternalArticleLocally({ article: `# 测试标题\n\n${'内容'.repeat(750)}` });
  assert.equal(valid.outputIssue, null);
  assert.equal(valid.length.valid, true);
  assert.equal(valid.scope, 'local_checks_only');
  assert.equal(valid.requiresEvidenceReview, true);
});

test('文章事实基座共用内部提示词并保留来源和编辑约束', () => {
  const request = buildArticleFactBaseRequest({ batchId: 'batch', candidateId: 1, brief: {
    topic: '测试话题', sourceText: '来源原文', sourceUrl: 'https://example.com',
    confirmedFacts: '已确认事实', forbiddenClaims: '不得虚构', researchBasis: '研判依据',
  } });
  assert.equal(request.messages[0].content, ARTICLE_PROMPTS.facts);
  const input = JSON.parse(request.messages[1].content);
  assert.equal(input.sourceText, '来源原文');
  assert.equal(input.forbiddenClaims, '不得虚构');
  assert.equal(input.researchBasis, '研判依据');
});
