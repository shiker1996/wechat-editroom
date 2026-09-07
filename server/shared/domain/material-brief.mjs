const ARRAY_FIELDS = new Set(['event_ids', 'research_material_ids', 'counter_evidence']);
const TEXT_FIELDS = [
  'action', 'affected_group', 'reader_consequence', 'conflict', 'baseline_change', 'thesis',
  'evidence_boundary', 'title_promise', 'reader_action', 'article_type', 'material_readiness',
];

function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []; }
function firstText(...values) { return values.map(text).find(Boolean) || ''; }

export function parseMaterialBrief(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function normalizeMaterialBrief(value, fallback = {}) {
  const source = { ...parseMaterialBrief(fallback), ...parseMaterialBrief(value) };
  const result = {};
  for (const key of TEXT_FIELDS) result[key] = text(source[key]);
  for (const key of ARRAY_FIELDS) result[key] = list(source[key]);
  return result;
}

function sourceCount(material) {
  return [material?.sources, material?.source_refs, material?.evidence, material?.evidence_refs, material?.evidence_clips, material?.evidence_source_ids, material?.source_ids]
    .find((value) => Array.isArray(value) && value.length) || [];
}

export function deriveMaterialReadiness({ researchContext = null, materialBrief = {} } = {}) {
  const materials = Array.isArray(researchContext?.verified_research_materials) ? researchContext.verified_research_materials : [];
  if (!researchContext || researchContext.status !== 'available' || !materials.length) return 'insufficient';
  const hasSource = materials.some((material) => sourceCount(material).length > 0);
  const hasVerified = materials.some((material) => text(material?.status).toLowerCase() === 'verified');
  const hasImpact = Boolean(text(materialBrief.reader_consequence));
  const hasConflict = Boolean(text(materialBrief.conflict));
  return hasSource && hasVerified && hasImpact && hasConflict ? 'verified' : 'promising';
}

export function buildMaterialBrief({ candidate = {}, editorial = {}, researchContext = null, events = [] } = {}) {
  const stored = normalizeMaterialBrief(editorial.material_brief || editorial.materialBrief || editorial.material_brief_json);
  const materials = Array.isArray(researchContext?.verified_research_materials) ? researchContext.verified_research_materials : [];
  const material = materials[0] || {};
  const topicCandidate = researchContext?.topic_candidate || {};
  const eventIds = list(candidate.event_ids || events.map((event) => event.event_id || event.eventId));
  const researchMaterialIds = materials.map((item) => text(item.material_id || item.id || item.research_material_id)).filter(Boolean);
  const parties = Array.isArray(material.parties) ? material.parties.map((item) => text(item)).filter(Boolean) : [];
  const readerConsequence = firstText(stored.reader_consequence, material.reader_impact, material.impact, material.reader_consequence);
  const conflict = firstText(
    stored.conflict,
    material.difference_or_conflict,
    material.difference,
    material.gap,
    parties.length ? `相关方：${parties.join('、')}` : '',
  );
  const textForRoute = [candidate.category, candidate.angle, candidate.thesis].map(text).join(' ');
  const derivedArticleType = /趣闻|离谱|八卦|段子|奇葩|荒诞|整活|吐槽/.test(textForRoute)
    ? 'wechat-mp-gossip-chill'
    : /原理|机制拆解|架构拆解|性能拆解|成本拆解|公式|吞吐|延迟|显存|算力成本|部署成本|推理成本|训练成本|量化|内核|基准测试/.test(textForRoute) && /AI|模型|芯片|GPU|推理|训练|Token|Agent|数据库|框架|协议|算法|开源|性能|算力|架构|内核/i.test(textForRoute)
      ? 'wechat-mp-tech-deep'
      : /AI|模型|芯片|GPU|推理|训练|Token|Agent|数据库|框架|协议|算法|开源|性能|算力|架构|内核/i.test(textForRoute)
        ? 'wechat-mp-tech-hotspot'
        : 'wechat-mp-deep-dive';
  const draft = normalizeMaterialBrief({
    ...stored,
    event_ids: eventIds,
    research_material_ids: researchMaterialIds,
    action: firstText(stored.action, material.action, material.observed, material.event_change, topicCandidate.core_question),
    affected_group: firstText(stored.affected_group, material.affected_group, material.audience, candidate.reader_stake),
    reader_consequence: readerConsequence,
    conflict,
    baseline_change: firstText(stored.baseline_change, material.baseline_change, material.change, material.before_after),
    thesis: firstText(stored.thesis, candidate.thesis, topicCandidate.thesis),
    counter_evidence: stored.counter_evidence.length ? stored.counter_evidence : list(editorial.rejected_angles),
    evidence_boundary: firstText(stored.evidence_boundary, researchContext?.evidence_boundary?.note),
    article_type: firstText(stored.article_type, derivedArticleType),
  });
  draft.material_readiness = stored.material_readiness || deriveMaterialReadiness({ researchContext, materialBrief: draft });
  return draft;
}
