import { buildWechatInsights, classifyWechatArticle } from '../domain/wechat-content-insights.mjs';
import { buildSocialContentFeedbackSnapshot } from './social-content-feedback-service.mjs';

function aggregateWechatTrack(items, notified) {
  const rows = items.filter((item) => Boolean(item.notified) === notified);
  return {
    count: rows.length,
    reads: rows.reduce((sum, item) => sum + Number(item.reads || 0), 0),
    shares: rows.reduce((sum, item) => sum + Number(item.shares || 0), 0),
    follows: rows.reduce((sum, item) => sum + Number(item.follows_after_read || 0), 0),
    delivery: rows.reduce((sum, item) => sum + Number(item.delivery || 0), 0),
  };
}

function weekKey(dateValue) {
  const date = new Date(`${String(dateValue || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - mondayIndex);
  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const firstMondayIndex = (yearStart.getUTCDay() + 6) % 7;
  const firstMonday = new Date(yearStart);
  firstMonday.setUTCDate(1 - firstMondayIndex);
  const week = Math.max(0, Math.floor((monday - firstMonday) / 604800000));
  return `${monday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function buildWechatTrack(articles) {
  const weeklyMap = new Map();
  for (const item of articles) {
    const week = weekKey(item.published_date);
    if (!week) continue;
    const current = weeklyMap.get(week) || { week, articles: 0, reads: 0, shares: 0, follows: 0 };
    current.articles += 1;
    current.reads += Number(item.reads || 0);
    current.shares += Number(item.shares || 0);
    current.follows += Number(item.follows_after_read || 0);
    weeklyMap.set(week, current);
  }
  const topArticles = [...articles].sort((left, right) => Number(right.reads || 0) - Number(left.reads || 0)).slice(0, 8);
  return {
    count: articles.length,
    articles,
    top_articles: topArticles,
    weekly: [...weeklyMap.values()].sort((left, right) => right.week.localeCompare(left.week)).slice(0, 12),
    notified: aggregateWechatTrack(articles, true),
    unnotified: aggregateWechatTrack(articles, false),
    insights: buildWechatInsights(articles),
  };
}

export function enrichWechatReview(review, matches = []) {
  const articles = (review.articles || []).map(classifyWechatArticle);
  const kindByMetric = new Map();
  for (const match of matches || []) {
    if (!['confirmed', 'auto_confirmed', 'rejected'].includes(match.status) || !match.metric_id) continue;
    const metricId = Number(match.metric_id);
    if (match.content_type === 'social' || match.artifact_type === '图文发布文案') kindByMetric.set(metricId, 'social');
    else if (match.content_type === 'article' || match.artifact_type) kindByMetric.set(metricId, 'article');
  }
  const classifiedArticles = articles.filter((item) => kindByMetric.has(Number(item.id)));
  const articleTrack = classifiedArticles.filter((item) => kindByMetric.get(Number(item.id)) === 'article');
  const socialTrack = articles.filter((item) => kindByMetric.get(Number(item.id)) === 'social');
  return {
    ...review,
    articles,
    top_articles: [...classifiedArticles].sort((left, right) => Number(right.reads || 0) - Number(left.reads || 0)).slice(0, 8),
    insights: buildWechatInsights(classifiedArticles),
    review_tracks: { article: buildWechatTrack(articleTrack), social: buildWechatTrack(socialTrack) },
  };
}

export function buildSocialFeedbackTrack(store) {
  const matches = store.listWechatArticleMetricMatches({ limit: 1000 }).filter((item) => ['confirmed', 'auto_confirmed'].includes(item?.status)
    && (item?.content_type === 'social' || item?.artifact_type === '图文发布文案'));
  const track = enrichWechatReview(store.getWechatReview(), matches).review_tracks?.social || {};
  return { ...track, content_feedback: buildSocialContentFeedbackSnapshot(matches) };
}
