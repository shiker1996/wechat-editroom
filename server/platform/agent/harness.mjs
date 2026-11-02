import { runConversationAgent } from './conversation-agent.mjs';
import { AgentContractError, toolError } from './tool-protocol.mjs';
import { executeConversationTool } from './tool-executor.mjs';
import { capabilityForToolName } from './tool-catalog.mjs';
import { compactToolResult, toolCallFingerprint } from './context.mjs';
import { AGENT_RUNTIME_CAPABILITIES } from './runtime-registry.mjs';
import { resolveSkillRuntime } from '../skills/resolver.mjs';
export { SKILL_RUN_KINDS } from '../skills/runtime-definition.mjs';
import { SKILL_RUN_KINDS } from '../skills/runtime-definition.mjs';
import { resolveSkillGates } from '../skills/gates.mjs';
import { readAgentSnapshot, prepareAgentRun, bindAgentGateway } from './run-preparation.mjs';
import { agentEvent } from './events.mjs';


/**
 * @typedef {Object} SkillDefinition
 * @property {string} id
 * @property {'prompt-skill'|'stage-skill'|'agent-skill'} kind
 * @property {string[]} [entryPoints]
 * @property {string} [inputContract]
 * @property {string} [outputContract]
 * @property {string[]} [requiredCapabilities]
 * @property {Object} [budget]
 *
 * @typedef {{allowedCapabilities?: string[]}} RunPolicy
 * @typedef {Partial<typeof import('./contracts.mjs').CONVERSATION_AGENT_BUDGET_DEFAULTS>} RunBudget
 * @typedef {{agentRunId: string, type: string, assistantReply?: string, output?: Object, modelSteps: number, toolCalls: number}} AgentRunResult
 * @typedef {{capability: string, inputSchema: Object, implementations?: Object[]}} ToolDefinition
 *
 * @typedef {Object} AgentRunRequest
 * @property {string} skillId
 * @property {string} entryPoint
 * @property {*} [input]
 * @property {Object} [context] Runtime dependencies; callbacks are never serialized.
 * @property {SkillDefinition} [definition] Resolved definition supplied by the entry/workflow.
 * @property {{allowedCapabilities?: string[]}} [policy] Can only narrow the supplied catalog.
 * @property {Object} [budget]
 * @property {string} [snapshotId] Requires context.resolveSnapshot; never silently uses live config.
 *
 * Agent results and events are returned unchanged. Prompt and stage results retain
 * their Gateway/Workflow contracts. This facade does not invent a second tool loop.
 */

function fail(code, message) { throw new AgentContractError(code, message); }

let runtimeRegistry = null;
let defaultRuntimeResolver = null;
export function setAgentRuntimeRegistry(registry, { getDefaultRuntime = null } = {}) {
  if (registry != null && typeof registry.resolve !== 'function') throw new TypeError('Agent Runtime Registry 必须提供 resolve');
  if (getDefaultRuntime != null && typeof getDefaultRuntime !== 'function') throw new TypeError('默认 Runtime resolver 必须是函数');
  runtimeRegistry = registry;
  defaultRuntimeResolver = getDefaultRuntime;
}

function validateStringList(value, field) {
  if (value != null && (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item))) {
    fail('INVALID_SKILL_RUN', `${field} 必须是字符串数组`);
  }
}

function scopedCatalog(catalog = [], scopes = []) {
  return Object.freeze(catalog.filter((tool) => scopes.every((scope) => scope.includes(tool.capability))));
}

/** @param {AgentRunRequest} request */
export async function runSkill(request = {}) {
  // Top-level engine options remain accepted during the adapter migration.
  const runtime = { ...request, ...request.context };
  const liveResumeMessages = request.resumeFrom != null && Array.isArray(runtime.messages) ? runtime.messages : null;
  let resumeClaim = null;
  const releaseResume = () => {
    if (!resumeClaim) return;
    runtime.store?.releaseAgentResume?.(resumeClaim.runId, resumeClaim.token);
    resumeClaim = null;
  };
  try {
  if (request.resumeFrom != null) {
    const checkpoint = runtime.store?.getLatestAgentCheckpoint?.(String(request.resumeFrom));
    if (!checkpoint?.state?.resumable) fail('RESUME_NOT_AVAILABLE', '没有可安全恢复的 Agent checkpoint');
    const token = `resume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    if (!runtime.store?.claimAgentResume?.(String(request.resumeFrom), token, request.resumeLeaseMs)) fail('RESUME_CONFLICT', 'Agent checkpoint 已被其他恢复任务占用');
    resumeClaim = { runId: String(request.resumeFrom), token };
    runtime.resumeState = checkpoint.state;
    runtime.toolContext = {
      ...runtime.toolContext,
      ...(runtime.toolContext?.rootRunId == null && checkpoint.state.rootRunId != null ? { rootRunId: checkpoint.state.rootRunId } : {}),
      ...(runtime.toolContext?.workflowRunId == null && checkpoint.state.workflowRunId != null ? { workflowRunId: checkpoint.state.workflowRunId } : {}),
      ...(runtime.toolContext?.stageId == null && checkpoint.state.stageId != null ? { stageId: checkpoint.state.stageId } : {}),
      ...(runtime.toolContext?.parentRunId == null ? { parentRunId: checkpoint.state.parentRunId || String(request.resumeFrom) } : {}),
    };
    request = { ...request, snapshotId: request.snapshotId ?? checkpoint.state.generationSnapshotId };
    if (typeof runtime.restoreState === 'function') {
      try { runtime.restoredState = await runtime.restoreState(checkpoint.state); }
      catch (error) { releaseResume(); fail('RUN_STATE_RESTORE_FAILED', `业务状态恢复失败：${error.message}`); }
      if (runtime.restoredState === false) { releaseResume(); fail('RUN_STATE_RESTORE_FAILED', '业务状态恢复回调拒绝当前 checkpoint'); }
    }
  }
  const skillId = request.skillId || runtime.toolContext?.skillId;
  const entryPoint = request.entryPoint || runtime.entryPoint;
  if (typeof skillId !== 'string' || !skillId.trim() || typeof entryPoint !== 'string' || !entryPoint.trim()) fail('INVALID_SKILL_RUN', 'runSkill 必须指定 skillId 和 entryPoint');
  let definition = request.definition || { id: skillId, kind: 'agent-skill' };
  if (!request.definition && request.snapshotId == null && runtime.toolContext?.workspaceRoot) {
    const resolved = resolveSkillRuntime({ workspaceRoot: runtime.toolContext.workspaceRoot, skillId, kind: 'agent-skill' });
    definition = resolved.definition;
    runtime.resolvedSkillBundle = resolved.bundle;
    runtime.skillConfig = resolved.bundle.config || null;
  }
  let frozenRuntime = {};
  let frozenGateBindings = null, historicalSnapshot = null;
  if (request.snapshotId != null) {
    if (typeof runtime.resolveSnapshot !== 'function' && typeof runtime.store?.getGenerationSnapshot !== 'function') fail('SKILL_SNAPSHOT_UNAVAILABLE', '指定 snapshotId 时必须提供快照存储或 resolveSnapshot');
    const snapshot = typeof runtime.resolveSnapshot === 'function' ? await runtime.resolveSnapshot(request.snapshotId)
      : readAgentSnapshot({ store: runtime.store, snapshotId: request.snapshotId, skillId, entryPoint, toolContext: runtime.toolContext });
    if (!snapshot || snapshot.skillId !== skillId || snapshot.entryPoint !== entryPoint) {
      fail('SKILL_SNAPSHOT_MISMATCH', '运行快照不存在或与当前技能、入口不匹配');
    }
    if (!snapshot.definition) fail('SKILL_SNAPSHOT_MISMATCH', '运行快照缺少技能定义');
    definition = snapshot.definition;
    frozenRuntime = structuredClone(snapshot.runtime || {});
    frozenGateBindings = snapshot.gateBindings ?? null;
    historicalSnapshot = snapshot.snapshot ?? null;
  }
  definition = structuredClone(definition);
  if (definition.id !== skillId || !SKILL_RUN_KINDS.includes(definition.kind)) fail('INVALID_SKILL_RUN', '技能 ID 或运行类型不合法');
  validateStringList(definition.entryPoints, 'definition.entryPoints');
  if (definition.runtimePolicy != null && (!definition.runtimePolicy || typeof definition.runtimePolicy !== 'object' || Array.isArray(definition.runtimePolicy)
      || definition.runtimePolicy.mode !== 'external-agent')) fail('INVALID_SKILL_RUN', 'definition.runtimePolicy 无效');
  validateStringList(definition.runtimePolicy?.requiredCapabilities, 'definition.runtimePolicy.requiredCapabilities');
  if ((definition.runtimePolicy?.requiredCapabilities || []).some((capability) => !AGENT_RUNTIME_CAPABILITIES.includes(capability))) fail('INVALID_SKILL_RUN', 'definition.runtimePolicy.requiredCapabilities 包含未知能力');
  validateStringList(definition.requiredCapabilities, 'definition.requiredCapabilities');
  validateStringList(request.policy?.allowedCapabilities, 'policy.allowedCapabilities');
  validateStringList(request.confirmedCapabilities, 'confirmedCapabilities');
  validateStringList(runtime.toolContext?.allowedCapabilities, 'toolContext.allowedCapabilities');
  validateStringList(frozenRuntime.toolContext?.allowedCapabilities, 'snapshot.allowedCapabilities');
  if (!runtime.runtimeAdapter && definition.runtimePolicy?.mode === 'external-agent' && runtimeRegistry) {
    const selectedRuntime = request.runtimeId || runtime.runtimeId || await defaultRuntimeResolver?.() || 'local-harness';
    if (selectedRuntime !== 'local-harness') {
      runtime.runtimeAdapter = runtimeRegistry.resolve(selectedRuntime);
      if (!runtime.runtimeAdapter) fail('RUNTIME_NOT_REGISTERED', `Agent Runtime 未注册：${selectedRuntime}`);
    }
  }
  if (definition.entryPoints?.length && !definition.entryPoints.includes(entryPoint)) fail('SKILL_ENTRY_NOT_ALLOWED', `技能 ${skillId} 不支持入口 ${entryPoint}`);
  const execution = { ...runtime, ...frozenRuntime };
  // Historical snapshots restore the original prompt. A resumed interactive
  // run may also provide a new user turn; keep that delta so the engine can
  // append it after the persisted checkpoint history.
  if (request.resumeFrom != null) execution.messages = liveResumeMessages || [];
  const scopes = [runtime.catalog?.map((tool) => tool.capability), runtime.toolContext?.allowedCapabilities, request.policy?.allowedCapabilities, frozenRuntime.toolContext?.allowedCapabilities].filter(Array.isArray);
  const catalog = scopedCatalog(execution.catalog, scopes);
  const missing = (definition.requiredCapabilities || []).filter((capability) => !catalog.some((tool) => tool.capability === capability));
  if (missing.length) fail('SKILL_CAPABILITY_MISSING', `技能 ${skillId} 缺少必需能力：${missing.join('、')}`);
  const budget = { ...definition.budget, ...runtime.budget, ...frozenRuntime.budget };
  // A historical snapshot must not replace current resource/path authorization.
  const toolContext = { ...runtime.toolContext, skillId, allowedCapabilities: catalog.map((tool) => tool.capability) };
  if (Array.isArray(request.confirmedCapabilities)) toolContext.confirmedCapabilities = [...new Set(request.confirmedCapabilities)];
  if (request.snapshotId != null) toolContext.generationSnapshotId = request.snapshotId;
  const gates = resolveSkillGates(definition.gates, runtime.gateHandlers, frozenGateBindings);
  const gateContext = { input: request.input, definition, context: { ...execution, catalog, toolContext } };
  await gates.run('input', gateContext);
  if (definition.kind === 'agent-skill') {
    const prepared = prepareAgentRun({ runtime: execution, skillId, entryPoint, definition, catalog, budget, toolContext,
      gateBindings: gates.bindings, historical: historicalSnapshot, snapshotId: request.snapshotId });
    if (prepared.snapshotId != null) toolContext.generationSnapshotId = prepared.snapshotId;
    if (execution.runtimeAdapter) {
      const capabilities = await execution.runtimeAdapter.getCapabilities(execution.runtimeProfile || {});
      const requiredRuntimeCapabilities = new Set(['run', 'streaming', 'cancel', ...(definition.runtimePolicy?.requiredCapabilities || []), ...(catalog.length ? ['hostToolCallbacks'] : [])]);
      const missingRuntimeCapabilities = [...requiredRuntimeCapabilities].filter((capability) => capabilities[capability] !== true);
      if (missingRuntimeCapabilities.length) fail('RUNTIME_CAPABILITY_MISSING', `所选 Agent Runtime 缺少能力：${missingRuntimeCapabilities.join('、')}`);
      if (request.resumeFrom != null && !capabilities.resume) fail('RESUME_NOT_AVAILABLE', '当前 Runtime 暂不支持恢复历史运行，请开始新的 Agent 轮次');
      const agentRunId = `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const trace = { rootRunId: toolContext.rootRunId || agentRunId, workflowRunId: toolContext.workflowRunId || toolContext.rootRunId || agentRunId, stageId: toolContext.stageId || entryPoint };
      const runtimeLimits = { maxToolCalls: Math.min(24, Math.max(1, Number(budget.maxToolCalls) || 10)),
        maxParallelToolCalls: Math.min(4, Math.max(1, Number(budget.maxParallelToolCalls) || 3)),
        maxToolResultChars: Math.min(80000, Math.max(256, Number(budget.maxToolResultChars) || 12000)),
        maxTotalToolResultChars: Math.min(320000, Math.max(256, Number(budget.maxTotalToolResultChars) || 64000)) };
      let toolCalls = 0, activeToolCalls = 0, totalToolResultChars = 0;
      const emitToolEvent = (type, payload = {}) => {
        const event = agentEvent(type, { agentRunId, ...payload });
        const internal = { ...event, type: type === 'assistant.delta' ? 'model.text' : type, schemaVersion: 1 };
        execution.store?.appendAgentRunEvent?.(agentRunId, internal);
        execution.onInternalEvent?.(internal);
        execution.onEvent?.(event);
      };
      const executeTool = async ({ callId, tool, arguments: args }) => {
        const capability = capabilityForToolName(tool, catalog);
        const safeCallId = String(callId || `call-${toolCalls + 1}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
        const request = { requestId: `tr_codex_${safeCallId}`, capability: capability || 'cap_codex_unmapped_tool',
          arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {}, reason: 'Codex Runtime 工具调用' };
        let result;
        execution.store?.startAgentToolCall?.({ agentRunId, request, ...trace });
        emitToolEvent('tool.requested', { requestId: request.requestId, capability: request.capability, reason: request.reason });
        if (!capability) result = toolError(request, 'CAPABILITY_NOT_VISIBLE', `当前运行未授权工具：${String(tool || '').slice(0, 120)}`, false);
        else if (toolCalls >= runtimeLimits.maxToolCalls) result = toolError(request, 'AGENT_BUDGET_EXCEEDED', '已达到工具调用预算', false);
        else if (activeToolCalls >= runtimeLimits.maxParallelToolCalls) result = toolError(request, 'AGENT_BUDGET_EXCEEDED', '已达到并行工具调用上限', false);
        else {
          toolCalls += 1;
          activeToolCalls += 1;
          try {
            result = await executeConversationTool(request, { registry: execution.registry, catalog,
              context: { ...toolContext, ...trace, store: execution.store, signal: runtime.signal, agentRunId,
                agentToolCallId: `${agentRunId}:${String(callId || request.requestId)}`, idempotencyKey: toolCallFingerprint(request),
                timeoutMs: Math.max(1, Number(budget.timeoutMs) || 180000) },
              resolveArguments: execution.resolveArguments, cacheLookup: execution.cacheLookup,
              onEvent: (type, payload) => emitToolEvent(type, { requestId: request.requestId, capability, ...payload }) });
            result = await execution.sanitizeToolResult?.(result, request, { agentRunId }) ?? result;
            result = compactToolResult(result, Math.min(runtimeLimits.maxToolResultChars, Math.max(256, runtimeLimits.maxTotalToolResultChars - totalToolResultChars)));
            totalToolResultChars += JSON.stringify(result).length;
          } catch (error) {
            result = toolError(request, error.code || 'TOOL_EXECUTION_FAILED', error.message || '工具执行失败', Boolean(error.retryable));
          } finally { activeToolCalls -= 1; }
        }
        execution.store?.finishAgentToolCall?.({ agentRunId, request, result });
        emitToolEvent(result?.status === 'ok' ? 'tool.completed' : 'tool.failed', { requestId: request.requestId,
          capability: request.capability, status: result?.status || 'error', error: result?.error });
        return result;
      };
      const persist = typeof execution.store?.startAgentRun === 'function';
      if (persist) {
        execution.store.startAgentRun({ id: agentRunId, entryPoint, skillId, batchId: toolContext.batchId, candidateId: toolContext.candidateId,
          provider: execution.runtimeAdapter.id, allowedCapabilities: catalog.map((tool) => tool.capability), generationSnapshotId: prepared.snapshotId, ...trace });
        execution.store.appendAgentRunEvent?.(agentRunId, { type: 'run.started', entryPoint, skillId, runtimeId: execution.runtimeAdapter.id });
        execution.onRunCreated?.(agentRunId);
      }
      try {
        let finalOutput = null;
        const instruction = (execution.messages || []).filter((item) => ['system', 'developer'].includes(item.role)).map((item) => String(item.content || '')).join('\n\n');
        const userInput = (execution.messages || []).filter((item) => item.role === 'user').map((item) => String(item.content || '')).join('\n\n');
        for await (const event of execution.runtimeAdapter.run({ runId: agentRunId, runtimeProfileId: execution.runtimeProfileId || 'codex-chatgpt-plan',
          workflowRunId: trace.workflowRunId, stageId: trace.stageId, instruction, input: userInput || request.input || '', outputSchema: definition.outputSchema || null,
          tools: catalog.map((tool) => ({ name: tool.capability, description: tool.description || tool.name || tool.capability, inputSchema: tool.inputSchema || { type: 'object' } })),
          executeTool, signal: runtime.signal })) {
          if (event.type === 'message.delta') {
            const normalized = { type: 'model.text', agentRunId, text: event.text };
            execution.store?.appendAgentRunEvent?.(agentRunId, normalized); execution.onInternalEvent?.(normalized);
            execution.onEvent?.(agentEvent('assistant.delta', { agentRunId, delta: event.text }));
          } else if (event.type === 'tool.requested' || event.type === 'tool.completed') {
            const normalized = { ...event, agentRunId, schemaVersion: 1 };
            execution.store?.appendAgentRunEvent?.(agentRunId, normalized);
            execution.onInternalEvent?.(normalized);
            execution.onEvent?.(agentEvent(event.type, { ...event, agentRunId }));
          } else if (event.type === 'run.completed') finalOutput = String(event.output || '');
          else if (event.type === 'run.cancelled') throw Object.assign(new Error('Codex Runtime 运行已取消'), { code: 'AGENT_ABORTED', name: 'AbortError' });
          else if (event.type === 'run.failed') throw Object.assign(new Error(event.message), { code: event.code || 'RUNTIME_FAILED' });
        }
        if (finalOutput == null) fail('RUNTIME_EMPTY_RESULT', 'Codex Runtime 未返回完成结果');
        const result = { agentRunId, type: 'final', assistantReply: finalOutput, output: { text: finalOutput }, modelSteps: 1, toolCalls };
        await gates.run('output', { ...gateContext, result }); await execution.validateFinal?.(result);
        if (persist) {
          execution.store.appendAgentRunEvent?.(agentRunId, { type: 'run.completed', runtimeId: execution.runtimeAdapter.id });
          execution.store.finishAgentRun(agentRunId, { status: 'completed', modelSteps: 1, toolCalls });
        }
        execution.onEvent?.(agentEvent('done', result));
        return result;
      } catch (error) {
        if (persist) {
          execution.store.appendAgentRunEvent?.(agentRunId, { type: error.code === 'AGENT_ABORTED' ? 'run.cancelled' : 'run.failed', error: error.message, runtimeId: execution.runtimeAdapter.id });
          execution.store.finishAgentRun(agentRunId, { status: error.code === 'AGENT_ABORTED' ? 'cancelled' : 'failed', modelSteps: 1, toolCalls, error: error.message });
        }
        throw error;
      } finally { releaseResume(); }
    }
    if (typeof execution.modelStep !== 'function') fail('INVALID_SKILL_RUN', 'agent-skill 必须提供 modelStep');
    try { return await runConversationAgent({ ...execution, entryPoint, catalog, budget, toolContext,
      checkpointing: execution.checkpointing ?? (prepared.snapshotId != null),
      modelStep: (turn) => execution.modelStep({ ...turn, state: runtime.restoredState, gateway: bindAgentGateway(prepared, catalog, turn.signal, { agentRunId: turn.agentRunId, agentStep: turn.step, workflowRunId: turn.workflowRunId || toolContext.workflowRunId, rootRunId: turn.rootRunId || toolContext.rootRunId, stageId: turn.stageId || toolContext.stageId }), generationSnapshotId: prepared.snapshotId }),
      resumeState: runtime.resumeState,
      onRunCreated: runtime.onRunCreated,
      validateFinal: async (result) => { await gates.run('output', { ...gateContext, result }); await execution.validateFinal?.(result); },
    }); } finally { releaseResume(); }
  }
  if (definition.kind === 'stage-skill') {
    if (typeof runtime.executeStage !== 'function') fail('INVALID_SKILL_RUN', 'stage-skill 必须提供 Workflow 阶段执行函数 executeStage');
    // Pipeline stages use the same persisted Run lifecycle as conversational
    // agents when a Store is available.  The stage output contract remains
    // unchanged; persistence is an implementation detail of the Harness.
    const persist = runtime.persistRun !== false && typeof runtime.store?.startAgentRun === 'function';
    const stageRunId = runtime.agentRunId || `stage-${entryPoint}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const traceContext = {
      rootRunId: toolContext.rootRunId || stageRunId,
      workflowRunId: toolContext.workflowRunId || toolContext.rootRunId || stageRunId,
      stageId: toolContext.stageId || entryPoint,
      parentRunId: toolContext.parentRunId || null,
    };
    if (persist) {
      runtime.store.startAgentRun({ id: stageRunId, entryPoint, skillId, batchId: toolContext.batchId, candidateId: toolContext.candidateId,
        provider: toolContext.provider || execution.provider, allowedCapabilities: catalog.map((tool) => tool.capability),
        generationSnapshotId: request.snapshotId || toolContext.generationSnapshotId, ...traceContext });
      runtime.store.appendAgentRunEvent?.(stageRunId, { type: 'run.started', entryPoint, skillId, stageId: traceContext.stageId });
      runtime.store.saveAgentStep?.({ agentRunId: stageRunId, step: 0, phase: 'stage_started', summary: { entryPoint, skillId } });
      runtime.store.saveAgentCheckpoint?.(stageRunId, {
        schemaVersion: 1, phase: 'stage_started', step: 0, nextStep: 0, resumable: false,
        entryPoint, skillId, generationSnapshotId: request.snapshotId || toolContext.generationSnapshotId,
        ...traceContext, input: request.input == null ? null : { type: typeof request.input, keys: Object.keys(request.input || {}).sort() },
      });
      runtime.onRunCreated?.(stageRunId);
    }
    try {
      const result = await runtime.executeStage({ skillId, entryPoint, input: request.input, definition,
        context: { ...execution, catalog, toolContext: { ...toolContext, ...traceContext, agentRunId: stageRunId } },
        budget, snapshotId: request.snapshotId, agentRunId: stageRunId, signal: runtime.signal });
      await gates.run('output', { ...gateContext, result });
      if (persist) {
        runtime.store.saveAgentStep?.({ agentRunId: stageRunId, step: 0, phase: 'stage_completed', summary: { outputType: typeof result } });
        runtime.store.appendAgentRunEvent?.(stageRunId, { type: 'run.completed', stageId: traceContext.stageId });
        runtime.store.saveAgentCheckpoint?.(stageRunId, {
          schemaVersion: 1, phase: 'stage_completed', step: 0, nextStep: 1, resumable: false,
          entryPoint, skillId, generationSnapshotId: request.snapshotId || toolContext.generationSnapshotId,
          ...traceContext, result: { type: typeof result },
        });
        runtime.store.finishAgentRun(stageRunId, { status: 'completed', modelSteps: 1, toolCalls: 0 });
      }
      releaseResume();
      return result;
    } catch (error) {
      if (persist) {
        const cancelled = error?.name === 'AbortError' || runtime.signal?.aborted;
        runtime.store.appendAgentRunEvent?.(stageRunId, { type: cancelled ? 'run.cancelled' : 'run.failed', error: error?.message || String(error), stageId: traceContext.stageId });
        runtime.store.saveAgentCheckpoint?.(stageRunId, {
          schemaVersion: 1, phase: cancelled ? 'stage_cancelled' : 'stage_failed', step: 0, nextStep: 0, resumable: true,
          entryPoint, skillId, generationSnapshotId: request.snapshotId || toolContext.generationSnapshotId,
          ...traceContext, error: error?.message || String(error), errorCode: error?.code || null,
        });
        runtime.store.finishAgentRun(stageRunId, { status: cancelled ? 'cancelled' : 'failed', modelSteps: 1, toolCalls: 0, error: error?.message || String(error) });
      }
      releaseResume();
      throw error;
    }
  }
  if (typeof runtime.gateway?.complete !== 'function') fail('INVALID_SKILL_RUN', 'prompt-skill 必须提供 LLM Gateway');
  if (!Array.isArray(execution.messages)) fail('INVALID_SKILL_RUN', 'prompt-skill 必须提供已解析的 messages');
  const result = await runtime.gateway.complete({ ...execution.modelInput, messages: execution.messages, signal: runtime.signal });
  await gates.run('output', { ...gateContext, result });
  return result;
  } finally {
    releaseResume();
  }
}
