import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAiVisualCoverScaffold, buildCoverVisualInput } from '../server/features/articles/application/ai-visual-cover-composer.mjs';
import { loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';

test('封面输入使用本篇设计方案和固定画布契约', () => {
  const designScheme = { visualDirection: '留白与暖色焦点', tokens: { colors: { page: '#111111' } } };
  const input = buildCoverVisualInput({ title: '测试标题', summary: '样张摘要', brand: '测试账号 · 2026.08', designScheme });
  assert.deepEqual(input.canvas, { width: 900, height: 383, selector: '.page' });
  assert.deepEqual(input.designScheme, designScheme);
  assert.deepEqual(input.output, { html: 'ai-cover.html', image: 'cover.png' });
  assert.match(buildAiVisualCoverScaffold(), /data-render-mode="ai-visual-cover"/);
});

test('AI 封面技能加载布局、契约和语义组件三份内置参考', () => {
  const bundle = loadSkillBundle({ workspaceRoot: process.cwd(), skillName: 'article-cover-ai-visual-generator' });
  assert.equal(bundle.fallback, false);
  assert.match(bundle.prompt, /cover-layout-guide\.md/);
  assert.match(bundle.prompt, /cover-visual-contract\.md/);
  assert.match(bundle.prompt, /cover-visual-component-mapping\.md/);
  assert.match(bundle.prompt, /禁止自行创造以下信息[\s\S]*期号/);
  assert.match(bundle.prompt, /构图位置、方向、视觉面板和具体组件由模型自行判断/);
  assert.match(bundle.prompt, /标题、摘要和信息行必须完整落在画布内/);
  assert.match(bundle.prompt, /视觉隐喻候选中选择或组合方向/);
  assert.match(bundle.prompt, /连续、有层次、有面积和视觉重量/);
  assert.doesNotMatch(bundle.prompt, /compositionHint/);
  assert.doesNotMatch(bundle.prompt, /secondaryFocus/);
});
