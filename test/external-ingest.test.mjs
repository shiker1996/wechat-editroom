import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExternalIngest } from '../server/features/collection/application/external-ingest.mjs';

test('X 与微信公众号外部条目归一到统一采集契约', () => {
  const result = normalizeExternalIngest({
    channel: 'twitter', sourceId: '@openai', sourceName: 'OpenAI',
    items: [
      { id: '1', title: '第一条', url: 'https://x.com/openai/status/1', publishedAt: '2026-09-30T01:00:00Z' },
      { id: '1-copy', title: '重复 URL', url: 'https://x.com/openai/status/1' },
    ],
  });
  assert.equal(result.channel, 'x');
  assert.equal(result.sourceKey, 'x:external:@openai');
  assert.equal(result.items.length, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.items[0].sourceType, 'x');
  assert.equal(result.items[0].publishedAt, '2026-09-30T01:00:00.000Z');
});

test('外部入口拒绝无标题、非法来源和超量请求', () => {
  assert.throws(() => normalizeExternalIngest({ channel: 'wechat', sourceId: 'demo', items: [{ url: 'https://example.com' }] }), /title/);
  assert.throws(() => normalizeExternalIngest({ channel: 'wechat', sourceId: 'demo', items: [{ title: 'x', url: 'javascript:bad' }] }), /HTTP\/HTTPS/);
  assert.throws(() => normalizeExternalIngest({ channel: 'wechat', sourceId: 'demo', items: Array.from({ length: 51 }, (_, index) => ({ title: String(index) })) }), /50/);
});
