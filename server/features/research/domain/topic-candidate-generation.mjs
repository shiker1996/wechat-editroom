import { dimensionPartsOf } from './hotspot-dimensions.mjs';

const RELATION_LABELS = Object.freeze({
  same_subject_sequence: '同一主体连续动作',
  shared_object_comparison: '同一对象横向比较',
  action_comparison: '同类动作横向比较',
  context_comparison: '同一场合横向比较',
  shared_dimension: '共享维度关系',
  trend_sequence: '趋势关系',
});
const RELATION_QUESTIONS = Object.freeze({
  same_subject_sequence: '同一主体的连续动作之间发生了什么变化？',
  shared_object_comparison: '不同主体围绕同一对象的动作有何差异？',
  action_comparison: '这些同类动作背后是否存在共同变化？',
  context_comparison: '同一场合下的不同事件为何出现不同反应？',
  shared_dimension: '这些事件之间的共同维度，是否足以构成一个讨论问题？',
  trend_sequence: '这些事件连续出现，背后是在形成什么趋势？',
});
const SEMANTIC_RELATION_QUESTIONS = Object.freeze({
  sequence: '前一个事件到后一个事件发生了什么变化？这是同一主体的连续动作，还是方向转弯？',
  response: '后一个事件回应了什么？这次连续动作中的回应，改变了哪些利益、判断或行动？',
  comparison: '这些事件都围绕同一对象，但参与方的动作、收益和代价有什么差异？',
  trend: '多个事件连续出现，背后是在形成什么趋势，谁会先受到影响？',
  counterexample: '这个事件反驳了什么趋势或判断？它说明原来的判断在哪些条件下不成立？',
});
const text = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];
const idOf = (event) => String(event?.event_id || event?.eventId || '').trim();
const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const mapBy = (items, key) => new Map(list(items).map((item) => [String(key(item)), item]).filter(([id]) => id && id !== 'undefined'));

function eventSignals(eventId, signals) {
  const item = signals.get(String(eventId));
  return item ? [
    ...list(item.anomaly_points || item.internal_research?.anomalies),
    ...list(item.interest_conflicts || item.internal_research?.interest_conflicts),
    ...list(item.divergence_directions || item.internal_research?.divergence_directions),
  ] : [];
}
function allArticles(events) {
  const seen = new Set();
  return list(events).flatMap((event) => list(event.articles)).filter((article) => {
    const key = String(article?.hotspot_id ?? article?.id ?? article?.url ?? '');
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function labelsFor(events) {
  const parts = events.map((event) => dimensionPartsOf(event));
  const shared = (field) => {
    const values = [...new Set(parts.map((item) => text(item[field], 100)).filter(Boolean))];
    return values.length === 1 ? values[0] : '';
  };
  return { who: shared('who'), object: shared('object'), action: shared('actionType'), occasion: shared('occasion') };
}
function titleFor(events, relation) {
  const titles = events.map((event) => text(event.representative_title, 100)).filter(Boolean);
  if (events.length === 1) return titles[0] || '高热事件讨论候选';
  const kind = relation?.relation_kind;
  const first = titles[0] || '事件 A';
  const second = titles[1] || '事件 B';
  if (kind === 'response') return `${first}引发${second}回应：回应改变了什么？`;
  if (kind === 'sequence') return `从${first}到${second}：这次变化意味着什么？`;
  if (kind === 'trend') return `从${titles.slice(0, 3).join('、')}看，变化正在指向哪里？`;
  if (kind === 'comparison') return `${first}与${second}都在行动，真正差异在哪？`;
  if (kind === 'counterexample') return `${first}与${second}之间，谁反驳了什么判断？`;
  const label = RELATION_LABELS[relation?.relation_type] || '事件关系';
  return `${label}：${first} × ${second}`;
}
function bestInternalSeed(signals) {
  const items = list(signals);
  return items.find((item) => item.kind === 'interest_conflict') || items.find((item) => item.kind === 'anomaly') || items.find((item) => item.kind === 'divergence') || null;
}
function topicSeed(events, relation, focus) {
  if (relation) {
    const kind = relation.relation_kind || 'comparison';
    const question = SEMANTIC_RELATION_QUESTIONS[kind] || RELATION_QUESTIONS[relation.relation_type] || SEMANTIC_RELATION_QUESTIONS.comparison;
    return {
      topic_type: kind === 'sequence' ? 'event_sequence' : kind === 'response' ? 'event_response' : kind === 'trend' ? 'event_trend' : kind === 'counterexample' ? 'event_counterexample' : 'event_comparison',
      candidate_title: titleFor(events, relation),
      angle: relation.relationship_statement || question,
      core_question: question,
      thesis_seed: kind === 'trend' ? '把连续出现的事件放进同一条变化线上，判断它是否已经从新闻变成趋势。' : kind === 'response' ? '围绕回应前后的变化，解释回应改变了什么，而不是只复述双方表态。' : kind === 'counterexample' ? '围绕反例与原有判断的冲突，说明趋势或判断成立的边界。' : '围绕事件之间的变化或差异，解释背后的利益、策略与代价。',
      basis: relation.event_ids || [],
    };
  }
  if (focus) {
    return {
      topic_type: focus.kind === 'interest_conflict' ? 'internal_interest_conflict' : focus.kind === 'anomaly' ? 'internal_anomaly' : 'internal_divergence',
      candidate_title: focus.kind === 'interest_conflict' ? `这起事件的利益冲突，到底发生在谁和谁之间？` : focus.kind === 'anomaly' ? `这起事件为什么出现反常变化？` : `这起事件还能从哪个问题继续追问？`,
      angle: focus.statement || focus.question || '从事件内部的变化寻找讨论入口。',
      core_question: focus.question || focus.statement || '这起事件除了发生本身，还改变了什么？',
      thesis_seed: focus.kind === 'anomaly' ? '从异常变化切入，解释预期与现实为什么错位。' : focus.kind === 'interest_conflict' ? '从参与方的收益、成本和责任分配切入，呈现事件的利益结构。' : '把待确认信息转成可验证的问题，避免停留在新闻复述。',
      basis: focus.basis || [],
    };
  }
  return null;
}
function discussionQuestion(events, relation, signals) {
  return topicSeed(events, relation, bestInternalSeed(signals))?.core_question || '当前没有足够研判依据形成讨论命题。';
}
function openQuestions(events, relation, signals) {
  const questions = [];
  if (relation) questions.push('关系是否由两个事件的原始来源和时间顺序共同支持？');
  if (events.length > 1) questions.push('多个事件是否属于同一变化链，而不是仅仅共享关键词？');
  if (signals.some((item) => item.kind === 'source_disagreement')) questions.push('来源分歧能否通过原文、发布时间或事实范围解释？');
  if (signals.some((item) => item.kind === 'unverified_boundary')) questions.push('未核实内容在成稿前是否需要补充来源？');
  return [...new Set(questions)];
}
function candidateContext({ events, scope, signals, relations, materials = [], type, relationIds, focus = null }) {
  const eventIds = events.map(idOf);
  const eventValues = events.map((event) => finite(scope.get(idOf(event))?.event_value ?? event.eventValue ?? event.t)).filter((value) => value != null);
  const ranks = events.map((event) => finite(scope.get(idOf(event))?.board_rank ?? event.eventHeatRank)).filter((value) => value != null);
  const allSignals = events.flatMap((event) => eventSignals(idOf(event), signals));
  const relation = relationIds.length ? relations.get(relationIds[0]) : null;
  const seed = topicSeed(events, relation, focus);
  const eventIdSet = new Set(eventIds);
  const selectedMaterials = list(materials).filter((material) => {
    const anchors = list(material?.anchor_event_ids).map(String);
    const materialRelationId = String(material?.relation_id || '').trim();
    return anchors.some((id) => eventIdSet.has(id)) || (materialRelationId && relationIds.includes(materialRelationId));
  });
  return {
    scope: 'topk',
    event_value: eventValues.length ? Math.max(...eventValues) : null,
    event_rank: ranks.length ? Math.min(...ranks) : null,
    internal_signals: events.map((event) => signals.get(idOf(event))).filter(Boolean),
    relations: relationIds.map((id) => relations.get(id)).filter(Boolean),
    verified_research_materials: selectedMaterials,
    topic_candidate: {
      status: 'provisional', type, event_ids: eventIds, relation_ids: relationIds,
      discussion_question: discussionQuestion(events, relation, allSignals),
      ...(seed || {}),
      is_author_stance: false,
      note: '临时讨论问题只用于候选生成和编辑会，不代表作者最终立场。',
    },
    topic_candidates: seed ? [{ ...seed, event_ids: eventIds, relation_ids: relationIds, is_author_stance: false }] : [],
    evidence_boundary: {
      confirmed_event_ids: eventIds,
      note: '候选只引用已进入 Top-K 研判范围的事件卡、来源和确定性事件关系；讨论问题仍需编辑会验证。',
    },
    open_questions: openQuestions(events, relation, allSignals),
  };
}
function candidateFromEvents({ events, type, relation = null, ranking, scope, signals, relations, materials = [], relationIds = [], order, focus = null }) {
  const rankItems = events.map((event) => ranking.get(idOf(event))).filter(Boolean);
  const lead = [...rankItems].sort((a, b) => finite(a.eventHeatRank, 999999) - finite(b.eventHeatRank, 999999))[0] || {};
  const classCounts = new Map();
  const classBoardRanks = new Map();
  for (const event of events) {
    const id = idOf(event);
    const item = ranking.get(id) || {};
    const scopeItem = scope.get(id) || {};
    const classification = event.card?.classification || event.classification || {};
    const contentClass = String(scopeItem.content_class || item.contentClass || item.content_class
      || classification.content_class || classification.contentClass || 'news_event');
    classCounts.set(contentClass, (classCounts.get(contentClass) || 0) + 1);
    const boardRank = finite(scopeItem.board_rank);
    if (boardRank != null) classBoardRanks.set(contentClass, Math.min(classBoardRanks.get(contentClass) ?? Infinity, boardRank));
  }
  const selectionContentClass = [...classCounts.keys()].sort((a, b) => (classCounts.get(b) - classCounts.get(a))
    || ((classBoardRanks.get(a) ?? Infinity) - (classBoardRanks.get(b) ?? Infinity))
    || a.localeCompare(b))[0] || 'news_event';
  const selectionBoardRank = classBoardRanks.get(selectionContentClass) ?? null;
  const classEventValue = Math.max(...events.filter((event) => {
    const id = idOf(event);
    const item = ranking.get(id) || {};
    const scopeItem = scope.get(id) || {};
    const classification = event.card?.classification || event.classification || {};
    const contentClass = String(scopeItem.content_class || item.contentClass || item.content_class
      || classification.content_class || classification.contentClass || 'news_event');
    return contentClass === selectionContentClass;
  }).map((event) => {
    const item = ranking.get(idOf(event)) || {};
    return finite(item.eventValue ?? item.t ?? item.eventHeatScore ?? event.eventValue ?? event.t, 0);
  }), 0);
  const sourceSignals = events.flatMap((event) => eventSignals(idOf(event), signals));
  const signalBonus = Math.min(10, sourceSignals.length * 2 + (sourceSignals.some((item) => item.kind === 'interest_conflict') ? 4 : 0));
  const relationBonus = relation ? Math.min(15, 6 + (relation.relation_kind === 'response' ? 5 : relation.relation_kind === 'trend' || relation.relation_kind === 'counterexample' ? 4 : 2) + (relation.confidence === 'high' ? 3 : 0)) : 0;
  const combinedEventValue = Math.max(...rankItems.map((item) => finite(item.eventValue ?? item.t ?? item.eventHeatScore, 0)), 0);
  const eventValue = classEventValue;
  // 排序热度只读取候选主类别内的 T，避免跨类别事件的原始 T 互相挤占名额。
  const topicPreselectionScore = Number((classEventValue + relationBonus + signalBonus).toFixed(1));
  const context = candidateContext({ events, scope, signals, relations, materials, type, relationIds, focus });
  const seed = context.topic_candidate;
  const articleList = allArticles(events);
  const primary = events[0] || {};
  const classification = primary.card?.classification || primary.classification || {};
  const labels = labelsFor(events);
  const category = rankItems.map((item) => item.category).find(Boolean) || primary.topic_category || '';
  return {
    candidate_id: type + ':' + (relation?.relation_id || idOf(primary)),
    candidate_type: type,
    eventId: type + ':' + (relation?.relation_id || idOf(primary)),
    hotspotId: articleList[0]?.hotspot_id ?? primary.representativeHotspotId,
    title: seed.candidate_title || titleFor(events, relation), category,
    marketScope: rankItems.map((item) => item.marketScope).find(Boolean) || primary.market_scope,
    chinaRelevance: Math.max(...rankItems.map((item) => finite(item.chinaRelevance, 0)), 0),
    chinaRelevanceReason: '', riskLevel: rankItems.map((item) => item.riskLevel).find((value) => value && value !== '待评估') || '待评估', riskReason: '',
    preScores: lead.preScores || {}, base: finite(lead.base, 0), categoryPreference: 0, credibleScoop: 0, saturationPenalty: 0,
    keywords: [...new Set(events.flatMap((event) => list(event.keywords)))].slice(0, 12), articles: articleList, repositoryMeta: null,
    blackHorseSignals: sourceSignals.slice(0, 6), topicHeatBonus: 0, finalPreScore: finite(lead.finalPreScore, 0),
    topicPreselectionScore, legacyPreselectionScore: finite(lead.finalPreScore, 0), poolRole: '', dimension: 'event', topicValue: eventValue, topicValueParts: null,
    selectionContentClass, selectionBoardRank, selectionEventValue: classEventValue,
    eventValue, combinedEventValue, t: eventValue, eventHeatScore: Math.max(...rankItems.map((item) => finite(item.eventHeatScore, 0)), 0),
    eventHeatRank: Math.min(...rankItems.map((item) => finite(item.eventHeatRank, 999999)), 999999),
    eventHeatState: lead.eventHeatState || primary.eventHeatState || null, eventHistoryRepeatDays: finite(lead.eventHistoryRepeatDays, 0),
    contentClass: classification.content_class || classification.contentClass || lead.contentClass || 'news_event',
    classificationStatus: classification.status || classification.classification_status || lead.classificationStatus || 'needs_review',
    classificationConfidence: classification.confidence ?? lead.classificationConfidence ?? null,
    classificationReason: classification.reason || lead.classificationReason || '',
    classificationEvidence: classification.evidence || lead.classificationEvidence || [],
    classificationFeatures: classification.features || lead.classificationFeatures || {},
    articleEligible: classification.articleEligible ?? classification.article_eligible ?? lead.articleEligible ?? true,
    articleEligibilityReason: lead.articleEligibilityReason || '',
    confirmedFactCount: events.reduce((sum, event) => sum + list(event.card?.confirmed_facts).length, 0),
    timelineCount: events.reduce((sum, event) => sum + list(event.card?.timeline).length, 0),
    disagreementCount: events.reduce((sum, event) => sum + list(event.card?.disagreements).length, 0),
    unverifiedCount: events.reduce((sum, event) => sum + list(event.card?.unverified).length, 0),
    sourceCount: articleList.length, duplicatePenalty: Math.max(...rankItems.map((item) => finite(item.duplicatePenalty, 0)), 0),
    event_ids: events.map(idOf), relation_ids: relationIds, research_context: context,
    discussion_question: context.topic_candidate.discussion_question, topic_candidate: seed, topic_type: seed.topic_type || type,
    angle: seed.angle || '', thesis: seed.thesis_seed || '', dimension_labels: labels, order,
  };
}
function candidateFromModelTopic({ topic, events, ranking, scope, signals, relations, materials = [], order }) {
  const eventIds = list(topic.event_ids).map(String);
  const topicEvents = eventIds.map((id) => events.find((event) => idOf(event) === id)).filter(Boolean);
  if (!topicEvents.length) return null;
  const relationIds = list(topic.relation_ids).map(String).filter((id) => relations.has(id));
  const relation = relationIds.length ? relations.get(relationIds[0]) : null;
  const type = topic.topic_type === 'event_trend' ? 'multi_event_trend' : topicEvents.length > 1 ? 'dual_event_relation' : 'single_event';
  const candidate = candidateFromEvents({ events: topicEvents, type, relation, ranking, scope, signals, relations, materials, relationIds, order });
  const modelTopic = {
    ...topic,
    event_ids: topicEvents.map(idOf),
    relation_ids: relationIds,
    is_author_stance: false,
    analysis_source: 'model',
  };
  const referencedMaterialIds = new Set(list(topic.material_ids).map(String));
  const topicMaterials = referencedMaterialIds.size
    ? list(materials).filter((material) => referencedMaterialIds.has(String(material?.material_id)))
    : candidate.research_context.verified_research_materials;
  return {
    ...candidate,
    candidate_id: `model:${topic.candidate_id || order + 1}`,
    title: topic.candidate_title || candidate.title,
    topic_type: topic.topic_type || candidate.topic_type,
    topic_candidate: modelTopic,
    topic_candidates: [modelTopic],
    research_context: {
      ...candidate.research_context,
      topic_candidate: modelTopic,
      topic_candidates: [modelTopic],
      verified_research_materials: topicMaterials,
      research_source: 'model',
      evidence_boundary: { ...candidate.research_context.evidence_boundary, note: '候选选题由模型根据事件卡、来源证据和事件关系形成；仍需编辑会确认。' },
    },
    discussion_question: topic.core_question || candidate.discussion_question,
    angle: topic.angle || candidate.angle,
    thesis: topic.thesis_seed || candidate.thesis,
    analysis_source: 'model',
  };
}
function connectedComponents(eventIds, relations) {
  const graph = new Map(eventIds.map((id) => [id, new Set()]));
  for (const relation of relations) {
    const ids = list(relation.event_ids).map(String).filter((id) => graph.has(id));
    if (ids.length !== 2) continue;
    graph.get(ids[0]).add(ids[1]); graph.get(ids[1]).add(ids[0]);
  }
  const seen = new Set(); const groups = [];
  for (const id of eventIds) {
    if (seen.has(id)) continue;
    const queue = [id]; const group = []; seen.add(id);
    while (queue.length) {
      const current = queue.shift(); group.push(current);
      for (const next of graph.get(current) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    if (group.length >= 3) groups.push(group.sort());
  }
  return groups;
}
function sortCandidates(left, right) {
  return right.topicPreselectionScore - left.topicPreselectionScore
    || finite(right.selectionEventValue ?? right.eventValue, 0) - finite(left.selectionEventValue ?? left.eventValue, 0)
    || finite(left.selectionBoardRank, 999999) - finite(right.selectionBoardRank, 999999)
    || left.candidate_id.localeCompare(right.candidate_id);
}
const DEFAULT_CONTENT_CLASS_ORDER = Object.freeze(['news_event', 'open_source_technology', 'open_source_trend', 'github_project']);

function classOfCandidate(candidate) {
  return String(candidate?.selectionContentClass || candidate?.contentClass || candidate?.content_class || 'news_event');
}

function classOrderForCandidates(candidates) {
  const present = new Set(candidates.map(classOfCandidate));
  return [...DEFAULT_CONTENT_CLASS_ORDER.filter((contentClass) => present.has(contentClass)),
    ...[...present].filter((contentClass) => !DEFAULT_CONTENT_CLASS_ORDER.includes(contentClass)).sort()];
}

function sortCandidatesWithinClasses(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const contentClass = classOfCandidate(candidate);
    if (!groups.has(contentClass)) groups.set(contentClass, []);
    groups.get(contentClass).push(candidate);
  }
  const ranked = [];
  for (const contentClass of classOrderForCandidates(candidates)) {
    const items = groups.get(contentClass).sort(sortCandidates);
    items.forEach((candidate, index) => ranked.push({
      ...candidate,
      selectionContentClass: contentClass,
      class_rank: index + 1,
      generated_rank: ranked.length + 1,
    }));
  }
  return ranked;
}

export function buildTopicCandidates({ events = [], discussionResearch = {}, ranking = [] } = {}) {
  // 阶段 0 只有范围快照，不能因为事件存在就自动降级生成“新闻复述”候选。
  // 候选必须等待模型完成事件内/事件间研判；模型候选是否回填结构化 ID 不影响保留。
  if (discussionResearch.mode === 'phase0_scope') return [];
  const scopedIds = new Set(list(discussionResearch.scope?.items).map((item) => String(item.event_id)));
  const byEvent = mapBy(events, idOf);
  const byRanking = mapBy(ranking, (item) => item.eventId || item.event_id);
  const byScope = mapBy(discussionResearch.scope?.items, (item) => item.event_id);
  const bySignals = mapBy(discussionResearch.internal_signals, (item) => item.event_id);
  const byRelation = mapBy(discussionResearch.relations, (item) => item.relation_id);
  const materials = list(discussionResearch.verified_research_materials);
  const scopedEvents = [...scopedIds].map((id) => byEvent.get(id)).filter(Boolean)
    .sort((a, b) => finite(byScope.get(idOf(a))?.selection_rank ?? byScope.get(idOf(a))?.rank, 999999)
      - finite(byScope.get(idOf(b))?.selection_rank ?? byScope.get(idOf(b))?.rank, 999999) || idOf(a).localeCompare(idOf(b)));
  const modelTopics = discussionResearch.research_source === 'model' ? list(discussionResearch.topic_candidates) : [];
  if (discussionResearch.research_source === 'model') {
    return sortCandidatesWithinClasses(modelTopics.map((topic, index) => candidateFromModelTopic({ topic, events: scopedEvents, ranking: byRanking, scope: byScope, signals: bySignals, relations: byRelation, materials, order: index }))
      .filter(Boolean));
  }
  const candidates = [];
  scopedEvents.forEach((event, index) => {
    const focus = bestInternalSeed(eventSignals(idOf(event), bySignals));
    candidates.push(candidateFromEvents({ events: [event], type: 'single_event', focus, ranking: byRanking, scope: byScope, signals: bySignals, relations: byRelation, materials, order: index }));
  });
  for (const relation of list(discussionResearch.relations)) {
    const relationEvents = list(relation.event_ids).map((id) => byEvent.get(String(id))).filter(Boolean);
    if (relationEvents.length < 2) continue;
    const type = relation.relation_kind === 'trend' ? 'multi_event_trend' : 'dual_event_relation';
    candidates.push(candidateFromEvents({ events: relationEvents, type, relation, ranking: byRanking, scope: byScope, signals: bySignals, relations: byRelation, materials, relationIds: [String(relation.relation_id)], order: candidates.length }));
  }
  for (const ids of connectedComponents(scopedEvents.map(idOf), list(discussionResearch.relations))) {
    const groupRelations = list(discussionResearch.relations).filter((relation) => list(relation.event_ids).every((id) => ids.includes(String(id))));
    const groupEvents = ids.map((id) => byEvent.get(id)).filter(Boolean);
    candidates.push(candidateFromEvents({ events: groupEvents, type: 'multi_event_chain', relation: groupRelations.find((item) => item.relation_kind === 'trend') || groupRelations[0] || null, ranking: byRanking, scope: byScope, signals: bySignals, relations: byRelation, materials, relationIds: groupRelations.map((item) => String(item.relation_id)), order: candidates.length }));
  }
  return sortCandidatesWithinClasses(candidates);
}
function allocateClassLimits(limit, classOrder, classCounts = {}) {
  const weights = classOrder.map((contentClass) => Math.max(0, Number(classCounts[contentClass]) || 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!classOrder.length || !limit) return new Map(classOrder.map((contentClass) => [contentClass, 0]));
  if (!totalWeight) return new Map(classOrder.map((contentClass, index) => [contentClass, Math.floor(limit / classOrder.length) + (index < limit % classOrder.length ? 1 : 0)]));
  const raw = classOrder.map((contentClass, index) => ({
    contentClass, index, exact: limit * weights[index] / totalWeight,
  }));
  const allocation = new Map(raw.map(({ contentClass, exact }) => [contentClass, Math.floor(exact)]));
  let remaining = limit - [...allocation.values()].reduce((sum, value) => sum + value, 0);
  for (const item of raw.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || a.index - b.index)) {
    if (!remaining) break;
    allocation.set(item.contentClass, allocation.get(item.contentClass) + 1);
    remaining -= 1;
  }
  return allocation;
}

export function selectTopicCandidates(candidates = [], { coreLimit = 8, blackLimit = 2, backupLimit = 3, contentClassCounts = {}, contentClassOrder = [] } = {}) {
  const selected = [];
  const groups = new Map();
  for (const candidate of candidates) {
    const contentClass = classOfCandidate(candidate);
    if (!groups.has(contentClass)) groups.set(contentClass, []);
    groups.get(contentClass).push(candidate);
  }
  const presentClassOrder = classOrderForCandidates(candidates);
  // Keep requested classes even when a class has no candidates. Its quota must remain visible
  // instead of silently being redistributed before coverage repair has had a chance to run.
  const requestedOrder = list(contentClassOrder).map(String).filter(Boolean);
  const classOrder = [...new Set([...requestedOrder, ...presentClassOrder])];
  const counts = { ...contentClassCounts };
  if (!Object.values(counts).some((value) => Number(value) > 0)) {
    for (const contentClass of classOrder) counts[contentClass] = (groups.get(contentClass) || []).length;
  }
  for (const contentClass of classOrder) (groups.get(contentClass) || []).sort(sortCandidates);
  const selectedIds = new Set();
  const rejectionReasons = new Map();
  const noteRejection = (candidate, role, code) => {
    if (!rejectionReasons.has(candidate.candidate_id)) rejectionReasons.set(candidate.candidate_id, []);
    const reasons = rejectionReasons.get(candidate.candidate_id);
    if (!reasons.some((item) => item.role === role && item.code === code)) reasons.push({ role, code });
  };
  const takeRole = (limit, role, eligible = () => true, destination = selected) => {
    // Event reuse is constrained within a role, not across core, blackhorse, and backup pools.
    // A backup should remain available as an alternative to a core topic on the same event.
    const usedByEvent = new Map();
    const canTake = (candidate) => candidate.event_ids.every((id) => (usedByEvent.get(id) || 0) < 2);
    const quotas = allocateClassLimits(limit, classOrder, counts);
    let roleCount = 0;
    for (const contentClass of classOrder) {
      let classCount = 0;
      for (const candidate of groups.get(contentClass) || []) {
        if (roleCount >= limit) { noteRejection(candidate, role, 'role_quota_filled'); continue; }
        if (classCount >= (quotas.get(contentClass) || 0)) { noteRejection(candidate, role, 'class_quota_filled'); continue; }
        if (selectedIds.has(candidate.candidate_id)) { noteRejection(candidate, role, 'already_assigned_to_higher_priority_pool'); continue; }
        if (!canTake(candidate)) { noteRejection(candidate, role, 'event_reuse_limit'); continue; }
        if (!eligible(candidate)) { noteRejection(candidate, role, 'role_eligibility_not_met'); continue; }
        destination.push({ ...candidate, poolRole: role });
        selectedIds.add(candidate.candidate_id);
        for (const id of candidate.event_ids) usedByEvent.set(id, (usedByEvent.get(id) || 0) + 1);
        classCount += 1;
        roleCount += 1;
      }
    }
    // 若某类别候选不足或被事件复用门槛挡住，按榜单类别顺序用各自下一名补位；不比较类别分数。
    while (roleCount < limit) {
      let added = false;
      for (const contentClass of classOrder) {
        let candidate = null;
        for (const item of groups.get(contentClass) || []) {
          if (selectedIds.has(item.candidate_id)) { noteRejection(item, role, 'already_assigned_to_higher_priority_pool'); continue; }
          if (!canTake(item)) { noteRejection(item, role, 'event_reuse_limit'); continue; }
          if (!eligible(item)) { noteRejection(item, role, 'role_eligibility_not_met'); continue; }
          candidate = item;
          break;
        }
        if (!candidate) continue;
        destination.push({ ...candidate, poolRole: role });
        selectedIds.add(candidate.candidate_id);
        for (const id of candidate.event_ids) usedByEvent.set(id, (usedByEvent.get(id) || 0) + 1);
        roleCount += 1;
        added = true;
        if (roleCount >= limit) break;
      }
      if (!added) break;
    }
  };
  takeRole(coreLimit, '核心8条');
  takeRole(blackLimit, '黑马2条', (candidate) => candidate.candidate_type !== 'single_event'
    || candidate.research_context.internal_signals.some((item) => item.signal_count > 0)
    || candidate.research_context.relations.length > 0);
  const backup = [];
  takeRole(backupLimit, '候补3条', () => true, backup);
  const core = selected.filter((item) => item.poolRole === '核心8条');
  const black = selected.filter((item) => item.poolRole === '黑马2条');
  const classCountsOf = (items) => items.reduce((result, item) => {
    const contentClass = classOfCandidate(item);
    result[contentClass] = (result[contentClass] || 0) + 1;
    return result;
  }, {});
  const requested = { core: coreLimit, black: blackLimit, backup: backupLimit };
  const actual = { core: core.length, black: black.length, backup: backup.length };
  const selectedRoleById = new Map([...selected, ...backup].map((item) => [item.candidate_id, item.poolRole]));
  const classQuotas = {
    core: Object.fromEntries(allocateClassLimits(coreLimit, classOrder, counts)),
    black: Object.fromEntries(allocateClassLimits(blackLimit, classOrder, counts)),
    backup: Object.fromEntries(allocateClassLimits(backupLimit, classOrder, counts)),
  };
  return {
    selected, core, black, backup, all: candidates,
    unselectedReasons: Object.fromEntries(candidates
      .filter((candidate) => !selectedRoleById.has(candidate.candidate_id))
      .map((candidate) => [candidate.candidate_id, rejectionReasons.get(candidate.candidate_id) || []])),
    summary: {
      requested,
      actual,
      unfilled: Object.fromEntries(Object.keys(requested).map((key) => [key, Math.max(0, requested[key] - actual[key])])),
      class_quotas: classQuotas,
      class_actual: { core: classCountsOf(core), black: classCountsOf(black), backup: classCountsOf(backup) },
    },
  };
}
export function topicCandidatesMarkdown({ candidates = [], selection = {}, coverage = [] } = {}) {
  const role = (candidate) => candidate.poolRole || '未入选';
  return ['# 阶段 3 · 讨论导向候选选题', '', '> 候选命题必须来自已确认的事件内研判信号，或模型确认的事件间前后、回应、对比、趋势、反例关系；不代表作者最终立场。候选按类别分别排序和分配名额，T 不跨类别比较。', '', '核心 ' + (selection.core?.length || 0) + ' 条；黑马 ' + (selection.black?.length || 0) + ' 条；候补 ' + (selection.backup?.length || 0) + ' 条。', '', ...(coverage.length ? ['## 事件覆盖清单', '', ...coverage.map((item) => `- ${item.status === 'covered' ? '✅ 已覆盖' : item.status === 'uncovered' ? '⚠️ 未形成候选' : '❔ 未说明'} · ${item.title || item.event_id}${item.candidate_ids?.length ? ` → ${item.candidate_ids.join('、')}` : ''}${item.reason ? `：${item.reason}` : ''}`), ''] : []), ...candidates.map((candidate) => {
    const signals = candidate.research_context?.internal_signals || [];
    const signalCount = signals.reduce((sum, item) => sum + [item.anomalies, item.conflicts, item.divergences, item.internal_research?.anomalies, item.internal_research?.interest_conflicts, item.internal_research?.divergence_directions].reduce((n, values) => n + (Array.isArray(values) ? values.length : 0), 0), 0);
    const relationCount = candidate.research_context?.relations?.length || 0;
    const rejectionLabels = {
      role_quota_filled: '该角色名额已满',
      class_quota_filled: '该类别名额已满',
      already_assigned_to_higher_priority_pool: '已分配给优先级更高的候选池',
      event_reuse_limit: '关联事件的候选复用上限已达到',
      role_eligibility_not_met: '未满足该候选池的入选条件',
    };
    const rejectionText = list(candidate.selection_rejection_reasons)
      .map((item) => `${item.role}：${rejectionLabels[item.code] || item.code}`)
      .join('；');
    return '## ' + role(candidate) + ' · ' + candidate.title + '\n\n- 所属类别：' + (candidate.selectionContentClass || candidate.contentClass || '普通事件') + '（类内第 ' + (candidate.class_rank || '—') + ' 名）\n- 候选类型：' + (candidate.topic_type || candidate.candidate_type) + '\n- 关联事件：' + candidate.event_ids.join('、') + '\n- 事件价值 T：' + candidate.eventValue + '\n- 研判依据：事件内 ' + signalCount + ' 条；事件间 ' + relationCount + ' 条' + (rejectionText ? '\n- 未入选原因：' + rejectionText : '') + '\n- 核心问题：' + candidate.topic_candidate.core_question + '\n- 切入角度：' + candidate.topic_candidate.angle + '\n- 命题种子：' + candidate.topic_candidate.thesis_seed + '\n- 事实边界：' + candidate.research_context.evidence_boundary.note;
  })].join('\n\n');
}
export function discussionQuestionForContext(context) {
  return text(context?.topic_candidate?.discussion_question || '');
}
