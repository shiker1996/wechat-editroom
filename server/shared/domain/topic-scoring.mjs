export const TOPIC_SCORING_FORMULA_VERSION = 'v4';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const MATERIAL_STRATEGIES = new Set(['direct_practical', 'event_trigger']);

export function computeFinalScore({
  H = 0, B = 0, P = 0, T = null, J = 0, S = 0, D = 0, chinaRelevance = null,
  materialStrategy = 'unclassified', materialFit = null, M = null,
} = {}, scoring = {}) {
  const h = clamp(H, 0, 100);
  const b = clamp(B, 0, 100);
  const p = clamp(P, 0, 100);
  const t = T == null || !Number.isFinite(Number(T)) ? null : clamp(T, 0, 100);
  const j = clamp(J, 0, 100);
  const allowedStrategy = MATERIAL_STRATEGIES.has(materialStrategy) ? materialStrategy : 'unclassified';
  const suppliedM = materialFit ?? M;
  const hasMaterialFit = suppliedM != null && Number.isFinite(Number(suppliedM));
  const material = allowedStrategy === 'unclassified' || !hasMaterialFit ? 50 : clamp(suppliedM, 0, 100);
  const materialFitSource = allowedStrategy === 'unclassified' ? 'neutral_unclassified'
    : hasMaterialFit ? 'assessed' : 'neutral_missing_fit';
  const saturation = clamp(S, 0, 15);
  const duplicate = clamp(D, 0, 20);
  const c = clamp(saturation + duplicate, 0, 35);
  const a = clamp(h * 0.50 + b * 0.30 + p * 0.20, 0, 100);
  const weights = { article: 0.50, eventValue: 0.20, researchValue: 0.10, domestic: 0.10, material: 0.10 };
  const weightWarnings = [...new Set(scoring.scoringWarnings || [])];
  const hasDomestic = chinaRelevance != null && Number.isFinite(Number(chinaRelevance));
  const dom = hasDomestic ? clamp(chinaRelevance, 0, 12) / 12 * 100 : null;
  let appliedWeights = { ...weights };
  if (!hasDomestic) {
    const total = weights.article + weights.eventValue + weights.researchValue + weights.material;
    appliedWeights = {
      ...weights,
      article: total ? weights.article / total : 1,
      eventValue: total ? weights.eventValue / total : 0,
      researchValue: total ? weights.researchValue / total : 0,
      domestic: 0,
      material: total ? weights.material / total : 0,
    };
  }
  const f = t == null ? null : clamp(
    a * appliedWeights.article
      + t * appliedWeights.eventValue
      + j * appliedWeights.researchValue
      + (dom ?? 0) * appliedWeights.domestic
      + material * appliedWeights.material
      - c,
    0,
    100,
  );
  return {
    formulaVersion: TOPIC_SCORING_FORMULA_VERSION,
    A: Number(a.toFixed(1)),
    F: f == null ? null : Number(f.toFixed(1)),
    DOM: dom == null ? null : Number(dom.toFixed(1)),
    C: Number(c.toFixed(1)),
    weights: appliedWeights,
    weightWarnings,
    materialStrategy: allowedStrategy,
    M: Number(material.toFixed(1)),
    materialFitSource,
    components: { H: h, B: b, P: p, T: t, J: j, DOM: dom, M: material, S: saturation, D: duplicate },
  };
}
