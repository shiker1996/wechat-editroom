import { ARTICLE_LENGTH_RANGE, articleLengthStatus, articleStageOutputIssue } from './article-pipeline-contract.mjs';
import { scanPublicationRisk } from '../domain/publication-compliance.mjs';

const INTERNAL_WORKFLOW_PATTERNS = [
  ['工作台采集/处理措辞', /工作台(?:采集到的|采集|抓取|读取|生成|处理)(?:候选|摘要|结果|原文|内容)?/iu],
  ['候选或采集内部数据', /(?:候选摘要|采集摘要|候选池|候选 ID|批次 ID)/iu],
  ['项目内部工具标识', /\b(?:jianzi_[a-z0-9_]+|cap_content_url_fetch)\b/iu],
];

function internalWorkflowWarnings(article = '') {
  const text = String(article || '');
  return INTERNAL_WORKFLOW_PATTERNS.flatMap(([label, pattern]) => {
    const match = text.match(pattern);
    return match ? [{ label, matchedText: match[0] }] : [];
  });
}

// These checks are shared with the article pipeline; model review is separate.
export function auditExternalArticleLocally({ article, factBase = {}, articleLength = ARTICLE_LENGTH_RANGE }) {
  const outputIssue = articleStageOutputIssue(article, { requireArticle: true });
  const min = Number(articleLength?.min);
  const max = Number(articleLength?.max);
  if (articleLength != null && (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 50000)) {
    throw new Error('articleLength 必须包含 0–50000 范围内且 min 不大于 max 的整数');
  }
  const range = articleLength == null ? ARTICLE_LENGTH_RANGE : { min, max };
  const length = articleLengthStatus(article, range);
  const scan = scanPublicationRisk({ article, factBase });
  return { outputIssue, length, titleBlockers: scan.titleBlockers,
    internalWorkflowWarnings: internalWorkflowWarnings(article),
    scope: 'local_checks_only', requiresEvidenceReview: true };
}
