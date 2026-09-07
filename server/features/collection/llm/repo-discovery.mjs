/**
 * AI 兴趣仓库发现（LLM 侧）
 * 1) planRepoDiscoveryQueries：按账号内容支柱/读者画像生成 GitHub Search 查询组，
 *    结果缓存到 data/repo-discovery-queries.json，refreshDays 内复用，失败回退缓存或空数组；
 * 2) filterRepositoriesByInterest：对 AI 查询组搜到的仓库做兴趣相关性打分过滤，
 *    分数与理由随热点入库，供研判评分与推荐理由复用。
 * 采集执行层（plugins/github-discovery/collector.mjs）只做搜索与归并，不感知 LLM。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { GITHUB_PROJECT_TYPES, GITHUB_SCENARIO_LANES } from '../../../shared/domain/github-repository.mjs';

const QUERIES_FILE = 'repo-discovery-queries.json';
const QUERY_SCHEMA_VERSION = 2;
const BROAD_QUERY_TERMS = new Set(['ai', 'agent', 'agents', 'llm', 'prompt', 'framework', 'cli', 'rust', 'kubernetes']);
const AI_LANES = new Set(['ai-utility', 'agent']);

export const BUILTIN_REPO_DISCOVERY_QUERIES = Object.freeze([
  { label: '开发者工具', lane: 'developer-productivity', query: 'topic:developer-tools', projectTypes: ['tool', 'component'], directUseCase: '改善日常开发、调试或代码协作效率', createdWithinDays: 30, activityWindowDays: 30, minStars: 100 },
  { label: '文件处理工具', lane: 'file-content', query: 'pdf markdown converter', projectTypes: ['tool', 'data-content'], directUseCase: '处理 PDF、Markdown 或其他日常文件内容', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '终端远程开发', lane: 'terminal-remote', query: 'terminal remote development', projectTypes: ['tool', 'infrastructure'], directUseCase: '改善终端、SSH 或远程开发体验', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '浏览器自动化', lane: 'browser-automation', query: 'browser automation testing', projectTypes: ['tool', 'plugin-extension'], directUseCase: '自动化浏览器操作、网页测试或扩展能力', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '数据库与同步', lane: 'data-observability', query: 'database backup sync', projectTypes: ['data-content', 'infrastructure'], directUseCase: '处理数据库、备份、同步或可观测性问题', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '可复用组件', lane: 'reusable-components', query: 'library sdk plugin component', projectTypes: ['component', 'plugin-extension'], directUseCase: '把能力作为库、SDK、插件或组件复用', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '工作流自动化', lane: 'skills-workflows', query: 'workflow automation integration', projectTypes: ['skill-workflow', 'tool'], directUseCase: '把重复工作接入自动化工作流', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '实用型 AI 工具', lane: 'ai-utility', query: 'AI PDF code review browser automation', projectTypes: ['ai-utility', 'tool'], directUseCase: '用 AI 直接完成可验证的文件、代码或浏览器任务', createdWithinDays: 60, activityWindowDays: 30, minStars: 100 },
]);

function parseJsonLoose(result, label) {
  return parseModelJson(result, { label });
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeProjectTypes(value) {
  const aliases = {
    cli: 'tool', 'desktop-tool': 'tool', 'browser-extension': 'plugin-extension',
    library: 'component', sdk: 'component', 'ui-component': 'component', plugin: 'plugin-extension',
    skill: 'skill-workflow', workflow: 'skill-workflow', automation: 'skill-workflow',
    'content-tool': 'data-content', 'data-tool': 'data-content', 'agent-optimization': 'agent',
  };
  return [...new Set((Array.isArray(value) ? value : [value]).map((item) => {
    const key = String(item || '').trim().toLowerCase();
    return GITHUB_PROJECT_TYPES.includes(key) ? key : aliases[key] || '';
  }).filter(Boolean))].slice(0, 4);
}

function inferLane(item) {
  const value = String(item?.lane || '').trim();
  if (GITHUB_SCENARIO_LANES.includes(value)) return value;
  const text = `${item?.label || ''} ${item?.query || ''} ${item?.directUseCase || ''}`.toLowerCase();
  if (/pdf|markdown|ocr|document|file|文档|文件/.test(text)) return 'file-content';
  if (/terminal|ssh|remote|tmux|shell|终端|远程/.test(text)) return 'terminal-remote';
  if (/browser|playwright|puppeteer|selenium|网页|浏览器/.test(text)) return 'browser-automation';
  if (/database|backup|sync|log|observability|数据库|备份|同步|日志/.test(text)) return 'data-observability';
  if (/library|sdk|component|plugin|extension|template|库|组件|插件|扩展/.test(text)) return 'reusable-components';
  if (/skill|workflow|automation|integration|mcp|工作流|自动化|集成/.test(text)) return 'skills-workflows';
  if (/ai|llm|agent|prompt|模型|智能体/.test(text)) return 'ai-utility';
  return 'developer-productivity';
}

function isBroadOnlyQuery(query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter((token) => token && !/^(and|or|not)$/.test(token));
  if (!tokens.length) return true;
  const meaningful = tokens.filter((token) => !token.includes(':'));
  return meaningful.length > 0 && meaningful.every((token) => BROAD_QUERY_TERMS.has(token.replace(/[^a-z-]/g, '')));
}

function isAiQuery(item) {
  const lane = inferLane(item);
  return AI_LANES.has(lane) || /(^|\s)(ai|llm|agent|prompt)(\s|$)/i.test(`${item?.query || ''} ${item?.label || ''}`);
}

// 查询组消毒：只保留可用字段并夹紧范围，防止模型输出跑偏后直接进 Search API
export function sanitizeQueries(parsed, { maxQueries = 6 } = {}) {
  const list = Array.isArray(parsed?.queries) ? parsed.queries : [];
  const out = [];
  for (const item of list) {
    const label = String(item?.label || '').trim().slice(0, 40);
    const query = String(item?.query || '').trim().slice(0, 200);
    if (!label || !query) continue;
    if (!query.split(/\s+/).some((token) => !/^(and|or|not)$/i.test(token))) continue;
    if (isBroadOnlyQuery(query)) continue;
    out.push({
      label, lane: inferLane(item), query,
      projectTypes: normalizeProjectTypes(item?.projectTypes),
      directUseCase: String(item?.directUseCase || '').trim().slice(0, 180),
      searchMode: ['active', 'evergreen'].includes(item?.searchMode) ? item.searchMode : 'new',
      language: String(item?.language || '').trim().slice(0, 30),
      createdWithinDays: clampNumber(item?.createdWithinDays, 7, 180, 60),
      activityWindowDays: clampNumber(item?.activityWindowDays, 7, 180, 30),
      minStars: clampNumber(item?.minStars, 10, 5000, 50),
    });
    if (out.length >= maxQueries) break;
  }
  const nonAi = out.filter((item) => !isAiQuery(item));
  if (out.length >= 3 && nonAi.length / out.length < 0.6) {
    return out.filter((item) => !isAiQuery(item) || nonAi.length >= Math.ceil(out.length * 0.6));
  }
  return out;
}

function queriesPath(workspaceRoot) {
  return path.join(workspaceRoot, 'data', QUERIES_FILE);
}

export function loadCachedQueries(workspaceRoot, refreshDays = 7) {
  try {
    const file = queriesPath(workspaceRoot);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number(parsed.schemaVersion || 0) !== QUERY_SCHEMA_VERSION) return null;
    const ageMs = Date.now() - new Date(parsed.generatedAt || 0).getTime();
    if (!Number.isFinite(ageMs) || ageMs > refreshDays * 86400000) return null;
    const queries = sanitizeQueries(parsed);
    return queries.length ? { queries, generatedAt: parsed.generatedAt, cached: true } : null;
  } catch { return null; }
}

function builtInQueries(maxQueries = 6) {
  return sanitizeQueries({ queries: BUILTIN_REPO_DISCOVERY_QUERIES }, { maxQueries });
}

function accountInterestText(accountContext) {
  const pillars = (accountContext?.contentPillars || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  return `- 账号：${accountContext?.name || ''}（${accountContext?.description || ''}）
- 核心读者：${accountContext?.readerProfile || ''}
- 内容支柱：\n${pillars}`;
}

export async function planRepoDiscoveryQueries({ workspaceRoot, gateway, accountContext, refreshDays = 7, maxQueries = 6, provider = '', log = () => {} }) {
  const cached = loadCachedQueries(workspaceRoot, refreshDays);
  if (cached) return cached;
  if (!gateway) return { queries: builtInQueries(maxQueries), generatedAt: null, cached: false, fallback: true };
  const system = `你是技术公众号的开源选题策划。根据账号内容支柱与读者画像，设计 GitHub Search 查询组，用于发现最近活跃、值得公众号写成实操/解读图文的开源项目。
要求：
- 输出 3~${maxQueries} 组查询，优先覆盖具体工作场景：文件/PDF、终端/远程开发、浏览器自动化、数据库/可观测性、开发者效率、隐私本地化、可复用组件、Skill/Workflow；至少 60% 查询组不得以 AI 为中心；
- 至少 1 组覆盖组件、插件、Library 或 SDK，至少 1 组覆盖 Skill、Workflow 或自动化；Agent 相关查询最多 1 组且必须绑定具体工作结果；
- query 字段只写 GitHub Search 的关键词部分（可含 topic: 限定符），不要写 stars:/created:/fork: 等限定符，系统会统一追加；
- 禁止单独使用 llm、agent、ai、prompt、framework、cli、rust、kubernetes 等宽泛词作为 query；每组必须说明读者使用后的直接结果；
- minStars 按领域热度给 50~1000，小众方向放低、大众方向放高；
- 返回严格 JSON：{"queries":[{"label":"方向名（10 字内）","lane":"场景组","query":"关键词","projectTypes":["tool|component|plugin-extension|skill-workflow|data-content|infrastructure|ai-utility|agent"],"directUseCase":"直接结果","searchMode":"new|active|evergreen","language":"可选，留空表示不限","createdWithinDays":30到90,"activityWindowDays":30到180,"minStars":数字}]}`;
  const user = accountInterestText(accountContext);
  try {
    const result = await gateway.complete({
      provider, purpose: 'repo-discovery-queries', jsonMode: true, maxOutputTokens: 2000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const queries = sanitizeQueries(parseJsonLoose(result, '兴趣查询组'), { maxQueries });
    if (!queries.length) throw new Error('模型未返回可用查询组');
    const generatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(queriesPath(workspaceRoot)), { recursive: true });
    fs.writeFileSync(queriesPath(workspaceRoot), JSON.stringify({ schemaVersion: QUERY_SCHEMA_VERSION, generatedAt, queries }, null, 2), 'utf8');
    log(`AI 兴趣查询组已生成 ${queries.length} 组：${queries.map((q) => q.label).join('、')}`);
    return { queries, generatedAt, cached: false };
  } catch (error) {
    const queries = builtInQueries(maxQueries);
    log(`AI 兴趣查询组生成失败，回退内置场景查询：${error.message}`);
    return { queries, generatedAt: null, cached: false, fallback: true };
  }
}

// 兴趣相关性过滤：对 AI 查询组发现的仓库按片并发打分，保留 >= threshold 的。
// 单片失败只放行该片（fail-open）并记日志——宁可多进热点，不让一次模型故障清空发现通道。
const INTEREST_CHUNK_SIZE = 25;
const INTEREST_CONCURRENCY = 4;
export async function filterRepositoriesByInterest({ gateway, accountContext, repos, threshold = 6, provider = '', log = () => {}, chunkSize = INTEREST_CHUNK_SIZE, concurrency = INTEREST_CONCURRENCY }) {
  const list = (repos || []).filter((repo) => repo?.repository);
  if (!list.length || !gateway) return repos || [];
  const system = `你是技术公众号的选题编辑。按"核心读者是否会想读一篇该仓库的实操/解读图文"为每个仓库打 0~10 分，并给一句 20 字内的中文理由。
评分锚点：9-10 分=读者会立刻想试用且能解决具体工作问题的工具；7-8 分=与内容支柱强相关并有明确输入输出；5-6 分=相关但受众窄或同质严重；0-4 分=与账号定位基本无关。
纯 Agent、Agent Framework、Agent 优化或只讲模型编排的项目，除非绑定具体工作场景并提供可运行结果，否则最高 5 分；AI PDF、代码审查、浏览器自动化、知识库和终端工具等实用型 AI 项目不因使用 AI 被降权。
返回严格 JSON：{"results":[{"repository":"owner/name","score":数字,"reason":"理由"}]}，必须覆盖全部输入仓库。`;
  const batches = [];
  for (let index = 0; index < list.length; index += Math.max(1, chunkSize)) batches.push(list.slice(index, index + chunkSize));
  const scoreBatch = async (batch) => {
    const catalog = batch.map((repo, i) => `${i + 1}. ${repo.repository}｜${repo.description || '无简介'}｜topics:${(repo.topics || []).join(',') || '无'}｜场景:${(repo.scenarioIds || []).join(',') || '未识别'}｜类型:${repo.projectType || '未识别'}｜直接用途:${repo.directUseCase || '未说明'}｜来源:${(repo.discoveryContexts || []).map((context) => context.label || context.channel).filter(Boolean).slice(0, 3).join(',') || '未记录'}｜${repo.language || '未知'}｜⭐${repo.stars ?? '?'}`).join('\n');
    const user = `${accountInterestText(accountContext)}\n\n候选仓库：\n${catalog}`;
    try {
      const result = await gateway.complete({
        provider, purpose: 'repo-interest-filter', jsonMode: true, maxOutputTokens: 4000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      const parsed = parseJsonLoose(result, '仓库兴趣相关性评分');
      return new Map((Array.isArray(parsed?.results) ? parsed.results : [])
        .map((r) => [String(r?.repository || '').toLowerCase(), { score: clampNumber(r?.score, 0, 10, 0), reason: String(r?.reason || '').slice(0, 60) }]));
    } catch (error) {
      log(`兴趣相关性过滤分片失败，放行该片 ${batch.length} 个仓库：${error.message}`);
      return new Map();
    }
  };
  const scores = new Map(); let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const index = cursor++; const partial = await scoreBatch(batches[index]);
      for (const [key, value] of partial) scores.set(key, value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), batches.length) }, () => worker()));
  const kept = []; const dropped = [];
  for (const repo of repos) {
    const hit = repo?.repository ? scores.get(repo.repository.toLowerCase()) : null;
    if (!repo?.repository || !hit || hit.score >= threshold) {
      kept.push(hit ? { ...repo, interestScore: hit.score, interestReason: hit.reason } : repo);
    } else {
      dropped.push(`${repo.repository}(${hit.score})`);
    }
  }
  log(`兴趣相关性过滤：保留 ${kept.length}/${repos.length}（阈值 ${threshold} 分，${batches.length} 片并发）${dropped.length ? `，过滤：${dropped.slice(0, 5).join('、')}${dropped.length > 5 ? ' 等' : ''}` : ''}`);
  return kept;
}
