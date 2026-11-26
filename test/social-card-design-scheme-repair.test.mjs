import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSocialCardDesignScheme } from '../server/features/social-cards/application/social-card-design-scheme.mjs';
import { getSocialCardVisualParadigm } from '../server/shared/domain/social-card-visual-paradigms.mjs';

function validScheme(paradigm) {
  return {
    designScheme: {
      schemaVersion: 5,
      contentReading: { subject: '测试内容', narrative: '从背景到结论', readerFeeling: '清楚可信', visualAnchor: '证据关系' },
      paradigmId: paradigm.id,
      visualDirection: '用证据轨迹呈现内容关系和变化。',
      palette: { background: '#FFFFFF', surface: '#F4F4F4', text: '#111111', muted: '#555555', accent: '#0055DD', accentSecondary: '#228833' },
      typography: { family: 'sans', titlePx: 34, bodyPx: 14, captionPx: 12, lineHeight: 1.55 },
      composition: { grid: '单列', density: '中等', rhythm: '背景到结论', motif: '证据轨迹' },
      designLanguage: { colorLogic: '蓝色突出证据', shape: '直线和圆点', surface: '平面', graphics: '证据轨迹', imageTreatment: '图形示意' },
      sharedAnchors: [{ id: 'series-mark', description: '系列标记' }, { id: 'page-rail', description: '页序轨迹' }],
      pages: [
        { page: 1, role: 'cover', visualPurpose: '建立主题', layout: 'editorial', focus: '主题', treatment: '标题与证据入口', composition: 'topic-field', primaryVisual: 'topic-mark', backgroundMode: 'paper', accentPlacement: 'top' },
        { page: 2, role: 'content', visualPurpose: '说明背景', layout: 'timeline', focus: '背景', treatment: '按时间展开', composition: 'time-track', primaryVisual: 'time-nodes', backgroundMode: 'cool-paper', accentPlacement: 'left-rail' },
        { page: 3, role: 'content', visualPurpose: '呈现证据', layout: 'evidence', focus: '证据', treatment: '分组呈现证据', composition: 'evidence-grid', primaryVisual: 'evidence-blocks', backgroundMode: 'dark-board', accentPlacement: 'inline' },
        { page: 4, role: 'ending', visualPurpose: '收束结论', layout: 'checklist', focus: '结论', treatment: '用要点收束', composition: 'closing-list', primaryVisual: 'check-list', backgroundMode: 'warm-paper', accentPlacement: 'bottom' },
      ],
    },
  };
}

test('设计方案门禁失败后会多轮自动修复额外页字段', async () => {
  const paradigm = getSocialCardVisualParadigm('daily-brief');
  const valid = validScheme(paradigm);
  const withUnexpectedTitles = () => ({
    designScheme: {
      ...valid.designScheme,
      pages: valid.designScheme.pages.map((page) => ({ ...page, title: `第 ${page.page} 页标题` })),
    },
  });
  const responses = [withUnexpectedTitles(), withUnexpectedTitles(), valid];
  const calls = [];
  const gateway = {
    config: { providers: { deepseek: { maxOutputTokens: 3000 } }, defaultProvider: 'deepseek' },
    async complete(options) {
      calls.push(options);
      return { content: JSON.stringify(responses.shift()) };
    },
  };
  const logs = [];

  const result = await generateSocialCardDesignScheme({
    gateway,
    provider: 'deepseek',
    title: '测试主题',
    contentType: 'custom',
    paradigm,
    pages: [
      { role: 'cover', title: '主题' },
      { role: 'content', title: '背景' },
      { role: 'content', title: '证据' },
      { role: 'ending', title: '结论' },
    ],
    log: (message) => logs.push(message),
  });

  assert.equal(result.audit.valid, true);
  assert.equal(result.audit.attempts, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.purpose === 'social-card-design-scheme' || call.purpose === 'social-card-design-scheme-repair'));
  const repairPayload = JSON.parse(calls[1].messages.at(-1).content);
  assert.ok(repairPayload.allowedPageFields.includes('visualPurpose'));
  assert.equal(repairPayload.allowedPageFields.includes('title'), false);
  assert.match(repairPayload.instruction, /title.*额外字段/);
  assert.ok(logs.some((message) => message.includes('自动修复（2/3）')));
});

test('多轮修复仍只多出页面 title 时自动剔除冗余字段并复核', async () => {
  const paradigm = getSocialCardVisualParadigm('daily-brief');
  const valid = validScheme(paradigm);
  const withUnexpectedTitles = () => ({
    designScheme: {
      ...valid.designScheme,
      pages: valid.designScheme.pages.map((page) => ({ ...page, title: `第 ${page.page} 页标题` })),
    },
  });
  const calls = [];
  const gateway = {
    config: { providers: { deepseek: { maxOutputTokens: 3000 } }, defaultProvider: 'deepseek' },
    async complete(options) {
      calls.push(options);
      return { content: JSON.stringify(withUnexpectedTitles()) };
    },
  };
  const logs = [];

  const result = await generateSocialCardDesignScheme({
    gateway,
    provider: 'deepseek',
    title: '测试主题',
    contentType: 'custom',
    paradigm,
    pages: [
      { role: 'cover', title: '主题' },
      { role: 'content', title: '背景' },
      { role: 'content', title: '证据' },
      { role: 'ending', title: '结论' },
    ],
    log: (message) => logs.push(message),
  });

  assert.equal(result.audit.valid, true);
  assert.equal(result.audit.attempts, 4);
  assert.equal(calls.length, 4);
  assert.ok(result.designScheme.pages.every((page) => !Object.hasOwn(page, 'title')));
  assert.ok(logs.some((message) => message.includes('已移除该非契约字段并复核通过')));
});
