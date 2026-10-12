const DEFAULT_BASE_URL = 'https://api.twexapi.io';

function apiError(message, code = 'NETWORK_ERROR') { const error = new Error(message); error.code = code; return error; }

function baseUrlOf(configuration) {
  let parsed;
  try { parsed = new URL(String(configuration.baseUrl || DEFAULT_BASE_URL).trim()); } catch { throw apiError('TwexAPI Base URL 无效', 'INVALID_SOURCE_CONFIG'); }
  if (parsed.protocol !== 'https:') throw apiError('TwexAPI 必须使用 HTTPS', 'INVALID_SOURCE_CONFIG');
  return parsed.href.replace(/\/$/, '');
}

function endpointOf(configuration, path) { return new URL(`${baseUrlOf(configuration)}${path}`); }

function recent(value, maxAgeHours) {
  const timestamp = Date.parse(String(value || ''));
  return !Number.isFinite(timestamp) || timestamp >= Date.now() - Math.max(1, Number(maxAgeHours || 168)) * 60 * 60 * 1000;
}

async function requestJson(url, options, mode) {
  const response = await options.fetchImpl(url, { ...options.request, signal: AbortSignal.timeout(Number(options.timeoutMs) || 30000) });
  if (response.status === 401 || response.status === 403) throw apiError(`TwexAPI ${mode}鉴权失败，请检查 API Key`, 'AUTH_REQUIRED');
  if (response.status === 402 || response.status === 429) throw apiError(`TwexAPI ${mode}返回 HTTP ${response.status}，可能是余额或频率限制`, 'RATE_LIMITED');
  if (response.status === 422) throw apiError(`TwexAPI ${mode}参数无效`, 'INVALID_SOURCE_CONFIG');
  if (!response.ok) throw apiError(`TwexAPI ${mode}返回 HTTP ${response.status}`);
  let payload; try { payload = await response.json(); } catch { throw apiError(`TwexAPI ${mode}返回了无法解析的 JSON`); }
  if (payload?.code && Number(payload.code) !== 200) throw apiError(`TwexAPI ${mode}失败：${payload.msg || '未知错误'}`, 'NETWORK_ERROR');
  if (payload?.status === 'error') throw apiError(`TwexAPI ${mode}失败：${payload.message || '未知错误'}`, 'NETWORK_ERROR');
  return payload;
}

async function requestSearch(source, query, configuration, fetchImpl = fetch) {
  if (!configuration.apiKey) throw apiError('TwexAPI 采集器尚未配置 API Key', 'AUTH_REQUIRED');
  return requestJson(endpointOf(configuration, '/twitter/advanced_search/page'), {
    fetchImpl,
    timeoutMs: configuration.timeoutMs,
    request: { method: 'POST', headers: { authorization: `Bearer ${configuration.apiKey}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ searchTerms: [query], sortBy: source.searchType || 'Latest', next_cursor: '' }) },
  }, '搜索');
}

async function requestTrending(source, configuration, fetchImpl = fetch) {
  if (!configuration.apiKey) throw apiError('TwexAPI 采集器尚未配置 API Key', 'AUTH_REQUIRED');
  const endpoint = endpointOf(configuration, '/twitter/global-trending/tweets');
  endpoint.searchParams.set('country', String(source.country || 'worldwide').trim());
  if (String(source.topic || '').trim()) endpoint.searchParams.set('topic', String(source.topic).trim());
  if (String(source.content || '').trim()) endpoint.searchParams.set('content', String(source.content).trim());
  endpoint.searchParams.set('count', String(Math.min(100, Math.max(1, Number(source.limit || 20)))));
  return requestJson(endpoint, {
    fetchImpl,
    timeoutMs: configuration.timeoutMs,
    request: { headers: { authorization: `Bearer ${configuration.apiKey}`, accept: 'application/json' } },
  }, '趋势');
}

function normalizeItems(payload, source, query = source.query) {
  const limit = Math.min(50, Math.max(1, Number(source.limit || 20)));
  const tweets = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.tweets) ? payload.tweets : [];
  return tweets.map((tweet) => {
    const id = String(tweet.tweet_id || tweet.id_str || tweet.id || '').trim();
    const handle = String(tweet.user?.screen_name || tweet.in_reply_to_screen_name || 'i').trim();
    const text = String(tweet.full_text || tweet.text || '').trim();
    return {
      id,
      externalId: id,
      title: text.slice(0, 500),
      url: id ? `https://x.com/${handle === 'i' ? 'i' : handle}/status/${id}` : '',
      summary: text,
      author: tweet.user?.name || handle,
      publishedAt: tweet.created_at_datetime || tweet.tweet_created_at || tweet.created_at || null,
      metrics: { views: tweet.view_count ?? tweet.views_count ?? null, likes: tweet.favorite_count ?? null, replies: tweet.reply_count ?? null, reposts: tweet.retweet_count ?? null, bookmarks: tweet.bookmark_count ?? null },
      raw: { provider: 'twexapi', mode: source.mode || 'fixed', query, country: source.country || null, topic: source.topic || null, content: source.content || null, ...tweet },
    };
  }).filter((item) => item.title && item.url && recent(item.publishedAt, source.maxAgeHours)).slice(0, limit);
}

function queriesOf(source) {
  const queries = String(source.query || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [...new Set(queries)].slice(0, source.mode === 'query-pool' ? 8 : 1);
}

export async function collectXSearch(source, configuration = {}, onProgress = () => {}, fetchImpl = fetch) {
  const mode = source.mode || 'fixed';
  const queries = queriesOf(source);
  if (mode !== 'trending' && !queries.length) throw apiError('X 搜索条件不能为空', 'INVALID_SOURCE_CONFIG');
  if (mode === 'trending') {
    onProgress(`正在读取 TwexAPI 趋势：${source.country || 'worldwide'}`);
    const items = normalizeItems(await requestTrending(source, configuration, fetchImpl), source, '');
    if (!items.length) throw apiError('TwexAPI 趋势接口返回成功，但没有可用推文', 'OUTPUT_INVALID');
    return [...new Map(items.map((item) => [item.externalId || item.url, item])).values()].slice(0, Math.min(50, Math.max(1, Number(source.limit || 20))));
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
  const testSource = { ...source, limit: 5, maxAgeHours: 8760 }; const queries = queriesOf(testSource); const items = [];
  if ((testSource.mode || 'fixed') === 'trending') items.push(...normalizeItems(await requestTrending(testSource, configuration, fetchImpl), testSource, ''));
  else for (const query of queries) items.push(...normalizeItems(await requestSearch(testSource, query, configuration, fetchImpl), testSource, query));
  const unique = [...new Map(items.map((item) => [item.externalId || item.url, item])).values()].slice(0, 5);
  return { ok: true, title: source.mode === 'trending' ? `TwexAPI 趋势 · ${source.country || 'worldwide'}` : source.mode === 'query-pool' ? `查询词池（${queries.length} 条）` : queries[0], itemCount: unique.length, items: unique };
}
