export const TOPIC_SCORING_FORMULA_VERSION = 'v3';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function resolveTopicScoreWeights({
  eventValueWeight = 0.25,
  researchValueWeight = 0.10,
  domesticWeight = 0.10,
  maxNonArticleWeight = 0.85,
} = {}) {
  let t = clamp(eventValueWeight, 0, 1);
  let j = clamp(researchValueWeight, 0, 1);
  let domestic = clamp(domesticWeight, 0, 0.25);
  const warnings = [];
  const total = t + j + domestic;
  if (total > maxNonArticleWeight) {
    const scale = maxNonArticleWeight / total;
    t *= scale;
    j *= scale;
    domestic *= scale;
    warnings.push('T/J/DOM 权重合计超过上限，已按比例缩放');
  }
  return {
    article: Math.max(0, 1 - t - j - domestic),
    eventValue: t,
    researchValue: j,
    domestic,
    warnings,
  };
}

export function computeFinalScore({
  H = 0, B = 0, P = 0, T = null, J = 0, S = 0, D = 0, chinaRelevance = null,
} = {}, scoring = {}) {
  const component = scoring.weights || { h: 0.5, b: 0.3, p: 0.2 };
  const hWeight = clamp(component.h, 0, 1);
  const bWeight = clamp(component.b, 0, 1);
  const pWeight = clamp(component.p, 0, 1);
  const componentWeightTotal = hWeight + bWeight + pWeight || 1;
  const h = clamp(H, 0, 100);
  const b = clamp(B, 0, 100);
  const p = clamp(P, 0, 100);
  const t = T == null || !Number.isFinite(Number(T)) ? null : clamp(T, 0, 100);
  const j = clamp(J, 0, 100);
  const saturation = clamp(S, 0, 15);
  const duplicate = clamp(D, 0, 20);
  const c = clamp(saturation + duplicate, 0, 35);
  const a = clamp((h * hWeight + b * bWeight + p * pWeight) / componentWeightTotal, 0, 100);
  const { warnings: computedWarnings, ...weights } = resolveTopicScoreWeights(scoring);
  const weightWarnings = [...(scoring.scoringWarnings || []), ...computedWarnings];
  const hasDomestic = chinaRelevance != null && Number.isFinite(Number(chinaRelevance));
  const dom = hasDomestic ? clamp(chinaRelevance, 0, 12) / 12 * 100 : null;
  let appliedWeights = { ...weights };
  if (!hasDomestic) {
    const total = weights.article + weights.eventValue + weights.researchValue;
    appliedWeights = {
      ...weights,
      article: total ? weights.article / total : 1,
      eventValue: total ? weights.eventValue / total : 0,
      researchValue: total ? weights.researchValue / total : 0,
      domestic: 0,
    };
  }
  const f = t == null ? null : clamp(
    a * appliedWeights.article
      + t * appliedWeights.eventValue
      + j * appliedWeights.researchValue
      + (dom ?? 0) * appliedWeights.domestic
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
    components: { H: h, B: b, P: p, T: t, J: j, S: saturation, D: duplicate },
  };
}