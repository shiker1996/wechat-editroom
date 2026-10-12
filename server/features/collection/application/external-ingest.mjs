const CHANNEL_ALIASES = new Map([
  ['x', 'x'], ['twitter', 'x'], ['x_search', 'x'],
  ['wechat', 'wechat'], ['mp', 'wechat'], ['mp_account', 'wechat'], ['公众号', 'wechat'],
]);

function text(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function channelOf(value) {
  const channel = CHANNEL_ALIASES.get(String(value ?? '').trim().toLowerCase());
  if (!channel) throw new Error('channel 只支持 x 或 wechat');
  return channel;
}

function sourcePart(value, fallback) {
  const normalized = text(value || fallback, 160).replace(/[^\w:@./-]+/gu, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error('sourceId 不能为空');
  return normalized;
}

function safeDate(value) {
  if (value == null || value === '') return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new Error(`publishedAt 不是有效日期：${value}`);
  return new Date(timestamp).toISOString();
}

function canonicalUrl(value) {
  const raw = text(value, 2000);
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`url 不是有效链接：${raw}`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('url 只支持 HTTP/HTTPS');
  parsed.hash = '';
  return parsed.href;
}

/**
 * Normalize X/微信公众号 bridge payloads into the same hotspot item shape
 * used by the built-in collectors. The bridge is intentionally provider
 * neutral: TwexAPI、极致了/大佳拉或自有脚本都可以输出这套契约。
 */
export function normalizeExternalIngest(input = {}) {
  const channel = channelOf(input.channel);
  const sourceId = sourcePart(input.sourceId || input.sourceName, channel);
  const sourceName = text(input.sourceName || sourceId, 160);
  const sourceKey = `${channel}:external:${sourceId}`;
  const rows = Array.isArray(input.items) ? input.items : [];
  if (!rows.length) throw new Error('items 不能为空');
  if (rows.length > 50) throw new Error('单次最多接收 50 条条目');

  const seen = new Set();
  const items = [];
  let duplicates = 0;
  for (const row of rows) {
    const title = text(row?.title, 1000);
    if (!title) throw new Error('每条条目都必须有 title');
    const url = canonicalUrl(row?.url);
    const identity = url || `title:${title.toLowerCase()}`;
    if (seen.has(identity)) { duplicates += 1; continue; }
    seen.add(identity);
    const externalId = text(row?.externalId || row?.id || url || title, 300);
    items.push({
      id: externalId,
      externalId,
      title,
      url,
      summary: text(row?.summary || row?.description, 5000),
      author: text(row?.author || row?.account || row?.nickname, 300),
      publishedAt: safeDate(row?.publishedAt || row?.published_at || row?.createdAt),
      sourceGroup: channel,
      sourceType: channel,
      sourceKey,
      sourceName,
      provenance: {
        method: 'external-ingest',
        channel,
        sourceId,
        capturedAt: new Date().toISOString(),
      },
      raw: row?.raw && typeof row.raw === 'object' ? row.raw : row,
    });
  }
  return { channel, sourceId, sourceName, sourceKey, items, duplicates };
}
