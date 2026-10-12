function apiError(message, code = 'NETWORK_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function endpointOf(configuration) {
  const value = String(configuration.endpoint || '').trim();
  let parsed;
  try { parsed = new URL(value); } catch { throw apiError('公众号接口地址无效', 'INVALID_SOURCE_CONFIG'); }
  if (parsed.protocol !== 'https:') throw apiError('公众号接口必须使用 HTTPS', 'INVALID_SOURCE_CONFIG');
  return parsed.href;
}

function timestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number)) return new Date(number < 10_000_000_000 ? number * 1000 : number).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function identifierPayload(source) {
  const identifier = String(source.identifier || '').trim();
  const type = source.identifierType || 'ghid';
  if (type === 'url') return { url: identifier, ghid: '' };
  if (type === 'nickname') return { nickname: identifier, ghid: '' };
  if (type === 'wxid') return { wxid: identifier, ghid: '' };
  return { ghid: identifier, url: '' };
}

async function requestHistory(source, configuration, fetchImpl = fetch) {
  if (!configuration.apiKey) throw apiError('公众号采集器尚未配置 API Key', 'AUTH_REQUIRED');
  const endpoint = endpointOf(configuration);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ ...identifierPayload(source), offset: '', key: configuration.apiKey, verifycode: configuration.verifycode || '' }),
    signal: AbortSignal.timeout(Number(configuration.timeoutMs) || 30000),
  });
  if (response.status === 401 || response.status === 403) throw apiError('公众号接口鉴权失败，请检查 API Key', 'AUTH_REQUIRED');
  if (response.status === 429) throw apiError('公众号接口请求频率受限', 'RATE_LIMITED');
  if (!response.ok) throw apiError(`公众号接口返回 HTTP ${response.status}`);
  let payload;
  try { payload = await response.json(); } catch { throw apiError('公众号接口返回了无法解析的 JSON'); }
  if (Number(payload?.code) !== 0) {
    const providerCode = Number(payload?.code);
    const code = providerCode === 10002 || providerCode === 104 ? 'AUTH_REQUIRED' : providerCode === -1 || providerCode === 103 ? 'RATE_LIMITED' : 'NETWORK_ERROR';
    throw apiError(`公众号接口失败${payload?.msg ? `：${payload.msg}` : ''}（${String(payload?.code ?? 'unknown')}）`, code);
  }
  if (!Array.isArray(payload?.data)) throw apiError('公众号接口返回成功，但文章列表 data 格式异常', 'OUTPUT_INVALID');
  return payload;
}

function normalizeItems(payload, source, now = Date.now()) {
  const maxAgeMs = Math.max(1, Number(source.maxAgeHours || 168)) * 60 * 60 * 1000;
  const limit = Math.min(50, Math.max(1, Number(source.limit || 30)));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((item) => {
    const publishedAt = timestamp(item.post_time ?? item.post_time_str ?? item.update_time);
    const url = String(item.url || '').trim();
    return {
      id: item.sn || item.hashid || url,
      externalId: item.sn || item.hashid || url,
      title: String(item.title || '').trim(),
      url,
      summary: String(item.digest || item.summary || '').trim(),
      author: String(item.author || payload.nickname || payload.ghid || source.identifier || '').trim(),
      publishedAt,
      metrics: { read: item.read ?? null, likes: item.zan ?? item.praise ?? null, look: item.look ?? null, original: item.original ?? null },
      raw: { provider: 'dajiala', account: { nickname: payload.nickname || '', ghid: payload.ghid || '' }, ...item },
    };
  }).filter((item) => item.title && /^https?:\/\//i.test(item.url) && (!item.publishedAt || Date.parse(item.publishedAt) >= now - maxAgeMs)).slice(0, limit);
}

export async function collectWeChatAccount(source, configuration = {}, onProgress = () => {}, fetchImpl = fetch) {
  onProgress(`正在读取微信公众号：${source.identifier}`);
  const payload = await requestHistory(source, configuration, fetchImpl);
  const items = normalizeItems(payload, source);
  if (!items.length) {
    const maxAgeHours = Math.max(1, Number(source.maxAgeHours || 168));
    const reason = payload.data.length
      ? `${payload.data.length} 篇记录经时间范围、标题和链接校验后没有可采集文章`
      : '接口返回的历史文章列表为空';
    onProgress(`微信公众号本次无可用文章：${reason}（范围：最近 ${maxAgeHours} 小时）；按 0 条成功继续采集`);
  }
  return items;
}

export async function testWeChatAccount(source, configuration = {}, fetchImpl = fetch) {
  const payload = await requestHistory({ ...source, maxAgeHours: 8760, limit: 3 }, configuration, fetchImpl);
  const items = normalizeItems(payload, { ...source, maxAgeHours: 8760, limit: 3 });
  return { ok: true, title: payload.nickname || payload.ghid || source.identifier, itemCount: items.length, items };
}
