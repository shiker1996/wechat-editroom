import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMaterial } from '../server/features/materials/index.mjs';

test('素材评估规则只使用输入和上层注入的历史信号', () => {
  const input = {
    source_type: 'project',
    title: '自动化失败复盘',
    raw_text: '我遇到问题，后来发现原因，结果效率下降，所以建议保留人工判断。',
  };
  const context = { contentPillars: ['自动化'], readerProfile: '开发者', description: '' };
  const columns = [{ id: 7, name: '工具与实践' }];
  const first = assessMaterial(input, columns, context, { sample_count: 0 });
  const second = assessMaterial(input, columns, context, { sample_count: 2 });
  assert.equal(first.recommended_column_id, 7);
  assert.equal(first.historical_signal.sample_count, 0);
  assert.equal(second.historical_signal.sample_count, 2);
  assert.notEqual(first, second);
});
