import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBatchSourceGroups, selectBatchSourceGroups } from '../server/features/collection/application/batch-source-selection.mjs';

test('批次采集能力只把已启用的来源类型标记为可执行', () => {
  const groups = describeBatchSourceGroups([
    { source_type: 'rsshub', enabled: true },
    { source_type: 'reddit', enabled: false },
    { source_type: 'github', enabled: false },
  ]);
  assert.deepEqual(groups.map((item) => [item.id, item.ready, item.enabledSourceCount]), [
    ['reddit', false, 0],
    ['rsshub', true, 1],
    ['github', false, 0],
  ]);
});

test('旧客户端仍发送全量来源时，后端只选择有启用实例的来源组', () => {
  const result = selectBatchSourceGroups(['reddit', 'rsshub', 'github'], [
    { source_type: 'rsshub', enabled: true },
  ]);
  assert.deepEqual(result.selected, ['rsshub']);
  assert.deepEqual(result.skipped, ['reddit', 'github']);
});

test('没有已启用来源时不允许创建采集任务', () => {
  const result = selectBatchSourceGroups(undefined, [
    { source_type: 'rsshub', enabled: false },
  ]);
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.available.filter((item) => item.ready), []);
});

test('RSSHub 未安装时不会把已有 RSSHub 来源放进批次', () => {
  const result = selectBatchSourceGroups(['rsshub'], [
    { source_type: 'rsshub', enabled: true },
  ], { rsshubReady: false, rsshubReason: '尚未安装 RSSHub' });
  assert.deepEqual(result.selected, []);
  assert.equal(result.available.find((item) => item.id === 'rsshub')?.reason, '尚未安装 RSSHub');
});
