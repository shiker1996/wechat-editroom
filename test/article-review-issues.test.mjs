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

    const stale = buildArticleReviewIssueReport({ document: { id: 7, status: 'finalized', review_state: 'unverified' }, artifacts });
    assert.equal(stale.reviewPending, true);
    assert.equal(stale.issueCount, 4);

    const confirmed = buildArticleReviewIssueReport({ document: { id: 7, status: 'finalized', review_state: 'confirmed' }, artifacts });
    assert.equal(confirmed.reviewPending, false);
    assert.equal(confirmed.manualConfirmed, true);
    assert.equal(confirmed.issueCount, 4);
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

test('文稿审核支持启动独立重跑任务', async () => {
  let response = null;
  let started = null;
  const handled = await handleArticleRoutes({
    request: { method: 'POST' },
    response: {},
    pathname: '/api/documents/7/review',
    body: async () => ({ provider: 'deepseek-v4-flash' }),
    store: { getDocumentById: () => ({ id: 7, batch_id: 'batch-1', candidate_row_id: 9, kind: 'final', status: 'finalized' }) },
    aiJobs: { start: (input) => { started = input; return { id: 'job-1', type: 'article-review' }; } },
    json: (_response, status, data) => { response = { status, data }; },
  });
  assert.equal(handled, undefined);
  assert.equal(response.status, 202);
  assert.equal(started.type, 'article-review');
  assert.equal(started.documentKind, 'final');
  assert.equal(started.candidateId, 9);
});

test('编辑人工确认审核建议后将终稿放行但保留审核状态', async () => {
  let response = null;
  let saved = null;
  await handleArticleRoutes({
    request: { method: 'POST' },
    response: {},
    pathname: '/api/documents/7/review-confirm',
    store: {
      getDocumentById: () => ({ id: 7, batch_id: 'batch-1', candidate_row_id: 9, kind: 'final', title: '标题', content: '# 标题\n\n正文', file_path: 'E:/article/09-FINAL.md', status: 'needs_review' }),
      saveDocument: (input) => { saved = input; return { id: 7, status: input.status, review_state: input.reviewState }; },
    },
    json: (_response, status, data) => { response = { status, data }; },
  });
  assert.equal(response.status, 200);
  assert.equal(saved.status, 'finalized');
  assert.equal(saved.reviewState, 'confirmed');
  assert.equal(response.data.review_state, 'confirmed');
});

test('审核接口按文稿目录兼容没有候选关联的历史产物', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'article-review-legacy-'));
  const filePath = path.join(tempRoot, '08-quality-gate.json');
  fs.writeFileSync(filePath, JSON.stringify({ pass: false, issues: [{ type: 'fact', message: '需要处理的历史问题' }] }), 'utf8');
  let response = null;
  try {
    await handleArticleRoutes({
      request: { method: 'GET' },
      response: {},
      pathname: '/api/documents/8/review-issues',
      path,
      store: {
        getDocumentById: () => ({ id: 8, batch_id: 'batch-1', candidate_row_id: 9, status: 'needs_review', file_path: path.join(tempRoot, '09-FINAL.md') }),
        listArtifacts: () => [{ id: 4, name: '08-quality-gate.json', file_path: filePath, candidate_row_id: null }],
      },
      json: (_response, status, data) => { response = { status, data }; },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.issues[0].message, '需要处理的历史问题');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('首次锁题没有编辑室预检缓存时仍可继续成稿', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'editorial-lock-without-preflight-'));
  let response = null;
  const candidate = {
    id: 7,
    batch_id: 'batch-1',
    candidate_id: 'C001',
    hotspot_title: '测试选题',
    content_class: 'news_event',
    content_route: 'article',
    article_eligible: 1,
    editorial_mode: 'manual',
    angle: '从责任边界分析功能上线',
    thesis: '功能上线不等于责任边界已经解决',
    editorial: {
      confirmed_facts: '官方公告确认该功能已经上线。',
      author_opinions: '真正值得讨论的是上线后的责任边界。',
      adopted_research_points: [],
      research_basis: '',
      reader_consequence: '读者需要重新判断自己的使用成本。',
      conflict: '平台扩大覆盖，用户承担迁移成本。',
      forbidden_claims: '',
    },
  };
  let savedEditorial = null;
  try {
    await handleArticleRoutes({
      request: { method: 'POST' },
      response: {},
      pathname: '/api/candidates/7/lock',
      body: async () => ({}),
      root: tempRoot,
      path,
      candidateEventGroups: () => [],
      lockedBrief: () => '# 测试选题\n',
      batchWorkdir: () => tempRoot,
      writeUtf8: (filePath, content) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return { size: Buffer.byteLength(content), modifiedAt: new Date().toISOString() };
      },
      store: {
        getCandidate: () => candidate,
        getBatch: () => ({ id: 'batch-1' }),
        saveEditorial: (_id, editorial) => {
          savedEditorial = editorial;
          candidate.editorial = { ...candidate.editorial, ...editorial };
          return candidate.editorial;
        },
        updateCandidate: () => {},
        updateBatch: () => {},
        upsertArtifact: () => {},
      },
      json: (_response, status, data) => { response = { status, data }; },
    });
    assert.equal(response.status, 200);
    assert.equal(savedEditorial.brief_status, 'LOCKED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
