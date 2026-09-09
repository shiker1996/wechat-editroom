// 新工作区的参考采集源。来源配置取自生产环境中长期使用过的公开来源，
// 只作为可编辑的示例写入，默认暂停，避免首次启动就产生外部请求。
export const INITIAL_COLLECTION_SOURCES = Object.freeze([
  { pluginId: 'reddit-collector', pluginVersion: '1.0.0', sourceType: 'reddit', sourceKey: 'reddit:r/technology', label: '示例 · Reddit 科技', config: { subreddit: 'technology', sort: 'hot', limit: 15 } },
  { pluginId: 'reddit-collector', pluginVersion: '1.0.0', sourceType: 'reddit', sourceKey: 'reddit:r/programming', label: '示例 · Reddit 编程', config: { subreddit: 'programming', sort: 'hot', limit: 15 } },
  { pluginId: 'reddit-collector', pluginVersion: '1.0.0', sourceType: 'reddit', sourceKey: 'reddit:r/artificial', label: '示例 · Reddit AI', config: { subreddit: 'artificial', sort: 'hot', limit: 15 } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'rsshub', sourceKey: 'rsshub:/techcrunch/news', label: '示例 · TechCrunch', config: { route: '/techcrunch/news?limit=30' } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'rsshub', sourceKey: 'rsshub:/huxiu/article', label: '示例 · 虎嗅', config: { route: '/huxiu/article?limit=30' } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'rsshub', sourceKey: 'rsshub:/solidot', label: '示例 · Solidot', config: { route: '/solidot?limit=30' } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'rsshub', sourceKey: 'rsshub:/readhub/daily', label: '示例 · Readhub 日报', config: { route: '/readhub/daily?limit=30' } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'rsshub', sourceKey: 'rsshub:/36kr/hot-list', label: '示例 · 36 氪热榜', config: { route: '/36kr/hot-list?limit=30' } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'twitter', sourceKey: 'twitter:/twitter/user/OpenAI', label: '示例 · X / OpenAI', config: { route: '/twitter/user/OpenAI?limit=30' } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'twitter', sourceKey: 'twitter:/twitter/user/Alibaba_Qwen', label: '示例 · X / Qwen', config: { route: '/twitter/user/Alibaba_Qwen?limit=30' } },
  { pluginId: 'rsshub-collector', pluginVersion: '1.0.0', sourceType: 'github', sourceKey: 'github:trending:daily', label: '示例 · GitHub Trending（日榜）', config: { route: '/github/trending/daily/any?limit=30' } },
  { pluginId: 'github-discovery-collector', pluginVersion: '1.0.0', sourceType: 'github', sourceKey: 'github:search', label: '示例 · GitHub Search（近 7 天）', config: { createdWithinDays: 7, minStars: 1000, limit: 30 } },
  { pluginId: 'feed-collector', pluginVersion: '1.0.0', sourceType: 'direct', sourceKey: 'direct:https://wechat2rss.xlab.app/feed/ede30346413ea70dbef5d485ea5cbb95cca446e7.xml', label: '示例 · 新智元', config: { url: 'https://wechat2rss.xlab.app/feed/ede30346413ea70dbef5d485ea5cbb95cca446e7.xml' } },
  { pluginId: 'feed-collector', pluginVersion: '1.0.0', sourceType: 'direct', sourceKey: 'direct:https://wechat2rss.xlab.app/feed/7131b577c61365cb47e81000738c10d872685908.xml', label: '示例 · 量子位', config: { url: 'https://wechat2rss.xlab.app/feed/7131b577c61365cb47e81000738c10d872685908.xml' } },
  { pluginId: 'feed-collector', pluginVersion: '1.0.0', sourceType: 'direct', sourceKey: 'direct:https://wechat2rss.xlab.app/feed/51e92aad2728acdd1fda7314be32b16639353001.xml', label: '示例 · 机器之心', config: { url: 'https://wechat2rss.xlab.app/feed/51e92aad2728acdd1fda7314be32b16639353001.xml' } },
  { pluginId: 'feed-collector', pluginVersion: '1.0.0', sourceType: 'direct', sourceKey: 'direct:https://tldr.tech/api/rss/ai', label: '示例 · TLDR AI', config: { url: 'https://tldr.tech/api/rss/ai' } },
]);

const MARKER_TYPE = 'system';
const MARKER_ID = 'initial-collection-sources';
const MARKER_VERSION = 1;

export function seedInitialCollectionSources(store) {
  const repository = store?.repositories?.collectionSources;
  const settings = store?.repositories?.extensionSettings;
  if (!repository || !settings) throw new TypeError('初始化采集源需要有效的 Store');

  const marker = settings.get(MARKER_TYPE, MARKER_ID);
  if (marker) return { seeded: false, reason: 'already-initialized', count: repository.list().length };

  // 迁移过来的旧库、已有用户配置的库和生产库都不接受示例覆盖。
  const existing = Number(store.db.prepare('SELECT COUNT(*) AS count FROM collection_sources').get()?.count || 0);
  if (existing > 0) {
    settings.save({ extensionType: MARKER_TYPE, extensionId: MARKER_ID, value: { version: MARKER_VERSION, status: 'skipped-existing', count: existing }, configured: true, status: 'ready' });
    return { seeded: false, reason: 'existing-sources', count: existing };
  }

  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const source of INITIAL_COLLECTION_SOURCES) repository.upsert({ ...source, enabled: false, managed: false, origin: 'initial-sample' });
    settings.save({ extensionType: MARKER_TYPE, extensionId: MARKER_ID, value: { version: MARKER_VERSION, status: 'seeded', count: INITIAL_COLLECTION_SOURCES.length }, configured: true, status: 'ready' });
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { seeded: true, count: INITIAL_COLLECTION_SOURCES.length };
}
