import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { Store } from '../../server/platform/core/store.mjs';
import { setCredentialFields } from '../../server/platform/tools/remote-credentials.mjs';
import { startFakeGitHub, startFakeModel, startFakeRssHub } from './support/fake-upstreams.mjs';
import { runBrowserMainlineFlow, runBrowserSmoke } from './support/browser-smoke.mjs';
import { startWorkbench, waitForJob, writeFixtureConfig } from './support/workbench-process.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PERFORMANCE_THRESHOLDS = Object.freeze({
  collectMs: 30_000,
  researchMs: 60_000,
  browserSocialFlowMs: 120_000,
  articleMs: 120_000,
});

test('主链路 E2E：采集、文章与图文产物均可从真实 HTTP 服务闭环', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-e2e-'));
  const workspaceRoot = path.join(root, 'workspace');
  const configRoot = path.join(root, 'config');
  const databasePath = path.join(workspaceRoot, 'data', 'workbench.db');
  assert.notEqual(path.resolve(workspaceRoot), projectRoot, 'E2E 必须使用隔离工作区');
  fs.mkdirSync(path.join(workspaceRoot, 'data', 'source-cache'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'data', 'installed-skills'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'data', 'skill-packages.json'), JSON.stringify({ schemaVersion: 1, packages: {}, entryDefaults: {}, stageDefaults: {} }, null, 2));
  // SkillRegistry treats the workspace as the source of truth; copy the checked-in
  // built-in skills into the disposable workspace so selection is tested too.
  fs.cpSync(path.join(projectRoot, 'skills'), path.join(workspaceRoot, 'skills'), { recursive: true });
  const rsshub = await startFakeRssHub();
  const github = await startFakeGitHub();
  const model = await startFakeModel();
  let workbench;
  let failure = null;
  const timings = {};
  try {
    const store = new Store(databasePath);
    const batch = store.createBatch({ date: '2026-09-12', title: 'E2E 主链路固定夹具', requestedTracks: ['article', 'social_cards'] });
    store.saveExtensionSetting({ extensionType: 'collector', extensionId: 'rsshub-collector', value: { baseUrl: rsshub.baseUrl, rootDir: path.join(projectRoot, 'RSSHub'), keepAlive: true, maxAgeHours: 168, allowUndated: true, concurrency: 2 }, configured: true, status: 'ready' });
    // Model credentials are resolved from the configured profile root (configRoot),
    // while content and the database remain isolated under workspaceRoot.
    setCredentialFields(configRoot, 'fixture', 'model-provider-fixture', { apiKey: 'fixture-key' });
    setCredentialFields(configRoot, 'fixture', 'model-connection-fixture', { apiKey: 'fixture-key' });
    store.upsertCollectionSource({ pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'rsshub', sourceKey: 'rsshub:/e2e/news', label: 'E2E 固定来源', config: { route: '/e2e/news?limit=30' }, enabled: true, origin: 'e2e' });
    store.close();
    assert.ok(fs.existsSync(databasePath), 'E2E 应创建临时 SQLite 数据库');
    assert.ok(!path.resolve(databasePath).toLowerCase().startsWith(`${projectRoot}${path.sep}`.toLowerCase()), '临时数据库不得落到项目目录');

    writeFixtureConfig(configRoot, { workspaceRoot, rsshub: { baseUrl: rsshub.baseUrl, rootDir: path.join(projectRoot, 'RSSHub'), keepAlive: true, maxAgeHours: 168, allowUndated: true }, llm: { defaultProvider: 'fixture', providers: { fixture: { label: 'E2E Fixture', baseUrl: model.baseUrl, protocol: 'chat_completions', model: 'fixture', apiKeyEnv: 'E2E_FIXTURE_KEY', contextWindow: 32000, maxOutputTokens: 16000, supportsJsonMode: true, supportsNativeTools: true, supportsThinkingToggle: true, enabled: true } } } });
    workbench = await startWorkbench({ projectRoot, workspaceRoot, configRoot, port: 0, env: { WORKBENCH_GITHUB_API_BASE_URL: github.baseUrl } });
    const actualPort = Number(new URL(workbench.baseUrl).port);
    assert.ok(actualPort > 0);
    const sources = await workbench.api('/api/collection-sources');
    const fixtureSource = sources.items.find((item) => item.source_key === 'rsshub:/e2e/news');
    assert.ok(fixtureSource, '固定 RSS 来源应通过真实配置加载');
    assert.deepEqual(fixtureSource?.config?.route, '/e2e/news?limit=30');
    await workbench.api(`/api/collection-sources/${fixtureSource.id}/test`, { method: 'POST', body: {} });

    const collectStartedAt = performance.now();
    const collect = await workbench.api(`/api/batches/${batch.id}/collect`, { method: 'POST', body: { provider: 'fixture' } });
    const collectStatuses = [];
    try { await waitForJob(workbench.api, collect.id, { observedStatuses: collectStatuses }); }
    catch (error) { throw new Error(`${error.message}\n服务日志：${workbench.logs.join('')}\nRSSHub 请求：${rsshub.requests.join(', ')}`); }
    assert.ok(rsshub.requests.includes('/e2e/news?limit=30'), `采集未请求固定 RSS：${rsshub.requests.join(', ')}`);
    assert.equal(collectStatuses.at(-1), 'completed', `采集任务未通过轮询进入完成态：${collectStatuses.join(' -> ')}`);
    timings.collectMs = Math.round(performance.now() - collectStartedAt);
    assert.ok(timings.collectMs <= PERFORMANCE_THRESHOLDS.collectMs, `采集阶段超出性能阈值：${timings.collectMs}ms > ${PERFORMANCE_THRESHOLDS.collectMs}ms`);
    const tagging = await workbench.api(`/api/batches/${batch.id}/ai/tag`, { method: 'POST', body: { provider: 'fixture' } });
    assert.ok(Number(tagging.updated) > 0, '真实打标阶段必须处理采集热点');
    assert.equal(tagging.eventCards?.failed || 0, 0, '真实事件卡阶段不应失败');
    const researchStartedAt = performance.now();
    const researchStart = await workbench.api(`/api/batches/${batch.id}/ai/research`, { method: 'POST', body: { provider: 'fixture' } });
    const researchStatuses = [];
    try { await waitForJob(workbench.api, researchStart.id, { observedStatuses: researchStatuses }); }
    catch (error) { throw new Error(`${error.message}\n服务日志：${workbench.logs.join('')}\n模型请求：${JSON.stringify(model.requests)}`); }
    assert.equal(researchStatuses.at(-1), 'completed', `研判任务未通过轮询进入完成态：${researchStatuses.join(' -> ')}`);
    timings.researchMs = Math.round(performance.now() - researchStartedAt);
    assert.ok(timings.researchMs <= PERFORMANCE_THRESHOLDS.researchMs, `研判阶段超出性能阈值：${timings.researchMs}ms > ${PERFORMANCE_THRESHOLDS.researchMs}ms`);
    const researchArtifacts = await workbench.api(`/api/artifacts?batch_id=${encodeURIComponent(batch.id)}`);
    for (const name of ['discussion-research.json', 'discussion-research-reports.md', 'topic-candidate-generation.json']) {
      const artifact = researchArtifacts.find((item) => item.name === name);
      assert.ok(artifact, `研判产物缺少 ${name}`);
      assert.equal(artifact.status, 'ready', `研判产物 ${name} 未就绪`);
      assert.ok(fs.existsSync(artifact.file_path), `研判产物文件不存在：${name}`);
    }
    const collected = await workbench.api(`/api/batches/${batch.id}`);
    const articleHotspot = collected.hotspots.find((item) => item.url === 'https://example.com/e2e/article');
    const repositoryHotspot = collected.hotspots.find((item) => item.url === 'https://github.com/example/e2e-tool');
    assert.ok(articleHotspot, '文章热点必须来自本次 RSS 采集结果');
    assert.ok(repositoryHotspot, '图文热点必须来自本次 RSS 采集结果');

    const articleCandidates = await workbench.api(`/api/batches/${batch.id}/candidates?track=article`);
    const articleCandidate = articleCandidates.find((item) => Number(item.hotspot_id) === Number(articleHotspot.id));
    const socialCandidates = await workbench.api(`/api/batches/${batch.id}/candidates`, {
      method: 'POST', body: { hotspotIds: [repositoryHotspot.id], tracks: ['social_cards'] },
    });
    const socialCandidate = socialCandidates.find((item) => Number(item.hotspot_id) === Number(repositoryHotspot.id));
    assert.ok(articleCandidate, '文章候选必须由采集热点创建');
    assert.ok(socialCandidate, '图文候选必须由采集热点创建');
    await workbench.api(`/api/candidates/${articleCandidate.id}`, {
      method: 'PATCH', body: { content_route: 'article', content_class: 'news_event', angle: '验证采集结果是否完整进入文章产物', thesis: '稳定的固定夹具可以让主链路回归测试可重复。' },
    });
    await workbench.api(`/api/candidates/${socialCandidate.id}`, {
      method: 'PATCH', body: { content_route: 'social_cards', content_class: 'github_project' },
    });
    await workbench.api(`/api/candidates/${articleCandidate.id}/editorial`, {
      method: 'PUT', body: { confirmed_facts: '固定资料展示了一条可核验的测试事实。', author_opinions: '本文只验证流程完整性。', adopted_research_points: [{ point_id: 'e2e-research-1', kind: 'anomaly', statement: '事件来源的反常在于采集结果必须继续进入最终产物。' }], research_basis: '围绕该事件来源的反常与变化，验证采集结果是否进入文章产物。', forbidden_claims: '不得把测试数据写成真实行业结论。', next_action: 'WRITE_NOW', brief_status: 'LOCKED', reader_consequence: '开发者可以复跑同一条验证路径。', conflict: '改动可能导致产物缺失。' },
    });
    const fetchedSource = await workbench.api(`/api/candidates/${articleCandidate.id}/source`, {
      method: 'POST', body: {},
    });
    assert.equal(fetchedSource.status, 'ok', '文章原文必须通过真实备料接口就绪');
    assert.ok(Number(fetchedSource.content_chars) > 800, '文章备料应来自 RSS 正文摘要而不是预置缓存');

    const browserFlowStartedAt = performance.now();
    const browserFlow = await runBrowserMainlineFlow({ baseUrl: workbench.baseUrl, socialCandidateId: socialCandidate.id, factsText: '固定仓库分析 Fixture 工具', diagnosticsDir: path.join(root, 'diagnostics'), visualBaselinePath: path.join(projectRoot, 'test/e2e/fixtures/social-card-plan.sha256') });
    timings.browserSocialFlowMs = Math.round(performance.now() - browserFlowStartedAt);
    assert.ok(timings.browserSocialFlowMs <= PERFORMANCE_THRESHOLDS.browserSocialFlowMs, `图文浏览器主链路超出性能阈值：${timings.browserSocialFlowMs}ms > ${PERFORMANCE_THRESHOLDS.browserSocialFlowMs}ms`);
    assert.deepEqual(browserFlow.actions, ['打开工具图文', '选择图文候选', '分析仓库', '生成故事板', '生成图文并等待交付']);
    assert.match(browserFlow.deliveryMeta, /\d+ 张/);
    assert.match(browserFlow.visualSignature, /^[a-f0-9]{64}$/, '图文视觉回归未生成有效签名');
    assert.deepEqual(github.requests.sort(), ['/repos/example/e2e-tool', '/repos/example/e2e-tool/license', '/repos/example/e2e-tool/readme', '/repos/example/e2e-tool/releases/latest'].sort(), `仓库分析必须通过固定 GitHub API 完成：${github.requests.join(', ')}`);

    const articleStartedAt = performance.now();
    let articleJob;
    try { articleJob = await workbench.api(`/api/candidates/${articleCandidate.id}/ai/article`, { method: 'POST', body: { provider: 'fixture', useLatestSkill: true } }); }
    catch (error) { throw new Error(`${error.message}\n服务日志：${workbench.logs.join('')}`); }
    const articleStatuses = [];
    try { await waitForJob(workbench.api, articleJob.id, { observedStatuses: articleStatuses }); }
    catch (error) { throw new Error(`${error.message}\n模型请求：${JSON.stringify(model.requests)}`); }
    assert.equal(articleStatuses.at(-1), 'completed', `文章任务未通过轮询进入完成态：${articleStatuses.join(' -> ')}`);
    timings.articleMs = Math.round(performance.now() - articleStartedAt);
    assert.ok(timings.articleMs <= PERFORMANCE_THRESHOLDS.articleMs, `文章阶段超出性能阈值：${timings.articleMs}ms > ${PERFORMANCE_THRESHOLDS.articleMs}ms`);
    const articleArtifacts = await workbench.api(`/api/artifacts?batch_id=${encodeURIComponent(batch.id)}`);
    const articleRows = articleArtifacts.filter((item) => Number(item.candidate_row_id) === articleCandidate.id);
    const requiredArticleArtifacts = [
      '00-article-brief.md', '02-fact-base.json', '02-outline.md', '04-draft.md',
      '05-humanized.md', '06-reviewed.md', '07-seo-keywords.md', '08-seo-optimized.md',
      '09-visual-plan.json', '09-FINAL.md', '10-publication-compliance.json',
    ];
    for (const name of requiredArticleArtifacts) {
      const artifact = articleRows.find((item) => item.name === name);
      assert.ok(artifact, `文章产物缺少 ${name}`);
      assert.equal(artifact.status, 'ready', `文章产物 ${name} 未就绪`);
      assert.ok(fs.existsSync(artifact.file_path), `文章产物文件不存在：${name}`);
      assert.ok(Number(artifact.size) > 0, `文章产物为空：${name}`);
    }
    const finalArtifact = articleRows.find((item) => item.name === '09-FINAL.md');
    const finalContent = fs.readFileSync(finalArtifact.file_path, 'utf8');
    assert.match(finalContent, /^#\s+\S+/m, '文章终稿缺少 H1 标题');
    assert.match(finalContent, /^##\s+\S+/m, '文章终稿缺少 H2 章节');
    assert.doesNotMatch(finalContent, /<!--\s*REVIEW[\s\S]*?-->/i, '文章终稿不应残留审核标记');
    const finalDocument = await workbench.api(`/api/batches/${encodeURIComponent(batch.id)}/documents?candidateId=${articleCandidate.id}&kind=final`);
    assert.equal(finalDocument.candidate_row_id, articleCandidate.id);
    assert.equal(finalDocument.status, 'finalized');
    assert.equal(path.resolve(finalDocument.file_path), path.resolve(finalArtifact.file_path));
    assert.ok(Number(finalDocument.visible_chars) > 0, '文章终稿应有可见字符');
    const finalArticles = await workbench.api('/api/articles');
    assert.ok(finalArticles.some((item) => Number(item.candidate_row_id) === articleCandidate.id && item.status === 'finalized'));

    const replayIds = new Set(model.requests.map((request) => request.replayId));
    assert.ok(model.requests.length > 0, '主链路应调用模型 Replay');
    assert.ok(replayIds.has('hotspot-tagging'), `打标 Replay 未命中：${[...replayIds].join(', ')}`);
    assert.ok(replayIds.has('event-card'), `事件卡 Replay 未命中：${[...replayIds].join(', ')}`);
    assert.ok(replayIds.has('discussion-research-report'), `单事件研判 Replay 未命中：${[...replayIds].join(', ')}`);
    assert.ok(replayIds.has('hotspot-brainstorm'), `脑暴 Replay 未命中：${[...replayIds].join(', ')}`);
    assert.ok(replayIds.has('hotspot-synthesis'), `综合复排 Replay 未命中：${[...replayIds].join(', ')}`);
    assert.ok([...replayIds].some((id) => id === 'article-markdown'), `文章 Replay 未命中：${[...replayIds].join(', ')}`);
    assert.ok(replayIds.has('social-card-editorial'), `图文故事板 Replay 未命中：${[...replayIds].join(', ')}`);
    assert.ok(model.requests.every((request) => request.replayId), '每次模型请求都必须可追踪到 Replay');
    const socialArtifacts = await workbench.api(`/api/artifacts?batch_id=${encodeURIComponent(batch.id)}`);
    const socialRows = socialArtifacts.filter((item) => Number(item.candidate_row_id) === socialCandidate.id);
    const requiredSocialArtifacts = ['fact-sheet.md', 'card-plan.json', 'copy.txt', 'my-design.html', 'layout-report.json', 'delivery-report.json'];
    for (const name of requiredSocialArtifacts) {
      const artifact = socialRows.find((item) => item.name === name);
      assert.ok(artifact, `图文产物缺少 ${name}`);
      assert.equal(artifact.status, 'ready', `图文产物 ${name} 未就绪`);
      assert.ok(fs.existsSync(artifact.file_path), `图文产物文件不存在：${name}`);
      assert.ok(Number(artifact.size) > 0, `图文产物为空：${name}`);
    }
    const socialView = await workbench.api(`/api/candidates/${socialCandidate.id}/social-cards`);
    const socialPages = Array.isArray(socialView.cardPlan) ? socialView.cardPlan : socialView.cardPlan?.pages;
    assert.equal(socialView.ready, true, '图文交付接口应报告 ready');
    assert.ok(socialView.htmlUrl, '图文交付接口应暴露 HTML 预览地址');
    assert.ok(Array.isArray(socialPages) && socialPages.length >= 4, `图文故事板至少需要 4 页：${JSON.stringify(socialView.cardPlan).slice(0, 500)}`);
    assert.ok(socialPages.some((page) => page.role === 'cover'), '图文故事板缺少封面页');
    assert.ok(socialPages.some((page) => page.role === 'ending'), '图文故事板缺少收尾页');
    assert.ok(Array.isArray(socialView.images) && socialView.images.length === socialPages.length, '图文卡片数量应与故事板页数一致');
    assert.equal(socialView.delivery?.valid, true, '图文交付门禁应通过');
    assert.ok(Array.isArray(socialView.layout?.pages) && socialView.layout.pages.length === socialView.images.length, '图文布局报告应覆盖每一页');
    const layoutIssues = socialView.layout.pages.flatMap((page) => Array.isArray(page.issues) ? page.issues : []);
    assert.doesNotMatch(layoutIssues.join(','), /overflow|clipped|horizontal_overflow/i, '图文布局不应有溢出或裁切');

    const browserSmoke = await runBrowserSmoke({
      baseUrl: workbench.baseUrl,
      diagnosticsDir: path.join(root, 'diagnostics'),
      routes: [
        { name: '工作台总览', route: 'dashboard', view: 'dashboard', selector: '#view-dashboard #dashboard-batch-title' },
        { name: '热点全景', route: 'overview', view: 'overview', selector: '#view-overview #event-hotlist', allowEmpty: true },
        { name: '文章选题池', route: 'topics', view: 'topics', selector: '#view-topics #candidate-list' },
        { name: '热点事件创作', route: 'editorial', view: 'editorial', selector: '#view-editorial #editorial-candidates' },
        { name: '文章编辑器', route: 'editor', view: 'editor', selector: '#view-editor #markdown-editor' },
        { name: '工具图文', route: 'social-editor', view: 'social-editor', selector: '#view-social-editor #social-editor-candidates' },
        { name: '产物中心', route: 'artifacts', view: 'artifacts', selector: '#view-artifacts #artifact-list' },
        { name: '任务日志', route: 'logs', view: 'logs', selector: '#view-logs #log-list' },
        { name: '采集源', route: 'sources', view: 'sources', selector: '#view-sources #subscription-list' },
      ],
    });
    assert.equal(browserSmoke.length, 9, '关键页面 Smoke 数量不完整');
  } catch (error) {
    failure = error;
    const diagnosticsDir = path.join(root, 'diagnostics');
    try {
      fs.mkdirSync(diagnosticsDir, { recursive: true });
      fs.writeFileSync(path.join(diagnosticsDir, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, timings, performanceThresholds: PERFORMANCE_THRESHOLDS }, null, 2));
      fs.writeFileSync(path.join(diagnosticsDir, 'workbench.log'), workbench?.logs?.join('') || '');
      fs.writeFileSync(path.join(diagnosticsDir, 'rsshub-requests.json'), JSON.stringify(rsshub.requests, null, 2));
      fs.writeFileSync(path.join(diagnosticsDir, 'model-requests.json'), JSON.stringify(model.requests, null, 2));
    } catch {
      // Keep the original assertion as the test result if diagnostics cannot be written.
    }
    throw error;
  } finally {
    await workbench?.close();
    await model.close();
      await rsshub.close();
      await github.close();
    if (failure && process.env.E2E_ARTIFACT_DIR) {
      try {
        const destination = path.resolve(process.env.E2E_ARTIFACT_DIR);
        const copyRoot = path.join(destination, path.basename(root));
        fs.mkdirSync(destination, { recursive: true });
        fs.cpSync(root, copyRoot, { recursive: true, force: true });
      } catch {
        // The original test failure is more useful than a best-effort artifact copy error.
      }
    }
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may release SQLite handles shortly after the child exits. */ }
  }
}, { timeout: 240000 });
