import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../../server/platform/core/store.mjs';
import { setCredentialFields } from '../../server/platform/tools/remote-credentials.mjs';
import { startFakeModel, startFakeRssHub } from './support/fake-upstreams.mjs';
import { startWorkbench, waitForJob, writeFixtureConfig } from './support/workbench-process.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../..');

function prepareWorkspace(root) {
  const workspaceRoot = path.join(root, 'workspace');
  const configRoot = path.join(root, 'config');
  fs.mkdirSync(path.join(workspaceRoot, 'data', 'source-cache'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'skills'), path.join(workspaceRoot, 'skills'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'data', 'installed-skills'), path.join(workspaceRoot, 'data', 'installed-skills'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'data', 'skill-packages.json'), path.join(workspaceRoot, 'data', 'skill-packages.json'));
  return { workspaceRoot, configRoot, databasePath: path.join(workspaceRoot, 'data', 'workbench.db') };
}

function fixtureConfig({ workspaceRoot, rsshub, model }) {
  return {
    workspaceRoot,
    rsshub: { baseUrl: rsshub.baseUrl, rootDir: path.join(projectRoot, 'RSSHub'), keepAlive: true, maxAgeHours: 168, allowUndated: true },
    llm: { defaultProvider: 'fixture', providers: { fixture: { label: 'E2E Fixture', baseUrl: model.baseUrl, protocol: 'chat_completions', model: 'fixture', apiKeyEnv: 'E2E_FIXTURE_KEY', contextWindow: 32000, maxOutputTokens: 16000, supportsJsonMode: true, supportsNativeTools: true, supportsThinkingToggle: true, enabled: true } } },
  };
}

function configureCollection(store, rsshub) {
  store.saveExtensionSetting({ extensionType: 'collector', extensionId: 'rsshub-collector', value: { baseUrl: rsshub.baseUrl, rootDir: path.join(projectRoot, 'RSSHub'), keepAlive: true, maxAgeHours: 168, allowUndated: true, concurrency: 2 }, configured: true, status: 'ready' });
  return store.upsertCollectionSource({ pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'rsshub', sourceKey: 'rsshub:/e2e/news', label: 'E2E 异常固定来源', config: { route: '/e2e/news?limit=30' }, enabled: true, origin: 'e2e' });
}

async function closeAndRemove(root, workbench, ...upstreams) {
  await workbench?.close();
  for (const upstream of upstreams.reverse()) await upstream?.close();
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may release SQLite handles shortly after the child exits. */ }
}

test('真实采集链路：RSS HTTP 503 会使任务失败并阻断批次', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-e2e-rss-failure-'));
  const { workspaceRoot, configRoot, databasePath } = prepareWorkspace(root);
  const rsshub = await startFakeRssHub({ status: 200, routeStatus: 503 });
  const model = await startFakeModel();
  let workbench;
  try {
    const store = new Store(databasePath);
    const batch = store.createBatch({ date: '2026-09-12', title: 'E2E RSS 异常', requestedTracks: ['article'] });
    const source = configureCollection(store, rsshub);
    assert.equal(source.config.route, '/e2e/news?limit=30');
    setCredentialFields(configRoot, 'fixture', 'model-provider-fixture', { apiKey: 'fixture-key' });
    setCredentialFields(configRoot, 'fixture', 'model-connection-fixture', { apiKey: 'fixture-key' });
    store.close();
    writeFixtureConfig(configRoot, fixtureConfig({ workspaceRoot, rsshub, model }));
    workbench = await startWorkbench({ projectRoot, workspaceRoot, configRoot, port: 0 });
    const sources = await workbench.api('/api/collection-sources');
    assert.equal(sources.items.find((item) => item.source_key === 'rsshub:/e2e/news')?.config?.route, '/e2e/news?limit=30');

    const collect = await workbench.api(`/api/batches/${batch.id}/collect`, { method: 'POST', body: { provider: 'fixture' } });
    await assert.rejects(waitForJob(workbench.api, collect.id, { timeoutMs: 30000, intervalMs: 10 }), /失败/);
    const job = await workbench.api(`/api/jobs/${collect.id}`);
    const failedBatch = await workbench.api(`/api/batches/${batch.id}`);
    assert.equal(job.status, 'failed');
    assert.match(`${job.error} ${job.progress}`, /503|失败|所有具体来源/);
    assert.equal(failedBatch.status, 'blocked');
    assert.ok(rsshub.requests.includes('/e2e/news?limit=30'), `真实采集没有请求失败 RSS：${rsshub.requests.join(', ')}`);
  } finally {
    await closeAndRemove(root, workbench, model, rsshub);
  }
}, { timeout: 60000 });

test('真实文章链路：模型 HTTP 502 会使 AI 任务失败且不产生完成态', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-e2e-model-failure-'));
  const { workspaceRoot, configRoot, databasePath } = prepareWorkspace(root);
  const rsshub = await startFakeRssHub();
  const model = await startFakeModel({ mode: 'http-error' });
  let workbench;
  try {
    const store = new Store(databasePath);
    const batch = store.createBatch({ date: '2026-09-12', title: 'E2E 模型异常', requestedTracks: ['article'] });
    configureCollection(store, rsshub);
    store.addHotspots(batch.id, 'rsshub', [{ id: 'e2e-model-failure', title: 'E2E 模型异常样本', url: 'https://example.com/e2e/model-failure', publishedAt: new Date().toISOString(), summary: '固定来源正文，用于验证模型失败不会伪装成完成。', sourceType: 'rsshub', sourceKey: 'rsshub:/e2e/news' }]);
    const hotspot = store.getBatch(batch.id).hotspots.find((item) => item.url === 'https://example.com/e2e/model-failure');
    assert.ok(hotspot);
    const [candidate] = store.addCandidates(batch.id, [hotspot.id], { tracks: ['article'], editorialMode: 'manual' });
    store.updateCandidate(candidate.id, { content_route: 'article', content_class: 'news_event', angle: '验证模型失败状态', thesis: '模型错误必须阻断文章产物。' });
    store.saveEditorial(candidate.id, { confirmed_facts: '固定资料展示了一条可核验的测试事实。', author_opinions: '本文只验证失败处理。', forbidden_claims: '不得把失败当成成功。', next_action: 'WRITE_NOW', brief_status: 'LOCKED', reader_consequence: '失败可追踪。', conflict: '模型服务可能返回错误。' });
    fs.writeFileSync(path.join(workspaceRoot, 'data', 'source-cache', `${hotspot.id}.json`), JSON.stringify({ url: hotspot.url, final_url: hotspot.url, title: hotspot.title, content: '固定来源正文，用于验证模型失败不会伪装成完成。', content_chars: 31 }));
    setCredentialFields(configRoot, 'fixture', 'model-provider-fixture', { apiKey: 'fixture-key' });
    setCredentialFields(configRoot, 'fixture', 'model-connection-fixture', { apiKey: 'fixture-key' });
    store.close();
    writeFixtureConfig(configRoot, fixtureConfig({ workspaceRoot, rsshub, model }));
    workbench = await startWorkbench({ projectRoot, workspaceRoot, configRoot, port: 0 });

    const article = await workbench.api(`/api/candidates/${candidate.id}/ai/article`, { method: 'POST', body: { provider: 'fixture', useLatestSkill: true } });
    await assert.rejects(waitForJob(workbench.api, article.id, { timeoutMs: 30000, intervalMs: 10 }), /失败/);
    const job = await workbench.api(`/api/jobs/${article.id}`);
    const artifacts = await workbench.api(`/api/artifacts?batch_id=${encodeURIComponent(batch.id)}`);
    assert.equal(job.status, 'failed');
    assert.match(`${job.error} ${job.progress}`, /502|fixture model failure|失败/);
    assert.equal(artifacts.some((item) => Number(item.candidate_row_id) === candidate.id && item.name === '09-FINAL.md' && item.status === 'ready'), false);
  } finally {
    await closeAndRemove(root, workbench, model, rsshub);
  }
}, { timeout: 60000 });
