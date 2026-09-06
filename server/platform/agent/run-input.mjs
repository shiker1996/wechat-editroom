import fs from 'node:fs';
import path from 'node:path';
import { batchArticlesDir, candidateArticleDir, candidateSocialCardDir } from '../core/workspace-paths.mjs';
import { redactAuditText } from './audit-governance.mjs';

const DEFAULT_PREVIEW_LIMIT = 2400;
const MAX_INPUT_FILES = 12;

function textForFile(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function previewText(value, limit = DEFAULT_PREVIEW_LIMIT) {
  const text = String(value ?? '');
  const max = Math.max(240, Number(limit) || DEFAULT_PREVIEW_LIMIT);
  if (text.length <= max) return { preview: text, length: text.length, truncated: false };
  const head = Math.max(120, Math.floor(max * 0.68));
  const tail = Math.max(80, max - head);
  return {
    preview: `${text.slice(0, head)}\n\n… 已截断 ${text.length - head - tail} 字符 …\n\n${text.slice(-tail)}`,
    length: text.length,
    truncated: true,
  };
}

function serialiseContent(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.json') return content;
  try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; }
}

function safeContent(filePath) {
  return redactAuditText(serialiseContent(filePath, textForFile(filePath) || ''));
}

function safeJsonValue(value) {
  const serialised = redactAuditText(JSON.stringify(value));
  try { return JSON.parse(serialised); } catch { return value; }
}

function rootRunFor(trace) {
  const rootId = String(trace?.rootRunId || trace?.root_run_id || '');
  return (trace?.runs || []).find((run) => String(run.id) === rootId)
    || (trace?.runs || []).find((run) => !run.parent_run_id && !run.parentRunId)
    || trace?.runs?.[0]
    || null;
}

function addKnown(files, label, filePath, stageId = '') {
  if (files.some((item) => item.filePath === filePath)) return;
  if (textForFile(filePath) == null) return;
  files.push({ label, filePath, stageId });
  if (files.length > MAX_INPUT_FILES) files.splice(MAX_INPUT_FILES);
}

function inputFilesForRun({ root, store, trace, batchWorkdir }) {
  const run = rootRunFor(trace);
  if (!run?.batch_id || typeof batchWorkdir !== 'function') return [];
  const batch = store.getBatch?.(run.batch_id);
  if (!batch) return [];
  const files = [];
  const entryPoint = String(run.entry_point || run.entryPoint || '').toLowerCase();
  const sources = path.join(batchWorkdir(batch), 'sources');

  if (entryPoint.includes('research') || entryPoint.includes('breaking')) {
    addKnown(files, '讨论研判模型输入', path.join(sources, 'discussion-research-input.json'), 'discussion-research');
    addKnown(files, '研判阶段 3 输入', path.join(sources, 'discussion-research-stage3-input.json'), 'discussion-research.topic_generation');
    addKnown(files, 'Top-K 研判范围', path.join(sources, 'topk-research-scope.json'), 'discussion-research');
  } else {
    // 其它 Pipeline 沿用各自已经落盘的输入 / 计划文件，不扫描或暴露任意产物。
    const preferred = [
      ['批次 brief 输入', 'brief-pool.json', 'workflow.input'],
      ['事件卡输入', 'event-cards.json', 'event-cards'],
      ['事件关系输入', 'event-relations.json', 'event-relations'],
      ['阶段 3 输入', 'discussion-research-stage3-input.json', 'discussion-research.topic_generation'],
    ];
    preferred.forEach(([label, name, stageId]) => addKnown(files, label, path.join(sources, name), stageId));
  }

  const candidateId = run.candidate_row_id ?? run.candidateRowId;
  const candidate = candidateId != null ? store.getCandidate?.(candidateId) : null;
  if (candidate) {
    if (entryPoint.includes('social-card') || entryPoint.includes('visual')) {
      const dir = candidateSocialCardDir(root, batch, candidate);
      addKnown(files, '图文卡片计划', path.join(dir, 'card-plan.json'), 'social-card.plan');
      addKnown(files, '图文事实材料', path.join(dir, 'fact-sheet.md'), 'social-card.inputs');
    }
    if (entryPoint.includes('article') || entryPoint.includes('tutorial') || entryPoint.includes('daily') || entryPoint.includes('cover')) {
      const dir = candidateArticleDir(root, batch, candidate);
      addKnown(files, '文章简报', path.join(dir, '00-article-brief.md'), 'article.brief');
      addKnown(files, '研究选择', path.join(dir, 'editorial-research-selection.json'), 'article.research');
    }
  }

  if (!files.length && (entryPoint.includes('article') || entryPoint.includes('daily'))) {
    addKnown(files, '批次文章目录', path.join(batchArticlesDir(root, batch), '00-article-brief.md'), 'article.brief');
  }
  return files;
}

function modelCallForPhase(phase, trace) {
  const callId = phase.call_id ?? phase.callId ?? phase.response?.call_id ?? phase.response?.callId;
  if (callId == null || callId === '') return null;
  return (trace?.modelCalls || []).find((call) => String(call.id ?? call.call_id ?? call.callId) === String(callId)) || null;
}

function phaseRecords(files, previewLimit, trace) {
  const researchFile = files.find((item) => path.basename(item.filePath) === 'discussion-research-input.json');
  if (!researchFile) return [];
  const content = textForFile(researchFile.filePath);
  try {
    const data = JSON.parse(content);
    return (Array.isArray(data.phases) ? data.phases : []).map((phase, index) => {
      const serialised = redactAuditText(JSON.stringify(phase.input ?? phase.messages ?? phase, null, 2));
      const view = previewText(serialised, previewLimit);
      const modelCall = modelCallForPhase(phase, trace);
      return {
        stageId: String(phase.stage_id || phase.stageId || phase.phase || `phase-${index + 1}`),
        attempt: Number(phase.attempt || 1),
        preview: view.preview,
        length: view.length,
        truncated: view.truncated,
        modelCallId: phase.call_id ?? phase.callId ?? phase.response?.call_id ?? phase.response?.callId ?? null,
        modelCall: modelCall ? {
          id: modelCall.id,
          provider: modelCall.provider || null,
          model: modelCall.model || null,
          purpose: modelCall.purpose || null,
          status: modelCall.status || null,
          estimatedInputTokens: modelCall.estimated_input_tokens ?? modelCall.estimatedInputTokens ?? null,
          promptTokens: modelCall.prompt_tokens ?? modelCall.promptTokens ?? null,
          completionTokens: modelCall.completion_tokens ?? modelCall.completionTokens ?? null,
          createdAt: modelCall.created_at || modelCall.createdAt || null,
        } : null,
      };
    });
  } catch { return []; }
}

export function buildRunInput({ root, store, trace, batchWorkdir, previewLimit = DEFAULT_PREVIEW_LIMIT } = {}) {
  const files = inputFilesForRun({ root, store, trace, batchWorkdir });
  const records = files.map(({ label, filePath, stageId }) => {
    const content = safeContent(filePath);
    const view = previewText(content, previewLimit);
    return { label, stageId, preview: view.preview, length: view.length, truncated: view.truncated };
  });
  const stages = phaseRecords(files, previewLimit, trace);
  const index = {
    schemaVersion: 1,
    source: 'existing-task-files',
    files: files.map(({ label, stageId, filePath }) => ({
      label,
      stageId,
      format: path.extname(filePath).toLowerCase() === '.json' ? 'json' : 'text',
      available: true,
    })),
    stages: stages.map(({ stageId, attempt, modelCallId }) => ({ stageId, attempt, modelCallId: modelCallId ?? null, available: true })),
  };
  return {
    available: records.length > 0,
    previewLimit: Math.max(240, Number(previewLimit) || DEFAULT_PREVIEW_LIMIT),
    records,
    stages,
    index,
    message: records.length ? '' : '该运行未记录输入',
  };
}

export function readRunInputDownload({ root, store, trace, batchWorkdir, stageId = '', attempt = null } = {}) {
  const files = inputFilesForRun({ root, store, trace, batchWorkdir });
  const phase = String(stageId || '').trim();
  const researchFile = files.find((item) => path.basename(item.filePath) === 'discussion-research-input.json');
  if (phase && researchFile) {
    try {
      const data = JSON.parse(textForFile(researchFile.filePath));
      const phases = (Array.isArray(data.phases) ? data.phases : []).filter((item) => {
        const itemStage = String(item.stage_id || item.stageId || item.phase || '');
        return (itemStage === phase || `discussion-research.${itemStage}` === phase || item.phase === phase)
          && (attempt == null || Number(item.attempt || 1) === Number(attempt));
      });
      if (phases.length) return { schemaVersion: 1, rootRunId: trace.rootRunId, stageId: phase, attempt: attempt == null ? null : Number(attempt), input: phases.map(safeJsonValue) };
    } catch {}
  }
  return {
    schemaVersion: 1,
    rootRunId: trace.rootRunId,
    input: files.map(({ label, stageId: fileStage, filePath }) => ({ label, stageId: fileStage, content: safeContent(filePath) })),
  };
}
