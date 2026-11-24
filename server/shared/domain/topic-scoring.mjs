export const TOPIC_SCORING_FORMULA_VERSION = 'v4';

export const DEFAULT_TOPIC_SCORING_FORMULA = Object.freeze({
  articleWeights: Object.freeze({ h: 0.50, b: 0.30, p: 0.20 }),
  finalWeights: Object.freeze({ article: 0.50, eventValue: 0.20, researchValue: 0.10, domestic: 0.10, material: 0.10 }),
  competition: Object.freeze({ saturationWeight: 1, duplicateWeight: 1, saturationCap: 15, duplicateCap: 20, totalCap: 35 }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const MATERIAL_STRATEGIES = new Set(['direct_practical', 'event_trigger']);

function resolveWeights(input, defaults, label, warnings) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const values = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const raw = source[key];
    const value = raw == null ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      values[key] = fallback;
      warnings.push(`${label}.${key} 必须是 0–1 的有限数值，已回退默认值 ${fallback}`);
    } else values[key] = value;
  }
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    warnings.push(`${label} 权重总和必须大于 0，已回退默认公式`);
    return { ...defaults };
  }
  if (Math.abs(total - 1) > 1e-8) warnings.push(`${label} 权重总和为 ${Number(total.toFixed(4))}，已自动归一化为 1`);
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value / total]));
}

function resolveCompetition(input, warnings) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_TOPIC_SCORING_FORMULA.competition)) {
    const raw = source[key];
    const value = raw == null ? fallback : Number(raw);
    const max = key.endsWith('Weight') ? 5 : 100;
    if (!Number.isFinite(value) || value < 0 || value > max) {
      result[key] = fallback;
      warnings.push(`formula.competition.${key} 必须是 0–${max} 的有限数值，已回退默认值 ${fallback}`);
    } else result[key] = value;
  }
  return result;
}

export function resolveTopicScoringFormula(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const warnings = [];
  const finalWeights = resolveWeights(source.finalWeights, DEFAULT_TOPIC_SCORING_FORMULA.finalWeights, 'formula.finalWeights', warnings);
  if (finalWeights.article + finalWeights.eventValue + finalWeights.researchValue + finalWeights.material <= 0) {
    warnings.push('formula.finalWeights 必须为 DOM 缺失时保留至少一个可用分项，已回退默认公式');
    Object.assign(finalWeights, DEFAULT_TOPIC_SCORING_FORMULA.finalWeights);
  }
  return {
    formula: {
      articleWeights: resolveWeights(source.articleWeights, DEFAULT_TOPIC_SCORING_FORMULA.articleWeights, 'formula.articleWeights', warnings),
      finalWeights,
      competition: resolveCompetition(source.competition, warnings),
    },
    warnings,
  };
}

export function computeFinalScore({
  H = 0, B = 0, P = 0, T = null, J = 0, S = 0, D = 0, chinaRelevance = null,
  materialStrategy = 'unclassified', materialFit = null, M = null,
} = {}, scoring = {}) {
  const formulaResult = resolveTopicScoringFormula(scoring.formulaConfig || scoring.formula || {});
  const formula = formulaResult.formula;
  const weights = formula.finalWeights;
  const competition = formula.competition;
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
  const saturation = clamp(S, 0, competition.saturationCap);
  const duplicate = clamp(D, 0, competition.duplicateCap);
  const c = clamp(saturation * competition.saturationWeight + duplicate * competition.duplicateWeight, 0, competition.totalCap);
  const aWeights = formula.articleWeights;
  const a = clamp(h * aWeights.h + b * aWeights.b + p * aWeights.p, 0, 100);
  const weightWarnings = [...new Set([...(scoring.scoringWarnings || []), ...formulaResult.warnings])];
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
    formulaConfig: formula,
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
