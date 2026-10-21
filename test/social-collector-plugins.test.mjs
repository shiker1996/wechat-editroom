import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter as createWechatAdapter } from '../plugins/wechat-account/adapter.mjs';
import { createAdapter as createXAdapter } from '../plugins/x-search/adapter.mjs';

function response(value, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => value }; }
function recentTimestamp() { return new Date(Date.now() - 60 * 60 * 1000).toISOString(); }

test('公众号账号采集器调用 post_history 并标准化文章', async () => {
  let request;
  const adapter = createWechatAdapter({ configuration: { endpoint: 'https://provider.example/post_history', apiKey: 'secret' }, fetchImpl: async (url, options) => { request = { url, options }; return response({ code: 0, nickname: '科技号', ghid: 'gh_demo', data: [{ sn: 'abc', title: '公众号文章', url: 'https://mp.weixin.qq.com/s/abc', digest: '摘要', post_time_str: recentTimestamp(), read: 123 }] }); } });
  const result = await adapter.collect({ identifier: 'gh_demo', identifierType: 'ghid', limit: 10, maxAgeHours: 168 });
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].title, '公众号文章');
  assert.equal(result.items[0].metrics.read, 123);
  assert.match(request.options.body, /"ghid":"gh_demo"/);
  assert.match(request.options.body, /"key":"secret"/);
});

test('X 搜索采集器调用 TwitterAPI 搜索并标准化推文', async () => {
  let request;
  const adapter = createXAdapter({ configuration: { baseUrl: 'https://api.twitterapi.io', apiKey: 'secret' }, fetchImpl: async (url, options) => { request = { url: String(url), options }; return response({ tweets: [{ id: '123', text: '一条 X 动态', createdAt: recentTimestamp(), author: { name: '账号', userName: 'demo' }, likeCount: 5 }] }); } });
  const result = await adapter.collect({ query: 'from:demo -filter:replies', searchType: 'Latest', limit: 10, maxAgeHours: 168 });
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].url, 'https://x.com/demo/status/123');
  assert.equal(new URL(request.url).origin, 'https://api.twitterapi.io');
  assert.equal(new URL(request.url).pathname, '/twitter/tweet/advanced_search');
  assert.equal(new URL(request.url).searchParams.get('query'), 'from:demo -filter:replies');
  assert.equal(request.options.headers['x-api-key'], 'secret');
});

test('X 查询词池模式逐条执行条件并合并去重', async () => {
  const requested = [];
  const adapter = createXAdapter({ configuration: { baseUrl: 'https://api.twitterapi.io', apiKey: 'secret' }, fetchImpl: async (url) => {
    requested.push(new URL(String(url)).searchParams.get('query'));
    return response({ tweets: [{ id: requested.length === 1 ? 'same' : 'second', text: `条件 ${requested.length}`, createdAt: recentTimestamp(), author: { userName: 'demo' } }] });
  } });
  const result = await adapter.collect({ mode: 'query-pool', query: 'AI\nOpenAI', searchType: 'Top', limit: 10, maxAgeHours: 168 });
  assert.deepEqual(requested, ['AI', 'OpenAI']);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].raw.raw.query, 'AI');
});

test('X 趋势模式先读 TwitterAPI 趋势词再搜索相关推文', async () => {
  const requests = [];
  const adapter = createXAdapter({ configuration: { baseUrl: 'https://api.twitterapi.io', apiKey: 'secret' }, fetchImpl: async (url) => {
    const parsed = new URL(String(url)); requests.push(parsed);
    if (parsed.pathname === '/twitter/trends') return response({ trends: [{ trend: { name: 'Technology', target: { query: 'Technology' } } }] });
    return response({ tweets: [{ id: 'trend-1', text: '趋势驱动的推文', createdAt: recentTimestamp(), author: { name: '趋势账号', userName: 'trend_demo' }, retweetCount: 8 }] });
  } });
  const result = await adapter.collect({ mode: 'trending', woeid: 1, limit: 10, maxAgeHours: 168 });
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].raw.raw.provider, 'twitterapi');
  assert.equal(result.items[0].raw.raw.mode, 'trending');
  assert.equal(requests[0].pathname, '/twitter/trends');
  assert.equal(requests[0].searchParams.get('woeid'), '1');
  assert.equal(requests[1].pathname, '/twitter/tweet/advanced_search');
  assert.equal(requests[1].searchParams.get('query'), 'Technology');
});
