const HOUR = 60 * 60 * 1000;
export const EVENT_HEAT_RANKING_VERSION = 5;

function timeValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseRaw(hotspot) {
  try { return JSON.parse(hotspot?.raw_json || '{}'); } catch { return {}; }
}

function observedAt(hotspot) {
  const raw = parseRaw(hotspot);
  const paperSource = hotspot?.source_group === 'paper' || hotspot?.source_type === 'paper' || raw.sourceType === 'paper';
  if (!paperSource) return hotspot?.published_at || hotspot?.created_at;
  const huggingFacePaper = (raw.discoverySources || []).includes?.('huggingface_papers')
    || /hugging\s*face/i.test(String(raw.platform || ''));
  return raw.discoveredAt || (huggingFacePaper ? hotspot?.created_at : null) || hotspot?.published_at || hotspot?.created_at;
}

function tagValue(hotspot, key) {
  return parseRaw(hotspot).aiTags?.[key];
}

function dateKey(value) {
  const timestamp = timeValue(value);
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function decay(timestamp, asOf, halfLifeHours = 36) {
  if (!timestamp) return 0;
  const ageHours = Math.max(0, (asOf - timestamp) / HOUR);
  return 2 ** (-ageHours / halfLifeHours);
}

function latestTimestamp(values) {
  return values.reduce((latest, value) => Math.max(latest, timeValue(value)), 0);
}

function representativeTitle(event) {
  const semanticTitle = buildEventTitle({ ...(event.normalized || {}), actionType: event.action_type || event.normalized?.actionType });
  return semanticTitle || event.title || event.normalized?.description || event.id;
}

function reasonList({ state, newReportCount, sourceCount, repeatDays, currentCount }) {
  const reasons = [];
  if (state === 'new_event') reasons.push('首次进入事件基座');
  if (state === 'new_update') reasons.push('出现事件新进展');
  if (newReportCount > 0 && state !== 'new_event') reasons.push(`新增 ${newReportCount} 条事实报道`);
  if (sourceCount > 1) reasons.push(`扩散至 ${sourceCount} 个独立来源`);
  if (currentCount > 1) reasons.push(`当前批次 ${currentCount} 条关联报道已归并`);
  if (repeatDays > 1) reasons.push(`已连续出现 ${repeatDays} 天`);
  if (state === 'stale') reasons.push('连续出现但未检测到实质增量');
  return reasons.length ? reasons : ['等待更多可核验信息'];
}

function classificationOf(event = {}) {
  const raw = event.classification || event.card?.classification || event.event_card?.classification || {};
  const contentClass = String(raw.contentClass || raw.content_class || event.content_class || '').trim();
  const features = raw.features || event.classification_features || {};
  return {
    contentClass: ['github_project', 'open_source_technology', 'open_source_trend', 'news_event'].includes(contentClass)
      ? contentClass : 'news_event',
    status: String(raw.status || raw.classification_status || event.classification_status || 'needs_review'),
    features: features && typeof features === 'object' ? features : {},
  };
}

function eventText(event = {}) {
  return [event.title, event.representative_title, event.normalized?.description, event.keywords,
    event.tags?.eventParts, event.eventParts, ...(event.articles || []).map((article) => [article.title, article.summary, article.source])]
    .flat(4).filter(Boolean).join(' ');
}

function preScoresOf(event = {}, currentHotspots = []) {
  const direct = event.tags?.preScores || event.preScores;
  if (direct && typeof direct === 'object' && Object.keys(direct).length) return direct;
  return currentHotspots.map((hotspot) => parseRaw(hotspot).aiTags?.preScores)
    .find((scores) => scores && typeof scores === 'object') || {};
}

const PLATFORM_METRIC_REFERENCES = Object.freeze({
  views: 100000, read: 50000, look: 50000,
  likes: 5000, replies: 500, reposts: 1000, bookmarks: 300,
  upvotes: 100, score: 1000, stars: 10000,
});

function metricCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/^\s*(\d+(?:\.\d+)?)\s*([km])?\s*(?:points?|score)?\s*$/i);
  if (!match) return null;
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1000 : match[2]?.toLowerCase() === 'm' ? 1000000 : 1;
  return Number(match[1]) * multiplier;
}

function normalizedMetric(value, reference) {
  const count = metricCount(value);
  if (count == null) return null;
  return clamp(Math.log1p(count) / Math.log1p(reference), 0, 1);
}

function platformOf(hotspot, raw, metrics) {
  const provider = String(raw.raw?.provider || raw.provider || raw.platform || raw.raw?.platform || metrics.platform || '').toLowerCase();
  const source = String(hotspot.source_group || hotspot.source_type || hotspot.source || '').toLowerCase();
  if (/techtwitter/.test(`${provider} ${source}`)) return 'techtwitter';
  if (/twex|(^|[^a-z])x([^a-z]|$)|twitter/.test(`${provider} ${source}`)) return 'x';
  if (/dajiala|wechat|公众号/.test(`${provider} ${source}`) || metrics.read != null) return 'wechat';
  if (/reddit/.test(`${provider} ${source}`) || raw.scoreText != null || raw.raw?.scoreText != null) return 'reddit';
  if (/hugging.?face/.test(`${provider} ${source}`) || metrics.upvotes != null) return 'huggingface';
  if (/github/.test(`${provider} ${source}`) || raw.stars != null || raw.raw?.stars != null) return 'github';
  return provider || source || 'other';
}

function scorePlatformItem(hotspot, asOf) {
  const raw = parseRaw(hotspot);
  const metrics = { ...(raw.raw?.metrics || {}), ...(raw.metrics || {}) };
  const reachValues = [
    ['views', metrics.views, PLATFORM_METRIC_REFERENCES.views],
    ['read', metrics.read, PLATFORM_METRIC_REFERENCES.read],
    ['look', metrics.look, PLATFORM_METRIC_REFERENCES.look],
  ].map(([key, value, reference]) => ({ key, score: normalizedMetric(value, reference) })).filter((item) => item.score != null);
  const interactionSpecs = [
    ['likes', 1, PLATFORM_METRIC_REFERENCES.likes],
    ['replies', 1.25, PLATFORM_METRIC_REFERENCES.replies],
    ['reposts', 1.25, PLATFORM_METRIC_REFERENCES.reposts],
    ['bookmarks', 1, PLATFORM_METRIC_REFERENCES.bookmarks],
    ['upvotes', 1, PLATFORM_METRIC_REFERENCES.upvotes],
    ['stars', 1, PLATFORM_METRIC_REFERENCES.stars],
  ];
  const interactionValues = interactionSpecs.map(([key, weight, reference]) => {
    const rawValue = key === 'stars' ? raw.stars ?? raw.raw?.stars ?? raw.repositoryMeta?.stars ?? raw.raw?.repositoryMeta?.stars
      : key === 'upvotes' ? metrics.upvotes ?? raw.upvotes ?? raw.raw?.upvotes
        : metrics[key];
    const score = normalizedMetric(rawValue, reference);
    return score == null ? null : { key, weight, score };
  }).filter(Boolean);
  const redditScore = normalizedMetric(raw.scoreText ?? raw.raw?.scoreText ?? metrics.score, PLATFORM_METRIC_REFERENCES.score);
  if (redditScore != null) interactionValues.push({ key: 'scoreText', weight: 1, score: redditScore });

  const reach = reachValues.length ? Math.max(...reachValues.map((item) => item.score)) : null;
  const interaction = interactionValues.length
    ? interactionValues.reduce((sum, item) => sum + item.score * item.weight, 0) / interactionValues.reduce((sum, item) => sum + item.weight, 0)
    : null;
  if (reach == null && interaction == null) return null;
  let score = reach != null && interaction != null ? reach * 0.4 + interaction * 0.6 : reach ?? interaction;
  const timestamp = timeValue(raw.updatedAt || raw.raw?.updatedAt || observedAt(hotspot));
  if (timestamp) score *= decay(timestamp, asOf, 168);
  const platform = platformOf(hotspot, raw, metrics);
  return { platform, score: Number((score * 10).toFixed(2)), signals: [...reachValues.map((item) => item.key), ...interactionValues.map((item) => item.key)] };
}

function platformImpactOf(currentHotspots, asOf) {
  const byPlatform = new Map();
  for (const hotspot of currentHotspots) {
    const signal = scorePlatformItem(hotspot, asOf);
    if (!signal) continue;
    const previous = byPlatform.get(signal.platform);
    if (!previous || signal.score > previous.score) byPlatform.set(signal.platform, signal);
  }
  const strongest = [...byPlatform.values()].sort((left, right) => right.score - left.score || left.platform.localeCompare(right.platform));
  if (!strongest.length) return { available: false, score: 0, byPlatform: [] };
  const score = clamp(strongest[0].score + strongest.slice(1, 4).reduce((sum, item) => sum + item.score * 0.25, 0), 0, 10);
  return { available: true, score: Number(score.toFixed(1)), byPlatform: strongest.map(({ platform, score: value, signals }) => ({ platform, score: value, signals })) };
}

function sourceStats({ currentHotspots, currentMemberships, features }) {
  const sourceCount = new Set(currentHotspots.map((hotspot) => hotspot.source_name || hotspot.source_group || hotspot.source).filter(Boolean)).size;
  const sourceEvidenceCount = Array.isArray(features.sourceEvidence) ? features.sourceEvidence.length : 0;
  return {
    sourceCount: Math.max(sourceCount, Number(features.independentSourceCount) || 0),
    sourceEvidenceCount,
    reportCount: currentMemberships.length,
  };
}

function accountNewsScoreParts({ event, currentHotspots, base }) {
  const scores = preScoresOf(event, currentHotspots);
  const readerConnection = clamp((Number(scores.audience) || 0) / 20 * 40, 0, 40);
  const readerImpact = clamp((Number(scores.impact) || 0) / 10 * 25, 0, 25);
  const informationGain = clamp((Number(scores.informationGain) || 0) / 15 * 20, 0, 20);
  const evidenceQuality = Number.isFinite(Number(scores.sourceReliability))
    ? clamp((Number(scores.sourceReliability) || 0) / 10 * 10, 0, 10)
    : clamp((Number(base.evidenceScore) || 0) / 10 * 10, 0, 10);
  // 热度只作为弱信号：新鲜度 3 分，扩散/报道动量 2 分。
  const freshness = clamp((Number(base.freshnessScore) || 0) / 25 * 3, 0, 3);
  const diffusion = clamp(((Number(base.incrementScore) || 0) + (Number(base.sourceSpreadScore) || 0) + (Number(base.momentumScore) || 0)) / 55 * 2, 0, 2);
  const historyDecay = clamp((Number(base.historyDecayScore) || 0) * 0.75, 0, 15);
  const scoreValue = Number(clamp(
    readerConnection + readerImpact + informationGain + evidenceQuality + freshness + diffusion - historyDecay,
    0, 100,
  ).toFixed(1));
  return {
    readerConnection: Number(readerConnection.toFixed(1)),
    readerImpact: Number(readerImpact.toFixed(1)),
    informationGain: Number(informationGain.toFixed(1)),
    evidenceQuality: Number(evidenceQuality.toFixed(1)),
    freshness: Number(freshness.toFixed(1)),
    diffusion: Number(diffusion.toFixed(1)),
    historyDecay: Number(historyDecay.toFixed(1)),
    scoreValue,
  };
}

function scorePartsForClass(contentClass, { event, currentHotspots, currentMemberships, base, asOf }) {
  const features = classificationOf(event).features;
  const scores = preScoresOf(event, currentHotspots);
  const stats = sourceStats({ currentHotspots, currentMemberships, features });
  const repositoryMeta = event.repositoryMeta || event.articles?.find((article) => article.repositoryMeta)?.repositoryMeta || null;
  const text = eventText(event);
  const freshness = Math.round(15 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 240));
  if (contentClass === 'open_source_technology') {
    const novelty = clamp((Number(scores.informationGain) || 0) / 15 * 15 + (features.hasPaper ? 5 : 0) + (features.hasBenchmark ? 5 : 0), 0, 25);
    const mechanismDepth = clamp((features.hasTechnicalDocs ? 8 : 0) + (features.hasPaper ? 7 : 0) + (features.hasBenchmark ? 5 : 0), 0, 20);
    const engineeringImpact = clamp((Number(scores.impact) || 0) / 10 * 12 + (features.hasAdoptionSignal ? 4 : 0) + (features.hasCompatibilitySignal ? 4 : 0), 0, 20);
    const reproducibility = clamp((features.hasBenchmark ? 9 : 0) + (features.hasPaper ? 4 : 0) + (features.hasTechnicalDocs ? 4 : 0) + (repositoryMeta ? 3 : 0), 0, 15);
    const timeliness = clamp(Math.round(20 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 168)), 0, 20);
    return { novelty: Number(novelty.toFixed(1)), mechanismDepth: Number(mechanismDepth.toFixed(1)), engineeringImpact: Number(engineeringImpact.toFixed(1)), reproducibility: Number(reproducibility.toFixed(1)), timeliness, sourceCount: stats.sourceCount, scoreValue: Number(clamp(novelty + mechanismDepth + engineeringImpact + reproducibility + timeliness, 0, 100).toFixed(1)) };
  }
  if (contentClass === 'open_source_trend') {
    const breadth = clamp((stats.sourceCount * 4) + ((Number(features.subjectCount) || 0) * 4), 0, 25);
    const trajectory = clamp((features.hasTimeline ? 8 : 0) + (features.hasAdoptionSignal ? 5 : 0) + (features.hasMigrationSignal ? 5 : 0) + (base.repeatDays > 1 ? 2 : 0), 0, 20);
    const ecosystemImpact = clamp((features.hasAdoptionSignal ? 7 : 0) + (features.hasMigrationSignal ? 5 : 0) + (features.hasCompatibilitySignal ? 4 : 0) + (features.hasPolicyOrStandardSignal ? 4 : 0), 0, 20);
    const evidenceQuality = clamp((stats.sourceCount * 4) + (features.hasTechnicalDocs ? 2 : 0) + (stats.sourceEvidenceCount > 2 ? 2 : 0), 0, 20);
    const timeliness = clamp(Math.round(15 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 240)), 0, 15);
    return { breadth: Number(breadth.toFixed(1)), trajectory: Number(trajectory.toFixed(1)), ecosystemImpact: Number(ecosystemImpact.toFixed(1)), evidenceQuality: Number(evidenceQuality.toFixed(1)), timeliness, sourceCount: stats.sourceCount, scoreValue: Number(clamp(breadth + trajectory + ecosystemImpact + evidenceQuality + timeliness, 0, 100).toFixed(1)) };
  }
  if (contentClass === 'github_project') {
    const projectClarity = clamp((repositoryMeta ? 18 : 8) + (features.hasTechnicalDocs ? 5 : 0) + (/工具|框架|插件|workflow|cli|sdk/i.test(text) ? 7 : 0), 0, 30);
    const demonstrability = clamp((features.hasGithubRepository ? 12 : 4) + (features.hasRelease ? 5 : 0) + (repositoryMeta?.language ? 4 : 0) + (repositoryMeta?.topics?.length ? 4 : 0), 0, 25);
    const discoveryFreshness = clamp(Math.round(20 * decay(base.lastUpdateAt ? timeValue(base.lastUpdateAt) : timeValue(base.lastSeenAt), asOf, 96)), 0, 20);
    const sourceCompleteness = clamp(stats.sourceCount * 4 + (stats.sourceEvidenceCount > 1 ? 4 : 0) + (Number(features.repositoryCount) > 0 ? 4 : 0), 0, 15);
    const visualPotential = clamp((features.hasGithubRepository ? 6 : 2) + (repositoryMeta?.topics?.length ? 4 : 0), 0, 10);
    return { projectClarity: Number(projectClarity.toFixed(1)), demonstrability: Number(demonstrability.toFixed(1)), discoveryFreshness, sourceCompleteness: Number(sourceCompleteness.toFixed(1)), visualPotential: Number(visualPotential.toFixed(1)), sourceCount: stats.sourceCount, scoreValue: Number(clamp(projectClarity + demonstrability + discoveryFreshness + sourceCompleteness + visualPotential, 0, 100).toFixed(1)) };
  }
  if (contentClass === 'news_event') {
    return base.scoreParts || accountNewsScoreParts({ event, currentHotspots, base });
  }
  return {
    freshness: base.freshnessScore,
    increment: base.incrementScore,
    sourceSpread: base.sourceSpreadScore,
    momentum: base.momentumScore,
    chinaRelevance: base.chinaRelevanceScore,
    evidence: base.evidenceScore,
    historyDecay: base.historyDecayScore,
    scoreValue: base.heatScore,
  };
}

/** Score a classified stable event without forcing project/technology/trend into news heat semantics. */
export function scoreClassifiedEvent({ event, currentMemberships = [], historicalMemberships = [], hotspotsById = new Map(), asOf = Date.now() }) {
  const base = scoreEventHeat({ event, currentMemberships, historicalMemberships, hotspotsById, asOf });
  const { contentClass, status } = classificationOf(event);
  const currentHotspots = currentMemberships.map((membership) => hotspotsById.get(Number(membership.hotspot_id))).filter(Boolean);
  const modelParts = scorePartsForClass(contentClass, { event, currentHotspots, currentMemberships, base, asOf });
  const baseScoreValue = Number.isFinite(Number(modelParts.scoreValue)) ? Number(modelParts.scoreValue) : base.heatScore;
  const platformImpact = platformImpactOf(currentHotspots, asOf);
  // When counters are present, reserve 10% of T for observed platform impact.
  // Missing counters are unknown rather than zero, so retain the full base score.
  const scoreValue = platformImpact.available
    ? Number(clamp(baseScoreValue * 0.9 + platformImpact.score, 0, 100).toFixed(1))
    : baseScoreValue;
  const scoreParts = {
    ...modelParts,
    baseScoreValue,
    platformImpact: platformImpact.score,
    platformImpactByPlatform: platformImpact.byPlatform,
    scoreValue,
  };
  const scoreModel = contentClass === 'news_event' ? 'T_account' : contentClass;
  return {
    ...base,
    contentClass,
    classificationStatus: status,
    scoreModel,
    scoreValue,
    platformImpact: platformImpact.score,
    platformImpactAvailable: platformImpact.available,
    platformImpactByPlatform: platformImpact.byPlatform,
    heatScore: scoreValue,
    eventValue: scoreValue,
    t: scoreValue,
    scoreParts,
    scoreComparable: false,
  };
}

/**
 * Build a deterministic event-level ranking. The model/resolver supplies event
 * identity; news events use the persisted account-aware semantic scores, with
 * recency and propagation retained only as weak supporting signals.
 */
export function scoreEventHeat({ event, currentMemberships = [], historicalMemberships = [], hotspotsById = new Map(), asOf = Date.now() }) {
  const currentIds = new Set(currentMemberships.map((membership) => Number(membership.hotspot_id)).filter(Number.isFinite));
  const currentHotspots = [...currentIds].map((id) => hotspotsById.get(id)).filter(Boolean);
  const allMemberships = [...historicalMemberships];
  const seenDates = new Set(allMemberships.map((membership) => dateKey(membership.batch_date || membership.created_at || membership.updated_at)).filter(Boolean));
  const currentSeenDates = new Set(currentMemberships.map((membership) => dateKey(membership.batch_date || membership.created_at || membership.updated_at)).filter(Boolean));
  const repeatDays = Math.max(1, seenDates.size || currentSeenDates.size || 1);
  const latestSeenAt = latestTimestamp([
    event.last_seen_at,
    ...currentHotspots.map(observedAt),
  ]);
  const lastUpdateAt = event.event_state === 'new_update' || event.event_state === 'new_event'
    ? latestSeenAt : 0;
  const ageHours = latestSeenAt ? Math.max(0, (asOf - latestSeenAt) / HOUR) : Infinity;
  const sourceNames = new Set(currentHotspots.map((hotspot) => hotspot.source_name || hotspot.source_group || hotspot.source).filter(Boolean));
  const sourceGroups = new Set(currentHotspots.map((hotspot) => hotspot.source_group || hotspot.source).filter(Boolean));
  const urlCount = new Set(currentHotspots.map((hotspot) => hotspot.url).filter(Boolean)).size;
  const newInfoCount = currentMemberships.filter((membership) => Number(membership.is_new_information) === 1).length;
  const newReportCount = event.event_state === 'new_event'
    ? currentMemberships.length
    : (event.event_state === 'new_update' ? Math.max(newInfoCount, currentMemberships.length) : newInfoCount);
  const recentCutoff = asOf - 72 * HOUR;
  const recentReportCount = allMemberships.filter((membership) => timeValue(membership.batch_date || membership.created_at || membership.updated_at) >= recentCutoff).length;
  const relevanceValues = currentHotspots.map((hotspot) => Number(tagValue(hotspot, 'chinaRelevance'))).filter(Number.isFinite);
  const chinaRelevance = relevanceValues.length ? Math.max(...relevanceValues) : 0;

  const freshnessScore = Math.round(25 * decay(lastUpdateAt || latestSeenAt, asOf, 36));
  const incrementScore = Math.round(clamp(newReportCount * 8 + Math.max(0, sourceNames.size - 1) * 2, 0, 25));
  const sourceSpreadScore = Math.round(clamp(sourceNames.size * 4 + sourceGroups.size, 0, 15));
  const momentumScore = Math.round(clamp(recentReportCount * 2.5, 0, 15));
  const chinaRelevanceScore = Math.round(clamp(chinaRelevance, 0, 10));
  const evidenceScore = Math.round(clamp(sourceNames.size * 2 + Math.min(urlCount, 4) + (event.confidence === 'high' ? 2 : 1), 0, 10));
  const historyDecayScore = Math.round(clamp(Math.max(0, repeatDays - 1) * 4 + (newReportCount === 0 && repeatDays > 1 ? 5 : 0), 0, 20));
  const stale = (newReportCount === 0 && repeatDays > 1 && ageHours > 24) || ageHours > 72;
  const state = stale ? 'stale' : (event.event_state || 'continuing');
  const genericHeatScore = Math.round(clamp(
    freshnessScore + incrementScore + sourceSpreadScore + momentumScore + chinaRelevanceScore + evidenceScore - historyDecayScore,
    0, 100,
  ));
  const base = { freshnessScore, incrementScore, sourceSpreadScore, momentumScore, evidenceScore, historyDecayScore };
  const isNewsEvent = classificationOf(event).contentClass === 'news_event';
  const accountScoreParts = isNewsEvent ? accountNewsScoreParts({ event, currentHotspots, base }) : null;
  const heatScore = accountScoreParts?.scoreValue ?? genericHeatScore;
  return {
    eventId: event.id,
    title: representativeTitle(event),
    state,
    heatScore,
    // 迁移兼容：事件热榜分正式统一称为 eventValue/T，旧 heatScore 保留供现有接口读取。
    eventValue: heatScore,
    t: heatScore,
    freshnessScore,
    incrementScore,
    sourceSpreadScore,
    momentumScore,
    chinaRelevanceScore,
    evidenceScore,
    historyDecayScore,
    ...(accountScoreParts ? { scoreParts: accountScoreParts } : {}),
    reportCount: currentMemberships.length,
    historicalReportCount: allMemberships.length,
    sourceCount: sourceNames.size,
    sourceGroups: sourceGroups.size,
    newReportCount,
    recentReportCount,
    repeatDays,
    firstSeenAt: event.first_seen_at || null,
    lastSeenAt: latestSeenAt ? new Date(latestSeenAt).toISOString() : (event.last_seen_at || null),
    lastUpdateAt: lastUpdateAt ? new Date(lastUpdateAt).toISOString() : null,
    hotspotIds: currentMemberships.map((membership) => Number(membership.hotspot_id)).filter(Number.isFinite),
    marketScopes: [...new Set(currentHotspots.map((hotspot) => hotspot.market_scope).filter(Boolean))],
    keywords: [...new Set(currentHotspots.flatMap((hotspot) => tagValue(hotspot, 'keywords') || []))].slice(0, 12),
    reason: reasonList({ state, newReportCount, sourceCount: sourceNames.size, repeatDays, currentCount: currentMemberships.length }),
  };
}

export function buildEventHeatRanking({ store, batch, previousItems = [], events = [], asOf = Date.now() }) {
  if (!store || !batch) return { schemaVersion: 2, titleVersion: 2, scoringVersion: EVENT_HEAT_RANKING_VERSION, generatedAt: new Date(asOf).toISOString(), batchId: batch?.id || null, items: [] };
  const currentMemberships = store.listEventHotspots?.({ batchId: batch.id, limit: 100000 }) || [];
  if (!currentMemberships.length) return { schemaVersion: 2, titleVersion: 2, scoringVersion: EVENT_HEAT_RANKING_VERSION, generatedAt: new Date(asOf).toISOString(), batchId: batch.id, items: [] };
  const historicalMemberships = store.listEventHotspots?.({ limit: 100000 }) || currentMemberships;
  const hotspotsById = new Map((batch.hotspots || []).map((hotspot) => [Number(hotspot.id), hotspot]));
  const eventInputGroups = new Map();
  for (const event of events || []) {
    const normalized = event?.normalized || {};
    const familyKey = [normalized.whoKey, normalized.objectKey, normalized.timeWindow].map((value) => String(value || '').trim()).join('|');
    if (!normalized.whoKey || !normalized.objectKey || !normalized.timeWindow) continue;
    if (!eventInputGroups.has(familyKey)) eventInputGroups.set(familyKey, []);
    eventInputGroups.get(familyKey).push(event);
  }
  const eventAliases = new Map();
  const mergedEventInputs = new Map();
  for (const group of eventInputGroups.values()) {
    const components = [];
    for (const event of group) {
      const match = components.find((component) => component.some((candidate) => structuredMatch(candidate.normalized || {}, event.normalized || {}).score >= 82));
      if (match) match.push(event);
      else components.push([event]);
    }
    for (const component of components) {
      const winner = [...component].sort((left, right) => Number(right.eventHeatScore || 0) - Number(left.eventHeatScore || 0)
        || Number(right.report_count || right.articles?.length || 0) - Number(left.report_count || left.articles?.length || 0)
        || String(left.event_id || left.id).localeCompare(String(right.event_id || right.id)))[0];
      const canonicalId = winner.event_id || winner.id;
      const merged = {
        ...winner,
        event_id: canonicalId,
        id: canonicalId,
        hotspot_ids: [...new Set(component.flatMap((event) => event.hotspot_ids || event.articles?.map((article) => article.hotspot_id) || []))],
        articles: component.flatMap((event) => event.articles || []),
        report_count: component.reduce((sum, event) => sum + Number(event.report_count || event.articles?.length || 0), 0),
        mergedEventIds: component.map((event) => event.event_id || event.id).filter(Boolean),
      };
      for (const event of component) eventAliases.set(event.event_id || event.id, canonicalId);
      mergedEventInputs.set(canonicalId, merged);
    }
  }
  const currentByEvent = new Map();
  for (const membership of currentMemberships) {
    const eventId = eventAliases.get(membership.event_id) || membership.event_id;
    if (!currentByEvent.has(eventId)) currentByEvent.set(eventId, []);
    currentByEvent.get(eventId).push(membership);
  }
  const historyByEvent = new Map();
  for (const membership of historicalMemberships) {
    const eventId = eventAliases.get(membership.event_id) || membership.event_id;
    if (!historyByEvent.has(eventId)) historyByEvent.set(eventId, []);
    historyByEvent.get(eventId).push(membership);
  }
  const records = new Map((store.listEventRecords?.({ limit: 100000 }) || []).map((event) => [event.id, event]));
  const eventInputs = new Map((events || []).map((event) => [event.event_id || event.id, event]));
  for (const [eventId, event] of mergedEventInputs) eventInputs.set(eventId, event);
  const previous = new Map((previousItems || []).map((item) => [item.eventId, item]));
  const items = [...currentByEvent.entries()].map(([eventId, memberships]) => {
    const record = records.get(eventId) || { id: eventId, title: memberships[0]?.title || eventId, event_state: 'continuing' };
    const input = eventInputs.get(eventId) || record;
    const classification = input.classification || (record.content_class ? { content_class: record.content_class, status: record.classification_status, features: record.classification_features } : null);
    const scored = scoreClassifiedEvent({ event: { ...record, ...input, id: eventId, classification }, currentMemberships: memberships, historicalMemberships: historyByEvent.get(eventId) || memberships, hotspotsById, asOf });
    return input?.mergedEventIds?.length > 1 ? { ...scored, mergedEventIds: input.mergedEventIds } : scored;
  }).sort((left, right) => right.scoreValue - left.scoreValue
    || right.incrementScore - left.incrementScore
    || right.sourceCount - left.sourceCount
    || right.reportCount - left.reportCount
    || String(left.lastSeenAt || '').localeCompare(String(right.lastSeenAt || ''))
    || left.eventId.localeCompare(right.eventId));
  const ranked = items.map((item, index) => {
    const prior = previous.get(item.eventId);
    const priorRank = Number.isFinite(Number(prior?.rank)) ? Number(prior.rank) : null;
    return { ...item, rank: index + 1, previousRank: priorRank, rankDelta: priorRank == null ? null : priorRank - (index + 1) };
  });
  const rankings = Object.fromEntries(['news_event', 'open_source_technology', 'open_source_trend', 'github_project'].map((contentClass) => {
    const board = ranked.filter((item) => item.contentClass === contentClass).map((item, index) => {
      const prior = previous.get(item.eventId);
      const priorRank = prior?.contentClass === contentClass && Number.isFinite(Number(prior.rank)) ? Number(prior.rank) : null;
      return { ...item, rank: index + 1, boardRank: index + 1, rankScope: contentClass, previousRank: priorRank, rankDelta: priorRank == null ? null : priorRank - (index + 1) };
    });
    return [contentClass, { contentClass, scoreModel: contentClass === 'news_event' ? 'T_account' : contentClass, scoreComparable: false, totalEvents: board.length, items: board }];
  }));
  return {
    schemaVersion: 2,
    titleVersion: 2,
    scoringVersion: EVENT_HEAT_RANKING_VERSION,
    generatedAt: new Date(asOf).toISOString(),
    batchId: batch.id,
    scoring: { baseModel: 90, platformImpact: 10, platformMetricReferences: PLATFORM_METRIC_REFERENCES, platformImpactNormalization: 'per-metric log saturation; event-age half-life 7 days; per-platform maximum plus capped corroboration; missing metrics preserve the base score', readerConnection: 40, readerImpact: 25, informationGain: 20, evidenceQuality: 10, freshness: 3, diffusion: 2, historyDecay: -15, eventValue: 100 },
    scoringModels: { news_event: 'T_account', open_source_technology: 'T_technology', open_source_trend: 'T_trend', github_project: 'projectDiscoveryScore' },
    totalEvents: ranked.length,
    rankings,
    items: ranked,
  };
}

import { buildEventTitle, structuredMatch } from './event-resolution-shadow.mjs';
