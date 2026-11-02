import { tagBatch } from '../../research/llm/tasks.mjs';
import { runResearchPipeline, ensureBatchEventCards } from '../../research/index.mjs';
import { runArticlePipeline, runArticleReview, runTypesetPipeline, runBreakingAnalysisPipeline, runDailyPipeline, runTutorialPipeline, runCoverImageJob } from '../../articles/index.mjs';
import { runSocialCardBeautify } from '../../social-cards/index.mjs';
import { runAutoPipeline } from './auto-pipeline.mjs';
import { retryPipelineFailure } from './pipeline-failure-retry.mjs';
import { bindPipelineHarnessGateway } from '../../../platform/skills/pipeline-runtime.mjs';

export const AI_JOB_TYPES = Object.freeze(['tag', 'retag', 'event-cards', 'research', 'pipeline-failure-retry', 'breaking-analysis', 'article', 'article-review', 'daily', 'tutorial', 'typeset', 'social-card-beautify', 'cover-image', 'auto']);
export const BATCH_LEVEL_AI_JOB_TYPES = new Set(['tag', 'retag', 'event-cards', 'research', 'pipeline-failure-retry', 'breaking-analysis', 'auto', 'daily']);
export const EXTERNAL_RUNTIME_AI_JOB_TYPES = new Set(['tag', 'retag', 'event-cards', 'research', 'article', 'article-review', 'typeset', 'social-card-beautify', 'cover-image', 'auto']);

export function createAiJobHandlers({ store, gateway, config, log, onThinking = () => {} }) {
  const progress = (job) => (message) => log(job, message);
  const modelProvider = (job) => job.modelConfigProvider || job.provider;
  const jobGateway = (job) => {
    const scoped = bindPipelineHarnessGateway(gateway, { store, batchId: job.batchId, candidateId: job.candidateId, runtimeId: job.runtimeId,
      rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, entryPoint: `batch-job:${job.type}`,
      workspaceRoot: config.workspaceRoot });
    const assertNotCancelled = () => {
      if (!job.cancelRequested && !job.abortController?.signal.aborted) return;
      const reason = job.cancelReason || job.abortController?.signal.reason?.message || '任务已取消';
      throw Object.assign(new Error(reason), { code: 'JOB_CANCELLED' });
    };
    return new Proxy(scoped, {
      get(target, property, receiver) {
        if (property === 'complete') return (input) => { assertNotCancelled(); return target.complete(input); };
        if (property === 'streamComplete') {
          const streamComplete = Reflect.get(target, property, receiver);
          return typeof streamComplete === 'function' ? (...args) => { assertNotCancelled(); return streamComplete(...args); } : streamComplete;
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  const visualEventSink = (job) => (event) => {
    if (event?.type === 'assistant.thinking') onThinking(job, event.text);
  };
  return new Map([
    ['tag', async ({ job, maxAgeHours, options }) => { store.updateBatch(job.batchId, { stage: 'synthesis', status: 'running' }); const result = await tagBatch({ gateway: jobGateway(job), store, batchId: job.batchId, provider: modelProvider(job), force: Boolean(options.force), maxAgeHours, workspaceRoot: config.workspaceRoot, runId: job.id, onProgress: progress(job) }); store.updateBatch(job.batchId, { stage: 'synthesis', status: 'review' }); return result; }],
    ['retag', async ({ job, maxAgeHours }) => { store.updateBatch(job.batchId, { stage: 'synthesis', status: 'running' }); const result = await tagBatch({ gateway: jobGateway(job), store, batchId: job.batchId, provider: modelProvider(job), force: true, maxAgeHours, workspaceRoot: config.workspaceRoot, runId: job.id, onProgress: progress(job) }); store.updateBatch(job.batchId, { stage: 'synthesis', status: 'review' }); return result; }],
    ['event-cards', async ({ job, maxAgeHours, options }) => { store.updateBatch(job.batchId, { stage: 'synthesis', status: 'running' }); const result = await ensureBatchEventCards({ gateway: jobGateway(job), store, batchId: job.batchId, provider: modelProvider(job), workspaceRoot: config.workspaceRoot, maxAgeHours, regenerate: Boolean(options.force), runId: job.id, onProgress: progress(job) }); store.updateBatch(job.batchId, { stage: 'synthesis', status: 'review' }); if (result.failed.length) throw new Error(`${result.failed.length} 张事件卡生成失败，可点击“继续生成事件卡”重试`); return result; }],
    ['research', async ({ job, maxAgeHours, options }) => { const result = await runResearchPipeline({ gateway: jobGateway(job), store, batchId: job.batchId, provider: modelProvider(job), workspaceRoot: config.workspaceRoot, maxAgeHours, resumeFrom: options.resumeFrom || '', onProgress: progress(job) }); for (const failure of store.listPipelineFailures(job.batchId, { statuses: ['open', 'retrying'], stages: ['research'] })) store.resolvePipelineFailure(failure.id); return result; }],
    ['pipeline-failure-retry', async ({ job, maxAgeHours, options }) => retryPipelineFailure({ failureId: options.failureId, batchId: job.batchId, provider: modelProvider(job), store, gateway: jobGateway(job), config, maxAgeHours, onProgress: progress(job) })],
    ['breaking-analysis', ({ job }) => runBreakingAnalysisPipeline({ gateway: jobGateway(job), store, batchId: job.batchId, provider: modelProvider(job), workspaceRoot: config.workspaceRoot, onProgress: progress(job) })],
    ['article', ({ job, options }) => runArticlePipeline({ gateway: jobGateway(job), store, batchId: job.batchId, candidateId: options.candidateId, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId, skillSelection: job.skillSelection, stageSelections: job.stageSelections, articleLength: config.articleLength, rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, onProgress: progress(job) })],
    ['article-review', ({ job, options }) => runArticleReview({ gateway: jobGateway(job), store, batchId: job.batchId, candidateId: options.candidateId, documentKind: options.documentKind, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, onProgress: progress(job) })],
    ['daily', ({ job, options }) => runDailyPipeline({ gateway: jobGateway(job), store, batchId: job.batchId, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId, stageSelections: job.stageSelections, focus: options.focus, focuses: options.focuses, articleLength: config.articleLength, rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, onProgress: progress(job) })],
    ['tutorial', ({ job, options }) => runTutorialPipeline({ gateway: jobGateway(job), store, batchId: job.batchId, candidateId: options.candidateId, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId, skillSelection: job.skillSelection, stageSelections: job.stageSelections, articleLength: config.articleLength, rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, onProgress: progress(job) })],
    ['typeset', ({ job, options }) => runTypesetPipeline({ gateway: jobGateway(job), store, batchId: job.batchId, candidateId: options.candidateId, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, snapshotId: job.snapshotId, documentKind: options.documentKind, imageDeliveryMode: options.imageDeliveryMode || 'local', rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, stageId: 'typeset', onProgress: progress(job) })],
    ['social-card-beautify', ({ job, options }) => runSocialCardBeautify({ gateway: jobGateway(job), store, batchId: job.batchId, candidateId: options.candidateId, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, styleBrief: options.styleBrief, resumeFrom: options.resumeFrom || '', onProgress: progress(job), onEvent: visualEventSink(job) })],
    ['cover-image', ({ job }) => runCoverImageJob({ gateway: jobGateway(job), store, batchId: job.batchId, candidateId: job.candidateId, provider: job.requestedProvider, workspaceRoot: config.workspaceRoot, rootRunId: `job:${job.id}`, workflowRunId: `job:${job.id}`, onProgress: progress(job), onEvent: visualEventSink(job) })],
    ['auto', async ({ job, batch, maxAgeHours }) => { const result = await runAutoPipeline({ gateway: jobGateway(job), store, config, job, batch, maxAgeHours, onProgress: progress(job) }); for (const failure of store.listPipelineFailures(job.batchId, { statuses: ['open', 'retrying'], stages: ['research'] })) store.resolvePipelineFailure(failure.id); return result; }],
  ]);
}
