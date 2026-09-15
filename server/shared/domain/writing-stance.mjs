export const WRITING_STANCES = Object.freeze(['report', 'analysis', 'opinion']);

export const DEFAULT_WRITING_STANCE_BY_ARTICLE_TYPE = Object.freeze({
  'wechat-mp-tech-deep': 'analysis',
  'wechat-mp-tech-hotspot': 'report',
  'wechat-mp-deep-dive': 'analysis',
  'wechat-mp-gossip-chill': 'opinion',
  'wechat-mp-composite': 'report',
  'wechat-mp-personal-writing': 'opinion',
  'wechat-mp-tutorial': 'report',
  'wechat-mp-daily': 'report',
});

export const CITATION_POLICIES = Object.freeze(['each_claim', 'cluster', 'endnote_only']);

function text(value) { return String(value ?? '').trim(); }

export function normalizeWritingStance(value, fallback = 'analysis') {
  const normalized = text(value).toLowerCase();
  if (WRITING_STANCES.includes(normalized)) return normalized;
  const safeFallback = text(fallback).toLowerCase();
  return WRITING_STANCES.includes(safeFallback) ? safeFallback : 'analysis';
}

export function deriveWritingStance({ articleType = '', explicit = '', materialBrief = {}, editorial = {} } = {}) {
  const candidates = [
    explicit,
    materialBrief?.writing_stance,
    materialBrief?.writingStance,
    editorial?.writing_stance,
    editorial?.writingStance,
  ];
  const selected = candidates.map(text).find((value) => WRITING_STANCES.includes(value.toLowerCase()));
  if (selected) return { stance: normalizeWritingStance(selected), source: 'explicit' };
  const resolvedArticleType = text(articleType || materialBrief?.article_type || editorial?.article_type);
  return {
    stance: normalizeWritingStance(DEFAULT_WRITING_STANCE_BY_ARTICLE_TYPE[resolvedArticleType], 'analysis'),
    source: 'article_type_default',
  };
}

export function citationPolicyForStance(stance, { sourceLevel = '', highImpact = false } = {}) {
  if (highImpact || ['official', 'reliable_media', 'technical_primary'].includes(text(sourceLevel))) return 'each_claim';
  if (normalizeWritingStance(stance) === 'report') return 'each_claim';
  if (normalizeWritingStance(stance) === 'opinion') return 'cluster';
  return 'cluster';
}

export function visualPolicyForStance({ stance, articleType = '', factBase = null, explicit = '' } = {}) {
  const requested = text(explicit).toLowerCase();
  if (['off', 'auto', 'manual_override'].includes(requested)) {
    return { policy: requested, reason: 'explicit' };
  }
  const normalized = normalizeWritingStance(stance);
  if (normalized === 'opinion') return { policy: 'off', reason: 'opinion stance defaults to prose-first' };
  if (normalized === 'report') {
    const claims = Array.isArray(factBase?.claims) ? factBase.claims : [];
    const groups = new Set(claims.map((claim) => claim?.source_group_id || claim?.sourceGroupId).filter(Boolean));
    if (groups.size <= 1) return { policy: 'off', reason: 'single-source report has no default visual requirement' };
  }
  if (/tech-deep|tutorial/.test(text(articleType))) return { policy: 'auto', reason: 'technical structure may benefit from explanatory visuals' };
  return { policy: 'auto', reason: 'analysis may benefit from relationship or process visuals' };
}

export function stanceOverlay(stance) {
  const normalized = normalizeWritingStance(stance);
  const overlays = {
    report: `## 写作立场 overlay：report\n- 先交代发生了什么，再交代影响。\n- 关键事实就近保留具体来源，不把来源观点改写成作者确定判断。\n- 不用长篇机制推演替代事实缺口；允许较高的来源可见密度。`,
    analysis: `## 写作立场 overlay：analysis\n- 按“事实 → 机制 → 影响 → 边界”推进。\n- 同一来源簇在一个论证段落中集中归因，后续句子不重复堆叠来源提示。\n- 观点必须有事实和推理支撑；反事实、因果和动机使用克制语气。`,
    opinion: `## 写作立场 overlay：opinion\n- 开头一次性交代事实来源和文章观察角度。\n- 后文优先使用自然连接和作者推理，不重复“据该来源”。\n- 观点通过论证呈现，不强制使用“作者判断”“本文认为”等标签。\n- 对未核实、高影响或单方主张保留必要的自然限定；结尾回到判断和适用边界，不增加模板化免责声明。`,
  };
  return overlays[normalized];
}

export function buildWritingStanceSnapshot({ articleType = '', stance = '', source = '', citationPolicy = '', visualPolicy = '' } = {}) {
  const resolved = deriveWritingStance({ articleType, explicit: stance });
  return {
    writingStance: resolved.stance,
    stanceSource: source || resolved.source,
    citationPolicy: citationPolicy || citationPolicyForStance(resolved.stance),
    visualPolicy: visualPolicy || visualPolicyForStance({ stance: resolved.stance, articleType }).policy,
    overlayVersion: '1',
  };
}
