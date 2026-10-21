const DEFAULT_BASE_URL = 'https://api.twitterapi.io';
const LEGACY_WOEID = Object.freeze({ worldwide: '1', 'united-states': '23424977', japan: '23424856', china: '23424781' });

function apiError(message, code = 'NETWORK_ERROR') { const error = new Error(message); error.code = code; return error; }

function baseUrlOf(configuration) {
  let parsed;
  const configured = String(configuration.baseUrl || DEFAULT_BASE_URL).trim();
  const migrated = configured.replace(/^https:\/\/api\.twexapi\.io\/?$/i, DEFAULT_BASE_URL);
  try { parsed = new URL(migrated); } catch { throw apiError('TwitterAPI Base URL 无效', 'INVALID_SOURCE_CONFIG'); }
  if (parsed.protocol !== 'https:') throw apiError('TwitterAPI 必须使用 HTTPS', 'INVALID_SOURCE_CONFIG');
  return parsed.href.replace(/\/$/, '');
}

function endpointOf(configuration, path) { return new URL(`${baseUrlOf(configuration)}${path}`); }

function recent(value, maxAgeHours) {
  const timestamp = Date.parse(String(value || ''));
  return !Number.isFinite(timestamp) || timestamp >= Date.now() - Math.max(1, Number(maxAgeHours || 168)) * 60 * 60 * 1000;
}

async function requestJson(url, options, mode) {
  const response = await options.fetchImpl(url, { ...options.request, signal: AbortSignal.timeout(Number(options.timeoutMs) || 30000) });
  if (response.status === 401 || response.status === 403) throw apiError(`TwitterAPI ${mode}鉴权失败，请检查 API Key`, 'AUTH_REQUIRED');
  if (response.status === 402 || response.status === 429) throw apiError(`TwitterAPI ${mode}返回 HTTP ${response.status}，请检查余额或频率限制`, 'RATE_LIMITED');
  if (response.status === 400 || response.status === 422) throw apiError(`TwitterAPI ${mode}参数无效`, 'INVALID_SOURCE_CONFIG');
  if (!response.ok) throw apiError(`TwitterAPI ${mode}返回 HTTP ${response.status}`);
  let payload; try { payload = await response.json(); } catch { throw apiError(`TwitterAPI ${mode}返回了无法解析的 JSON`); }
  if (payload?.status === 'error' || payload?.error) throw apiError(`TwitterAPI ${mode}失败：${payload?.msg || payload?.message || '未知错误'}`, 'NETWORK_ERROR');
  return payload;
}

function authHeaders(configuration, json = false) {
  if (!configuration.apiKey) throw apiError('TwitterAPI 采集器尚未配置 API Key', 'AUTH_REQUIRED');
  return { 'x-api-key': configuration.apiKey, accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}) };
}

async function requestSearch(source, query, configuration, fetchImpl = fetch) {
  const limit = Math.min(50, Math.max(1, Number(source.limit || 20)));
  const tweets = [];
  let cursor = '';
  for (let page = 0; page < 3 && tweets.length < limit; page += 1) {
    const endpoint = endpointOf(configuration, '/twitter/tweet/advanced_search');
    endpoint.searchParams.set('query', query);
    endpoint.searchParams.set('queryType', source.searchType || 'Latest');
    endpoint.searchParams.set('cursor', cursor);
    const payload = await requestJson(endpoint, {
      fetchImpl, timeoutMs: configuration.timeoutMs,
      request: { method: 'GET', headers: authHeaders(configuration) },
    }, '搜索');
    tweets.push(...(Array.isArray(payload?.tweets) ? payload.tweets : []));
    const next = String(payload?.next_cursor || '');
    if (!payload?.has_next_page || !next || next === cursor) break;
    cursor = next;
  }
  return { tweets: tweets.slice(0, limit) };
}

async function requestReplies(source, configuration, fetchImpl = fetch) {
  const tweetId = String(source.tweetId || '').trim();
  if (!/^\d{5,30}$/.test(tweetId)) throw apiError('推文 ID 无效', 'INVALID_SOURCE_CONFIG');
  const limit = Math.min(20, Math.max(1, Number(source.limit) || 12));
  const endpoint = endpointOf(configuration, '/twitter/tweet/replies/v2');
  endpoint.searchParams.set('tweetId', tweetId);
  endpoint.searchParams.set('queryType', source.sortBy || 'Likes');
  endpoint.searchParams.set('cursor', '');
  const payload = await requestJson(endpoint, {
    fetchImpl, timeoutMs: configuration.timeoutMs,
    request: { method: 'GET', headers: authHeaders(configuration) },
  }, '评论抓取');
  return (Array.isArray(payload?.tweets) ? payload.tweets : []).map((tweet) => normalizeTweet(tweet, { mode: 'replies', tweetId })).filter((item) => item.title && item.url).slice(0, limit);
}

function woeidOf(source) {
  const value = String(source.woeid ?? source.country ?? '1').trim().toLowerCase();
  const woeid = LEGACY_WOEID[value] || value;
  if (!/^\d{1,12}$/.test(woeid)) throw apiError('TwitterAPI 趋势地区请填写 WOEID 数字（worldwide 可用 1）', 'INVALID_SOURCE_CONFIG');
  return woeid;
}

async function requestTrends(source, configuration, fetchImpl = fetch) {
  const endpoint = endpointOf(configuration, '/twitter/trends');
  endpoint.searchParams.set('woeid', woeidOf(source));
  endpoint.searchParams.set('count', '30');
  return requestJson(endpoint, {
    fetchImpl, timeoutMs: configuration.timeoutMs,
    request: { method: 'GET', headers: authHeaders(configuration) },
  }, '趋势');
}

function normalizeTweet(tweet, source, query = '') {
  const id = String(tweet.id || tweet.tweet_id || tweet.id_str || '').trim();
  const handle = String(tweet.author?.userName || tweet.user?.screen_name || tweet.in_reply_to_username || 'i').trim();
  const text = String(tweet.text || tweet.full_text || '').trim();
  return {
    id, externalId: id, title: text.slice(0, 500),
    url: String(tweet.url || (id ? `https://x.com/${handle === 'i' ? 'i' : handle}/status/${id}` : '')),
    summary: text, author: tweet.author?.name || tweet.user?.name || handle,
    publishedAt: tweet.createdAt || tweet.created_at_datetime || tweet.tweet_created_at || tweet.created_at || null,
    metrics: { views: tweet.viewCount ?? tweet.view_count ?? null, likes: tweet.likeCount ?? tweet.favorite_count ?? null, replies: tweet.replyCount ?? tweet.reply_count ?? null, reposts: tweet.retweetCount ?? tweet.retweet_count ?? null, bookmarks: tweet.bookmarkCount ?? tweet.bookmark_count ?? null },
    raw: { provider: 'twitterapi', mode: source.mode || 'fixed', query, woeid: source.woeid || source.country || null, ...tweet },
  };
}

function normalizeItems(payload, source, query = source.query) {
  const limit = Math.min(50, Math.max(1, Number(source.limit || 20)));
  return (Array.isArray(payload?.tweets) ? payload.tweets : []).map((tweet) => normalizeTweet(tweet, source, query))
    .filter((item) => item.title && item.url && recent(item.publishedAt, source.maxAgeHours)).slice(0, limit);
}

function queriesOf(source) {
  const queries = String(source.query || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [...new Set(queries)].slice(0, source.mode === 'query-pool' ? 8 : 1);
}

async function collectTrendingTweets(source, configuration, fetchImpl, onProgress) {
  const payload = await requestTrends(source, configuration, fetchImpl);
  const trends = (Array.isArray(payload?.trends) ? payload.trends : [])
    .map((entry) => entry?.trend || entry).filter((trend) => trend?.target?.query || trend?.name);
  const limit = Math.min(50, Math.max(1, Number(source.limit || 20)));
  const items = [];
  let firstSearchError = null;
  // TwitterAPI exposes trend topics separately from tweets. Search a small top slice to retain this source's tweet-oriented contract.
  for (const trend of trends.slice(0, 5)) {
    if (items.length >= limit) break;
    const query = String(trend.target?.query || trend.name).trim();
    if (!query) continue;
    onProgress(`正在搜索 X 趋势话题：${trend.name || query}`);
    try { items.push(...normalizeItems(await requestSearch({ ...source, searchType: 'Top', limit }, query, configuration, fetchImpl), { ...source, mode: 'trending' }, query)); }
    catch (error) { firstSearchError ||= error; }
  }
  const unique = [...new Map(items.map((item) => [item.externalId || item.url, item])).values()];
  if (!unique.length && firstSearchError) throw firstSearchError;
  if (!unique.length) throw apiError('TwitterAPI 趋势接口未找到相关推文', 'OUTPUT_INVALID');
  return unique.slice(0, limit);
}

export async function collectXSearch(source, configuration = {}, onProgress = () => {}, fetchImpl = fetch) {
  const mode = source.mode || 'fixed';
  if (mode === 'replies') {
    onProgress(`正在读取 X 推文评论：${source.tweetId || ''}`);
    return requestReplies(source, configuration, fetchImpl);
  }
  const queries = queriesOf(source);
  if (mode !== 'trending' && !queries.length) throw apiError('X 搜索条件不能为空', 'INVALID_SOURCE_CONFIG');
  if (mode === 'trending') {
    onProgress(`正在读取 TwitterAPI 趋势：${source.woeid || source.country || 'worldwide'}`);
    return collectTrendingTweets(source, configuration, fetchImpl, onProgress);
  }
  const items = []; const failures = [];
  for (const query of queries) {
    onProgress(`正在读取 X 搜索：${query}`);
    try { items.push(...normalizeItems(await requestSearch(source, query, configuration, fetchImpl), source, query)); }
    catch (error) { failures.push(`${query}：${error.message}`); onProgress(`X 搜索条件失败，继续执行其他条件：${failures.at(-1)}`); }
  }
  const unique = [...new Map(items.map((item) => [item.externalId || item.url, item])).values()].slice(0, Math.min(50, Math.max(1, Number(source.limit || 20))));
  if (!unique.length && failures.length) throw apiError(`X 搜索全部失败：${failures[0]}`, failures[0].includes('鉴权') ? 'AUTH_REQUIRED' : 'NETWORK_ERROR');
  if (!unique.length) throw apiError('X 搜索接口返回成功，但没有符合时间范围的内容', 'OUTPUT_INVALID');
  return unique;
}

export async function testXSearch(source, configuration = {}, fetchImpl = fetch) {
  const testSource = { ...source, limit: 5, maxAgeHours: 8760 };
  const items = testSource.mode === 'replies'
    ? await requestReplies(testSource, configuration, fetchImpl)
    : testSource.mode === 'trending'
      ? await collectTrendingTweets(testSource, configuration, fetchImpl, () => {})
      : (await Promise.all(queriesOf(testSource).map(async (query) => normalizeItems(await requestSearch(testSource, query, configuration, fetchImpl), testSource, query)))).flat();
  const unique = [...new Map(items.map((item) => [item.externalId || item.url, item])).values()].slice(0, 5);
  return { ok: true, title: source.mode === 'replies' ? `推文评论 · ${source.tweetId}` : source.mode === 'trending' ? `TwitterAPI 趋势 · ${source.woeid || source.country || 'worldwide'}` : source.mode === 'query-pool' ? `查询词池（${queriesOf(source).length} 条）` : queriesOf(source)[0], itemCount: unique.length, items: unique };
}
