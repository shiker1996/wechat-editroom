import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { selectionPrompt } from '../llm/selection-prompts.mjs';

export const PROJECT_READER_VALUE_TOP_K_OPTIONS = Object.freeze([5, 8, 10]);
export const PROJECT_READER_VALUE_TOP_K = 8;
export const PROJECT_READER_VALUE_WEIGHTS = Object.freeze({
  dailyFit: 35,
  quickStart: 25,
  outcomeClarity: 15,
  reusability: 10,
  novelty: 10,
  evidenceQuality: 5,
});

const list = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 180) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback = 0) => Math.max(min, Math.min(max, finite(value, fallback)));

export function resolveProjectReaderValueTopK(value) {
  const normalized = Number(value);
  return PROJECT_READER_VALUE_TOP_K_OPTIONS.includes(normalized) ? normalized : PROJECT_READER_VALUE_TOP_K;
}

function repositoryOf(event) {
  return event?.repositoryMeta || event?.articles?.find((article) => article?.repositoryMeta)?.repositoryMeta || {};
}

export function projectReaderValueInput(event, heat = {}) {
  const repository = repositoryOf(event);
  return {
    eventId: String(event?.event_id || event?.eventId || ''),
    title: text(event?.representative_title || event?.title, 160),
    eventHeat: finite(heat?.scoreValue ?? heat?.eventValue ?? heat?.t, 0),
    projectType: text(repository.projectType, 40),
    scenarioIds: list(repository.scenarioIds).map((value) => text(value, 40)).slice(0, 6),
    directUseCase: text(repository.directUseCase, 180),
    repository: {
      name: text(repository.repository, 120),
      description: text(repository.description, 500),
      language: text(repository.language, 40),
      stars: finite(repository.stars, 0),
      topics: list(repository.topics).map((value) => text(value, 40)).slice(0, 12),
      discoveryChannels: list(repository.discoveryChannels).slice(0, 6),
      agentDependency: text(repository.agentDependency, 30),
      agentSignals: list(repository.agentSignals).map((value) => text(value, 40)).slice(0, 6),
    },
    sources: list(event?.articles).slice(0, 4).map((article) => ({
      title: text(article?.title, 160),
      summary: text(article?.summary, 300),
      source: text(article?.source, 80),
      url: text(article?.url, 300),
    })),
  };
}

export function selectProjectReaderValueCandidates({ clusters = [], eventHeatRanking = {}, topK = PROJECT_READER_VALUE_TOP_K } = {}) {
  const events = new Map(clusters.map((event) => [String(event?.event_id || event?.eventId || ''), event]));
  const board = list(eventHeatRanking?.rankings?.github_project?.items).length
    ? eventHeatRanking.rankings.github_project.items
    : list(eventHeatRanking?.items).filter((item) => item?.contentClass === 'github_project' || item?.content_class === 'github_project');
  return board.slice(0, resolveProjectReaderValueTopK(topK)).map((heat) => {
    const event = events.get(String(heat?.eventId || heat?.event_id || ''));
    return event ? projectReaderValueInput(event, heat) : null;
  }).filter(Boolean);
}

function normalizeResult(item = {}) {
  return {
    eventId: text(item.eventId || item.event_id, 120),
    dailyFit: clamp(item.dailyFit, 0, 10),
    quickStart: clamp(item.quickStart, 0, 10),
    outcomeClarity: clamp(item.outcomeClarity, 0, 10),
    reusability: clamp(item.reusability, 0, 10),
    novelty: clamp(item.novelty, 0, 10),
    evidenceQuality: clamp(item.evidenceQuality, 0, 10),
    installationFriction: clamp(item.installationFriction, 0, 10),
    agentPenalty: clamp(item.agentPenalty, 0, 25),
    confidence: clamp(item.confidence, 0, 1),
    whyRead: text(item.whyRead, 120),
    directUseCase: text(item.directUseCase, 180),
    limitations: text(item.limitations, 120),
  };
}

export function scoreProjectReaderValue(result = {}) {
  const weighted = Object.entries(PROJECT_READER_VALUE_WEIGHTS)
    .reduce((sum, [key, weight]) => sum + clamp(result[key], 0, 10) * weight / 10, 0);
  const score = clamp(weighted - clamp(result.installationFriction, 0, 10) - clamp(result.agentPenalty, 0, 25), 0, 100);
  return {
    ...result,
    projectReaderValue: Number(score.toFixed(1)),
    scoreParts: {
      dailyFit: Number((clamp(result.dailyFit, 0, 10) * 3.5).toFixed(1)),
      quickStart: Number((clamp(result.quickStart, 0, 10) * 2.5).toFixed(1)),
      outcomeClarity: Number((clamp(result.outcomeClarity, 0, 10) * 1.5).toFixed(1)),
      reusability: Number(clamp(result.reusability, 0, 10).toFixed(1)),
      novelty: Number(clamp(result.novelty, 0, 10).toFixed(1)),
      evidenceQuality: Number((clamp(result.evidenceQuality, 0, 10) * 0.5).toFixed(1)),
      installationFriction: Number(clamp(result.installationFriction, 0, 10).toFixed(1)),
      agentPenalty: Number(clamp(result.agentPenalty, 0, 25).toFixed(1)),
    },
  };
}

export async function evaluateProjectReaderValue({ gateway, workspaceRoot, projects = [], provider = '', batchId = '', topK = PROJECT_READER_VALUE_TOP_K } = {}) {
  const candidates = projects.slice(0, resolveProjectReaderValueTopK(topK));
  const base = { topK: resolveProjectReaderValueTopK(topK), candidateCount: candidates.length, candidates, results: [] };
  if (!candidates.length) return { ...base, status: 'skipped', reason: '没有可研判的项目' };
  if (!gateway) return { ...base, status: 'skipped', reason: '模型网关不可用' };
  const { prompt, bundle } = selectionPrompt({ workspaceRoot, skillName: 'project-reader-value' });
  const input = JSON.stringify({ topK: base.topK, projects: candidates });
  try {
    const result = await gateway.complete({
      provider,
      purpose: 'project-reader-value',
      batchId,
      jsonMode: true,
      thinking: false,
      maxOutputTokens: Math.min(5000, 700 + candidates.length * 420),
      messages: [{ role: 'system', content: prompt, protected: true }, { role: 'user', content: input, protected: true }],
    });
    const parsed = parseModelJson(result, { label: '项目读者价值研判' });
    const results = list(parsed?.results).map(normalizeResult).filter((item) => item.eventId);
    const scored = results.map(scoreProjectReaderValue);
    return { ...base, status: 'completed', results: scored, input, skill: bundle?.skill || 'project-reader-value', callId: result.callId || null, usage: result.usage || null };
  } catch (error) {
    return { ...base, status: 'failed', reason: text(error?.message || error, 240), input };
  }
}

export function attachProjectReaderValues(ranking = [], results = []) {
  const byEvent = new Map(results.map((result) => [String(result.eventId), result]));
  return ranking.map((item) => {
    const value = byEvent.get(String(item?.eventId || ''));
    if (!value || item?.contentClass !== 'github_project') return item;
    return { ...item, repositoryMeta: { ...(item.repositoryMeta || {}), ...value }, projectReaderValue: value.projectReaderValue,
      projectReaderValueReason: value.whyRead, projectReaderValueLimitations: value.limitations };
  });
}

export function applyProjectReaderValuesToHeatRanking(eventHeatRanking = {}, results = []) {
  const byEvent = new Map(results.map((result) => [String(result.eventId), result]));
  const board = list(eventHeatRanking?.rankings?.github_project?.items).map((item) => {
    const value = byEvent.get(String(item?.eventId || item?.event_id || ''));
    if (!value) return { ...item, projectRankScore: finite(item?.scoreValue, 0) };
    return {
      ...item,
      projectDiscoveryScore: finite(item?.scoreValue, 0),
      projectReaderValue: value.projectReaderValue,
      projectReaderValueScoreParts: value.scoreParts,
      projectReaderValueReason: value.whyRead,
      projectReaderValueLimitations: value.limitations,
      scoreValue: value.projectReaderValue,
      eventValue: value.projectReaderValue,
      t: value.projectReaderValue,
      scoreModel: 'projectReaderValue-v1',
      projectRankScore: value.projectReaderValue,
    };
  }).sort((left, right) => right.projectRankScore - left.projectRankScore
    || finite(right.projectDiscoveryScore, 0) - finite(left.projectDiscoveryScore, 0)
    || String(left.eventId || '').localeCompare(String(right.eventId || '')));
  const previousRanks = new Map(board.map((item) => [String(item.eventId || item.event_id || ''), item.previousRank]));
  const rankedBoard = board.map((item, index) => {
    const previousRank = Number.isFinite(Number(previousRanks.get(String(item.eventId || item.event_id || ''))))
      ? Number(previousRanks.get(String(item.eventId || item.event_id || ''))) : null;
    return { ...item, rank: index + 1, boardRank: index + 1, rankScope: 'github_project', previousRank,
      rankDelta: previousRank == null ? null : previousRank - (index + 1) };
  });
  return {
    ...eventHeatRanking,
    rankings: {
      ...(eventHeatRanking.rankings || {}),
      github_project: {
        ...(eventHeatRanking.rankings?.github_project || {}),
        contentClass: 'github_project',
        scoreModel: 'projectReaderValue-v1',
        scoreComparable: false,
        items: rankedBoard,
      },
    },
  };
}
