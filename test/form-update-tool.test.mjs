import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFormUpdateOperations, buildFormUpdateTool, createFormUpdateHandler } from '../server/platform/agent/form-update-tool.mjs';

const fields = {
  topic: { kind: 'text' },
  points: { kind: 'list' },
  materialUrls: { kind: 'url-list' },
  pages: { kind: 'number', normalize: (value) => Number(value), validate: (value) => Number.isInteger(value) && value >= 4 && value <= 10 },
};

test('统一表单工具对多值字段追加去重，并只按明确 remove/clear 删除', () => {
  const appended = applyFormUpdateOperations({ topic: '已有主题', points: ['事实 A', '事实 B'] }, [
    { field: 'points', op: 'append', values: ['事实 B', '事实 C'] },
  ], fields);
  assert.equal(appended.ok, true);
  assert.deepEqual(appended.state.points, ['事实 A', '事实 B', '事实 C']);

  const removed = applyFormUpdateOperations(appended.state, [{ field: 'points', op: 'remove', values: ['事实 B'] }], fields);
  assert.deepEqual(removed.state.points, ['事实 A', '事实 C']);
  const cleared = applyFormUpdateOperations(removed.state, [{ field: 'points', op: 'clear' }], fields);
  assert.deepEqual(cleared.state.points, []);
});

test('统一表单工具对单值字段只接受明确替换，并校验 URL 与数值', () => {
  const result = applyFormUpdateOperations({ topic: '旧主题' }, [
    { field: 'topic', op: 'replace', value: '新主题' },
    { field: 'materialUrls', op: 'append', values: ['https://example.com/a', 'https://example.com/a'] },
    { field: 'pages', op: 'set', value: 8 },
  ], fields);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { topic: '新主题', materialUrls: ['https://example.com/a'], pages: 8 });
  const invalid = applyFormUpdateOperations(result.state, [{ field: 'topic', op: 'append', value: '不允许的隐式拼接' }], fields);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.state.topic, '新主题');
  const badUrl = applyFormUpdateOperations(result.state, [{ field: 'materialUrls', op: 'append', values: ['not-a-url'] }], fields);
  assert.equal(badUrl.ok, false);
});

test('应用表单工具返回当前 formState，并拒绝未知字段', async () => {
  let state = { points: ['已有'] };
  const handler = createFormUpdateHandler({ fields, getState: () => state, setState: (next) => { state = next; } });
  const tool = buildFormUpdateTool({ fields });
  assert.deepEqual(tool.inputSchema.properties.operations.items.properties.field.enum.sort(), ['materialUrls', 'pages', 'points', 'topic']);
  const describedTool = buildFormUpdateTool({ fields: { research_basis: { description: '需要具体事件锚点' } } });
  assert.match(describedTool.inputSchema.properties.operations.description, /research_basis：需要具体事件锚点/);
  const success = await handler({ operations: [{ field: 'points', op: 'append', values: ['新增'] }] });
  assert.equal(success.status, 'ok');
  assert.deepEqual(success.data.formState.points, ['已有', '新增']);
  const failure = await handler({ operations: [{ field: 'not_allowed', op: 'replace', value: 'x' }] });
  assert.equal(failure.status, 'error');
  assert.deepEqual(state.points, ['已有', '新增']);
});

test('表单字段可返回可执行的校验失败原因', async () => {
  let state = {};
  const handler = createFormUpdateHandler({
    fields: {
      research_basis: {
        kind: 'text',
        validate: (value) => /反常/u.test(value) && /事件/u.test(value),
        validationMessage: () => '需要写明研判关系“反常”和具体事件锚点',
      },
    },
    getState: () => state,
    setState: (next) => { state = next; },
  });
  const failure = await handler({ operations: [{ field: 'research_basis', op: 'replace', value: '围绕影响展开' }] });
  assert.equal(failure.status, 'error');
  assert.match(failure.error.message, /需要写明研判关系/);
  assert.deepEqual(state, {});
});
