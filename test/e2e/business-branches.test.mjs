import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../../server/platform/core/store.mjs';
import { setCredentialFields } from '../../server/platform/tools/remote-credentials.mjs';
import { startFakeModel, startFakeRssHub } from './support/fake-upstreams.mjs';
import { startWorkbench, writeFixtureConfig } from './support/workbench-process.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../..');

function prepareWorkspace(root) {
  const workspaceRoot = path.join(root, 'workspace');
  const configRoot = path.join(root, 'config');
  fs.mkdirSync(path.join(workspaceRoot, 'data', 'source-cache'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'data', 'installed-skills'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'data', 'skill-packages.json'), JSON.stringify({ schemaVersion: 1, packages: {}, entryDefaults: {}, stageDefaults: {} }, null, 2));
  fs.cpSync(path.join(projectRoot, 'skills'), path.join(workspaceRoot, 'skills'), { recursive: true });
  return { workspaceRoot, configRoot, databasePath: path.join(workspaceRoot, 'data', 'workbench.db') };
}

function fixtureConfig({ workspaceRoot, rsshub, model }) {
  return {
    workspaceRoot,
    rsshub: { baseUrl: rsshub.baseUrl, rootDir: path.join(projectRoot, 'RSSHub'), keepAlive: true, maxAgeHours: 168, allowUndated: true },
    llm: { defaultProvider: 'fixture', providers: { fixture: { label: 'E2E Fixture', baseUrl: model.baseUrl, protocol: 'chat_completions', model: 'fixture', apiKeyEnv: 'E2E_FIXTURE_KEY', contextWindow: 32000, maxOutputTokens: 16000, supportsJsonMode: true, supportsNativeTools: true, supportsThinkingToggle: true, enabled: true } } },
  };
}

async function closeAndRemove(root, workbench, ...upstreams) {
  await workbench?.close();
  for (const upstream of upstreams.reverse()) await upstream?.close();
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may release SQLite handles shortly after the child exits. */ }
}

async function expectApiError(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

test('业务分支 E2E：综合、事件图文、每日早报、突发和自主写作路由完整', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-e2e-branches-'));
  const { workspaceRoot, configRoot, databasePath } = prepareWorkspace(root);
  const rsshub = await startFakeRssHub();
  const model = await startFakeModel();
  let workbench;
  try {
    const store = new Store(databasePath);
    const batch = store.createBatch({ date: '2026-09-12', title: 'E2E 业务分支固定夹具', requestedTracks: ['article', 'social_cards'] });
    store.addHotspots(batch.id, 'rsshub', [
      { id: 'branch-event-a', title: '平台发布新的开发者规范', url: 'https://example.com/branch/event-a', publishedAt: '2026-09-12T00:00:00.000Z', summary: '事件 A 的固定事实材料。', sourceType: 'rsshub', sourceKey: 'rsshub:/e2e/news' },
      { id: 'branch-event-b', title: '开发者社区开始采用新的规范', url: 'https://example.com/branch/event-b', publishedAt: '2026-09-12T00:00:00.000Z', summary: '事件 B 的固定事实材料。', sourceType: 'rsshub', sourceKey: 'rsshub:/e2e/news' },
      { id: 'branch-project', title: 'GitHub 开源项目固定样本', url: 'https://github.com/example/branch-project', publishedAt: '2026-09-12T00:00:00.000Z', summary: '纯项目热点只允许进入图文路线。', sourceType: 'rsshub', sourceKey: 'rsshub:/e2e/news' },
    ]);
    const seededBatch = store.getBatch(batch.id);
    assert.ok(seededBatch.hotspots.filter((item) => item.url?.startsWith('https://example.com/branch/')).length === 2, '业务分支夹具必须创建两个普通事件热点');
    store.close();
    setCredentialFields(configRoot, 'fixture', 'model-provider-fixture', { apiKey: 'fixture-key' });
    setCredentialFields(configRoot, 'fixture', 'model-connection-fixture', { apiKey: 'fixture-key' });
    writeFixtureConfig(configRoot, fixtureConfig({ workspaceRoot, rsshub, model }));
    workbench = await startWorkbench({ projectRoot, workspaceRoot, configRoot, port: 0 });

    const loadedBatch = await workbench.api(`/api/batches/${batch.id}`);
    const normalA = loadedBatch.hotspots.find((item) => item.url === 'https://example.com/branch/event-a');
    const normalB = loadedBatch.hotspots.find((item) => item.url === 'https://example.com/branch/event-b');
    const project = loadedBatch.hotspots.find((item) => item.url === 'https://github.com/example/branch-project');
    assert.ok(normalA && normalB && project, '业务分支热点必须可通过真实 HTTP 批次接口读回');

    const composite = await workbench.api(`/api/batches/${batch.id}/candidates/composite`, {
      method: 'POST',
      body: { hotspotIds: [normalA.id, normalB.id], tracks: ['article'], title: '两个事件的综合选题' },
    });
    assert.equal(composite.composite, 1, '综合候选必须标记 composite');
    const compositeRows = await workbench.api(`/api/batches/${batch.id}/candidates?track=article`);
    const compositeRow = compositeRows.find((item) => Number(item.id) === Number(composite.id));
    assert.equal(compositeRow?.hotspot_count, 2, '文章池读回的综合候选必须保留两个热点成员');
    assert.equal(composite.tracks.find((item) => item.track === 'article')?.track, 'article', '综合候选必须进入文章池');

    await expectApiError(workbench.api(`/api/batches/${batch.id}/candidates/composite`, {
      method: 'POST',
      body: { hotspotIds: [normalA.id, project.id], tracks: ['article'], title: '不应绕过纯项目保护' },
    }), /ARTICLE_ROUTE_REQUIRES_PROMOTION|纯项目/);

    const eventCards = await workbench.api(`/api/batches/${batch.id}/candidates`, {
      method: 'POST',
      body: { hotspotIds: [normalA.id], tracks: ['social_cards'], socialContentClass: 'news_event' },
    });
    const eventCardCandidate = eventCards.find((item) => Number(item.hotspot_id) === Number(normalA.id));
    assert.equal(eventCardCandidate.content_class, 'news_event', '事件图文必须保留 news_event 分类');
    assert.equal(eventCardCandidate.tracks.find((item) => item.track === 'social_cards')?.output_mode, 'wechat-event-cards', '事件图文必须进入事件卡输出路线');

    const daily = await workbench.api(`/api/batches/${batch.id}/daily`);
    assert.equal(daily.batch.batchType, 'regular');
    assert.ok(Array.isArray(daily.focusOptions) && Array.isArray(daily.jobs), '每日早报查询必须返回聚焦选项和任务历史');
    const dailyJob = await workbench.api(`/api/batches/${batch.id}/daily`, { method: 'POST', body: { provider: 'fixture', focuses: ['验证固定事件进入早报'] } });
    assert.equal(dailyJob.type, 'daily', '每日早报必须启动 daily 任务');

    const breaking = await workbench.api('/api/batches/breaking', {
      method: 'POST',
      body: { date: '2026-09-12', title: '固定突发事件', note: '验证突发入口和分析门禁', urls: ['https://example.com/branch/breaking'], requestedTracks: ['article', 'social_cards'] },
    });
    assert.equal(breaking.batch_type, 'breaking');
    assert.ok(breaking.intake_hotspot_id, '突发专题必须创建入口热点');
    await expectApiError(workbench.api(`/api/batches/${breaking.id}/breaking-analysis/route`, {
      method: 'POST', body: { tracks: ['article'] },
    }), /先完成突发分析|尚未生成突发分析/);

    const tutorial = await workbench.api(`/api/batches/${batch.id}/tutorials`, {
      method: 'POST',
      body: {
        creationRequestId: 'branch-tutorial-e2e', articleMode: 'tutorial', topic: '固定夹具教程', audience: '维护内容流水线的开发者', environment: 'Node.js 24',
        points: ['【素材】固定输入可以重复复现流程。', '【体验】先确认输入，再检查输出。', '【建议】合并前运行完整 E2E。'],
        steps: ['准备固定输入', '执行自动化测试'], provider: 'fixture',
      },
    });
    assert.equal(tutorial.candidate.tracks.find((item) => item.track === 'article')?.output_mode, 'wechat-tutorial', '教程必须进入 wechat-tutorial 路线');

    const experience = await workbench.api(`/api/batches/${batch.id}/tutorials`, {
      method: 'POST',
      body: {
        creationRequestId: 'branch-experience-e2e', articleMode: 'experience', topic: '固定夹具经验复盘', audience: '测试维护者', thesis: '稳定输入比偶然通过更值得信任。',
        points: ['【素材】本次回归使用固定 HTTP 上游。', '【体验】固定输出让失败更容易定位。', '【建议】把失败日志作为 CI 产物保留。'], provider: 'fixture',
      },
    });
    assert.equal(experience.candidate.tracks.find((item) => item.track === 'article')?.output_mode, 'wechat-experience', '心得必须进入 wechat-experience 路线');
  } finally {
    await closeAndRemove(root, workbench, model, rsshub);
  }
}, { timeout: 120000 });
