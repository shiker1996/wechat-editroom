import { articleLengthStatus, articleStageOutputIssue } from './article-pipeline-contract.mjs';
import { scanPublicationRisk } from '../domain/publication-compliance.mjs';

// These checks are shared with the article pipeline; model review is separate.
export function auditExternalArticleLocally({ article, factBase = {} }) {
  const outputIssue = articleStageOutputIssue(article, { requireArticle: true });
  const length = articleLengthStatus(article);
  const scan = scanPublicationRisk({ article, factBase });
  return { outputIssue, length, titleBlockers: scan.titleBlockers,
    scope: 'local_checks_only', requiresEvidenceReview: true };
}
