import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCollectedUrl, collectedItemIdentity, dedupeCollectedItems, filterCollectedItems } from '../server/features/collection/index.mjs';

test('采集 URL 身份会移除跟踪参数、片段并规范主机名', () => {
  assert.equal(
    canonicalCollectedUrl('HTTPS://Example.COM/news/123/?utm_source=rss&b=2&a=1#comments'),
    'https://example.com/news/123?a=1&b=2',
  );
});

test('同一规范化 URL 只保留一条，并保留重复来源审计信息', () => {
  const items = [
    { title: '简短标题', url: 'https://example.com/news/1?utm_source=a', sourceKey: 'rsshub:/a', summary: '短摘要' },
    { title: '更完整标题', url: 'https://EXAMPLE.com/news/1#top', sourceKey: 'rsshub:/b', summary: '更完整的摘要和正文' },
  ];
  const result = dedupeCollectedItems(filterCollectedItems(items).kept);
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.kept[0].title, '更完整标题');
  assert.deepEqual(result.kept[0].duplicateSourceKeys.sort(), ['rsshub:/a', 'rsshub:/b']);
  assert.equal(result.kept[0].duplicateCount, 1);
});

test('没有 URL 的正文指纹按来源隔离，避免误吞独立报道', () => {
  const first = { title: '同标题', content: '相同的正文', sourceKey: 'rsshub:/a' };
  const second = { title: '同标题', content: '相同的正文', sourceKey: 'rsshub:/b' };
  assert.notEqual(collectedItemIdentity(first), collectedItemIdentity(second));
  assert.equal(dedupeCollectedItems([first, { ...first }]).kept.length, 1);
  assert.equal(dedupeCollectedItems([first, second]).kept.length, 2);
});
