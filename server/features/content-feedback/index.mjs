// 内容反馈业务垂直入口。按 application/domain 暴露稳定能力。
export { parseWechatExport } from './domain/wechat-export-parser.mjs';
export { parseWechatExportFile } from './application/wechat-export-service.mjs';
export { buildWechatInsights, classifyWechatArticle, matchWechatPerformance } from './domain/wechat-content-insights.mjs';
export {
  matchWechatArticles,
  matchWechatArticle,
  matchWechatSocialCopy,
  normalizeWechatTitle,
} from './application/wechat-article-matching-service.mjs';
export { fetchWechatArticleContent, linkWechatArticlesContent } from './application/article-content-linking-service.mjs';
export {
  buildContentFeedbackSnapshot,
  extractArticleContentFeatures,
  toPlainArticleText,
} from './domain/wechat-content-feedback.mjs';
export { buildContentFeedbackPromptContext } from './application/wechat-content-feedback-context.mjs';
export { buildSocialContentFeedbackSnapshot } from './application/social-content-feedback-service.mjs';
export {
  applyProjectDiscoveryFeedbackToHeatRanking,
  applyProjectDiscoveryFeedbackToRanking,
  buildProjectDiscoveryFeedbackSnapshot,
} from './domain/project-discovery-feedback.mjs';
export { buildWechatStrategyRecommendations } from './domain/wechat-strategy-recommendations.mjs';
export {
  buildAdjustmentDraft,
  buildFeedbackAdjustmentMessages,
  buildFeedbackAdjustmentPatchMessages,
  confirmAdjustmentDraft,
  currentSkillFile,
  currentSkillPackageFiles,
  FEEDBACK_ADJUSTMENT_VERSION,
  listWriterSkillCatalog,
  resolveTitleSkillTarget,
  resolveWriterSkillTarget,
} from './application/feedback-adjustment-service.mjs';
export {
  buildSocialFeedbackAdjustmentDraft,
  buildSocialFeedbackAdjustmentPatchMessages,
  buildSocialFeedbackAdjustmentPlanningMessages,
  resolveSocialSkillTargets,
} from './application/social-feedback-adjustment-service.mjs';
