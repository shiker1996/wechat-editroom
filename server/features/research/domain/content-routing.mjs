import { isRepositoryEvent } from './editorial-categories.mjs';

const CONTENT_CLASSES = new Set(['news_event', 'open_source_technology', 'open_source_trend', 'github_project']);
const list = (value) => Array.isArray(value) ? value : [];

/** Derive classification evidence from event material; model claims never replace these facts. */
export function deriveClassificationFeatures(event = {}) {
  const articles = list(event.articles);
  const repositories = articles.filter((item) => /github\.com\//i.test(String(item?.url || '')) || /github/i.test(String(item?.source || item?.source_group || '')));
  const independentSources = new Set(articles.map((item) => String(item?.source_group || item?.source || item?.url || '').trim().toLowerCase()).filter(Boolean));
  const text = [event.representative_title, event.title, event.summary, event.keywords, ...articles.flatMap((item) => [item?.title, item?.summary, item?.content, item?.description])].flat(3).filter(Boolean).join(' ');
  return {
    hasGithubRepository: repositories.length > 0,
    repositoryCount: repositories.length,
    projectCount: repositories.length,
    independentSourceCount: independentSources.size,
    subjectCount: new Set(articles.map((item) => String(item?.entity || item?.subject || item?.source || '').trim().toLowerCase()).filter(Boolean)).size,
    hasTechnicalDocs: /架构|机制|原理|technical\s*report|architecture|mechanism/i.test(text),
    hasPaper: /论文|paper|arxiv/i.test(text),
    hasBenchmark: /benchmark|性能|吞吐|延迟|评测|基准/i.test(text),
    hasAdoptionSignal: /采用|迁移|集成|生态|adoption|migration|integration|ecosystem/i.test(text),
    sourceEvidence: articles.map((item) => ({ sourceId: item?.source_id || (item?.hotspot_id != null ? `hotspot:${item.hotspot_id}` : ''), url: item?.url || '', title: item?.title || '' })),
    sourceCount: independentSources.size,
    hasTimeline: list(event.card?.timeline || event.timeline).length > 1,
  };
}

/** Normalize model output and enforce deterministic evidence gates for content routes. */
export function normalizeEventClassification(raw = {}, { event = {}, features = deriveClassificationFeatures(event) } = {}) {
  const requested = String(raw.content_class || raw.contentClass || '').trim();
  const hasGithubRepository = features.hasGithubRepository || isPureProjectEvent(event);
  const singleRepositorySingleSource = hasGithubRepository
    && ((Number(features.repositoryCount || 0) === 1 && Number(features.independentSourceCount || 0) <= 1)
      || (Number(features.repositoryCount || 0) === 0 && Number(features.independentSourceCount || 0) === 0 && isPureProjectEvent(event)));
  const evidence = list(raw.evidence).map((item) => ({
    sourceId: String(item?.source_id || item?.sourceId || '').trim(),
    role: String(item?.role || '').trim(),
    claim: String(item?.claim || '').trim(),
  })).filter((item) => item.sourceId && item.role && item.claim);
  const evidenceByRole = (role) => evidence.some((item) => item.role === role);
  const missingEvidence = [];
  let contentClass = CONTENT_CLASSES.has(requested) ? requested : 'news_event';
  if (singleRepositorySingleSource) contentClass = 'github_project';
  else if (requested === 'github_project' && hasGithubRepository) {
    contentClass = features.hasTechnicalDocs || features.hasPaper || features.hasBenchmark
      ? 'open_source_technology'
      : 'news_event';
  }
  if (contentClass === 'open_source_technology' && !(features.hasTechnicalDocs || features.hasPaper || features.hasBenchmark || evidenceByRole('technical_mechanism'))) missingEvidence.push('技术机制、架构或性能证据');
  if (contentClass === 'open_source_trend' && !(Number(features.independentSourceCount || 0) >= 2 || Number(features.subjectCount || 0) >= 2 || features.hasTimeline) ) missingEvidence.push('多来源、多主体或生态变化证据');
  const status = contentClass === 'github_project' && hasGithubRepository
    ? 'auto'
    : contentClass === 'news_event' && !requested ? 'needs_review'
      : missingEvidence.length ? 'needs_review' : 'model_validated';
  const articleEligible = contentClass !== 'github_project';
  return {
    contentClass,
    status,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    reason: String(raw.reason || ''),
    evidence,
    features,
    missingEvidence,
    articleEligible,
    socialEligible: true,
    defaultRoute: articleEligible ? 'article' : 'social_cards',
  };
}

/** Repository origin is provenance, not an editorial category. */
export function isPureProjectEvent(event = {}) {
  if (Array.isArray(event.articles) && event.articles.length) return isRepositoryEvent(event);
  return isRepositoryEvent(event)
    || String(event.source_group || event.source_type || event.source || '').toLowerCase().includes('github')
    || /^https?:\/\/github\.com\//i.test(String(event.url || ''));
}

/** Choose a production route from source material and an explicit editorial decision. */
export function classifyContentRoute(card = {}, { event = null, requestedRoute = '' } = {}) {
  const articles = list(card.articles).length ? card.articles : list(event?.articles);
  const project = isPureProjectEvent({ ...(event || {}), ...card, articles });
  const manuallyApproved = requestedRoute === 'article'
    || card.articleRouteApproved === true || card.article_route_approved === true;
  if (project && !manuallyApproved) {
    return {
      contentRoute: 'social_only', articleEligible: false, pureProject: true,
      warning: 'GitHub 项目默认进入项目图文路线；文章路线需要人工选题并通过事实门禁',
    };
  }
  if (project && manuallyApproved) {
    return {
      contentRoute: 'manual_review', articleEligible: true, pureProject: true,
      warning: '项目已由编辑明确选入文章路线，仍需通过文章事实门禁',
    };
  }
  if (card.articleEligible === false || card.article_eligible === false) {
    return { contentRoute: 'editorial_review', articleEligible: false, pureProject: false, warning: card.articleEligibilityReason || card.article_eligibility_reason || '编辑资格待确认' };
  }
  return { contentRoute: 'article', articleEligible: true, pureProject: false, warning: '' };
}

export function scoreStatusForCard(card = {}) {
  const source = card.source || {};
  const rawEventValue = source.eventValue ?? source.t ?? source.eventHeatScore;
  const hasEventValue = rawEventValue !== null && rawEventValue !== undefined && Number.isFinite(Number(rawEventValue));
  if (source.scoreStatus === 'needs_source_data' || source.composite && !hasEventValue) {
    return { scoreStatus: 'needs_source_data', scoreWarning: source.scoreWarning || '缺少事件价值 T 或可核验事实，暂不生成正式 F 分' };
  }
  return { scoreStatus: 'ready', scoreWarning: '' };
}
