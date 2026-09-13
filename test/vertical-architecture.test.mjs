import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('领域层不反向依赖 LLM 编排层', () => {
  const files = fs.readdirSync(path.join(root, 'server', 'shared', 'domain'), { recursive: true })
    .filter((file) => String(file).endsWith('.mjs'));
  for (const file of files) {
    const source = read(path.join('server', 'shared', 'domain', file));
    assert.doesNotMatch(source, /from ['"][^'"]*\/llm\//, `领域文件 ${file} 不应依赖 llm`);
    assert.doesNotMatch(source, /from ['"][^'"]*\/features\//, `领域文件 ${file} 不应反向依赖 features`);
  }
});

test('shared 与低层 platform 不反向依赖业务 feature', () => {
  const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(relative) : entry.name.endsWith('.mjs') ? [relative] : [];
  });
  for (const file of walk('server/shared')) {
    const source = read(file);
    if (file.replaceAll('\\', '/').startsWith('server/shared/themes/')) continue;
    assert.doesNotMatch(source, /from ['"][^'"]*\/(?:features|platform)\//, `shared 文件 ${file} 不应依赖 features/platform`);
  }
  for (const layer of ['core', 'collectors', 'connectors', 'extensions', 'persistence', 'plugin-sdk', 'plugins', 'tools']) {
    for (const file of walk(path.join('server/platform', layer))) {
      assert.doesNotMatch(read(file), /from ['"][^'"]*\/features\//, `低层 platform 文件 ${file} 不应依赖 features`);
    }
  }
});

test('账号上下文的领域模型保持纯净，文件访问集中在 platform application', () => {
  const model = read('server/shared/domain/account-context-model.mjs');
  const service = read('server/platform/application/account-context-service.mjs');
  assert.doesNotMatch(model, /node:fs|node:path|platform\//);
  assert.match(model, /export function formatAccountContext/);
  assert.match(service, /node:fs/);
  assert.match(service, /account-context-model\.mjs/);
  assert.match(service, /export function (loadAccountContext|getAccountContext|saveAccountContext)/);
});

test('platform/core Store 只接收业务服务工厂，不反向装配 research', () => {
  const store = read('server/platform/core/store.mjs');
  assert.doesNotMatch(store, /from ['"][^'"]*features\//);
  assert.doesNotMatch(store, /store-services\.mjs/);
  assert.match(store, /configureStoreServices/);
});

test('Social Card 模板资产归属 social-cards，shared 只保留通用渲染基元', () => {
  const sharedTemplates = path.join(root, 'server', 'shared', 'rendering', 'templates', 'social');
  const socialTemplates = path.join(root, 'server', 'features', 'social-cards', 'rendering', 'templates', 'social');
  assert.equal(fs.existsSync(sharedTemplates) && fs.readdirSync(sharedTemplates).some((name) => name.endsWith('.mjs')), false);
  assert.deepEqual(fs.readdirSync(socialTemplates).filter((name) => name.endsWith('.mjs')).sort(), ['brutalist-v1.mjs', 'clean-v1.mjs', 'editorial-v1.mjs', 'neon-v1.mjs']);
  assert.match(read('server/features/social-cards/rendering/presentation.mjs'), /\.\/templates\/social\//);
  assert.match(read('server/shared/rendering/README.md'), /业务专属渲染和模板放对应 feature/);
});

test('Social Card 专属渲染实现和业务对话编排已物理归属垂直目录', () => {
  const rendering = path.join(root, 'server', 'features', 'social-cards', 'rendering');
  const expectedRenderingModules = [
    'social-card-capacity.mjs', 'social-card-composition.mjs', 'social-card-content-atoms.mjs', 'social-card-content-components.mjs',
    'social-card-fact-index.mjs', 'social-card-layout.mjs', 'social-card-pipeline-contracts.mjs', 'social-card-plan.mjs',
    'social-card-reflow.mjs', 'social-card-repair-policy.mjs', 'social-card-role.mjs', 'social-card-template-metrics.mjs',
    'social-card-template-registry.mjs', 'social-card-template-resolver.mjs', 'storyboard-content.mjs',
    'storyboard-document-renderer.mjs', 'storyboard-html-content.mjs', 'storyboard-page-renderer.mjs', 'structured-card-components.mjs',
  ];
  for (const module of expectedRenderingModules) assert.equal(fs.existsSync(path.join(rendering, module)), true, `social-cards/rendering 缺少 ${module}`);
  assert.equal(fs.existsSync(path.join(root, 'server', 'features', 'social-cards', 'llm', 'custom-social-chat.mjs')), false);
  assert.match(read('server/features/social-cards/application/custom-social-chat.mjs'), /export function requestMessages/);
  assert.match(read('server/features/social-cards/application/social-template-metrics-repository.mjs'), /from ['"]\.\.\/rendering\//);
  const store = read('server/platform/core/store.mjs');
  assert.doesNotMatch(store, /social-template-metrics-repository/);
  assert.match(store, /socialTemplateMetricsRepositoryFactory/);
});

test('platform 只有面向应用的适配层可以依赖业务 feature', () => {
  const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(relative) : entry.name.endsWith('.mjs') ? [relative] : [];
  });
  const allowed = new Set(['agent', 'application', 'http', 'integrations', 'jobs', 'llm']);
  for (const file of walk('server/platform')) {
    const relative = path.relative(path.join(root, 'server', 'platform'), path.join(root, file));
    const layer = relative.split(path.sep)[0];
    if (allowed.has(layer)) continue;
    assert.doesNotMatch(read(file), /from ['"][^'"]*\/features\//, `platform/${relative} 不应依赖业务 feature`);
  }
});

test('platform/llm 只保留通用基础设施', () => {
  const files = fs.readdirSync(path.join(root, 'server', 'platform', 'llm'))
    .filter((name) => name.endsWith('.mjs')).sort();
  assert.deepEqual(files, [
    'context-manager.mjs', 'context-safety.mjs', 'decision-tools.mjs', 'events.mjs', 'gateway.mjs', 'model-json-repair.mjs', 'model-json.mjs', 'output-budget.mjs', 'responses-api.mjs',
    'skill-runtime.mjs', 'stage-model-routing.mjs', 'stream-events.mjs', 'web-search.mjs',
  ]);
});

test('研究与图文生产调用方通过业务垂直入口访问核心流水线', () => {
  const callers = [
    'server.mjs',
    'server/platform/http/route-helpers.mjs',
    'server/platform/http/routes/task-routes.mjs',
    'server/platform/http/routes/candidate-routes.mjs',
    'server/platform/http/routes/batch-routes.mjs',
    'server/platform/http/routes/social-card-routes.mjs',
    'server/features/batches/application/pipeline-failure-retry.mjs',
    'server/features/batches/application/auto-pipeline.mjs',
    'server/features/batches/application/ai-job-handlers.mjs',
    'server/features/research/llm/tasks.mjs',
    'server/features/articles/llm/daily-pipeline.mjs',
    'server/platform/application/themes/theme-preview.mjs',
    'server/platform/application/themes/social-template-proposal-compiler.mjs',
  ];
  for (const file of callers) {
    const source = read(file);
    assert.doesNotMatch(source, /from ['"][^'"]*(?:research-pipeline|social-card-pipeline|domain\/(?:event-fact-base|hotspot-atlas|custom-fact-builder|social-card-storyboard-contracts))\.mjs['"]/, `${file} 不应直接穿透旧业务模块`);
  }
});

test('研究和图文垂直入口暴露稳定的业务能力集合', async () => {
  const research = await import('../server/features/research/index.mjs');
  const socialCards = await import('../server/features/social-cards/index.mjs');
  for (const name of ['runResearchPipeline', 'ensureBatchEventCards', 'clusterItems', 'dimensionSelections', 'scoreCards', 'buildHotspotAtlas']) {
    assert.equal(typeof research[name], 'function', `research 入口缺少 ${name}`);
  }
  for (const name of ['runSocialCardPipeline', 'renderStoryboardHtml', 'cleanCardPlanJson', 'evaluateCardGate', 'buildSocialCardFactEnvelope']) {
    assert.equal(typeof socialCards[name], 'function', `social-cards 入口缺少 ${name}`);
  }
});

test('素材与内容规划垂直具备稳定入口和职责清单', async () => {
  const materials = await import('../server/features/materials/index.mjs');
  const contentPlanning = await import('../server/features/content-planning/index.mjs');
  assert.deepEqual([...materials.MATERIALS_CAPABILITIES], ['capture', 'query', 'edit', 'status-transition', 'assessment']);
  for (const name of ['assessMaterial']) {
    assert.equal(typeof materials[name], 'function', `materials 入口缺少 ${name}`);
  }
  for (const name of ['materialBriefReadiness', 'materialBriefPrelude', 'buildContentPlanningRecommendation']) {
    assert.equal(typeof contentPlanning[name], 'function', `content-planning 入口缺少 ${name}`);
  }
});

test('内容反馈垂直具备稳定入口和反馈路由', async () => {
  const feedback = await import('../server/features/content-feedback/index.mjs');
  const route = read('server/platform/http/routes/content-feedback-routes.mjs');
  for (const name of ['parseWechatExport', 'matchWechatArticles', 'buildContentFeedbackSnapshot', 'buildWechatStrategyRecommendations']) {
    assert.equal(typeof feedback[name], 'function', `content-feedback 入口缺少 ${name}`);
  }
  assert.match(route, /export async function handleContentFeedbackRoutes/);
  assert.match(route, /\/api\/wechat\/import/);
  assert.match(route, /\/api\/wechat\/feedback/);
});

test('内容反馈实现已物理迁移，旧 content-planning 路径已删除', () => {
  const modules = [
    'article-content-linker.mjs',
    'feedback-adjustment.mjs',
    'project-discovery-feedback.mjs',
    'social-content-feedback.mjs',
    'social-feedback-adjustment.mjs',
    'wechat-article-matcher.mjs',
    'wechat-content-feedback.mjs',
    'wechat-content-insights.mjs',
    'wechat-export-parser.mjs',
    'wechat-strategy-recommendations.mjs',
  ];
  const entry = read('server/features/content-feedback/index.mjs');
  assert.doesNotMatch(entry, /\.\.\/content-planning\//);
  const legacyImport = /content-planning\/(?:article-content-linker|feedback-adjustment|project-discovery-feedback|social-content-feedback|social-feedback-adjustment|wechat-article-matcher|wechat-content-feedback|wechat-content-insights|wechat-export-parser|wechat-strategy-recommendations)\.mjs/;
  const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(relative) : entry.name.endsWith('.mjs') ? [relative] : [];
  });
  for (const file of walk('server')) {
    if (file.startsWith(path.join('server', 'features', 'content-planning'))) continue;
    assert.doesNotMatch(read(file), legacyImport, `生产代码不应继续导入旧反馈实现: ${file}`);
  }
  for (const module of modules) {
    assert.equal(fs.existsSync(path.join(root, 'server', 'features', 'content-planning', module)), false, `旧反馈路径仍存在: ${module}`);
  }
  for (const [layer, modulesInLayer] of Object.entries({
    domain: ['wechat-export-parser.mjs', 'wechat-content-insights.mjs', 'wechat-content-feedback.mjs', 'project-discovery-feedback.mjs', 'wechat-strategy-recommendations.mjs', 'social-content-feedback.mjs', 'wechat-article-matching.mjs'],
    application: ['wechat-article-matching-service.mjs', 'wechat-content-feedback-context.mjs', 'wechat-export-service.mjs', 'social-content-feedback-service.mjs'],
  })) {
    for (const module of modulesInLayer) {
      assert.equal(fs.existsSync(path.join(root, 'server', 'features', 'content-feedback', layer, module)), true, `迁移后的反馈模块缺失: ${layer}/${module}`);
    }
  }
});

test('内容反馈确定性规则已下沉到 domain', () => {
  for (const module of ['wechat-content-insights.mjs', 'project-discovery-feedback.mjs', 'wechat-strategy-recommendations.mjs', 'wechat-export-parser.mjs', 'wechat-article-matching.mjs']) {
    const source = read(`server/features/content-feedback/domain/${module}`);
    assert.ok(source.length > 0, `domain 规则模块为空: ${module}`);
    assert.doesNotMatch(source, /from ['"][^'"]*\/platform\//, `domain 规则不应依赖 platform: ${module}`);
    assert.doesNotMatch(source, /(?:readFile|writeFile|existsSync|statSync|fetch\s*\()/, `domain 规则不应执行 I/O: ${module}`);
  }
});

test('素材 HTTP 路由和 Store 边界已脱离 content-routes', () => {
  const materialRoutes = read('server/platform/http/routes/material-routes.mjs');
  const contentRoutes = read('server/platform/http/routes/content-routes.mjs');
  const contentPlanningRepository = read('server/platform/persistence/repositories/content-planning-repository.mjs');
  const store = read('server/platform/core/store.mjs');
  assert.match(materialRoutes, /export async function handleMaterialRoutes/);
  assert.match(materialRoutes, /\/api\/writing-materials/);
  assert.doesNotMatch(contentRoutes, /\/api\/writing-materials/);
  assert.doesNotMatch(contentRoutes, /request\.method === ['"]POST['"] && pathname === ['"]\/api\/writing-materials['"]/);
  assert.doesNotMatch(contentRoutes, /assessmentMatch/);
  assert.doesNotMatch(contentPlanningRepository, /^\s+(?:createMaterial|listMaterials|updateMaterial|saveAssessment)\s*\(/m);
  assert.match(store, /const material = new MaterialRepository\(this\.db\)/);
  assert.match(store, /materialServiceFactory/);
});

test('文章与采集生产调用方通过业务垂直入口访问核心能力', async () => {
  const callers = [
    'server.mjs',
    'server/platform/http/routes/article-routes.mjs',
    'server/platform/http/routes/media-routes.mjs',
    'server/platform/http/routes/task-routes.mjs',
    'server/platform/http/routes/candidate-routes.mjs',
    'server/platform/http/routes/system-routes.mjs',
    'server/features/batches/application/ai-job-handlers.mjs',
    'server/features/batches/application/auto-pipeline.mjs',
    'server/features/collection/application/collection-job-manager.mjs',
    'server/features/batches/application/pipeline-failure-retry.mjs',
    'server/platform/application/themes/theme-preview.mjs',
  ];
  for (const file of callers) {
    const source = read(file);
    assert.doesNotMatch(source, /from ['"][^'"]*\/(?:article-pipeline|typeset-pipeline|breaking-analysis-pipeline|daily-pipeline|tutorial-pipeline|cover-image-generator|article-image-generator|image-workflow|visual-planner|editorial-room|domain\/collection-quality|collectors\/source-service)\.mjs['"]/, `${file} 不应直接穿透文章/采集旧模块`);
  }
  const articles = await import('../server/features/articles/index.mjs');
  const collection = await import('../server/features/collection/index.mjs');
  for (const name of ['runArticlePipeline', 'runTypesetPipeline', 'runBreakingAnalysisPipeline', 'runDailyPipeline', 'planArticleVisuals', 'planImagePlaceholders']) {
    assert.equal(typeof articles[name], 'function', `articles 入口缺少 ${name}`);
  }
  for (const name of ['filterCollectedItems', 'CollectionSourceService', 'createStoreCollectionRunner']) {
    assert.equal(typeof collection[name], name === 'CollectionSourceService' ? 'function' : 'function', `collection 入口缺少 ${name}`);
  }
});

test('采集业务用例位于 collection 垂直，platform/collectors 只保留插件运行时', () => {
  const application = path.join(root, 'server', 'features', 'collection', 'application');
  for (const name of ['source-service.mjs', 'collection-runner.mjs', 'store-collection-runner.mjs', 'static-page-assistant.mjs']) {
    assert.equal(fs.existsSync(path.join(application, name)), true, `collection application 缺少 ${name}`);
  }
  for (const name of ['source-service.mjs', 'runner.mjs', 'store-runner.mjs', 'static-page-assistant.mjs']) {
    assert.equal(fs.existsSync(path.join(root, 'server', 'platform', 'collectors', name)), false, `platform/collectors 仍包含业务用例：${name}`);
  }
  const platformFiles = fs.readdirSync(path.join(root, 'server', 'platform', 'collectors'))
    .filter((name) => name.endsWith('.mjs'));
  assert.deepEqual(platformFiles.sort(), [
    'builtin-registry.mjs', 'contracts.mjs', 'package-manager.mjs', 'registry.mjs', 'runtime-registry.mjs', 'settings.mjs',
  ]);
});

test('批次与图文门禁实现位于对应业务垂直', async () => {
  const batchRoutes = read('server/platform/http/routes/batch-routes.mjs');
  const server = read('server.mjs');
  const socialPipeline = read('server/features/social-cards/application/social-card-pipeline.mjs');
  assert.doesNotMatch(batchRoutes, /domain\/(?:batch-pipeline-status|batch-deletion|topic-score-operations)\.mjs/);
  assert.doesNotMatch(server, /domain\/batch-deletion\.mjs/);
  assert.doesNotMatch(socialPipeline, /from ['"]\.\.\.\/domain\/social-card-gate\.mjs['"]/);
  const batches = await import('../server/features/batches/index.mjs');
  assert.equal(typeof batches.buildBatchPipelineStatus, 'function');
  assert.equal(typeof batches.deleteBatchPermanently, 'function');
});

test('server 每个模块目录都有 README 说明职责与依赖边界', () => {
  const walkDirectories = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const relative = path.join(directory, entry.name);
    return [relative, ...walkDirectories(relative)];
  });
  for (const directory of walkDirectories('server')) {
    assert.equal(
      fs.existsSync(path.join(root, directory, 'README.md')),
      true,
      `${directory} 缺少 README.md`
    );
  }
});
