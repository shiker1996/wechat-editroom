import crypto from 'node:crypto';

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const TRACKING_QUERY_KEYS = /^(?:utm_[a-z0-9_]+|fbclid|gclid|dclid|mc_cid|mc_eid|spm|ref|ref_)$/i;

/**
 * Normalize a collected article URL before it participates in identity checks.
 * Tracking parameters and fragments are transport noise, not article identity.
 */
export function canonicalCollectedUrl(value) {
  const input = text(value);
  if (!input) return '';
  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) return input;
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = '';
    parsed.hash = '';
    const params = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_QUERY_KEYS.test(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    parsed.search = '';
    for (const [key, item] of params) parsed.searchParams.append(key, item);
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.href;
  } catch {
    return input;
  }
}

function normalizedIdentityText(value) {
  return text(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ');
}

function collectedContentText(item) {
  return [item?.title, item?.summary, item?.description, item?.content, item?.text, item?.selftext]
    .map(normalizedIdentityText).filter(Boolean).join('\n');
}

function sourceIdentity(item) {
  return text(item?.sourceKey || item?.sourceName || item?.sourceGroup || item?.sourceType || 'unknown').toLocaleLowerCase();
}

/** Stable identity used by the collection boundary; URL wins over text. */
export function collectedItemIdentity(item) {
  const url = canonicalCollectedUrl(item?.url || item?.link || item?.guid);
  if (url) return `url:${url}`;
  const content = collectedContentText(item);
  if (!content) return '';
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  // Text-only records are scoped to a source so two independent reports with
  // the same short feed description are not collapsed into one source.
  return `content:${sourceIdentity(item)}:${digest}`;
}

function qualityOf(item) {
  return [item?.content, item?.text, item?.summary, item?.description, item?.title]
    .map((value) => normalizedIdentityText(value).length).reduce((sum, length) => sum + length, 0);
}

export function hasMeaningfulCollectedContent(item) {
  if (!item || typeof item !== 'object') return false;
  return [item.title, item.summary, item.description, item.content, item.text, item.selftext]
    .some((value) => text(value));
}

export function filterCollectedItems(items) {
  const kept = [];
  const dropped = [];
  for (const item of Array.isArray(items) ? items : []) {
    (hasMeaningfulCollectedContent(item) ? kept : dropped).push(item);
  }
  return { kept, dropped };
}

/**
 * Collapse repeated feed deliveries before persistence. The best copy wins;
 * duplicate provenance is retained on the winner for auditability.
 */
export function dedupeCollectedItems(items) {
  const kept = [];
  const dropped = [];
  const byIdentity = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const identity = collectedItemIdentity(item);
    if (!identity) { kept.push(item); continue; }
    const previousIndex = byIdentity.get(identity);
    if (previousIndex === undefined) {
      byIdentity.set(identity, kept.length);
      kept.push({ ...item });
      continue;
    }
    const previous = kept[previousIndex];
    const winner = qualityOf(item) > qualityOf(previous) ? { ...item } : previous;
    const duplicate = winner === previous ? item : previous;
    const duplicateSources = new Set([
      ...(Array.isArray(previous.duplicateSourceKeys) ? previous.duplicateSourceKeys : []),
      ...(Array.isArray(item.duplicateSourceKeys) ? item.duplicateSourceKeys : []),
      sourceIdentity(previous),
      sourceIdentity(item),
      sourceIdentity(duplicate),
    ].filter(Boolean));
    winner.duplicateSourceKeys = [...duplicateSources];
    winner.duplicateCount = Number(previous.duplicateCount || 0) + Number(item.duplicateCount || 0) + 1;
    kept[previousIndex] = winner;
    dropped.push({ ...duplicate, duplicateOf: identity });
  }
  return { kept, dropped };
}
