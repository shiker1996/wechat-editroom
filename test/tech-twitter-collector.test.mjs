import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../plugins/tech-twitter/adapter.mjs';
import { sourceInputForPlugin } from '../server/features/collection/application/source-service.mjs';
import { createBuiltinCollectorRegistry } from '../server/platform/collectors/builtin-registry.mjs';

function response(value, status = 200, retryAfter = null) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (key) => key.toLowerCase() === 'retry-after' ? retryAfter : null },
    json: async () => value, text: async () => String(value),
  };
}

const tweet = {
  id: 'tweet-uuid', tweet_url: 'https://x.com/dev/status/123', tweet_text: '开发者工具发布更新',
  summary: '对开发者工作流有影响', author_name: '作者', author_handle: 'dev',
  timestamp: '2026-10-01T12:00:00.000Z', like_count: 7, comment_count: 2,
  slug: 'tweet-slug', quality_score: 9, content_type: 'tweet', keywords: ['developer tools'],
};

test('TechTwitter 一批采集覆盖 Trending、5 类 Streams、Articles、Threads，并保留内容面', async () => {
  const requested = [];
  const adapter = createAdapter({ fetchImpl: async (url) => {
    const parsed = new URL(url);
    requested.push(parsed);
    if (parsed.pathname === '/api/tweets/trending') return response({ tweets: [tweet], total: 1, hasMore: false });
    if (parsed.pathname === '/api/command/streams') {
      const category = parsed.searchParams.get('category');
      return response({ tweets: [{ ...tweet, id: `stream-${category}`, tweet_url: category === 'ai-ml' ? tweet.tweet_url : `https://x.com/dev/${category}` }], count: 1 });
    }
    if (parsed.pathname === '/api/articles') return response({ articles: [{ id: 'article-id', slug: 'long-form-ai', title: 'AI 工程实践', summary: '一篇值得细看的长文', author_name: '作者', published_at: '2026-10-01T10:00:00Z' }] });
    if (parsed.pathname === '/threads') return response('<main><a href="/threads/gemini-release"><h2>Google Preps Gemini 4 Release</h2></a></main>');
    throw new Error(`Unexpected endpoint: ${parsed.href}`);
  } });

  const result = await adapter.collect({ limit: 12 });
  assert.equal(result.status, 'ok');
  assert.equal(requested.length, 8);
  assert.deepEqual(requested.filter((url) => url.pathname === '/api/command/streams').map((url) => url.searchParams.get('category')).sort(), ['ai-ml', 'coding', 'platform', 'product', 'startups']);
  assert.equal(requested.find((url) => url.pathname === '/api/tweets/trending').searchParams.get('limit'), '12');
  assert.deepEqual(new Set(result.items.map((item) => item.raw.raw.surface)), new Set(['trending', 'streams', 'articles', 'threads']));
  assert.ok(result.items.some((item) => item.raw.raw.category === 'coding'));
  const crossListed = result.items.find((item) => item.url === tweet.tweet_url);
  assert.deepEqual(crossListed.raw.raw.surfaces, ['trending', 'streams']);
  assert.deepEqual(crossListed.raw.raw.categories, ['ai-ml']);
  assert.equal(result.items.find((item) => item.raw.raw.surface === 'articles').url, 'https://www.techtwitter.com/articles/long-form-ai');
  assert.equal(result.items.find((item) => item.raw.raw.surface === 'threads').url, 'https://www.techtwitter.com/threads/gemini-release');
  assert.equal(result.items.find((item) => item.raw.raw.surface === 'trending').discussionUrl, 'https://www.techtwitter.com/tweet/tweet-slug');
});

test('TechTwitter 单个内容面失败时保留其他采集结果并报告失败面', async () => {
  const adapter = createAdapter({ fetchImpl: async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/tweets/trending') return response({ tweets: [tweet] });
    if (path === '/api/command/streams') return response({}, 503);
    if (path === '/api/articles') return response({ articles: [] });
    return response('<a href="/threads/example">Example thread</a>');
  } });
  const result = await adapter.collect({ limit: 5 });
  assert.equal(result.status, 'ok');
  assert.ok(result.items.some((item) => item.raw.raw.surface === 'trending'));
  assert.ok(result.items.some((item) => item.raw.raw.surface === 'threads'));
  assert.equal(result.provenance.failedSurfaces.length, 5);
});

test('TechTwitter 429 保留 Retry-After，并继续尝试其他内容面而不重试失败接口', async () => {
  const callsByPath = new Map();
  const adapter = createAdapter({ fetchImpl: async (url) => {
    const path = new URL(url).pathname;
    callsByPath.set(path, (callsByPath.get(path) || 0) + 1);
    if (path === '/api/tweets/trending') return response({ error: { code: 'rate_limited', message: '慢一点', hint: '稍后重试' } }, 429, '90');
    if (path === '/api/command/streams') return response({ tweets: [] });
    if (path === '/api/articles') return response({ articles: [] });
    return response('<a href="/threads/example">Example thread</a>');
  } });
  const result = await adapter.collect({ limit: 10 });
  assert.equal(result.status, 'ok');
  assert.equal(callsByPath.get('/api/tweets/trending'), 1);
  assert.equal(result.provenance.failedSurfaces[0].message.includes('90 秒后再试'), true);
});

test('TechTwitter 来源配置归入 X，且内置插件 manifest 合法', () => {
  const normalized = sourceInputForPlugin('tech-twitter-collector', { limit: 12, timeoutMs: 45000 });
  assert.equal(normalized.sourceType, 'x');
  assert.equal(normalized.config.limit, 12);
  assert.equal(normalized.config.timeoutMs, 45000);
  assert.equal(normalized.label, 'TechTwitter 全面精选');
  const manifest = createBuiltinCollectorRegistry().getManifest('tech-twitter-collector');
  assert.ok(manifest);
  assert.deepEqual(manifest.collector.sourceTypes, ['x']);
});
