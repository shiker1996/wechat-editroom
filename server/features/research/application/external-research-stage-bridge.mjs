import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { batchTopicsDir } from '../../../platform/core/workspace-paths.mjs';
import { getAccountContext } from '../../../platform/application/account-context-service.mjs';
import { isResearchEligibleHotspot } from '../domain/hotspot-pipeline-scope.mjs';
import { tagsOf } from '../domain/hotspot-clustering.mjs';
import { resolveStableBatchEvents } from './stable-event-service.mjs';
import { isFreshForBatch, runResearchPipeline } from './research-pipeline.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

function requestDigest(request) {
  const messages = JSON.stringify(request.messages).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, '<timestamp>');
  return digest({ stageId: request.stageId, purpose: request.purpose, jsonMode: request.jsonMode,
    tools: request.tools, toolChoice: request.toolChoice, messages });
}

// Each submitted model result is replayed through the original pipeline. It owns
// prompts, validation, scoring, article selection, social selection and artifacts.
const activeBatches = new Set();
export async function advanceExternalResearch(input) {
  if (activeBatches.has(input.batchId)) throw conflict('该批次的外部研判正在执行，请等待当前请求完成');
  activeBatches.add(input.batchId);
  try { return await advanceUnlocked(input); }
  finally { activeBatches.delete(input.batchId); }
}

async function advanceUnlocked({ store, batchId, workspaceRoot, maxAgeHours, taskId = '', output, reset = false }) {
  const batch = store.getBatch(batchId);
  if (!batch) throw Object.assign(new Error('批次不存在'), { statusCode: 404 });
  const sourcesDir = path.join(batchTopicsDir(workspaceRoot, batch), 'sources');
  const eligible = batch.hotspots.filter(isResearchEligibleHotspot)
    .filter((item) => isFreshForBatch(item, batch.batch_date, maxAgeHours));
  if (!eligible.length || eligible.some((item) => !tagsOf(item).eventKey || !tagsOf(item).preScores)) {
    throw conflict('请先完成有效热点的语义打标');
  }
  const events = resolveStableBatchEvents({ store, workspaceRoot, batch, hotspots: eligible });
  let cards;
  try { cards = JSON.parse(fs.readFileSync(path.join(sourcesDir, 'event-cards.json'), 'utf8')).items; } catch {}
  const cardIds = new Set((cards || []).map((item) => String(item.event_id)));
  if (events.some((event) => !cardIds.has(String(event.event_id)))) throw conflict('请先通过外部 Agent 提交全部稳定事件事实卡');
  const inputHash = digest({ batchId, account: getAccountContext({ workspaceRoot, refresh: true }), hotspots: eligible.map((item) => [item.id, item.title, item.raw_json,
    item.published_at, item.created_at]), cards: (cards || []).map((item) => [item.event_id, item]) });
  const ledgerPath = path.join(sourcesDir, 'external-research-stage-results.json');
  let ledger = { batchId, inputHash, runId: randomUUID(), responses: [], pending: null, completed: null };
  if (!reset && fs.existsSync(ledgerPath)) {
    try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); }
    catch { throw conflict('外部研判记录损坏，请确认后重置'); }
  }
  if (ledger.batchId !== batchId || ledger.inputHash !== inputHash || !ledger.runId || !Array.isArray(ledger.responses)) {
    throw conflict('批次热点或事件卡已变化，请先重置外部研判记录');
  }
  const saveLedger = () => {
    const temporary = `${ledgerPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), 'utf8');
    fs.renameSync(temporary, ledgerPath);
  };
  const checkpointPath = path.join(sourcesDir, 'discussion-research-stage3-input.json');
  const checkpointFingerprint = () => {
    let snapshot;
    try { snapshot = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')); } catch { throw conflict('研判阶段快照不存在或已损坏，请重置后重新研判'); }
    if (snapshot.batch_id !== batchId || !snapshot.base_report || !snapshot.single_pass?.reports || !snapshot.reader_screening) {
      throw conflict('研判阶段快照不完整，请重置后重新研判');
    }
    return digest({ base: snapshot.base_report, single: snapshot.single_pass,
      screening: snapshot.reader_screening, clusters: snapshot.clusters, heat: snapshot.event_heat_ranking });
  };
  if (ledger.checkpoint && checkpointFingerprint() !== ledger.checkpoint.fingerprint) {
    throw conflict('研判阶段快照已变化，请重置后重新研判');
  }
  let previousPending = null;
  if (output !== undefined) {
    const previous = ledger.responses.at(-1);
    const repeated = previous?.taskId === taskId && digest(previous.output) === digest(output);
    if ((!repeated && taskId !== ledger.pending?.taskId) || (typeof output !== 'string' && (!output || typeof output !== 'object' || Array.isArray(output)))) {
      throw conflict('阶段任务 ID 或输出无效，请重新领取当前任务');
    }
    if (!repeated && ledger.pending.jsonMode && typeof output !== 'object') throw conflict('当前阶段需要 JSON 对象');
    if (typeof output === 'string' && !output.trim()) throw conflict('阶段输出不能为空');
    if (!repeated) {
      previousPending = ledger.pending;
      ledger.responses.push({ taskId, requestHash: ledger.pending.requestHash, output });
      ledger.pending = null;
      saveLedger();
    }
  }
  if (ledger.completed) return { status: 'completed', batchId, result: ledger.completed };
  let cursor = ledger.checkpoint?.offset || 0;
  const gateway = {
    config: { defaultProvider: 'external', providers: { external: { maxOutputTokens: 18000, eventCardConcurrency: 1 } } },
    complete: async (request) => {
      const index = cursor++;
      const requestHash = requestDigest(request);
      if (ledger.responses[index]) {
        if (ledger.responses[index].requestHash !== requestHash) {
          throw Object.assign(conflict('阶段输入已变化，旧响应不能复用，请重置后重新研判'), { code: 'EXTERNAL_STAGE_REPLAY_CONFLICT' });
        }
        const saved = ledger.responses[index].output;
        return { content: typeof saved === 'string' ? saved : JSON.stringify(saved) };
      }
      const task = { taskId: `${batchId}:${ledger.runId}:${index}`, batchId, stageId: request.stageId || request.purpose,
        purpose: request.purpose, messages: request.messages, jsonMode: request.jsonMode, tools: request.tools || [] };
      if (!ledger.checkpoint && request.stageId === 'discussion-research.topic_generation') {
        ledger.checkpoint = { offset: index, fingerprint: checkpointFingerprint() };
      }
      ledger.pending = { taskId: task.taskId, requestHash, jsonMode: request.jsonMode };
      saveLedger();
      throw Object.assign(new Error('等待外部 Agent 提交阶段结果'), { code: 'EXTERNAL_STAGE_PENDING', task });
    },
  };
  try {
    const result = await runResearchPipeline({ gateway, store, batchId, provider: 'external', workspaceRoot, maxAgeHours,
      resumeFrom: ledger.checkpoint ? 'topic_generation' : '' });
    ledger.completed = result;
    saveLedger();
    return { status: 'completed', batchId, result };
  } catch (error) {
    if (error.code === 'EXTERNAL_STAGE_PENDING') return { status: 'pending', ...error.task };
    if (previousPending) {
      ledger.responses.pop();
      ledger.pending = previousPending;
      saveLedger();
    }
    throw error;
  }
}
