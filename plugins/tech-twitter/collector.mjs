const BASE_URL = 'https://www.techtwitter.com';
const STREAM_CATEGORIES = ['ai-ml', 'startups', 'coding', 'product', 'platform'];

function failure(message, code = 'NETWORK_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedLimit(source) {
  return Math.min(20, Math.max(1, Number(source.limit) || 20));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ').trim();
}

function collectionRows(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return Array.isArray(payload?.data) ? payload.data : [];
}

function mapTweet(tweet, surface, category = null) {
  const id = String(tweet.id || tweet.tweet_id || '').trim();
  const url = String(tweet.tweet_url || tweet.url || '').trim();
  const text = String(tweet.tweet_text || tweet.text || '').trim();
  const title = String(tweet.seo_title || tweet.article_title || text).trim();
  const canonicalUrl = tweet.slug ? `${BASE_URL}/tweet/${encodeURIComponent(tweet.slug)}` : '';
  return {
    externalId: id || url,
    title: title.slice(0, 500),
    url,
    discussionUrl: canonicalUrl && canonicalUrl !== url ? canonicalUrl : null,
    summary: String(tweet.summary || text).slice(0, 20000),
    author: tweet.author_handle ? `${tweet.author_name || tweet.author_handle} (@${tweet.author_handle})` : String(tweet.author_name || ''),
    publishedAt: tweet.timestamp || null,
    metrics: {
      likes: tweet.like_count ?? null,
      replies: tweet.comment_count ?? null,
      reposts: tweet.retweet_count ?? null,
      bookmarks: tweet.bookmark_count ?? null,
      qualityScore: tweet.quality_score ?? null,
    },
    raw: {
      provider: 'techtwitter', surface, category, contentType: tweet.content_type || 'tweet',
      sourceUrl: url || null, canonicalUrl: canonicalUrl || null, sourceEndpoint: tweet.sourceEndpoint || null,
      qualityScore: tweet.quality_score ?? null, keywords: Array.isArray(tweet.keywords) ? tweet.keywords : [],
      articleTitle: tweet.article_title || null,
    },
  };
}

function mapArticle(article) {
  const url = String(article.url || article.article_url || article.canonical_url || (article.slug ? `${BASE_URL}/articles/${encodeURIComponent(article.slug)}` : '')).trim();
  const title = String(article.title || article.seo_title || article.headline || '').trim();
  const author = article.author_name || article.author || article.author_handle || '';
  return {
    externalId: String(article.id || article.slug || url).trim(), title: title.slice(0, 500), url,
    summary: String(article.summary || article.excerpt || article.description || article.subtitle || '').slice(0, 20000),
    author: String(author), publishedAt: article.published_at || article.publishedAt || article.created_at || null,
    metrics: { qualityScore: article.quality_score ?? null },
    raw: { provider: 'techtwitter', surface: 'articles', contentType: 'article', slug: article.slug || null, keywords: article.keywords || article.tags || [] },
  };
}

function mapThreadsPage(html, limit) {
  const records = [];
  const seen = new Set();
  const anchor = /<a\b[^>]*href=["']([^"']*\/threads\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(anchor)) {
    const href = match[1].startsWith('http') ? match[1] : new URL(match[1], BASE_URL).href;
    if (seen.has(href)) continue;
    seen.add(href);
    const title = decodeHtml(match[2]);
    if (!title || /^(threads|read more|view thread)$/i.test(title)) continue;
    records.push({
      externalId: href, title: title.slice(0, 500), url: href,
      summary: `TechTwitter Threads 专题：${title}`,
      author: 'TechTwitter 编辑精选', publishedAt: null,
      metrics: {}, raw: { provider: 'techtwitter', surface: 'threads', contentType: 'thread-edition', sourceUrl: href, access: 'public listing; subscriber-only remainder is not fetched' },
    });
    if (records.length >= limit) break;
  }
  return records;
}

async function request(source, path, options, responseType = 'json') {
  const endpoint = new URL(path, BASE_URL);
  let response;
  try {
    response = await options.fetchImpl(endpoint, {
      signal: AbortSignal.timeout(Number(source.timeoutMs) || 30000),
      headers: { accept: responseType === 'json' ? 'application/json' : 'text/html' },
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw failure('TechTwitter 请求超时', 'TIMEOUT');
    throw error;
  }
  if (response.status === 429) {
    const retryAfter = response.headers?.get?.('retry-after');
    throw failure(`TechTwitter API 达到速率限制${retryAfter ? `，请在 ${retryAfter} 秒后再试` : ''}`, 'RATE_LIMITED');
  }
  if (response.status === 400) throw failure('TechTwitter API 参数无效', 'INVALID_SOURCE_CONFIG');
  if (response.status === 503) throw failure('TechTwitter 服务暂不可用');
  if (!response.ok) throw failure(`TechTwitter 返回 HTTP ${response.status}`);
  try { return responseType === 'json' ? await response.json() : await response.text(); }
  catch { throw failure(`TechTwitter ${responseType === 'json' ? 'API' : 'Threads 页面'}返回内容无法解析`); }
}

async function collectSurface(source, options, surface, path, mapper, responseType = 'json') {
  const payload = await request(source, path, options, responseType);
  if (surface === 'threads') return mapThreadsPage(payload, boundedLimit(source));
  return collectionRows(payload, surface === 'articles' ? ['articles', 'items', 'results'] : ['tweets', 'items', 'results'])
    .map((row) => mapper(row, surface))
    .filter((item) => item.title && item.url)
    .slice(0, boundedLimit(source));
}

export async function collectTechTwitter(source = {}, { fetchImpl = fetch, onProgress = () => {} } = {}) {
  const limit = boundedLimit(source);
  const tasks = [
    ['trending', `/api/tweets/trending?limit=${limit}`, (row) => mapTweet(row, 'trending')],
    ...STREAM_CATEGORIES.map((category) => [`streams:${category}`, `/api/command/streams?category=${category}&limit=${limit}`, (row) => mapTweet(row, 'streams', category)]),
    ['articles', `/api/articles?limit=${limit}`, mapArticle],
    ['threads', '/threads', null, 'html'],
  ];
  const items = [];
  const failures = [];
  for (const [surface, path, mapper, responseType] of tasks) {
    onProgress(`正在读取 TechTwitter ${surface}`);
    try {
      const rows = await collectSurface(source, { fetchImpl }, surface === 'threads' ? 'threads' : surface.split(':')[0], path, mapper, responseType);
      items.push(...rows);
    } catch (error) {
      failures.push({ surface, message: error.message, code: error.code || 'NETWORK_ERROR' });
      onProgress(`TechTwitter ${surface} 读取失败，继续其他内容面：${error.message}`);
    }
  }
  const byUrl = new Map();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing) { byUrl.set(item.url, item); continue; }
    const existingRaw = existing.raw;
    const itemRaw = item.raw;
    existingRaw.surfaces = [...new Set([...(existingRaw.surfaces || [existingRaw.surface]), ...(itemRaw.surfaces || [itemRaw.surface])])];
    existingRaw.categories = [...new Set([...(existingRaw.categories || (existingRaw.category ? [existingRaw.category] : [])), ...(itemRaw.categories || (itemRaw.category ? [itemRaw.category] : []))])];
  }
  const unique = [...byUrl.values()];
  if (!unique.length) {
    const message = failures.length ? failures[0].message : '没有读取到可用内容';
    throw failure(`TechTwitter 各内容面均未取得有效内容：${message}`, failures[0]?.code || 'OUTPUT_INVALID');
  }
  Object.defineProperty(unique, 'collectionInfo', { value: { failedSurfaces: failures }, enumerable: false });
  return unique;
}

export async function testTechTwitter(source = {}, options = {}) {
  const testSource = { ...source, limit: Math.min(5, Number(source.limit) || 5) };
  const items = await collectTechTwitter(testSource, options);
  return {
    ok: true, title: 'TechTwitter · Trending / Streams / Articles / Threads', itemCount: items.length,
    items, failedSurfaces: items.collectionInfo?.failedSurfaces || [],
  };
}
