import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildArticleReviewIssueReport } from '../server/features/articles/application/article-review-issues.mjs';
import { handleArticleRoutes } from '../server/platform/http/routes/article-routes.mjs';

test('文章待修订报告汇总标题、质量和发布合规问题', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'article-review-issues-'));
  try {
    const files = new Map([
      ['03-title-risk.json', { titleBlockers: ['标题需要明确这是作者判断'] }],
      ['06-review-quality-gate.json', { pass: false, issues: [{ type: 'publication_compliance', message: '正文需要补充作者判断限定' }] }],
      ['08-quality-gate.json', { pass: false, issues: [{ type: 'citation', message: 'claim-6 缺少 sourceUrl', repair: '补充官方来源链接' }] }],
      ['10-publication-compliance.json', { scan: { titleBlockers: [] }, gate: { pass: false, issues: [{ type: 'fact', message: '存在未经核验的新增断言' }] } }],
    ]);
    const artifacts = [...files.entries()].map(([name, content], index) => {
      const filePath = path.join(tempRoot, name);
      fs.writeFileSync(filePath, JSON.stringify(content), 'utf8');
      return { id: index + 1, name, file_path: filePath };
    });
    const report = buildArticleReviewIssueReport({ document: { id: 7, status: 'needs_review' }, artifacts });
    assert.deepEqual(report.groups.map((item) => item.label), ['标题', '发布合规', '引用', '事实']);
    assert.equal(report.issueCount, 4);
    assert.equal(report.issues.find((item) => item.type === 'citation').repair, '补充官方来源链接');

    const finalized = buildArticleReviewIssueReport({ document: { id: 7, status: 'finalized' }, artifacts });
    assert.equal(finalized.issueCount, 0);
    assert.deepEqual(finalized.issues, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('文章文稿接口暴露待修订问题明细', async () => {
  let response = null;
  const filePath = path.join(os.tmpdir(), `article-review-route-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ gate: { pass: false, issues: [{ type: 'publication_compliance', message: '作者观点需要限定' }] } }), 'utf8');
  try {
    const handled = await handleArticleRoutes({
      request: { method: 'GET' },
      response: {},
      pathname: '/api/documents/7/review-issues',
      store: {
        getDocumentById: () => ({ id: 7, batch_id: 'batch-1', candidate_row_id: 9, status: 'needs_review' }),
        listArtifacts: () => [{ id: 3, name: '10-publication-compliance.json', file_path: filePath, candidate_row_id: 9 }],
      },
      json: (_response, status, data) => { response = { status, data }; },
    });
    assert.equal(handled, undefined);
    assert.equal(response.status, 200);
    assert.equal(response.data.issues[0].message, '作者观点需要限定');
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});
