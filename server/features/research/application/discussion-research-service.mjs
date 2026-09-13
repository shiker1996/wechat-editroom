import fs from 'node:fs';
import path from 'node:path';
import { DISCUSSION_RESEARCH_TOP_K } from '../domain/discussion-research.mjs';

const list = (value) => Array.isArray(value) ? value : [];
const idOf = (event) => String(event?.event_id || event?.eventId || '').trim();
const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function derivedDiscussionQuestion(internalSignals, relations, matchedIds) {
  const relation = relations.find((item) => (item.event_ids || []).some((id) => matchedIds.has(String(id))));
  if (relation) {
    const labels = { same_subject_sequence: '同一主体的连续动作之间发生了什么变化？', shared_object_comparison: '不同主体围绕同一对象的动作有何差异？', action_comparison: '这些同类动作背后是否存在共同变化？', context_comparison: '同一场合下的不同事件为何出现不同反应？', shared_dimension: '这些事件之间的共同维度，是否足以构成一个讨论问题？', model_sequence: '前后事件之间发生了什么变化？', model_response: '后一个事件回应了什么，改变了哪些判断或利益？', model_comparison: '这些事件的具体动作、收益和代价有何差异？', model_trend: '这些事件连续出现，是否已经形成值得讨论的趋势？', model_counterexample: '这个事件反驳了什么趋势或判断？' };
    return labels[relation.relation_type] || labels.shared_dimension;
  }
  const signals = internalSignals.flatMap((item) => [...(item.anomalies || []), ...(item.conflicts || []), ...(item.divergences || [])]);
  const kinds = new Set(signals.map((item) => String(item.kind || '')));
  if (kinds.has('source_disagreement')) return '同一事件的不同来源为何出现分歧，分歧本身说明了什么？';
  if (kinds.has('new_source_evidence')) return '新增来源补充了什么，是否改变了我们对事件的理解？';
  if (kinds.has('timeline_change')) return '事件在时间线上如何变化，变化背后有哪些可验证原因？';
  if (kinds.has('unverified_boundary')) return '已确认事实和未确认说法之间的边界在哪里？';
  return '这个高热事件除了发生本身，还值得讨论什么？';
}

export function readDiscussionResearchContext({ workspaceRoot, batchId, candidate = {}, events = [] } = {}) {
  const sourceDir = path.join(workspaceRoot || '', 'topics', `${batchId}-orchestrated`, 'sources');
  const report = readJson(path.join(sourceDir, 'discussion-research.json'));
  if (!report) return null;
  const clusters = readJson(path.join(sourceDir, 'event-clusters.json'))?.events || [];
  const eventIds = new Set(list(events).map((event) => String(event.event_id || event.eventId || '')).filter(Boolean));
  const hotspotIds = new Set([
    candidate.hotspot_id,
    ...list(candidate.member_hotspot_ids),
    ...list(candidate.hotspots).map((hotspot) => hotspot?.id || hotspot?.hotspot_id),
  ].map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0));
  for (const event of clusters) if (list(event.articles).some((article) => hotspotIds.has(Number(article.hotspot_id)))) eventIds.add(idOf(event));
  const matched = (report.scope?.items || []).filter((item) => eventIds.has(String(item.event_id)));
  const matchedIds = new Set(matched.map((item) => String(item.event_id)));
  const internalSignals = (report.internal_signals || []).filter((item) => matchedIds.has(String(item.event_id)));
  const referenceEvents = (report.reference_events || []).filter((item) => list(item.anchor_event_ids).some((id) => matchedIds.has(String(id))));
  const relations = (report.relations || []).filter((item) => {
    const anchors = list(item.event_ids).map(String);
    return anchors.length >= 1 && anchors.every((id) => matchedIds.has(id))
      && (!item.reference_event_ids?.length || item.reference_event_ids.some((referenceId) => referenceEvents.some((reference) => String(reference.reference_id) === String(referenceId))));
  });
  const internalResearch = internalSignals.map((item) => ({
    ...item,
    internal_research: item.internal_research || {
      anomalies: item.anomaly_points || [],
      interest_conflicts: item.interest_conflicts || [],
      divergence_directions: item.divergence_directions || [],
    },
  }));
  const openQuestions = internalResearch.flatMap((item) => item.internal_research?.divergence_directions || []).map((item) => item.question || item.statement).filter(Boolean);
  const materials = (report.verified_research_materials || []).filter((item) => list(item.anchor_event_ids || item.event_ids).some((id) => matchedIds.has(String(id))));
  const researchReports = (report.research_reports || []).filter((item) => matchedIds.has(String(item.event_id)));
  const generated = readJson(path.join(sourceDir, 'topic-candidate-generation.json'))?.items || [];
  const exact = generated.find((item) => {
    const ids = new Set((item.event_ids || []).map(String));
    return ids.size === matchedIds.size && [...ids].every((id) => matchedIds.has(id));
  });
  const generatedTopic = exact?.research_context?.topic_candidate || exact?.topic_candidate;
  const generatedTopics = exact?.research_context?.topic_candidates || exact?.topic_candidates || [];
  const question = generatedTopic?.discussion_question || generatedTopics[0]?.core_question || derivedDiscussionQuestion(internalResearch, relations, matchedIds);
  return {
    schema_version: report.schema_version,
    mode: report.mode,
    status: matched.length ? 'available' : 'no_matching_event',
    scope: { top_k: report.policy?.top_k || DISCUSSION_RESEARCH_TOP_K, events: matched },
    event_value: matched.length ? Math.max(...matched.map((item) => finite(item.event_value, 0))) : null,
    event_rank: matched.length ? Math.min(...matched.map((item) => finite(item.rank, 999999))) : null,
    internal_signals: internalResearch,
    internal_research: internalResearch,
    inter_event_research: relations,
    relations,
    reference_events: referenceEvents,
    verified_research_materials: materials,
    research_reports: researchReports,
    candidate_coverage: exact || generatedTopics.length ? 'covered' : 'uncovered',
    topic_candidates: generatedTopics,
    topic_candidate: generatedTopic ? { ...generatedTopic, angle: generatedTopic.angle || null, thesis: generatedTopic.thesis || null } : { status: 'provisional', type: matched.length > 1 ? 'dual_event_relation' : 'single_event', angle: null, thesis: null, discussion_question: question, is_author_stance: false, note: '候选命题只用于编辑确认，不代表作者最终立场。' },
    evidence_boundary: { open_questions: openQuestions, note: generatedTopic || generatedTopics.length ? '研判已形成候选选题；角度与作者命题仍需编辑会确认。' : '当前只提供事件内和事件间研判，尚未形成可直接发布的候选选题。' },
    generated_at: report.generated_at,
  };
}
