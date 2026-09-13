import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { selectionPrompt } from '../../../platform/skills/skill-prompt.mjs';
import {
  PROJECT_READER_VALUE_TOP_K,
  resolveProjectReaderValueTopK,
  scoreProjectReaderValue,
} from '../domain/project-reader-value.mjs';

const list = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback = 0) => Math.max(min, Math.min(max, finite(value, fallback)));

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
