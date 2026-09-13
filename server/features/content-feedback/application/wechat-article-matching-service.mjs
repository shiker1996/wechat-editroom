import { matchWechatArticle, matchWechatSocialCopy } from '../domain/wechat-article-matching.mjs';

export { matchWechatArticle, matchWechatSocialCopy, normalizeWechatTitle } from '../domain/wechat-article-matching.mjs';

function combinePendingResults(articleResult, socialResult) {
  const candidates = [...(articleResult.candidates || []), ...(socialResult.candidates || [])]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .filter((item, index, all) => all.findIndex((candidate) => Number(candidate.id) === Number(item.id)) === index)
    .slice(0, 5);
  return candidates.length
    ? { status: 'pending', articleArtifactId: null, method: 'mixed_candidates', confidence: candidates[0].score >= 0.8 ? 'medium' : 'low', candidates }
    : articleResult;
}

export function matchWechatArticles(store, { force = false } = {}) {
  const metrics = store.listWechatArticleMetrics();
  const artifacts = store.listArticleArtifacts({ limit: 1000 });
  let matched = 0; let pending = 0; let unmatched = 0; let preserved = 0;
  for (const metric of metrics) {
    const existing = store.getWechatArticleMetricMatchByMetric(metric.id);
    if (existing && ['confirmed', 'rejected'].includes(existing.status) && !force) { preserved += 1; continue; }
    const articleResult = matchWechatArticle(metric, artifacts);
    const socialResult = matchWechatSocialCopy(metric, artifacts);
    const result = articleResult.status === 'auto_confirmed'
      ? articleResult
      : socialResult.status === 'auto_confirmed'
        ? socialResult
        : articleResult.status === 'pending' && socialResult.status === 'pending'
          ? combinePendingResults(articleResult, socialResult)
          : articleResult.status === 'pending' ? articleResult : socialResult;
    const normalizedResult = result.status === 'unmatched'
      ? { ...result, contentType: 'unknown', method: 'unmatched' }
      : result;
    store.upsertWechatArticleMetricMatch({ metricId: metric.id, ...normalizedResult, force });
    if (normalizedResult.status === 'auto_confirmed') matched += 1;
    else if (normalizedResult.status === 'pending') pending += 1;
    else unmatched += 1;
  }
  return { metrics: metrics.length, matched, pending, unmatched, preserved };
}
