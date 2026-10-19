import { collectTechTwitter, testTechTwitter } from './collector.mjs';

function standardItem(item) {
  return {
    externalId: item.id || item.externalId || '',
    title: item.title,
    url: item.url,
    discussionUrl: item.redditUrl || item.discussionUrl || null,
    summary: item.summary || item.description || '',
    author: item.author || '',
    publishedAt: item.publishedAt || item.timestamp || null,
    metrics: {
      ...(item.metrics || {}),
      ...(item.scoreText ? { scoreText: item.scoreText } : {}),
      ...(item.stars !== undefined ? { stars: item.stars } : {}),
    },
    raw: item,
  };
}

export function createAdapter({ fetchImpl = fetch, onProgress = () => {} } = {}) {
  return {
    test: (source) => testTechTwitter(source, { fetchImpl }),
    collect: async (source) => {
      onProgress('正在读取 TechTwitter Trending、Streams 和 Articles');
      const items = await collectTechTwitter(source, { fetchImpl, onProgress });
      return {
        status: 'ok',
        items: items.map(standardItem),
        warnings: [],
        provenance: { provider: 'TechTwitter', fetchMethod: 'public-trending-streams-articles', failedSurfaces: items.collectionInfo?.failedSurfaces || [] },
      };
    },
  };
}
