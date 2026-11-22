import { sourceError } from './source-http.mjs';

function decodeXml(value = '') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '').trim();
}

function field(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeXml(match[1]);
  }
  return null;
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)].map((match) => {
    const attributes = match[1];
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const rel = attributes.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2]?.toLowerCase();
    return { href, rel };
  }).filter((item) => item.href);
  return links.find((item) => item.rel === 'alternate')?.href
    || links.find((item) => !item.rel)?.href
    || links[0]?.href
    || null;
}

function normalizeDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return null; }
}

export function parseFeedDocument(xml, source) {
  const text = String(xml || '');
  const root = text.match(/<\s*(rss|feed|rdf:RDF)\b[^>]*>/i);
  const rootName = root?.[1];
  if (!rootName || !new RegExp(`<\\/\\s*${rootName}\\s*>`, 'i').test(text)) {
    throw sourceError('OUTPUT_INVALID', 'PARSE_ERROR: 响应不是完整、可识别的 RSS/Atom 文档');
  }
  const blocks = text.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const items = [];
  const seen = new Set();
  let droppedCount = 0;
  let duplicateCount = 0;
  for (const [index, block] of blocks.entries()) {
    const title = field(block, ['title']);
    const linkText = field(block, ['link']);
    const url = canonicalUrl(linkText || atomLink(block) || field(block, ['guid', 'id']));
    if (!title || !url) { droppedCount += 1; continue; }
    if (seen.has(url)) { duplicateCount += 1; continue; }
    seen.add(url);
    items.push({
      id: field(block, ['guid', 'id']) || url || `${source}-${index}`,
      title,
      url,
      publishedAt: normalizeDate(field(block, ['pubDate', 'published', 'updated', 'dc:date'])),
      summary: field(block, ['description', 'summary', 'content', 'content:encoded']) || '',
      githubRepositories: [...new Set([...block.matchAll(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gi)]
        .map((match) => match[0].replace(/[),.;]+$/, '')))],
      route: source,
      rank: items.length + 1,
    });
  }
  if (blocks.length > 0 && items.length === 0) {
    throw sourceError('OUTPUT_INVALID', 'PARSE_ERROR: feed 条目缺少可用标题或 HTTP(S) 链接');
  }
  return { items, parsedCount: blocks.length, droppedCount, duplicateCount };
}

export function feedDocumentTitle(xml, fallback = '') {
  const root = String(xml || '').match(/<(?:channel|feed)\b[\s\S]*?<\/(?:channel|feed)>/i)?.[0] || String(xml || '');
  return field(root, ['title']) || fallback;
}
