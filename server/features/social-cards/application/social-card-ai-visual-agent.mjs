import {
  AI_VISUAL_DOCUMENT_AUDIT,
  AI_VISUAL_DOCUMENT_WRITE,
  filterAiVisualGenerationCatalog,
  runAiVisualDocumentAgent,
  shouldUseAiVisualPlanningThinking,
} from '../../../platform/agent/ai-visual-document-agent.mjs';

export {
  AI_VISUAL_DOCUMENT_AUDIT,
  AI_VISUAL_DOCUMENT_WRITE,
  filterAiVisualGenerationCatalog,
  shouldUseAiVisualPlanningThinking,
};

/**
 * Social card compatibility wrapper around the shared AI visual document Agent.
 *
 * Keep this feature-level entry point stable so existing callers retain the
 * social-card-specific output contract while the protocol implementation can
 * also be reused by article cover generation.
 */
export async function runSocialCardAiVisualGenerationAgent(options = {}) {
  return runAiVisualDocumentAgent({
    ...options,
    // 两条生成路径共用同一视觉方案页序：拆分或合并要先回到故事板阶段处理。
    pageCountTolerance: 0,
    auditCapability: AI_VISUAL_DOCUMENT_AUDIT,
    // 六页社交卡通常需要多次分块写入，再完成审计与 finish；使用视觉 Agent
    // 的 40 步专用上限，避免默认 28 步在 HTML 未收尾时提前熔断。
    budget: {
      maxModelSteps: 40,
      maxToolCalls: 40,
      ...(options.budget || {}),
    },
    entryPoint: 'social-card-ai-visual-generation',
    skillId: 'social-card-ai-visual-generator',
    purpose: 'social-card-ai-visual-generation-agent',
    outputPath: 'ai-beautified.html',
    documentLabel: '社交卡',
    canvas: { width: 375, height: 667 },
  });
}
