export const GITHUB_SCENARIO_LANES = Object.freeze([
  'file-content', 'terminal-remote', 'browser-automation', 'data-observability',
  'developer-productivity', 'privacy-local', 'reusable-components', 'skills-workflows',
]);

export const GITHUB_PROJECT_TYPES = Object.freeze([
  'tool', 'component', 'plugin-extension', 'skill-workflow', 'data-content', 'infrastructure', 'ai-utility', 'agent',
]);

const SCENARIO_PATTERNS = Object.freeze({
  'file-content': /pdf|markdown|md\b|ocr|document|file|text extraction|knowledge base|知识库|文档|文件|转换|文本/i,
  'terminal-remote': /terminal|shell|ssh|remote|tmux|zellij|vscode server|终端|远程开发|命令行/i,
  'browser-automation': /browser|playwright|puppeteer|selenium|web test|extension|网页|浏览器|自动化测试|浏览器扩展/i,
  'data-observability': /database|postgres|mysql|sqlite|backup|sync|log|observability|monitor|数据库|备份|同步|日志|监控|可观测/i,
  'developer-productivity': /developer tool|devtool|cli|code review|debug|lint|git|开发者|代码审查|调试|效率/i,
  'privacy-local': /privacy|local[- ]first|self-host|offline|on-premise|隐私|本地优先|自托管|离线/i,
  'reusable-components': /library|sdk|component|template|package|module|库|组件|模板|模块/i,
  'skills-workflows': /skill|workflow|automation|integration|mcp|plugin|集成|工作流|自动化/i,
});

const PROJECT_TYPE_PATTERNS = Object.freeze([
  ['plugin-extension', /plugin|extension|browser extension|editor extension|插件|扩展/i],
  ['skill-workflow', /skill|workflow|automation|integration|mcp|工作流|自动化|集成/i],
  ['component', /library|sdk|component|template|package|module|库|组件|模板|模块/i],
  ['data-content', /pdf|markdown|ocr|document|file converter|文档|文件转换|知识库/i],
  ['infrastructure', /database|kubernetes|docker|deploy|observability|monitoring|数据库|部署|可观测|监控/i],
  ['tool', /cli|desktop|app|tool|terminal|browser|开发者工具|命令行|桌面|工具/i],
]);

const AGENT_SIGNAL_PATTERNS = Object.freeze([
  ['agent-framework', /agent framework|multi-agent|agent memory|agent benchmark|多智能体|智能体框架/i],
  ['prompt-optimization', /prompt engineering|prompt optimization|prompt framework|提示词工程|提示词优化/i],
  ['llm-orchestration', /llm router|llm orchestration|model router|模型编排|模型路由/i],
]);

function textOf(values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).filter((value) => value != null && String(value).trim()).map((value) => String(value).trim()).join(' ');
}

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase();
  const aliases = { cli: 'tool', 'desktop-tool': 'tool', 'browser-extension': 'plugin-extension', library: 'component', sdk: 'component', 'ui-component': 'component', plugin: 'plugin-extension', skill: 'skill-workflow', workflow: 'skill-workflow', automation: 'skill-workflow', 'content-tool': 'data-content', 'data-tool': 'data-content', 'agent-optimization': 'agent' };
  return GITHUB_PROJECT_TYPES.includes(type) ? type : aliases[type] || '';
}

export function normalizeGitHubRepository(value) {
  const declared = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const [owner, repo] = declared.split('/').filter(Boolean).slice(0, 2);
  return owner && repo && !['topics', 'trending', 'search', 'marketplace'].includes(owner.toLowerCase()) ? `${owner}/${repo}`.toLowerCase() : '';
}

export function classifyGitHubRepository(repository = {}, querySpec = {}) {
  const text = textOf([repository.repository, repository.description, repository.topics, repository.language, repository.searchQuery, querySpec.label, querySpec.query, querySpec.directUseCase]);
  const scenarios = [...new Set([
    ...(Array.isArray(repository.scenarioIds) ? repository.scenarioIds : []),
    ...(Array.isArray(querySpec.scenarioIds) ? querySpec.scenarioIds : []),
    ...(GITHUB_SCENARIO_LANES.includes(String(querySpec.lane)) ? [String(querySpec.lane)] : []),
    ...Object.entries(SCENARIO_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([name]) => name),
  ])].filter((item) => GITHUB_SCENARIO_LANES.includes(item)).slice(0, 4);
  const explicitType = normalizeType(repository.projectType || querySpec.projectType || querySpec.projectTypes?.[0]);
  const isAgent = /(^|\s)(agent|agents|llm|prompt)(\s|$)|agent framework|multi-agent|智能体/i.test(text);
  const projectType = explicitType || (isAgent ? 'agent' : PROJECT_TYPE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || 'tool');
  const agentSignals = AGENT_SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  if (projectType === 'agent' && !agentSignals.length) agentSignals.push('agent-keyword');
  const agentDependency = projectType === 'agent' ? 'required' : /\b(ai|llm|model|embedding|模型|智能体)\b/i.test(text) ? 'optional' : 'none';
  const directUseCase = String(repository.directUseCase || querySpec.directUseCase || '').trim().slice(0, 180);
  return {
    projectType,
    scenarioIds: scenarios,
    directUseCase,
    agentDependency,
    agentSignals,
    classificationEvidence: querySpec.lane || querySpec.projectTypes?.length ? 'query-lane' : repository.description || repository.topics?.length ? 'metadata' : 'uncertain',
    classificationReason: directUseCase || `${projectType}${scenarios.length ? ` · ${scenarios.join('、')}` : ''}`,
  };
}
