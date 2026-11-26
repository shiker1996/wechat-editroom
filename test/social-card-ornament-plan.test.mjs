import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { probeHtmlLayout } from '../server/platform/browser/html-layout-probe.mjs';
import { compareSocialCardDesignToMeasurements } from '../server/features/social-cards/application/social-card-design-conformance.mjs';
import { validateSocialCardDesignScheme } from '../server/features/social-cards/application/social-card-design-scheme-contract.mjs';
import { auditSocialCardHtmlFit } from '../server/features/social-cards/application/social-card-visual-audit.mjs';

const pageSpecs = [
  { role: 'cover', layout: 'editorial', visualPurpose: '建立主题', focus: '时间线索', treatment: '标题与标记组成封面', composition: 'time-cover', primaryVisual: 'timecode-wave', backgroundMode: 'paper', accentPlacement: 'lower-right', ornaments: [['frame', 'edge'], ['stamp', 'corner']] },
  { role: 'content', layout: 'steps', visualPurpose: '说明步骤', focus: '操作顺序', treatment: '沿时间线推进', composition: 'step-rail', primaryVisual: 'numbered-steps', backgroundMode: 'cool-paper', accentPlacement: 'left-rail', ornaments: [['rail', 'edge'], ['index', 'header']] },
  { role: 'content', layout: 'timeline', visualPurpose: '展示过程', focus: '阶段变化', treatment: '节点连接证据', composition: 'timeline-map', primaryVisual: 'timeline-node', backgroundMode: 'dark-board', accentPlacement: 'inline', ornaments: [['annotation', 'inline'], ['motif', 'margin']] },
  { role: 'ending', layout: 'editorial', visualPurpose: '收束主题', focus: '核验要点', treatment: '校验标记收尾', composition: 'closing-field', primaryVisual: 'verification-log', backgroundMode: 'dark-paper', accentPlacement: 'corner', ornaments: [['badge', 'corner'], ['perforation', 'edge']] },
];

function designScheme() {
  return {
    schemaVersion: 5,
    paradigmId: 'continuous-scroll',
    contentReading: { subject: '测试主题', narrative: '从线索到结论', readerFeeling: '清楚', visualAnchor: '时间标记' },
    visualDirection: '用带时间标记的流程线索组织页面',
    palette: { background: '#F4F0E5', surface: '#FFFDF7', text: '#171D1D', muted: '#52605D', accent: '#3158E8', accentSecondary: '#5D7900' },
    typography: { family: 'sans', titlePx: 34, bodyPx: 14, captionPx: 12, lineHeight: 1.55 },
    composition: { grid: '单列', density: '中等', rhythm: '标题后接步骤', motif: '时间轨' },
    designLanguage: { colorLogic: '蓝绿用于不同层级', shape: '圆章与边线', surface: '纸面', graphics: '时间线和印章', imageTreatment: '图形示意' },
    sharedAnchors: [{ id: 'time-rail', description: '时间线索' }, { id: 'field-stamp', description: '页角标记' }],
    pages: pageSpecs.map((page, index) => ({
      page: index + 1, role: page.role, layout: page.layout, visualPurpose: page.visualPurpose, focus: page.focus, treatment: page.treatment,
      composition: page.composition, primaryVisual: page.primaryVisual, backgroundMode: page.backgroundMode, accentPlacement: page.accentPlacement,
      ornaments: page.ornaments.map(([kind, placement]) => ({ kind, placement, purpose: '呼应本页内容层级' })),
    })),
  };
}

const storyboardPages = pageSpecs.map(({ role }) => ({ role }));
const placementRects = {
  corner: { x: 340, y: 16, width: 18, height: 18 },
  edge: { x: 345, y: 200, width: 18, height: 18 },
  header: { x: 24, y: 16, width: 18, height: 18 },
  footer: { x: 24, y: 628, width: 18, height: 18 },
  inline: { x: 90, y: 320, width: 18, height: 18 },
  'behind-focus': { x: 120, y: 240, width: 18, height: 18 },
  margin: { x: 10, y: 300, width: 18, height: 18 },
};
const pageStyle = (page, ornaments) => ({
  width: 375, height: 667, pageNumber: String(page), role: pageSpecs[page - 1].role, visualComposition: pageSpecs[page - 1].composition, primaryVisual: pageSpecs[page - 1].primaryVisual, backgroundMode: pageSpecs[page - 1].backgroundMode, accentPlacement: pageSpecs[page - 1].accentPlacement,
  sharedAnchorIds: ['time-rail', 'field-stamp'], ornaments,
});

test('v5 视觉方案允许装饰规划可选并校验已规划项', () => {
  const scheme = designScheme();
  const initial = validateSocialCardDesignScheme({ designScheme: scheme, storyboardPages, expectedParadigmId: 'continuous-scroll' });
  assert.equal(initial.valid, true, JSON.stringify(initial.issues));

  delete scheme.pages[0].ornaments;
  const omitted = validateSocialCardDesignScheme({ designScheme: scheme, storyboardPages, expectedParadigmId: 'continuous-scroll' });
  assert.equal(omitted.valid, true, JSON.stringify(omitted.issues));

  scheme.pages[0].ornaments = [pageSpecs[0].ornaments[0]].map(([kind, placement]) => ({ kind, placement, purpose: '呼应本页内容层级' }));
  const single = validateSocialCardDesignScheme({ designScheme: scheme, storyboardPages, expectedParadigmId: 'continuous-scroll' });
  assert.equal(single.valid, true, JSON.stringify(single.issues));

  scheme.pages[0].ornaments = [
    { kind: 'frame', placement: 'edge', purpose: '边界' },
    { kind: 'frame', placement: 'corner', purpose: '角标' },
  ];
  const repeated = validateSocialCardDesignScheme({ designScheme: scheme, storyboardPages, expectedParadigmId: 'continuous-scroll' });
  assert.ok(repeated.issues.some((issue) => issue.code === 'DECORATION_PLAN_DUPLICATE'));
});

test('设计兑现审计逐项匹配可见装饰类型和位置', () => {
  const scheme = designScheme();
  const good = compareSocialCardDesignToMeasurements({
    designScheme: scheme,
    storyboardPages,
    pageMeasurements: scheme.pages.map((page, index) => ({
      page: index + 1,
      pageStyle: pageStyle(index + 1, page.ornaments.map(({ kind, placement }) => ({ kind, placement, visible: true, rect: placementRects[placement] }))),
    })),
    expectedParadigmId: 'continuous-scroll',
  });
  assert.equal(good.valid, true, JSON.stringify(good.issues));
  assert.deepEqual(good.pages[0].ornaments, { planned: 2, rendered: 2, distinctRenderedKinds: 2 });

  const coveredText = compareSocialCardDesignToMeasurements({
    designScheme: scheme,
    storyboardPages,
    pageMeasurements: scheme.pages.map((page, index) => ({
      page: index + 1,
      pageStyle: pageStyle(index + 1, page.ornaments.map(({ kind, placement }) => ({
        kind, placement, visible: true, rect: placementRects[placement],
        textOverlaps: index === 0 && kind === 'stamp' ? [{ text: '标题文字', rect: { x: 340, y: 16, width: 30, height: 18 } }] : [],
      }))),
    })),
    expectedParadigmId: 'continuous-scroll',
  });
  assert.equal(coveredText.valid, false);
  assert.ok(coveredText.issues.some((issue) => issue.code === 'DECORATION_TEXT_OVERLAP'));

  const missing = compareSocialCardDesignToMeasurements({
    designScheme: scheme,
    storyboardPages,
    pageMeasurements: scheme.pages.map((page, index) => ({ page: index + 1, pageStyle: pageStyle(index + 1, index === 0 ? [
      { kind: 'frame', placement: 'edge', visible: true, rect: placementRects.edge },
      { kind: 'stamp', placement: 'footer', visible: true, rect: placementRects.footer },
    ] : page.ornaments.map(({ kind, placement }) => ({ kind, placement, visible: true, rect: placementRects[placement] }))) })),
    expectedParadigmId: 'continuous-scroll',
  });
  assert.equal(missing.valid, false);
  assert.ok(missing.issues.some((issue) => issue.code === 'DECORATION_PLAN_NOT_RENDERED'));

  const misplaced = compareSocialCardDesignToMeasurements({
    designScheme: scheme,
    storyboardPages,
    pageMeasurements: scheme.pages.map((page, index) => ({ page: index + 1, pageStyle: pageStyle(index + 1, index === 0 ? [
      { kind: 'frame', placement: 'edge', visible: true, rect: placementRects.edge },
      { kind: 'stamp', placement: 'corner', visible: true, rect: placementRects.inline },
    ] : page.ornaments.map(({ kind, placement }) => ({ kind, placement, visible: true, rect: placementRects[placement] }))) })),
    expectedParadigmId: 'continuous-scroll',
  });
  assert.equal(misplaced.valid, false);
  assert.ok(misplaced.issues.some((issue) => issue.code === 'DECORATION_PLACEMENT_MISMATCH'));
});

test('Chromium 探针只将有真实样式且位于画布内的装饰标为可见', async () => {
  const html = `<!doctype html><html><head><style>
    .page{position:relative;width:375px;height:667px;overflow:hidden}.copy{position:absolute;left:12px;top:12px}
    .ornament{position:absolute;width:18px;height:18px;border:1px solid #111;background:#eee}
    .good{left:12px;top:12px}.hidden{left:42px;top:12px;opacity:0}
    .blank{left:72px;top:12px;border:0;background:transparent}
    .outside{left:390px;top:12px}
    .group{position:absolute;left:100px;top:50px;width:120px;height:16px;display:flex;align-items:flex-end;gap:3px}
    .group span{display:block;width:3px;height:8px;background:#111}
  </style></head><body><section class="page"><p class="copy">Readable heading</p>
    <span class="ornament good" data-ornament="frame" data-ornament-placement="corner"></span>
    <span class="ornament hidden" data-ornament="stamp" data-ornament-placement="corner"></span>
    <span class="ornament blank" data-ornament="badge" data-ornament-placement="inline"></span>
    <span class="ornament outside" data-ornament="motif" data-ornament-placement="edge"></span>
    <div class="group" data-ornament="motif" data-ornament-placement="behind-focus"><span></span><span></span><span></span></div>
  </section></body></html>`;
  const [measurement] = await probeHtmlLayout({ html, pageSelector: '.page' });
  const ornaments = measurement.pageStyle.ornaments;
  assert.equal(ornaments.length, 5);
  assert.deepEqual(ornaments.map((ornament) => ornament.visible), [true, false, false, false, true]);
  assert.equal(ornaments[4].hasVisualTreatment, true, '组装装饰可由子元素绘制');
  assert.ok(ornaments[0].textOverlaps.some((run) => run.text.includes('Readable heading')));
});

test('没有视觉方案时布局审计仍会阻止装饰压住文字', async () => {
  const html = `<!doctype html><html><head><style>
    .page{position:relative;width:375px;height:667px;overflow:hidden;background:#fff;color:#111}
    .page-inner{height:100%;display:flex;flex-direction:column}.page-body{flex:1;min-height:0}
    .page-content-stack{height:100%;display:flex;flex-direction:column;justify-content:center}
    .ornament{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:180px;height:48px;background:#e33;z-index:8}
  </style></head><body><section class="page" data-page-role="cover">
    <span class="ornament" data-ornament="stamp" data-ornament-placement="corner"></span>
    <div class="page-inner"><div class="page-body"><main class="page-content-stack"><h1>标题被装饰盖住</h1><p>需要浏览器级别的字行净空检查。</p></main></div></div>
  </section></body></html>`;
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-card-ornament-overlap-'));
  const htmlPath = path.join(workdir, 'overlap.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    const report = await auditSocialCardHtmlFit({ htmlPath });
    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.code === 'DECORATION_TEXT_OVERLAP'));
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test('正文整体偏离可用区垂直中心时布局审计会按页拦截', async () => {
  const html = `<!doctype html><html><head><style>
    .page{position:relative;width:375px;height:667px;overflow:hidden;background:#fff;color:#111}
    .page-inner{height:100%;display:flex;flex-direction:column;padding:20px}
    .page-body{min-height:0;flex:1;display:flex;flex-direction:column;justify-content:flex-start;padding:4px 0 7px}
    .page-content-stack{width:100%;min-width:0}
  </style></head><body><section class="page" data-page-role="content">
    <div class="page-inner"><div class="page-body"><main class="page-content-stack"><h1>正文贴在上方</h1><p>整组内容没有位于正文区垂直中心。</p></main></div></div>
  </section></body></html>`;
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-card-content-alignment-'));
  const htmlPath = path.join(workdir, 'top-aligned.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    const report = await auditSocialCardHtmlFit({ htmlPath });
    assert.equal(report.valid, false);
    assert.ok(report.issues.some((issue) => issue.code === 'CONTENT_NOT_CENTERED' && issue.page === 1));
    assert.ok(Math.abs(report.pages[0].pageStyle.contentAlignment.verticalCenterOffsetPx) > 18);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test('整组浏览器审计可验证 v5 装饰清单并生成联系表', async () => {
  const pages = pageSpecs.map((page, index) => {
    const ornaments = page.ornaments.map(([kind, placement]) => `<span aria-hidden="true" class="ornament" data-ornament="${kind}" data-ornament-placement="${placement}"></span>`).join('');
    const anchors = '<span data-shared-anchor="time-rail">时间线索</span><span data-shared-anchor="field-stamp">场记</span>';
    return `<section class="page" data-page="${index + 1}" data-page-role="${page.role}" data-visual-composition="${page.composition}" data-primary-visual="${page.primaryVisual}" data-background-mode="${page.backgroundMode}" data-accent-placement="${page.accentPlacement}">${ornaments}<div class="page-inner"><div class="page-body"><main class="page-content-stack">${anchors}<h1>${page.focus}</h1><p>${page.treatment}</p></main></div></div></section>`;
  }).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}.page{position:relative;width:375px;height:667px;overflow:hidden;background:#F4F0E5;color:#171D1D}.page:nth-child(2){background:#DFE7E2}.page:nth-child(3){background:#171D1D;color:#F4F0E5}.page:nth-child(4){background:#242C31;color:#F4F0E5}.page-inner{height:100%;display:flex;flex-direction:column;padding:20px}.page-body{min-height:0;flex:1}.page-content-stack{height:100%;display:flex;flex-direction:column;justify-content:space-around}.ornament{position:absolute;z-index:2;width:18px;height:18px;border:1px solid #3158E8;background:#FFFDF7}.ornament[data-ornament="frame"]{width:18px;height:18px;border-width:2px}.ornament[data-ornament-placement="corner"]{top:16px;right:16px;border-radius:50%}.ornament[data-ornament-placement="edge"]{right:12px;top:160px}.ornament[data-ornament-placement="header"]{left:22px;top:16px}.ornament[data-ornament-placement="footer"]{left:22px;bottom:16px}.ornament[data-ornament-placement="inline"]{left:80px;top:48%}.ornament[data-ornament-placement="margin"]{left:12px;top:240px}.ornament[data-ornament-placement="behind-focus"]{left:24px;top:180px}
  </style></head><body>${pages}</body></html>`;
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-card-ornament-audit-'));
  const htmlPath = path.join(workdir, 'audit.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    const report = await auditSocialCardHtmlFit({
      htmlPath,
      designScheme: designScheme(),
      storyboardPages,
      expectedParadigmId: 'continuous-scroll',
      requireDesignScheme: true,
      includeContactSheet: true,
    });
    assert.equal(report.valid, true, JSON.stringify(report.issues));
    assert.ok(report.previewImageBase64?.length > 1000, '整组审计应返回联系表');
    assert.ok(report.designConformance.pages.every((page) => page.ornaments.rendered >= 2));

    const pageReport = await auditSocialCardHtmlFit({
      htmlPath,
      page: 2,
      designScheme: designScheme(),
      storyboardPages,
      expectedParadigmId: 'continuous-scroll',
      requireDesignScheme: true,
    });
    assert.equal(pageReport.valid, true, JSON.stringify(pageReport.issues));
    assert.equal(pageReport.pageCount, 1, '单页审计只测量所选页面');
    assert.deepEqual(pageReport.pages.map((page) => page.page), [2]);
    assert.deepEqual(pageReport.designConformance.pages.map((page) => page.page), [2]);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});
