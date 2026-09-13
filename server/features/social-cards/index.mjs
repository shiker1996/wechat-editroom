// 图文业务垂直入口。
// 生产调用方从这里获取图文事实、门禁、故事板和交付流水线能力。
export {
  SOCIAL_CARD_STAGE_CONTRACT,
  SOCIAL_CARD_COMPOSITION_MODES,
  SOCIAL_CARD_LAYOUTS,
  acceptSoftDensityOnlyLayoutReport,
  adaptiveContentPageIndexes,
  cleanCardPlanJson,
  describeCardLayouts,
  normalizeCardComposition,
  renderStoryboardHtml,
  runAudit,
  runSocialCardPipeline,
} from './application/social-card-pipeline.mjs';
export { SOCIAL_CARD_BEAUTIFY_DELIVERY_GATE, SOCIAL_CARD_BEAUTIFY_HTML, SOCIAL_CARD_BEAUTIFY_OUTPUT, SOCIAL_CARD_BEAUTIFY_REPORT, runSocialCardBeautify, validateAiVisualScreenshotSet } from './application/social-card-beautify.mjs';
export { buildSocialCardCopyInput, buildSocialCardCopySkillPrompt, buildSocialCardCopySystemPrompt, generateSocialCardCopy, validateSocialCardCopy } from './application/social-card-copy.mjs';
export { SOCIAL_CARD_AI_VISUAL_ARTIFACTS, SOCIAL_CARD_AI_VISUAL_FAILURE_CODES, classifySocialCardAiVisualFailure, collectSocialCardAiVisualArtifacts, writeSocialCardAiVisualBaseline } from './application/social-card-ai-visual-baseline.mjs';
export { SOCIAL_CARD_AI_VISUAL_STAGE_CONTRACT, createSocialCardAiVisualStageRecorder, writeSocialCardAiVisualSkillManifest } from './application/social-card-ai-visual-pipeline.mjs';
export { AI_VISUAL_DOCUMENT_WRITE, filterAiVisualGenerationCatalog, runSocialCardAiVisualGenerationAgent } from './application/social-card-ai-visual-agent.mjs';

export { CUSTOM_CONTENT_TYPES, CUSTOM_SOURCE_LEVELS, evaluateCardGate, evaluateClassifiedCardGate, evaluateCustomCardGate, evaluateEventCardGate } from './domain/social-card-gate.mjs';
export { buildCustomFactSheet, customFactMarkdown, customSourceUrl, parseLines, parsePointLine } from './application/custom-fact-service.mjs';
export { createRepositoryCandidate } from './application/repository-candidate.mjs';
export { BUILTIN_SOCIAL_CARD_STORYBOARD_SKILLS, SOCIAL_CARD_STORYBOARD_CONTRACTS, buildSocialCardFactEnvelope, buildSocialCardStoryboardSystemPrompt, toLegacySocialCardPromptInput } from './application/storyboard-contracts.mjs';
export { SOCIAL_CONTENT_TYPES, SOCIAL_ROUTE_VERSION, contentTypeForSocialRoute, normalizeSocialContentClass, socialRouteForContentClass, socialRouteForContentType, socialStoryboardClassForContentClass, socialStoryboardSkillForContentClass } from './domain/social-routing.mjs';
export { CUSTOM_SOCIAL_AGENT_CAPABILITIES, runCustomSocialAgentTurn } from './application/agent/custom-social-adapter.mjs';
export { SocialTemplateMetricsRepository, createSocialTemplateMetricsRepository } from './application/social-template-metrics-repository.mjs';
export { SOCIAL_CARD_RENDERER_BLOCK_TYPES, SOCIAL_CARD_CHANNEL_BLOCK_TYPES, SOCIAL_CARD_TEMPLATE_PACKS, DEFAULT_SOCIAL_CARD_TEMPLATE_PACK, getSocialCardTemplatePack, listSocialCardTemplatePacks, socialCardTemplateEditorCatalog } from './rendering/social-card-template-registry.mjs';
export { createSocialCardStoryboardThemeSnapshot, getSocialCardTemplateCapabilities, resolveSocialCardStoryboardThemeState, resolveSocialCardTemplateContext, resolveSocialCardTemplate, validateSocialCardTemplateCompatibility } from './rendering/social-card-template-resolver.mjs';
export { summarizeSocialTemplateRun, summarizeSocialCardPageRoles, aggregateSocialTemplateMetrics, aggregateSocialTemplateMetricsByDimension, buildSocialTemplateCalibrationReport } from './rendering/social-card-template-metrics.mjs';
export { buildSocialCardPlanRolloutReport, getSocialCardPlanRolloutProfile, listSocialCardPlanRolloutProfiles } from './rendering/social-card-plan-rollout.mjs';
export { enrichEventAnalysis, eventGroupsForCandidate, resolveEventAnalysis } from '../research/index.mjs';
