const HF_DAILY = 'https://huggingface.co/api/daily_papers';
const ARXIV_API = 'https://export.arxiv.org/api/query';
const USER_AGENT = 'WriteAssistant-PaperRadar/1.0';
const text = (value) => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const tag = (block, name) => text(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
const arxivId = (value) => String(value || '').match(/(?:abs\/|pdf\/)?((?:\d{4}\.\d{4,5})(?:v\d+)?)/)?.[1] || '';
const normalizeTitle = (value) => text(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const dateMs = (value) => { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; };
const errorDetail = (error) => error?.cause?.code ? `${error.message} (${error.cause.code})` : error?.message || String(error);

async function get(fetchImpl, url, extraHeaders = {}) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json, application/atom+xml, application/rss+xml, application/xml', 'user-agent': USER_AGENT, ...extraHeaders }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 300); } catch {}
    throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }
  return response;
}

function normalizePaper({ id = '', title = '', url = '', publishedAt = '', discoveredAt = '', discoveryWindowDays = null, authors = [], summary = '', source, venue = '', status = 'unknown', metrics = {} }) {
  return {
    externalId: id || arxivId(url) || url,
    title: text(title) || '无标题',
    url: url || (id ? `https://arxiv.org/abs/${id}` : ''),
    discussionUrl: null,
    summary: text(summary),
    author: Array.isArray(authors) ? authors.map((item) => typeof item === 'string' ? item : item?.name || item?.fullname || '').filter(Boolean).join(', ') : text(authors),
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    metrics,
    raw: { sourceType: 'paper', paperStatus: status, venue: venue || 'NO_DATA', arxivId: arxivId(id) || arxivId(url) || 'NO_DATA', discoverySources: [source], ...(discoveredAt ? { discoveredAt: new Date(discoveredAt).toISOString() } : {}), ...(discoveryWindowDays ? { discoveryWindowDays } : {}), ...metrics },
  };
}

async function collectHuggingFace(fetchImpl, windowDays, limit) {
  const all = [];
  let fetchedCount = 0;
  const today = new Date();
  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
    const query = new URLSearchParams({ date, p: '0', limit: String(limit), sort: 'trending' });
    const payload = await (await get(fetchImpl, `${HF_DAILY}?${query}`)).json();
    const rows = Array.isArray(payload) ? payload : payload?.papers || payload?.items || [];
    fetchedCount += rows.length;
    for (const row of rows) {
      const paper = row.paper || row;
      const id = String(paper.id || paper._id || '');
      const paperId = arxivId(id) || id;
      const url = paperId ? `https://arxiv.org/abs/${paperId}` : `https://huggingface.co/papers/${id}`;
      const publishedAt = paper.publishedAt || paper.published_at || paper.date || date;
      const upvotes = row.upvotes ?? paper.upvotes;
      all.push(normalizePaper({ id: paperId, title: paper.title, url, publishedAt, discoveredAt: date, discoveryWindowDays: windowDays, authors: paper.authors, summary: paper.summary || paper.abstract, source: 'huggingface_papers', status: 'preprint', metrics: { platform: 'Hugging Face Daily Papers', ...(upvotes !== undefined ? { upvotes } : {}) } }));
    }
  }
  return { items: all, fetchedCount };
}

async function collectArxiv(fetchImpl, windowDays, categories, limit) {
  const now = new Date(), start = new Date(now.getTime() - windowDays * 86400000);
  const stamp = (date) => date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
  const categoryQuery = categories.map((category) => `cat:${category}`).join(' OR ');
  const search = `(${categoryQuery}) AND submittedDate:[${stamp(start)} TO ${stamp(now)}]`;
  const query = new URLSearchParams({ search_query: search, start: '0', max_results: String(limit), sortBy: 'submittedDate', sortOrder: 'descending' });
  const xml = await (await get(fetchImpl, `${ARXIV_API}?${query}`)).text();
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return { items: entries.map((entry) => {
    const idUrl = tag(entry, 'id');
    const id = arxivId(idUrl);
    const authors = [...entry.matchAll(/<author\b[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((match) => text(match[1]));
    const categoriesFound = [...entry.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?\s*>/gi)].map((match) => match[1]);
    const publishedAt = tag(entry, 'published');
    return normalizePaper({ id, title: tag(entry, 'title'), url: idUrl, publishedAt, discoveredAt: publishedAt, discoveryWindowDays: windowDays, authors, summary: tag(entry, 'summary'), source: 'arxiv', status: 'preprint', metrics: { categories: categoriesFound } });
  }), fetchedCount: entries.length };
}

export async function collectPapers(source = {}, configuration = {}, { fetchImpl = fetch, onProgress = () => {} } = {}) {
  if (configuration.enabled === false) throw new Error('论文采集器已在系统配置中停用');
  const windowDays = Math.min(30, Math.max(1, Number(source.windowDays || configuration.windowDays) || 7));
  const limit = Math.min(100, Math.max(1, Number(source.limit || configuration.maxItems) || 10));
  const categories = String(configuration.categories || 'cs.AI,cs.LG,cs.CL,cs.HC,cs.SE,cs.CY').split(',').map((item) => item.trim()).filter(Boolean);
  const enabled = [
    ['Hugging Face Daily Papers', configuration.huggingFaceEnabled !== false, () => collectHuggingFace(fetchImpl, windowDays, limit)],
    ['arXiv', configuration.arxivEnabled !== false, () => collectArxiv(fetchImpl, windowDays, categories, limit)],
  ];
  const results = [], failures = [], sourceResults = [];
  if (!enabled.some(([, active]) => active)) throw new Error('请在系统配置中至少启用一个论文采集源');
  for (const [label, active, collect] of enabled) {
    if (!active) continue;
    onProgress(`正在采集论文：${label}`);
    try {
      const collected = await collect();
      const items = (Array.isArray(collected) ? collected : collected.items || []).slice(0, limit);
      results.push(...items);
      const warnings = Array.isArray(collected) ? [] : collected.warnings || [];
      failures.push(...warnings.map((error) => ({ source: label, error })));
      const status = items.length ? warnings.length ? 'partial' : 'success' : warnings.length ? 'failed' : 'empty';
      sourceResults.push({ source: label, status, fetchedCount: Array.isArray(collected) ? items.length : Number(collected.fetchedCount ?? items.length), keptCount: items.length,
        ...(warnings.length ? { warnings: warnings.map(String) } : {}), items: items.map(({ title, url, publishedAt, externalId }) => ({ title, url, publishedAt, externalId })) });
      onProgress(`${label}：${status}，候选 ${sourceResults.at(-1).fetchedCount} 条，保留 ${items.length} 条`);
    } catch (error) {
      const detail = errorDetail(error);
      failures.push({ source: label, error: detail });
      sourceResults.push({ source: label, status: 'failed', fetchedCount: 0, keptCount: 0, error: detail, items: [] });
      onProgress(`${label}：失败，${detail}`);
    }
  }
  const activeSources = enabled.filter(([, active]) => active);
  if (failures.length === activeSources.length && activeSources.length) throw new Error(`所有论文采集源均失败：${failures.map(({ source, error }) => `${source}（${error}）`).join('；')}`);

  const byIdentity = new Map();
  for (const item of results) {
    const key = normalizeTitle(item.title) || arxivId(item.externalId || item.url) || item.url;
    const existing = byIdentity.get(key);
    if (!existing) { byIdentity.set(key, item); continue; }
    existing.raw.discoverySources = [...new Set([...existing.raw.discoverySources, ...item.raw.discoverySources])];
    const discoveryTimes = [existing.raw.discoveredAt, item.raw.discoveredAt].filter(Boolean).sort();
    if (discoveryTimes.length) existing.raw.discoveredAt = discoveryTimes.at(-1);
    existing.raw.discoveryWindowDays = Math.max(Number(existing.raw.discoveryWindowDays) || 0, Number(item.raw.discoveryWindowDays) || 0) || undefined;
    if (item.raw.paperStatus === 'peer-reviewed') { existing.raw.paperStatus = 'peer-reviewed'; existing.raw.venue = item.raw.venue; }
    if (item.metrics.upvotes !== undefined) existing.metrics = { ...existing.metrics, upvotes: item.metrics.upvotes, platform: item.metrics.platform };
  }
  const items = [...byIdentity.values()].sort((a, b) => dateMs(b.publishedAt) - dateMs(a.publishedAt));
  onProgress(`论文雷达完成：${sourceResults.map((item) => `${item.source} ${item.status} ${item.keptCount}/${item.fetchedCount}`).join('；')}；去重后保留 ${items.length} 篇`);
  return { items, warnings: failures.map(({ source: name, error }) => `${name}: ${error}`), provenance: { providers: enabled.filter(([, active]) => active).map(([name]) => name), failures, windowDays, perSourceLimit: limit, sourceResults } };
}

export function createAdapter({ configuration = {}, onProgress = () => {}, fetchImpl = fetch } = {}) {
  const collect = (source) => collectPapers(source, configuration, { fetchImpl, onProgress });
  return {
    collect: async (source) => ({ status: 'ok', ...(await collect(source)) }),
    test: async (source) => { const result = await collect({ ...source, limit: Math.min(5, source.limit || 5) }); return { ok: true, title: '学术论文雷达', itemCount: result.items.length, items: result.items.slice(0, 5).map(({ title, url }) => ({ title, url })), warnings: result.warnings }; },
  };
}
