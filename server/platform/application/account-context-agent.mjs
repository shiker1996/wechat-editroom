import { buildConversationToolCatalog, buildNativeToolDefinitions, providerSupportsNativeTools, providerSupportsToolCallStreaming } from '../agent/tool-catalog.mjs';
import { buildFormUpdateTool, createFormUpdateHandler, normalizeFormState } from '../agent/form-update-tool.mjs';
import { CONVERSATION_FINISH_CAPABILITY, buildConversationFinishTool, createConversationFinishHandler } from '../agent/conversation-finish-tool.mjs';
import { runSkill } from '../agent/harness.mjs';
import { selectionPrompt } from '../skills/skill-prompt.mjs';
import { formatAccountContext } from '../../shared/domain/account-context-model.mjs';
import { getAccountContext } from './account-context-service.mjs';

export const ACCOUNT_CONTEXT_AGENT_SKILL = 'account-context-assistant';
const FORM_UPDATE_CAPABILITY = 'cap_agent_form_update';

const FORM_FIELDS = Object.freeze({
  readerProfile: { kind: 'text', description: '核心读者与他们关心的问题。' },
  contentPillars: { kind: 'list', description: '长期内容方向，每条一个方向。' },
  editorialCategories: { kind: 'list', description: '选题分类，每项格式为“分类名 | 分类说明”。' },
  voiceGuardrails: { kind: 'list', description: '表达原则和明确禁区。' },
  followReason: { kind: 'text', description: '读者关注后可以持续获得什么。' },
  conversionBridge: { kind: 'text', description: '文章可自然承接的内容、工具或服务。' },
  scoring: {
    kind: 'text',
    description: '评分配置 JSON 字符串。只更新 categoryPreference 和 marketScopeCategoryPreference，保留其余评分参数。',
    normalize: (value) => {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
        return JSON.stringify(parsed);
      } catch { return undefined; }
    },
    validate: (value) => {
      try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed); } catch { return false; }
    },
    validationMessage: () => '评分配置必须是有效的 JSON 对象',
  },
  currentStage: { kind: 'text', description: '内部流程阶段；只用于续接对话。' },
});

const APPLICATION_TOOLS = Object.freeze([
  buildFormUpdateTool({ capability: FORM_UPDATE_CAPABILITY, name: '更新账号画像表单', description: '只更新本轮已确认的当前阶段字段。单值字段用 replace/set，多值字段用 replace，不要覆盖其他阶段内容。', fields: FORM_FIELDS }),
  buildConversationFinishTool({ name: '结束本轮画像对话', description: '提交给创作者的简短回复；本轮表单变化必须先使用更新账号画像表单工具写入。' }),
]);

function currentStageFor(state = {}) {
  if (!String(state.readerProfile || '').trim()) return 'readerProfile';
  if (!Array.isArray(state.contentPillars) || !state.contentPillars.length) return 'contentPillars';
  if (!Array.isArray(state.editorialCategories) || !state.editorialCategories.length) return 'editorialCategories';
  if (!Array.isArray(state.voiceGuardrails) || !state.voiceGuardrails.length) return 'voiceGuardrails';
  if (!String(state.followReason || '').trim() || !String(state.conversionBridge || '').trim()) return 'followReason';
  let scoring = {};
  try { scoring = JSON.parse(String(state.scoring || '{}')); } catch { /* 评分字段由表单校验 */ }
  if (!Object.keys(scoring.categoryPreference || {}).length) return 'scoring';
  return 'complete';
}

function formStateFromDraft(draft = {}) {
  const categories = Array.isArray(draft.editorialCategories)
    ? draft.editorialCategories.map((item) => typeof item === 'string' ? item : `${item.name || ''} | ${item.description || ''}`).filter(Boolean)
    : [];
  return {
    readerProfile: String(draft.readerProfile || ''),
    contentPillars: Array.isArray(draft.contentPillars) ? draft.contentPillars : [],
    editorialCategories: categories,
    voiceGuardrails: Array.isArray(draft.voiceGuardrails) ? draft.voiceGuardrails : [],
    followReason: String(draft.followReason || ''),
    conversionBridge: String(draft.conversionBridge || ''),
    scoring: typeof draft.scoring === 'string' ? draft.scoring : JSON.stringify(draft.scoring || {}),
  };
}

function profileDraftFromState(state = {}) {
  const categories = (Array.isArray(state.editorialCategories) ? state.editorialCategories : []).map((line) => {
    const separator = String(line).indexOf('|');
    return { name: (separator < 0 ? line : line.slice(0, separator)).trim(), description: (separator < 0 ? '' : line.slice(separator + 1)).trim() };
  }).filter((item) => item.name && item.description);
  let scoring = {};
  try { scoring = JSON.parse(String(state.scoring || '{}')); } catch { /* 保留空对象供用户修正 */ }
  return {
    readerProfile: state.readerProfile || '', contentPillars: state.contentPillars || [], editorialCategories: categories,
    voiceGuardrails: state.voiceGuardrails || [], followReason: state.followReason || '', conversionBridge: state.conversionBridge || '', scoring,
  };
}

export async function runAccountContextAgentTurn({ gateway, store, registry, provider, workspaceRoot, name, description, draft = {}, history = [], answer = '', onEvent = () => {}, signal = null }) {
  const normalizedHistory = Array.isArray(history) ? history.slice(-20).filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string') : [];
  const normalizedAnswer = String(answer || '').trim();
  if (!normalizedAnswer) throw new Error('请先输入你希望补充或调整的画像信息');
  const baseState = normalizeFormState(formStateFromDraft(draft), FORM_FIELDS);
  const originalState = JSON.stringify(baseState);
  const formState = { value: { ...baseState, currentStage: currentStageFor(baseState) } };
  const turnStage = formState.value.currentStage;
  const setState = (next) => { formState.value = { ...next, currentStage: currentStageFor(next) }; };
  const baseFormUpdateHandler = createFormUpdateHandler({ fields: FORM_FIELDS, getState: () => formState.value, setState });
  const stageFields = {
    readerProfile: ['readerProfile'],
    contentPillars: ['contentPillars'],
    editorialCategories: ['editorialCategories'],
    voiceGuardrails: ['voiceGuardrails'],
    followReason: ['followReason', 'conversionBridge'],
    scoring: ['scoring'],
    complete: ['readerProfile', 'contentPillars', 'editorialCategories', 'voiceGuardrails', 'followReason', 'conversionBridge', 'scoring'],
  };
  const formUpdateHandler = async (input = {}) => {
    const allowedFields = new Set(stageFields[turnStage] || []);
    const operations = Array.isArray(input.operations) ? input.operations : [];
    const rejected = operations.filter((operation) => !allowedFields.has(String(operation?.field || '').trim()));
    if (rejected.length) return { status: 'error', error: { code: 'INVALID_STAGE', message: `本轮阶段为 ${turnStage}，只能更新：${[...allowedFields].join('、') || '无'}。请先完成当前阶段。` } };
    const safeOperations = operations.map((operation) => {
      if (operation?.field !== 'scoring' || !['replace', 'set'].includes(operation.op || operation.operation)) return operation;
      let current = {};
      let incoming = {};
      try { current = JSON.parse(formState.value.scoring || '{}'); } catch { /* 保留已知配置之外的评分偏好 */ }
      try {
        const raw = Object.prototype.hasOwnProperty.call(operation, 'values') ? operation.values : operation.value;
        incoming = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch { /* 由表单工具返回标准 JSON 校验错误 */ }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return operation;
      const merged = { ...current };
      for (const field of ['categoryPreference', 'marketScopeCategoryPreference']) {
        if (Object.prototype.hasOwnProperty.call(incoming, field)) merged[field] = incoming[field];
      }
      const normalized = { ...operation, value: JSON.stringify(merged) };
      delete normalized.values;
      return normalized;
    });
    return baseFormUpdateHandler({ ...input, operations: safeOperations });
  };
  const finishHandler = createConversationFinishHandler();
  const allowedCapabilities = [FORM_UPDATE_CAPABILITY, CONVERSATION_FINISH_CAPABILITY];
  const catalog = buildConversationToolCatalog({ registry, entryCapabilities: [], allowedCapabilities, applicationTools: APPLICATION_TOOLS });
  if (!providerSupportsNativeTools(gateway, provider)) throw new Error('当前模型未启用原生工具调用，账号画像助手需要支持 function tools 的模型');
  const nativeToolDefinitions = buildNativeToolDefinitions(catalog);
  const providerName = provider || gateway.config.defaultProvider;
  const providerConfig = gateway.config.providers[providerName];
  const skillPrompt = selectionPrompt({ workspaceRoot, skillName: ACCOUNT_CONTEXT_AGENT_SKILL }).prompt;
  const systemPrompt = skillPrompt.replaceAll('{{ACCOUNT_CONTEXT}}', formatAccountContext(getAccountContext({ workspaceRoot })));
  const currentStage = formState.value.currentStage;
  const messages = [
    { role: 'system', protected: true, content: systemPrompt },
    { role: 'user', protected: true, content: JSON.stringify({ accountName: String(name || '').trim(), accountDescription: String(description || '').trim(), currentStage, currentDraft: profileDraftFromState(formState.value) }) },
    ...normalizedHistory,
    ...(normalizedHistory.at(-1)?.role === 'user' && normalizedHistory.at(-1)?.content === normalizedAnswer ? [] : [{ role: 'user', content: normalizedAnswer }]),
    { role: 'system', protected: true, content: `本轮唯一允许优先处理的阶段是 ${currentStage}。表单工具当前状态：${JSON.stringify(formState.value)}。当前流程阶段应按现有表单空缺计算；写入一个阶段后，更新工具会返回新状态。不得跳过前置阶段批量填写后续偏好。` },
  ];
  let lastResult = null;
  const run = await runSkill({
    gateway, entryPoint: 'account-context', registry, catalog, messages, store,
    definition: { id: ACCOUNT_CONTEXT_AGENT_SKILL, kind: 'agent-skill', entryPoints: ['account-context'], requiredCapabilities: allowedCapabilities, budget: { maxModelSteps: 4, maxToolCalls: 3, maxParallelToolCalls: 1, timeoutMs: 60000, maxToolResultChars: 3000, maxTotalToolResultChars: 6000 } },
    signal,
    toolContext: {
      skillId: ACCOUNT_CONTEXT_AGENT_SKILL,
      provider: providerName,
      workspaceRoot,
      allowedCapabilities: catalog.map((item) => item.capability),
      toolHandlers: { [FORM_UPDATE_CAPABILITY]: formUpdateHandler, [CONVERSATION_FINISH_CAPABILITY]: finishHandler },
    },
    onEvent,
    modelStep: async ({ gateway: runGateway, messages: modelMessages, signal: modelSignal, emit }) => {
      const input = { provider: providerName, purpose: 'account-context-assist', jsonMode: false, nativeTools: true, tools: nativeToolDefinitions, maxOutputTokens: Math.min(3000, providerConfig?.maxOutputTokens || 3000), messages: modelMessages, signal: modelSignal };
      lastResult = providerSupportsToolCallStreaming(gateway, providerName) && typeof gateway.streamComplete === 'function'
        ? await runGateway.streamComplete(input, () => {}, (text) => emit('thinking', { text }))
        : await runGateway.complete(input);
      return { nativeTools: true, content: lastResult.content || '', toolCalls: lastResult.toolCalls };
    },
  });
  if (run.type !== 'final') return { reply: '我已保留当前草案，请继续回答上一个问题。', draft: profileDraftFromState(formState.value), stage: formState.value.currentStage, updated: originalState !== JSON.stringify(normalizeFormState(formState.value, FORM_FIELDS)), limited: true, agentRunId: run.agentRunId, toolCalls: run.toolCalls };
  if (!String(run.assistantReply || '').trim()) throw new Error('账号画像助手未返回有效回复');
  return { reply: String(run.assistantReply).trim(), draft: profileDraftFromState(formState.value), stage: formState.value.currentStage, updated: originalState !== JSON.stringify(normalizeFormState(formState.value, FORM_FIELDS)), agentRunId: run.agentRunId, toolCalls: run.toolCalls, usage: lastResult?.usage, model: lastResult?.model };
}
