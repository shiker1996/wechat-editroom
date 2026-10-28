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
import { resolvePrompt } from '../../../platform/llm/prompt-registry.mjs';
import { GITHUB_PROJECT_TYPES, GITHUB_SCENARIO_LANES } from '../../../shared/domain/github-repository.mjs';

const QUERIES_FILE = 'repo-discovery-queries.json';
const QUERY_SCHEMA_VERSION = 3;
const BROAD_QUERY_TERMS = new Set(['ai', 'agent', 'agents', 'llm', 'prompt', 'framework', 'cli', 'rust', 'kubernetes']);
const AI_LANES = new Set(['ai-utility', 'agent']);

export const BUILTIN_REPO_DISCOVERY_QUERIES = Object.freeze([
  { label: '网页结果工具', lane: 'browser-automation', query: 'website recreate screenshot preview', projectTypes: ['tool', 'component'], directUseCase: '从网页或界面参考得到可运行、可预览的页面结果', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '文档格式转换', lane: 'file-content', query: 'pdf to markdown converter', projectTypes: ['tool', 'data-content'], directUseCase: '把 PDF 等文档转成可搜索、可继续处理的文本', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '开发者资源', lane: 'developer-productivity', query: 'awesome free developer tools APIs', projectTypes: ['data-content', 'tool'], directUseCase: '按用途找到可直接使用的开发服务或资源，并说明适用限制', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: 'MCP 工作流', lane: 'skills-workflows', query: 'MCP server developer workflow integration', projectTypes: ['skill-workflow', 'tool'], directUseCase: '把具体开发任务接入现有编辑器、终端或自动化流程', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '知识整理检索', lane: 'file-content', query: 'knowledge graph search local notes', projectTypes: ['tool', 'data-content'], directUseCase: '把代码或资料整理成可检索、可浏览的知识结构', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '终端调试工具', lane: 'terminal-remote', query: 'terminal remote development debugging', projectTypes: ['tool', 'infrastructure'], directUseCase: '在终端或远程环境中完成调试、管理或协作任务', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '浏览器自动化', lane: 'browser-automation', query: 'browser automation testing screenshot', projectTypes: ['tool', 'plugin-extension'], directUseCase: '自动执行网页操作或测试并得到可核验结果', createdWithinDays: 90, activityWindowDays: 30, minStars: 50 },
  { label: '实用型 AI 工具', lane: 'ai-utility', query: 'AI document conversion code review browser automation', projectTypes: ['ai-utility', 'tool'], directUseCase: '用 AI 完成具体文件、代码或浏览器任务，并展示输出', createdWithinDays: 60, activityWindowDays: 30, minStars: 100 },
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
  return `## 账号上下文
以下配置决定账号相关度和查询方向，不是仓库或新闻事实；不得自行补充账号没有提供的行业、读者或内容偏好。
${JSON.stringify(accountContext || {}, null, 2)}`;
}

export async function planRepoDiscoveryQueries({ workspaceRoot, gateway, accountContext, refreshDays = 7, maxQueries = 6, provider = '', log = () => {} }) {
  const cached = loadCachedQueries(workspaceRoot, refreshDays);
  if (cached) return cached;
  if (!gateway) return { queries: builtInQueries(maxQueries), generatedAt: null, cached: false, fallback: true };
  const system = resolvePrompt('collection.repo-discovery-queries', { maxQueries }).text;
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
  const system = resolvePrompt('collection.repo-interest-filter').text;
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
