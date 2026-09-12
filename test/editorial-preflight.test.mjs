import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEditorialPreflight } from '../server/features/articles/application/editorial-preflight.mjs';
import { readArticleSourceInput } from '../server/features/articles/application/article-pipeline-contract.mjs';

function candidate() {
  return {
    id: 7,
    batch_id: 'batch-preflight-test',
    candidate_id: 'C001',
    hotspot_id: 11,
    hotspot_title: '测试选题',
    url: 'https://example.com/story',
    category: '科技',
    content_class: 'news_event',
    editorial_mode: 'manual',
    pool_role: '人工补选',
    tracks: [{ track: 'article', pool_role: '人工补选' }],
    angle: '从责任边界分析功能上线',
    thesis: '功能上线不等于责任边界已经解决',
    article_eligible: 1,
    content_route: 'article',
    editorial: {
      confirmed_facts: '官方公告与报道已经确认该功能上线。',
      author_opinions: '我认为真正值得讨论的是上线后的责任边界。',
      material_brief: {
        reader_consequence: '读者需要重新判断自己的使用成本。',
        conflict: '平台扩大覆盖，用户承担迁移成本。',
      },
      forbidden_claims: '',
      adopted_research_points: [],
      research_basis: '',
    },
  };
}

test('编辑室预检在来源未备料时阻断且不调用事实基座模型', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-preflight-'));
  const item = candidate();
  const artifacts = [];
  let calls = 0;
  const store = {
    getCandidate: () => item,
    getBatch: () => ({ id: item.batch_id, batch_date: '2026-09-12' }),
    upsertArtifact: (artifact) => artifacts.push(artifact),
  };
  const result = await runEditorialPreflight({
    gateway: { complete: async () => { calls += 1; return { content: '{}' }; } },
    store,
    candidate: item,
    candidateId: item.id,
    batchId: item.batch_id,
    workspaceRoot: root,
    events: [],
    researchContext: {},
  });

  assert.equal(result.ready, false);
  assert.equal(calls, 0);
  assert.equal(result.gates.find((gate) => gate.id === 'source-cache').passed, false);
  assert.equal(result.gates.length, 6);
  assert.equal(artifacts.some((artifact) => artifact.name === 'editorial-preflight.json'), true);
});

test('编辑室补充来源持久化后可在缺少主热点缓存时供预检读取', () => {
  const item = candidate();
  const source = readArticleSourceInput({
    candidate: item,
    workspaceRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-source-input-')),
    store: { listCandidateSources: () => [{ url: 'https://example.com/supplement', final_url: 'https://example.com/supplement', status: 'ok', title: '补充原文', content: '可核对的补充正文' }] },
  });
  assert.equal(source.issue, null);
  assert.match(source.sourceText, /可核对的补充正文/);
  assert.deepEqual(source.sourceUrls, [item.url, 'https://example.com/supplement']);
});

test('主来源 URL 不匹配只作为警告，不阻断已有正文', () => {
  const item = candidate();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-source-warning-'));
  fs.mkdirSync(path.join(root, 'data', 'source-cache'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'source-cache', `${item.hotspot_id}.json`), JSON.stringify({ url: 'https://other.example.com/story', content: '已有正文' }));
  const source = readArticleSourceInput({ candidate: item, workspaceRoot: root, store: { listCandidateSources: () => [] } });
  assert.equal(source.issue, null);
  assert.match(source.warning, /来源缓存与热点原文不一致/);
});
