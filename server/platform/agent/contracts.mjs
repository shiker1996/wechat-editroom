// Shared contract constants for production conversation agents and their phase-0 baseline tests.
export const CONVERSATION_AGENT_SCHEMA_VERSION = 1;

export const CONVERSATION_AGENT_ENTRY_POINTS = Object.freeze([
  'editorial',
  'independent-writing',
  'custom-social',
]);

export const CONVERSATION_AGENT_ERROR_CODES = Object.freeze([
  'INVALID_SKILL_RUN',
  'SKILL_ENTRY_NOT_ALLOWED',
  'SKILL_CAPABILITY_MISSING',
  'SKILL_GATE_UNAVAILABLE',
  'SKILL_GATE_FAILED',
  'RESUME_NOT_AVAILABLE',
  'RESUME_CONFLICT',
  'RUN_STATE_RESTORE_FAILED',
  'SKILL_SNAPSHOT_UNAVAILABLE',
  'SKILL_SNAPSHOT_MISMATCH',
  'INVALID_AGENT_ENVELOPE',
  'CAPABILITY_NOT_VISIBLE',
  'INVALID_TOOL_ARGUMENTS',
  'RESOURCE_NOT_ALLOWED',
  'TOOL_DEPENDENCY_MISSING',
  'TOOL_PERMISSION_DENIED',
  'TOOL_TIMEOUT',
  'TOOL_CONFIRMATION_REQUIRED',
  'TOOL_EXECUTION_FAILED',
  'TOOL_OUTPUT_INVALID',
  'AGENT_BUDGET_EXCEEDED',
  'AGENT_ABORTED',
]);

export const CONVERSATION_AGENT_STREAM_EVENTS = Object.freeze([
  'assistant.delta',
  'assistant.thinking',
  'tool.requested',
  'tool.running',
  'tool.completed',
  'tool.failed',
  'tool.needs_confirmation',
  'agent.limit',
  'done',
  'error',
]);

export const CONVERSATION_AGENT_BUDGET_DEFAULTS = Object.freeze({
  maxModelSteps: 6,
  maxToolCalls: 10,
  maxParallelToolCalls: 3,
  maxToolResultChars: 12000,
  maxTotalToolResultChars: 64000,
  maxHistoryChars: 120000,
  timeoutMs: 180000,
  maxDuplicateCalls: 1,
});

export const CONVERSATION_AGENT_BUDGET_LIMITS = Object.freeze({
  // 视觉 Agent 需要一次完整读取、分块写入和 finish；24 步作为异常循环上限，
  // 对当前 6–8 页的视觉文档范围足够。
  maxModelSteps: 24,
  maxToolCalls: 24,
  maxParallelToolCalls: 4,
  // 文件读取类 Agent 需要把多个候选资料文件交给模型；16KB 会把
  // card-plan.json 截成前缀，导致事实文件后半段无法进入模型上下文。
  maxToolResultChars: 80000,
  maxTotalToolResultChars: 320000,
  maxHistoryChars: 300000,
  timeoutMs: 300000,
  maxDuplicateCalls: 1,
});
