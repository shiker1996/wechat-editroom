import { isPureProjectEvent } from './content-routing.mjs';
import { socialRouteForMaterialType } from '../../social-cards/domain/social-routing.mjs';

export const G_SOCIAL_WEIGHTS = Object.freeze({
  factSupport: 0.25,
  visualPotential: 0.20,
  readerValue: 0.20,
  contentClarity: 0.20,
  productionReadiness: 0.15,
});

export const G_SOCIAL_THRESHOLDS = Object.freeze({ candidate: 55, auto: 70 });
export const G_SOCIAL_MATERIAL_CAPS = Object.freeze({ repository: 6 });
export const G_SOCIAL_CLASS_CAPS = Object.freeze({ github_project: 6, repository: 6 });

const DEMONSTRABLE_PATTERN = /转换|转成|生成|复刻|预览|检索|搜索|可视化|导入|导出|同步|备份|部署|调试|测试|审查|自动化|接入.{0,16}(?:工作流|项目|系统)|一条命令|输入.{0,12}输出|pdf.{0,20}markdown|screenshot.{0,30}(?:website|web page)|(?:convert|generate|clone|preview|search|visuali[sz]e|import|export|sync|backup|deploy|debug|test|review|automate)/i;
const TREND_SIGNAL_PATTERN = /采用|迁移|生态|竞争|标准|政策|规范|趋势|增长|发布|合作|集成|adoption|migration|ecosystem|standard|policy|trend/i;

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : 0));
}

function hasFiniteValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function round(value) { return Number(clamp(value).toFixed(1)); }

function textOf(values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value != null && String(value).trim())
    .map((value) => String(value).trim())
    .join(' ');
}

function articlesOf(item) { return Array.isArray(item?.articles) ? item.articles : []; }

function sourceCountOf(item) {
  const sources = new Set(articlesOf(item).map((article) => article?.source || article?.channel || article?.url).filter(Boolean));
  return Math.max(Number(item?.sourceCount || item?.source_count || 0), sources.size);
}

function articleCountOf(item) { return Math.max(articlesOf(item).length, Number(item?.reportCount || item?.report_count || 0)); }

function cardCountOf(item, key) {
  const direct = Number(item?.[key]);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  const cardKey = { confirmedFactCount: 'confirmed_facts', timelineCount: 'timeline', disagreementCount: 'disagreements', unverifiedCount: 'unverified' }[key];
  return Array.isArray(item?.card?.[cardKey]) ? item.card[cardKey].length : 0;
}

function uniqueTimeCount(item) {
  const values = articlesOf(item).map((article) => String(article?.time || '').slice(0, 10)).filter(Boolean);
  return new Set(values).size + Math.max(0, cardCountOf(item, 'timelineCount') - values.length);
}

function materialTypeOf(item) {
  return isPureProjectEvent(item) || item?.material_type === 'repository' ? 'repository' : 'event';
}

function repositorySignals(item, text) {
  const repository = item?.repositoryMeta || {};
  const topics = Array.isArray(repository.topics) ? repository.topics : [];
  const hasReaderValue = hasFiniteValue(repository.projectReaderValue);
  const outcomeClarity = clamp(Number(repository.outcomeClarity || 0) * 10);
  const evidenceQuality = clamp(Number(repository.evidenceQuality || 0) * 10);
  const quickStart = clamp(Number(repository.quickStart || 0) * 10);
  const demonstrable = hasReaderValue ? outcomeClarity >= 40 : DEMONSTRABLE_PATTERN.test(text);
  const hasDescription = Boolean(String(repository.description || '').trim());
  const hasSource = Boolean(articlesOf(item)[0]?.url || item.sourceUrl);
  const metadataSupport = clamp(30 + (hasDescription ? 22 : 0) + (topics.length ? 10 : 0) + (hasSource ? 16 : 0) + (Number(repository.stars) > 0 ? 10 : 0));
  return {
    factSupport: hasReaderValue ? clamp(metadataSupport * 0.4 + evidenceQuality * 0.6) : metadataSupport,
    visualPotential: hasReaderValue
      ? clamp(15 + outcomeClarity * 0.7 + (demonstrable ? 15 : 0))
      : clamp(28 + (demonstrable ? 32 : 0) + Math.min(20, topics.length * 4) + (repository.language ? 8 : 0)),
    productionReadiness: hasReaderValue
      ? clamp(15 + quickStart * 0.7 + evidenceQuality * 0.15 + (repository.language ? 5 : 0) + (hasSource ? 5 : 0))
      : clamp(25 + (hasDescription ? 20 : 0) + (repository.language ? 10 : 0) + (topics.length ? 10 : 0) + (repository.createdAt ? 10 : 0) + (Number(repository.stars) > 0 ? 10 : 0) + (hasSource ? 10 : 0)),
  };
}

function eventSignals(item, text, sourceCount, articleCount) {
  const confirmedFacts = cardCountOf(item, 'confirmedFactCount');
  const timeline = cardCountOf(item, 'timelineCount');
  const disagreements = cardCountOf(item, 'disagreementCount');
  return {
    factSupport: clamp(10 + confirmedFacts * 12 + Math.min(30, sourceCount * 14) + Math.min(15, articleCount * 4)),
    visualPotential: clamp(18 + Math.min(35, timeline * 14) + Math.min(20, disagreements * 10) + (TREND_SIGNAL_PATTERN.test(text) ? 10 : 0)),
    productionReadiness: clamp(18 + Math.min(35, confirmedFacts * 12) + Math.min(25, sourceCount * 12) + Math.min(15, timeline * 8)),
  };
}

function commonSignals(item, text, sourceCount, articleCount) {
  const china = clamp(Number(item?.chinaRelevance || item?.china_relevance_score || 0) / 12 * 60);
  const audience = clamp(Number(item?.preScores?.audience || 0) / 20 * 40);
  const baselineReaderValue = clamp(china + audience);
  const projectReaderValue = hasFiniteValue(item?.repositoryMeta?.projectReaderValue)
    ? Number(item.repositoryMeta.projectReaderValue) : Number.NaN;
  const projectFeedbackAdjustment = Number(item?.repositoryMeta?.projectFeedbackAdjustment);
  const feedbackAdjustment = Number.isFinite(projectFeedbackAdjustment) ? clamp(projectFeedbackAdjustment, -8, 8) : 0;
  const readerValue = Number.isFinite(projectReaderValue)
    ? clamp(baselineReaderValue * 0.5 + clamp(projectReaderValue, 0, 100) * 0.5 + feedbackAdjustment)
    : clamp(baselineReaderValue + feedbackAdjustment);
  const keywords = Array.isArray(item?.keywords) ? item.keywords.length : 0;
  const hasTitle = Boolean(String(item?.title || '').trim());
  const hasSummary = articlesOf(item).some((article) => String(article?.summary || '').trim());
  const clarity = clamp((hasTitle ? 25 : 0) + Math.min(25, keywords * 5) + (hasSummary ? 18 : 0) + (sourceCount ? 12 : 0) + (articleCount > 1 ? 10 : 0) + (text.length > 80 ? 10 : 0));
  return { readerValue, projectReaderValue: Number.isFinite(projectReaderValue) ? clamp(projectReaderValue, 0, 100) : null, projectFeedbackAdjustment: feedbackAdjustment, contentClarity: clarity };
}

function qualificationFor(item, materialType, signals) {
  const sourceCount = sourceCountOf(item);
  const articleCount = articleCountOf(item);
  if (item?.riskLevel === '高') return { status: 'blocked', reason: '风险等级为高', candidateEligible: false, autoEligible: false };
  if (materialType === 'repository') {
    const repository = item?.repositoryMeta || {};
    const text = textOf([item?.title, item?.chinaRelevanceReason, repository.description, repository.language, repository.topics,
      repository.projectType, repository.scenarioIds, repository.directUseCase, repository.discoveryChannels]);
    const hasReaderValue = hasFiniteValue(repository.projectReaderValue);
    const directUseCase = String(repository.directUseCase || '').trim();
    const outcomeClarity = Number(repository.outcomeClarity);
    const evidenceQuality = Number(repository.evidenceQuality);
    if (hasReaderValue && Number(repository.projectReaderValue) < 60) {
      return { status: 'reader_value_blocked', reason: `项目读者价值 ${Number(repository.projectReaderValue).toFixed(1)}，低于候选线 60`, candidateEligible: false, autoEligible: false };
    }
    if (hasReaderValue && (!directUseCase || !Number.isFinite(outcomeClarity) || outcomeClarity < 4)) {
      return { status: 'outcome_gate_blocked', reason: '项目没有说明读者任务和可见结果', candidateEligible: false, autoEligible: false };
    }
    if (!hasReaderValue && !DEMONSTRABLE_PATTERN.test(text) && signals.gSocial >= G_SOCIAL_THRESHOLDS.candidate) {
      return { status: 'type_gate_blocked', reason: '项目缺少具体任务或结果的可演示证据', candidateEligible: false, autoEligible: false };
    }
    if (hasReaderValue && Number.isFinite(evidenceQuality) && evidenceQuality < 3) {
      return { status: 'evidence_gate_blocked', reason: '项目缺少支持贴图介绍的 README、示例或来源证据', candidateEligible: false, autoEligible: false };
    }
  }
  const contentClass = String(item?.contentClass || item?.content_class || '');
  const classificationEvidence = Array.isArray(item?.classificationEvidence) ? item.classificationEvidence : Array.isArray(item?.classification_evidence) ? item.classification_evidence : [];
  if (contentClass === 'open_source_technology'
    && !classificationEvidence.some((entry) => entry?.role === 'technical_mechanism' || entry?.role === 'architecture' || entry?.role === 'performance')) {
    return { status: 'type_gate_blocked', reason: '开源技术缺少机制、架构或性能证据', candidateEligible: false, autoEligible: false };
  }
  if (contentClass === 'open_source_trend') {
    const features = item?.classificationFeatures || item?.classification_features || {};
    if (!(sourceCount >= 2 && (features.hasAdoptionSignal || features.subjectCount >= 2 || classificationEvidence.some((entry) => entry?.role === 'trend_signal')))) {
      return { status: 'type_gate_blocked', reason: '开源趋势缺少多来源与变化信号', candidateEligible: false, autoEligible: false };
    }
  }
  if (materialType === 'event' && (signals.confirmedFacts < 1 || sourceCount < 1)) {
    return { status: 'evidence_gate_blocked', reason: '事件缺少已确认事实或来源证据', candidateEligible: false, autoEligible: false };
  }
  const candidateEligible = signals.gSocial >= G_SOCIAL_THRESHOLDS.candidate;
  const autoEligible = signals.gSocial >= G_SOCIAL_THRESHOLDS.auto;
  if (autoEligible) return { status: 'auto_eligible', reason: '通过事实门禁和自动图文线', candidateEligible, autoEligible };
  if (candidateEligible) return { status: 'candidate', reason: `G_social ${signals.gSocial}，达到候选线但未达到自动图文线 ${G_SOCIAL_THRESHOLDS.auto}`, candidateEligible, autoEligible };
  return { status: 'below_threshold', reason: `G_social ${signals.gSocial}，低于候选线 ${G_SOCIAL_THRESHOLDS.candidate}`, candidateEligible, autoEligible };
}

export function scoreSocialCandidate(item) {
  const materialType = materialTypeOf(item);
  const repository = item?.repositoryMeta || {};
  const text = textOf([item?.title, item?.chinaRelevanceReason, item?.keywords, item?.articles?.map((article) => [article?.title, article?.summary, article?.source]), repository.description, repository.language, repository.topics,
    repository.projectType, repository.scenarioIds, repository.directUseCase, repository.discoveryChannels]);
  const sourceCount = sourceCountOf(item);
  const articleCount = articleCountOf(item);
  const common = commonSignals(item, text, sourceCount, articleCount);
  const typeSignals = materialType === 'repository'
    ? repositorySignals(item, text)
    : eventSignals(item, text, sourceCount, articleCount);
  const dimensions = {
    factSupport: round(typeSignals.factSupport),
    visualPotential: round(typeSignals.visualPotential),
    readerValue: round(common.readerValue),
    contentClarity: round(common.contentClarity),
    productionReadiness: round(typeSignals.productionReadiness),
  };
  const saturationPenalty = clamp(Number(item?.saturationPenalty || 0), 0, 10);
  const riskPenalty = item?.riskLevel === '较高' ? 12 : item?.riskLevel === '中' ? 5 : 0;
  const missingEvidencePenalty = cardCountOf(item, 'confirmedFactCount') < 1 ? 8 : 0;
  const penalties = { saturationPenalty: round(saturationPenalty), riskPenalty: round(riskPenalty), missingEvidencePenalty: round(missingEvidencePenalty) };
  const weighted = Object.entries(G_SOCIAL_WEIGHTS).reduce((sum, [key, weight]) => sum + dimensions[key] * weight, 0);
  const gSocial = round(weighted - saturationPenalty - riskPenalty - missingEvidencePenalty);
  const signals = { ...dimensions, ...penalties, gSocial, projectReaderValue: common.projectReaderValue, projectFeedbackAdjustment: common.projectFeedbackAdjustment, confirmedFacts: cardCountOf(item, 'confirmedFactCount'), sourceCount, articleCount };
  const qualification = qualificationFor(item, materialType, { ...signals, gSocial });
  const repositoryText = textOf([item?.title, repository.description, repository.language, repository.topics, repository.projectType, repository.scenarioIds, repository.directUseCase, repository.discoveryChannels]);
  const trending = /github\s*trending/i.test(repositoryText) || repository?.discoveryChannels?.includes('trending');
  const demonstrable = DEMONSTRABLE_PATTERN.test(repositoryText);
  const reasons = [
    materialType === 'repository' ? 'GitHub 项目素材' : '事件素材',
    sourceCount > 1 ? `${sourceCount} 个独立来源` : null,
    trending ? 'Trending' : null,
    repository?.discoveryChannels?.includes('search') ? '近期增长发现' : null,
    repository?.discoveryChannels?.includes('mentioned') ? '热点提及' : null,
    Number(repository?.stars) >= 1000 ? `${repository.stars} Stars` : null,
    hasFiniteValue(repository?.projectReaderValue) ? `读者价值 ${Number(repository.projectReaderValue).toFixed(1)}` : null,
    common.projectFeedbackAdjustment ? `反馈调整 ${common.projectFeedbackAdjustment > 0 ? '+' : ''}${common.projectFeedbackAdjustment}` : null,
    demonstrable ? '可演示工具' : null,
  ].filter(Boolean);
  const contentClass = String(item?.contentClass || item?.content_class || (materialType === 'repository' ? 'github_project' : 'news_event'));
  return {
    contentClass,
    materialType,
    ...socialRouteForMaterialType(materialType),
    gSocial,
    socialScore: gSocial,
    socialScoreDetails: { ...dimensions, ...penalties, projectReaderValue: common.projectReaderValue, projectFeedbackAdjustment: common.projectFeedbackAdjustment, finalScore: gSocial, scoreStage: 'discovery', scoreModel: 'g_social-v1', weights: G_SOCIAL_WEIGHTS,
      materialType, qualificationStatus: qualification.status, qualificationReason: qualification.reason,
      candidateEligible: qualification.candidateEligible, autoEligible: qualification.autoEligible },
    qualificationStatus: qualification.status,
    qualificationReason: qualification.reason,
    candidateEligible: qualification.candidateEligible,
    autoEligible: qualification.autoEligible,
    eligible: qualification.autoEligible,
    rejectionReason: qualification.reason,
    reasons,
  };
}

export function selectSocialPool(ranking, limit = 10, materialCaps = G_SOCIAL_MATERIAL_CAPS) {
  const selected = [];
  const counts = new Map();
  for (const item of Array.isArray(ranking) ? ranking : []) {
    if (!item?.autoEligible && !item?.eligible) continue;
    const materialType = String(item.contentClass || item.content_class || item.materialType || 'event');
    const capKey = materialCaps && Object.hasOwn(materialCaps, materialType) ? materialType : (materialType === 'github_project' ? 'repository' : materialType);
    const cap = materialCaps && Number.isFinite(Number(materialCaps[capKey])) ? Number(materialCaps[capKey]) : Infinity;
    const count = counts.get(materialType) || 0;
    if (count >= cap) continue;
    selected.push(item);
    counts.set(materialType, count + 1);
    if (selected.length >= Math.max(1, Number(limit) || 10)) break;
  }
  return selected;
}

export function selectSocialCandidates(ranking, limit = 10, includeBelowThreshold = false) {
  const scored = (Array.isArray(ranking) ? ranking : []).map((item) => ({ ...item, ...scoreSocialCandidate(item) }));
  const filtered = includeBelowThreshold ? scored : scored.filter((item) => item.candidateEligible);
  return filtered
    .sort((a, b) => b.gSocial - a.gSocial || (b.finalPreScore || 0) - (a.finalPreScore || 0) || String(a.title || '').localeCompare(String(b.title || '')))
    .slice(0, Math.max(1, Number(limit) || 10));
}
