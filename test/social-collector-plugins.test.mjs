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

test('X 搜索采集器调用 TwexAPI 搜索并标准化推文', async () => {
  let request;
  const adapter = createXAdapter({ configuration: { baseUrl: 'https://api.twexapi.io', apiKey: 'secret' }, fetchImpl: async (url, options) => { request = { url: String(url), options }; return response({ code: 200, data: [{ tweet_id: '123', text: '一条 X 动态', created_at_datetime: recentTimestamp(), user: { name: '账号', screen_name: 'demo' }, favorite_count: 5 }] }); } });
  const result = await adapter.collect({ query: 'from:demo -filter:replies', searchType: 'Latest', limit: 10, maxAgeHours: 168 });
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].url, 'https://x.com/demo/status/123');
  assert.equal(request.url, 'https://api.twexapi.io/twitter/advanced_search/page');
  assert.match(request.options.body, /"searchTerms":\["from:demo -filter:replies"\]/);
  assert.match(request.options.headers.authorization, /Bearer secret/);
});

test('X 查询词池模式逐条执行条件并合并去重', async () => {
  const requested = [];
  const adapter = createXAdapter({ configuration: { baseUrl: 'https://api.twexapi.io', apiKey: 'secret' }, fetchImpl: async (url, options) => {
    requested.push(JSON.parse(options.body).searchTerms[0]);
    return response({ code: 200, data: [{ tweet_id: requested.length === 1 ? 'same' : 'second', text: `条件 ${requested.length}`, created_at_datetime: recentTimestamp(), user: { screen_name: 'demo' } }] });
  } });
  const result = await adapter.collect({ mode: 'query-pool', query: 'AI\nOpenAI', searchType: 'Top', limit: 10, maxAgeHours: 168 });
  assert.deepEqual(requested, ['AI', 'OpenAI']);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].raw.raw.query, 'AI');
});

test('X 趋势模式调用 TwexAPI global-trending 并标准化热门推文', async () => {
  let request;
  const adapter = createXAdapter({ configuration: { baseUrl: 'https://api.twexapi.io', apiKey: 'secret' }, fetchImpl: async (url, options) => { request = { url: String(url), options }; return response({ code: 200, data: [{ tweet_id: 'trend-1', full_text: '趋势驱动的推文', created_at_datetime: recentTimestamp(), user: { name: '趋势账号', screen_name: 'trend_demo' }, retweet_count: 8 }] }); } });
  const result = await adapter.collect({ mode: 'trending', country: 'worldwide', topic: 'Technology', content: 'AI', limit: 10, maxAgeHours: 168 });
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].raw.raw.provider, 'twexapi');
  assert.equal(result.items[0].raw.raw.mode, 'trending');
  assert.equal(new URL(request.url).pathname, '/twitter/global-trending/tweets');
  assert.deepEqual(Object.fromEntries(new URL(request.url).searchParams), { country: 'worldwide', topic: 'Technology', content: 'AI', count: '10' });
  assert.equal(request.options.headers.authorization, 'Bearer secret');
});
