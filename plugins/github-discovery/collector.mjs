import { classifyGitHubRepository, normalizeGitHubRepository } from './classification.mjs';

export function repositoryFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const repository = normalizeGitHubRepository(url.pathname);
    if (!repository) return null;
    const [owner, repo] = repository.split('/');
    return { repository: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
  } catch { return null; }
}

function mergeRepository(map, item, channel) {
  const parsed = repositoryFromUrl(item.url) || (item.repository && normalizeGitHubRepository(item.repository)
    ? { repository: normalizeGitHubRepository(item.repository), url: `https://github.com/${normalizeGitHubRepository(item.repository)}` }
    : null);
  if (!parsed) return;
  const key = parsed.repository.toLowerCase();
  const current = map.get(key);
  const channels = [...new Set([...(current?.discoveryChannels || []), channel, ...(item.discoveryChannels || [])])];
  const modes = [...new Set([...(current?.discoveryModes || []), item.discoveryMode].filter(Boolean))];
  const fallbackContext = {
    channel,
    sourceType: item.sourceType || '',
    sourceKey: item.sourceKey || '',
    sourceName: item.sourceName || '',
  };
  const incomingContexts = Array.isArray(item.discoveryContexts) && item.discoveryContexts.length
    ? item.discoveryContexts
    : [fallbackContext];
  const discoveryContexts = [...(current?.discoveryContexts || []), ...incomingContexts]
    .filter((context) => context && typeof context === 'object')
    .filter((context, index, list) => list.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(context)) === index)
    .slice(0, 12);
  const priority = { trending: 4, 'ai-search': 3, search: 2, mentioned: 1 };
  const preferred = !current || priority[channel] > priority[current.primaryDiscovery || 'mentioned'] ? item : current;
  const merged = {
    ...current,
    ...preferred,
    id: `github:${key}`,
    title: parsed.repository,
    url: parsed.url,
    repository: parsed.repository,
    sourceGroup: 'github',
    discoveryChannels: channels,
    discoveryModes: modes,
    discoveryContexts,
    primaryDiscovery: channels.sort((a, b) => priority[b] - priority[a])[0],
  };
  const contextTypes = discoveryContexts.flatMap((context) => Array.isArray(context.projectTypes) ? context.projectTypes : []);
  const contextLanes = discoveryContexts.map((context) => context.lane).filter(Boolean);
  const contextUseCases = discoveryContexts.map((context) => context.directUseCase).find(Boolean) || '';
  const classificationInput = {
    ...merged,
    scenarioIds: [...new Set([...(merged.scenarioIds || []), ...contextLanes])],
    projectTypes: [...new Set([...(Array.isArray(merged.projectTypes) ? merged.projectTypes : []), ...contextTypes])],
    directUseCase: merged.directUseCase || contextUseCases,
  };
  map.set(key, { ...merged, ...classifyGitHubRepository(classificationInput, classificationInput) });
}

const LOGICAL_OPERATOR = /^(and|or|not)$/i;

// 把 AI 查询拆成可执行的子查询：只要存在普通文本词条就原样返回；
// 仅由限定符 + 逻辑运算符组成的查询会被 GitHub 拒绝，这里按 OR 拆分。
export function expandAiQueryKeywords(keywords) {
  const tokens = String(keywords || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const hasTextTerm = tokens.some((token) => !LOGICAL_OPERATOR.test(token) && !token.includes(':'));
  if (hasTextTerm) return [tokens.join(' ')];
  const groups = []; let current = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^or$/i.test(token)) { if (current.length) groups.push(current.join(' ')); current = []; }
    else if (/^and$/i.test(token)) continue;
    else if (/^not$/i.test(token)) { i += 1; }
    else current.push(token);
  }
  if (current.length) groups.push(current.join(' '));
  return groups.filter(Boolean);
}

async function searchRepositories({ requestGitHubJson, config, query, limit, sort = 'stars', mode, days, minStars, onProgress }) {
  const result = await requestGitHubJson(`/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=${limit}`, {
    cacheDir: config.cacheDir,
    ttlMs: Number(config.cacheTtlMs || 30 * 60 * 1000),
    fetchImpl: config.fetchImpl || fetch,
    token: config.token ?? process.env.GITHUB_ACCESS_TOKEN,
  });
  return (result.items || []).slice(0, limit).map((repo) => ({
    url: repo.html_url,
    repository: repo.full_name,
    sourceType: 'search',
    sourceKey: 'github:search',
    sourceName: mode === 'active' ? 'GitHub 活跃项目发现' : 'GitHub 新项目发现',
    publishedAt: new Date().toISOString(),
    description: repo.description || '',
    language: repo.language || '',
    stars: repo.stargazers_count,
    topics: repo.topics || [],
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    searchQuery: query,
    discoveryMode: mode,
    discoveryContexts: [{ channel: 'search', mode, query, windowDays: days, minStars }],
  }));
}

export async function discoverGitHubRepositories(items, config = {}, onProgress = () => {}, onSourceResult = () => {}) {
  const requestGitHubJson = config.requestGitHubJson || config.githubRequest || (config.fetchImpl
    ? async (apiPath, options = {}) => {
      const response = await config.fetchImpl(`https://api.github.com${apiPath}`, options);
      if (!response.ok) throw new Error(`GitHub API ${response.status}`);
      return response.json();
    }
    : null);
  if (config.enabled !== false && typeof requestGitHubJson !== 'function') throw new Error('GitHub 宿主服务未注入');

  const map = new Map(); const others = [];
  for (const item of items) {
    if (item.sourceGroup === 'github') { mergeRepository(map, item, item.sourceType || item.primaryDiscovery || 'trending'); continue; }
    others.push(item);
    for (const url of item.githubRepositories || []) {
      const parsed = repositoryFromUrl(url);
      if (parsed) mergeRepository(map, {
        ...parsed,
        sourceType: 'mentioned', sourceKey: 'github:mentioned', sourceName: '其他热点提及的 GitHub 项目',
        publishedAt: item.publishedAt, mentionedBy: [{ title: item.title, url: item.url, source: item.sourceName }],
      }, 'mentioned');
    }
  }
  if (config.enabled === false) return [...others, ...map.values()];

  if (config.searchEnabled !== false) {
    const baseMinStars = Math.max(1, Number(config.minStars || 1000));
    const limit = Math.max(1, Math.min(100, Number(config.limit || 30)));
    const searches = [
      { mode: 'new', days: Math.max(1, Number(config.createdWithinDays || 30)), minStars: baseMinStars, field: 'created', sort: 'stars' },
      ...(config.activeSearchEnabled === false ? [] : [{
        mode: 'active', days: Math.max(7, Number(config.activeWithinDays || 30)),
        minStars: Math.max(10, Number(config.activeMinStars || Math.min(baseMinStars, 100))), field: 'pushed', sort: 'updated',
      }]),
      ...(config.evergreenSearchEnabled === false ? [] : [{
        mode: 'evergreen', days: Math.max(30, Number(config.evergreenWithinDays || 180)),
        minStars: Math.max(10, Number(config.evergreenMinStars || Math.max(baseMinStars, 500))), field: 'pushed', sort: 'stars',
      }]),
    ];
    const startedAt = new Date().toISOString(); const started = Date.now(); let success = false; let total = 0; const failures = [];
    for (const search of searches) {
      const after = new Date(Date.now() - search.days * 86400000).toISOString().slice(0, 10);
      const query = `stars:>=${search.minStars} ${search.field}:>=${after} fork:false archived:false`;
      try {
        onProgress(search.mode === 'active'
          ? `正在发现最近 ${search.days} 天活跃且 Star ≥ ${search.minStars} 的 GitHub 项目`
          : search.mode === 'evergreen'
            ? `正在发现最近 ${search.days} 天仍活跃且 Star ≥ ${search.minStars} 的成熟 GitHub 项目`
            : `正在发现最近 ${search.days} 天新建且 Star ≥ ${search.minStars} 的 GitHub 项目`);
        const found = await searchRepositories({ requestGitHubJson, config, query, limit, sort: search.sort, mode: search.mode, days: search.days, minStars: search.minStars, onProgress });
        for (const repo of found) { mergeRepository(map, repo, 'search'); total += 1; }
        success = true;
      } catch (error) { failures.push(`${search.mode}：${error.message}`); }
    }
    onSourceResult({
      sourceGroup: 'github', sourceType: 'search', sourceKey: 'github:search', sourceName: 'GitHub 新项目与活跃项目发现',
      status: success ? 'success' : 'failed', itemCount: total, durationMs: Date.now() - started,
      ...(success ? {} : { error: failures[0] || '搜索失败' }), startedAt, endedAt: new Date().toISOString(),
    });
    if (!success) onProgress(`GitHub Search 发现失败，已保留 Trending 与热点提及结果：${failures[0] || '未知错误'}`);
  }

  // AI 兴趣查询组由 job-manager 经 LLM 规划后传入；这里负责搜索、归并和基础分类。
  for (const spec of Array.isArray(config.aiQueries) ? config.aiQueries : []) {
    const label = String(spec?.label || '兴趣发现').slice(0, 40);
    const subQueries = expandAiQueryKeywords(spec?.query);
    if (!subQueries.length) continue;
    const mode = ['active', 'evergreen'].includes(spec.searchMode) ? spec.searchMode : 'new';
    const days = Math.max(7, Number(mode !== 'new' ? spec.activityWindowDays || spec.createdWithinDays || 60 : spec.createdWithinDays || 60));
    const stars = Math.max(10, Number(spec.minStars || 50));
    const perQuery = Math.max(1, Math.min(50, Number(spec.limit || 15)));
    const after = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const language = String(spec.language || '').trim();
    const timeField = mode !== 'new' ? 'pushed' : 'created';
    const suffix = ` stars:>=${stars} ${timeField}:>=${after} fork:false archived:false${language ? ` language:${language}` : ''}`;
    const sourceKey = `github:ai-search:${label}`; const queryStarted = Date.now(); const queryStartedAt = new Date().toISOString();
    const found = []; const failures = [];
    for (const keywords of subQueries) {
      const query = `${keywords}${suffix}`;
      try {
        onProgress(`正在按兴趣方向「${label}」搜索 GitHub 项目${subQueries.length > 1 ? `（${keywords}）` : ''}`);
        const result = await requestGitHubJson(`/search/repositories?q=${encodeURIComponent(query)}&sort=${mode === 'active' ? 'updated' : 'stars'}&order=desc&per_page=${perQuery}`, {
          cacheDir: config.cacheDir, ttlMs: Number(config.cacheTtlMs || 30 * 60 * 1000), fetchImpl: config.fetchImpl || fetch,
          token: config.token ?? process.env.GITHUB_ACCESS_TOKEN,
        });
        for (const repo of (result.items || []).slice(0, perQuery)) {
          if (found.some((item) => item.repository === repo.full_name)) continue;
          found.push({
            url: repo.html_url, repository: repo.full_name, sourceType: 'ai-search', sourceKey,
            sourceName: `AI 兴趣发现 · ${label}`, publishedAt: queryStartedAt, description: repo.description || '',
            language: repo.language || '', stars: repo.stargazers_count, topics: repo.topics || [],
            createdAt: repo.created_at, updatedAt: repo.updated_at, searchQuery: query, discoveryMode: mode,
            lane: spec.lane, projectTypes: spec.projectTypes, directUseCase: spec.directUseCase,
            discoveryContexts: [{ channel: 'ai-search', label, lane: spec.lane, query: keywords, searchQuery: query,
              searchMode: mode, projectTypes: spec.projectTypes || [], directUseCase: spec.directUseCase || '',
              windowDays: days, minStars: stars }],
          });
        }
      } catch (error) { failures.push(`${keywords}：${error.message}`); }
    }
    if (found.length) {
      for (const repo of found) mergeRepository(map, repo, 'ai-search');
      onSourceResult({ sourceGroup: 'github', sourceType: 'ai-search', sourceKey, sourceName: `AI 兴趣发现 · ${label}`, status: 'success', itemCount: found.length, durationMs: Date.now() - queryStarted, startedAt: queryStartedAt, endedAt: new Date().toISOString() });
    } else if (failures.length) {
      onProgress(`兴趣方向「${label}」搜索失败，已跳过：${failures[0]}`);
      onSourceResult({ sourceGroup: 'github', sourceType: 'ai-search', sourceKey, sourceName: `AI 兴趣发现 · ${label}`, status: 'failed', itemCount: 0, durationMs: Date.now() - queryStarted, error: failures[0], startedAt: queryStartedAt, endedAt: new Date().toISOString() });
    }
  }
  return [...others, ...map.values()].map((item) => item.sourceGroup === 'github' ? {
    ...item,
    sourceType: item.primaryDiscovery,
    sourceKey: `github:${item.primaryDiscovery}`,
    sourceName: item.primaryDiscovery === 'trending' || item.primaryDiscovery === 'ai-search' ? item.sourceName
      : item.primaryDiscovery === 'search' ? 'GitHub 新项目与活跃项目发现' : '其他热点提及的 GitHub 项目',
  } : item);
}
