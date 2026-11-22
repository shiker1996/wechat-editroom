import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRecentItems, parseFeed } from '../plugins/feed/collector.mjs';
import { fetchWithBoundedRetry } from '../plugins/shared/source-http.mjs';

test('Feed 插件独立解析 RSS 与 CDATA', () => {
  const xml = '<rss><channel><item><guid>x1</guid><title><![CDATA[AI &amp; 开源]]></title><link>https://example.com/a</link><pubDate>Sun, 19 Jul 2026 08:00:00 GMT</pubDate></item></channel></rss>';
  const items = parseFeed(xml, 'https://example.com/feed.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'AI & 开源');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].publishedAt, '2026-07-19T08:00:00.000Z');
});

test('Feed 插件独立解析 Atom link href', () => {
  const xml = '<feed><entry><id>a1</id><title>更新</title><link href="https://example.com/b"/><updated>2026-07-19T08:00:00Z</updated></entry></feed>';
  assert.equal(parseFeed(xml, 'https://example.com/atom.xml')[0].url, 'https://example.com/b');
});

test('Feed 文本仅解码一层 XML 实体并移除 HTML 标签边界', () => {
  const xml = '<rss><channel><item><title>安全测试</title><link>https://example.com/security</link><description>&lt;script&gt;alert(1)&lt;/script&gt; &amp;lt;img&amp;gt;</description></item></channel></rss>';
  const [item] = parseFeed(xml, 'https://example.com/feed.xml');
  assert.equal(item.summary, 'scriptalert(1)/script &lt;img&gt;');
  assert.doesNotMatch(item.summary, /[<>]/);
});

test('Feed 逐条过滤无链接条目并按规范链接去重', () => {
  const xml = '<rss><channel><item><guid>x1</guid><title>更新</title><link>https://example.com/a?utm_source=mail#top</link></item><item><title>重复</title><link>https://example.com/a</link></item><item><title>缺链接</title></item></channel></rss>';
  const items = parseFeed(xml, 'https://example.com/feed.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.com/a');
});

test('Feed 区分空 Feed 与无法识别的文档', () => {
  assert.deepEqual(parseFeed('<rss><channel><title>空 feed</title></channel></rss>', 'https://example.com/feed.xml'), []);
  assert.throws(() => parseFeed('<html>not a feed</html>', 'https://example.com/feed.xml'), /PARSE_ERROR/);
});

test('来源 HTTP 请求对 5xx 最多重试一次，并将限流错误分类', async () => {
  let calls = 0;
  const result = await fetchWithBoundedRetry('https://example.com/feed', {}, { timeoutMs: 1000, fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? new Response('', { status: 503 }) : new Response('<rss/>', { status: 200 });
  } });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(fetchWithBoundedRetry('https://example.com/feed', {}, { timeoutMs: 1000, fetchImpl: async () => {
    calls += 1;
    return new Response('', { status: 429, headers: { 'retry-after': '60' } });
  } }), (error) => error.code === 'RATE_LIMITED');
  assert.equal(calls, 1);
});

test('来源 HTTP 请求对带平台错误码的网络失败重试并分类超时', async () => {
  let calls = 0;
  const response = await fetchWithBoundedRetry('https://example.com/feed', {}, { timeoutMs: 1000, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });
    return new Response('<rss/>', { status: 200 });
  } });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  await assert.rejects(fetchWithBoundedRetry('https://example.com/feed', {}, { timeoutMs: 1000, fetchImpl: async () => {
    throw Object.assign(new Error('deadline'), { name: 'TimeoutError' });
  } }), (error) => error.code === 'TIMEOUT');
});

test('Feed 插件独立过滤时间窗口', () => {
  const items = [{ title: '新', publishedAt: '2026-07-19T08:00:00Z' }, { title: '旧', publishedAt: '2026-07-01T08:00:00Z' }, { title: '无日期', publishedAt: null }];
  const result = filterRecentItems(items, { maxAgeHours: 168, allowUndated: true }, Date.parse('2026-07-19T10:00:00Z'));
  assert.deepEqual(result.kept.map((item) => item.title), ['新', '无日期']);
  assert.deepEqual(result.stale.map((item) => item.title), ['旧']);
});
