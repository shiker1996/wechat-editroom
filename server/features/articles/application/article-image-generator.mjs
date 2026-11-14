import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { escapeHtml } from '../../../shared/rendering/html-utils.mjs';
import { fontStack } from '../../../shared/themes/font-utils.mjs';
import { resolveSkillFile } from '../../../platform/llm/skill-runtime.mjs';

// 文章配图确定性生成（待办「文章配图接入图文确定性生成链」）：
// 结构化配图使用固定 HTML 模板 + html-pages-to-images
// 截图产出单张浅色插图。数据只能来自占位中的结构化清单（规划时取自正文），模型不参与渲染。
// 生成失败保留占位并抛错，绝不静默删除或伪造图片。

const RATIO_SIZE = {
  '16:9': { width: 750, height: 422 },
  '4:3': { width: 750, height: 562 },
  '1:1': { width: 600, height: 600 },
};

const DEFAULT_TOKENS = {
  colors: {
    background: '#FFFFFF', surface: '#FFFFFF', text: '#202522', muted: '#6C736E',
    accent: '#C4473A', accentSecondary: '#C4473A', line: '#D8D3C9', inverseText: '#FFFFFF',
  },
  typography: { family: 'sans', headingFamily: 'serif', bodyPx: 16, captionPx: 13 },
  shape: { radiusPx: 10, borderWidthPx: 1, shadow: 'none' },
};

function safeHex(value, fallback) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : fallback;
}

function safePx(value, fallback, min = 0, max = 64) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeShadow(value) {
  const shadow = String(value || 'none').trim();
  return /^(?:none|[0-9a-zA-Z .,%()#-]+)$/.test(shadow) ? shadow : 'none';
}

function readJson(filePath) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
  } catch {
    return null;
  }
}

function normalizeTokens(input = {}) {
  const colors = { ...DEFAULT_TOKENS.colors, ...(input.colors || {}) };
  const typography = { ...DEFAULT_TOKENS.typography, ...(input.typography || {}) };
  const shape = { ...DEFAULT_TOKENS.shape, ...(input.shape || {}) };
  return {
    colors: Object.fromEntries(Object.entries(colors).map(([key, value]) => [key, safeHex(value, DEFAULT_TOKENS.colors[key] || DEFAULT_TOKENS.colors.text)])),
    typography: {
      family: ['sans', 'serif', 'song', 'kai', 'hei', 'mono'].includes(typography.family) ? typography.family : 'sans',
      headingFamily: ['sans', 'serif', 'song', 'kai', 'hei', 'mono'].includes(typography.headingFamily) ? typography.headingFamily : 'serif',
      bodyPx: safePx(typography.bodyPx ?? typography.body_px, DEFAULT_TOKENS.typography.bodyPx, 12, 24),
      captionPx: safePx(typography.captionPx ?? typography.caption_px, DEFAULT_TOKENS.typography.captionPx, 9, 18),
    },
    shape: {
      radiusPx: safePx(shape.radiusPx ?? input.image?.radius_px, DEFAULT_TOKENS.shape.radiusPx, 0, 24),
      borderWidthPx: safePx(shape.borderWidthPx, DEFAULT_TOKENS.shape.borderWidthPx, 0, 4),
      shadow: safeShadow(shape.shadow),
    },
  };
}

export function resolveArticleImageTokens(workdir) {
  // Structured images follow the same design tokens as the article and charts.
  const persisted = readJson(path.join(workdir, 'chart-design-tokens.json'))
    || readJson(path.join(workdir, 'magazine-design-tokens.json'))
    || {};
  return normalizeTokens({
    colors: persisted.colors || {},
    typography: persisted.typography || {},
    shape: persisted.shape || {},
  });
}

function fontFamily(kind) {
  return fontStack(kind);
}

// 文章结构化配图的视觉模板。
// 这些 HTML 只在本地 Chromium 中作为截图源，最终交付仍然是 PNG；
// 因此可以使用 grid、伪元素和 CSS 变量来表达版式，不会进入公众号 HTML。
function articleStructuredCardCss({ dense = false, featureCount = 0 } = {}) {
  const cardPadding = dense ? 13 : 18;
  const valueSize = dense ? 28 : 40;
  const labelSize = dense ? 11 : 12;
  const timelineGap = dense ? 8 : 12;
  const timelineTitleSize = dense ? 15 : 18;
  const featureRows = Math.max(1, featureCount - 1);
  return `
    .content-block{display:block;min-width:0;width:100%}
    .stats-block{background:var(--bg);padding:0}
    .stats-block .stat-row{display:grid;gap:${dense ? 8 : 10}px;align-items:stretch}
    .stats-block .stat{min-width:0;padding:${cardPadding}px ${dense ? 14 : 18}px;background:var(--surface);border-top:3px solid var(--ink);border-bottom:1px solid var(--line);text-align:left}
    .stats-block .stat b{display:block;font-family:var(--heading-family);font-size:${valueSize}px;line-height:1;color:var(--accent);letter-spacing:-.04em;overflow-wrap:anywhere}
    .stats-block .stat span{display:block;margin-top:8px;color:var(--muted);font-size:${labelSize}px;line-height:1.45;overflow-wrap:anywhere}
    .stats-feature .stat:first-child{grid-row:span ${featureRows};background:var(--accent);border-color:var(--accent)}
    .stats-feature .stat:first-child b,.stats-feature .stat:first-child span{color:var(--inverse)}
    .stats-feature .stat:first-child b{font-size:${dense ? 38 : 54}px}
    .stats-grid .stat{grid-column:span 2;border-top:1px solid var(--line)}
    .stats-grid .stat:nth-child(1),.stats-grid .stat:nth-child(2){grid-column:span 3}
    .stats-grid .stat:nth-child(2){border-top:3px solid var(--accent)}
    .timeline-block{background:var(--bg);padding:2px 8px 0}
    .timeline-block:before{content:'PROCESS / ${String(featureCount || 0).padStart(2, '0')}';display:block;margin:0 0 8px -2px;color:var(--accent2);font:10px/1.2 ${fontFamily('sans')};letter-spacing:.13em;transform-origin:left top}
    .timeline-block .tl{display:grid;margin-left:8px;padding-left:18px;border-left:2px solid var(--accent2)}
    .timeline-block .tl-node{position:relative;margin:0;padding:0 0 ${timelineGap}px;border:0}
    .timeline-block .tl-node:last-child{padding-bottom:0}
    .timeline-block .tl-node:before{content:'';position:absolute;left:-25px;top:2px;width:10px;height:10px;background:var(--bg);border:2px solid var(--accent2);border-radius:50%}
    .timeline-block .tl-time{display:block;color:var(--accent2);font:700 ${dense ? 10 : 11}px/1.3 ${fontFamily('sans')};letter-spacing:.08em}
    .timeline-block .tl-node h3{margin:3px 0 0;color:var(--ink);font:700 ${timelineTitleSize}px/1.3 var(--heading-family);overflow-wrap:anywhere}
    .timeline-block .tl-node p{margin:3px 0 0;color:var(--muted);font-size:${dense ? 10 : 11}px;line-height:1.4;overflow-wrap:anywhere}`;
}

function timelineHtml({ title, items }, { width, height }, tokens) {
  const dense = items.length > 5;
  const rows = items.map((item) => `
    <div class="tl-node">
      <span class="tl-time">${escapeHtml(item.label)}</span>
      <h3>${escapeHtml(item.value)}</h3>
    </div>`).join('');
  return pageHtml({ width, height, title, subtitle: '事件时间线', body: `<div class="content-block timeline-block"><div class="tl">${rows}</div></div>` },
    articleStructuredCardCss({ dense, featureCount: items.length }), tokens);
}

function datacardHtml({ title, items }, { width, height }, tokens) {
  const dense = items.length > 4;
  const feature = items.length <= 4;
  const cards = items.map((item) => `
    <div class="stat${feature && item === items[0] ? ' stat-feature' : ''}">
      <b>${escapeHtml(item.value)}</b>
      <span>${escapeHtml(item.label)}</span>
    </div>`).join('');
  const gridStyle = feature
    ? `grid-template-columns:${items.length === 2 ? 'repeat(2,minmax(0,1fr))' : '1.25fr .75fr'};grid-template-rows:repeat(${Math.max(1, items.length - 1)},minmax(0,1fr))`
    : 'grid-template-columns:repeat(6,minmax(0,1fr))';
  const body = `<div class="content-block stats-block ${feature ? 'stats-feature' : 'stats-grid'}"><div class="stat-row" style="${gridStyle}">${cards}</div></div>`;
  return pageHtml({ width, height, title, subtitle: '数据速览', body }, articleStructuredCardCss({ dense, featureCount: items.length }), tokens);
}

function diagramHtml({ title, nodes, edges, sourceNote = '' }, { width, height }, tokens) {
  const canvasWidth = width - 60;
  const canvasHeight = 250;
  const columnWidth = canvasWidth / 4;
  const positions = new Map();
  for (let level = 0; level < 4; level += 1) {
    const group = nodes.filter((node) => node.level === level);
    group.forEach((node, index) => positions.set(node.id, {
      x: columnWidth * (level + 0.5),
      y: group.length === 1 ? canvasHeight / 2 : canvasHeight * (index === 0 ? 0.28 : 0.72),
    }));
  }
  const paths = edges.map((edge) => {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    const startX = from.x + (to.x > from.x ? 68 : -68), endX = to.x + (to.x > from.x ? -68 : 68);
    const midX = (startX + endX) / 2;
    const label = edge.label ? `<text class="edge-label" x="${midX}" y="${(from.y + to.y) / 2 - 8}" text-anchor="middle">${escapeHtml(edge.label)}</text>` : '';
    return `<path class="edge" d="M ${startX} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${endX} ${to.y}" marker-end="url(#arrow)"/>${label}`;
  }).join('');
  const boxes = nodes.map((node) => {
    const point = positions.get(node.id);
    return `<div class="diagram-node" style="left:${point.x}px;top:${point.y}px"><strong>${escapeHtml(node.label)}</strong>${node.detail ? `<span>${escapeHtml(node.detail)}</span>` : ''}</div>`;
  }).join('');
  const body = `<div class="diagram-canvas"><svg viewBox="0 0 ${canvasWidth} ${canvasHeight}" aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"/></marker></defs>${paths}</svg>${boxes}</div>`;
  const css = `.diagram-canvas{position:relative;width:100%;height:${canvasHeight}px}.diagram-canvas svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.diagram-canvas .edge{fill:none;stroke:var(--accent);stroke-width:2}.diagram-canvas marker path{fill:var(--accent)}.diagram-canvas .edge-label{font:11px ${fontFamily('sans')};fill:var(--muted);paint-order:stroke;stroke:var(--bg);stroke-width:5px;stroke-linejoin:round}.diagram-node{position:absolute;transform:translate(-50%,-50%);width:136px;min-height:64px;padding:10px 9px;border:1px solid var(--line);border-top:3px solid var(--accent);background:var(--surface);display:flex;flex-direction:column;justify-content:center;text-align:center}.diagram-node strong{font-size:15px;line-height:1.3;overflow-wrap:anywhere}.diagram-node span{margin-top:3px;color:var(--muted);font-size:10px;line-height:1.25;overflow-wrap:anywhere}`;
  const footer = sourceNote ? `<div class="diagram-source">${escapeHtml(sourceNote)}</div>` : '';
  return pageHtml({ width, height, title, subtitle: '机制示意图', body: `${body}${footer}` }, `${css}.diagram-source{margin-top:8px;color:var(--muted);font-size:9px;line-height:1.35;overflow-wrap:anywhere}`, tokens);
}

function pageHtml({ width, height, title, subtitle, body }, extraCss, tokens) {
  const colors = tokens.colors;
  const headingFamily = fontFamily(tokens.typography.headingFamily);
  const bodyFamily = fontFamily(tokens.typography.family);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:${colors.background};--surface:${colors.surface};--ink:${colors.text};--muted:${colors.muted};--accent:${colors.accent};--accent2:${colors.accentSecondary};--line:${colors.line};--inverse:${colors.inverseText};--border-width:${tokens.shape.borderWidthPx}px;--radius:${tokens.shape.radiusPx}px;--shadow:${tokens.shape.shadow};--component-scale:1;--heading-family:${headingFamily};--body-family:${bodyFamily}}
  body{font-family:${bodyFamily};background:var(--bg);color:var(--ink)}
  .page{width:${width}px;height:${height}px;background:var(--bg);padding:28px 30px;display:flex;flex-direction:column}
  .head{border-left:${Math.max(3, tokens.shape.borderWidthPx + 2)}px solid var(--accent);padding-left:14px;margin-bottom:20px}
  .title{font-family:${headingFamily};font-size:22px;font-weight:800;color:var(--ink);line-height:1.3;overflow-wrap:anywhere}
  .subtitle{font-size:${tokens.typography.captionPx}px;color:var(--muted);letter-spacing:2px;margin-top:4px}
  .content{flex:1;display:flex;flex-direction:column;justify-content:center}
  ${extraCss}
</style></head>
<body><div class="page">
  <div class="head"><div class="title">${escapeHtml(title)}</div><div class="subtitle">${escapeHtml(subtitle)}</div></div>
  <div class="content">${body}</div>
</div></body></html>`;
}

export function buildGenerateImageHtml(generate, ratio = '16:9', inputTokens = {}) {
  const size = RATIO_SIZE[ratio] || { width: 750, height: Math.round(750 * 0.62) };
  const tokens = normalizeTokens(inputTokens);
  if (generate?.kind === 'timeline') return { html: timelineHtml(generate, size, tokens), ...size };
  if (generate?.kind === 'datacard') return { html: datacardHtml(generate, size, tokens), ...size };
  if (generate?.kind === 'diagram') return { html: diagramHtml(generate, size, tokens), ...size };
  throw new Error(`未知的可生成图片类型：${generate?.kind || '未声明'}`);
}

export async function generateArticleImage({ workspaceRoot, workdir, slotId, generate, ratio, tokens = null, renderHtmlPages = null }) {
  if (generate?.kind !== 'diagram' && !generate?.items?.length) throw new Error('该占位没有可生成的结构化数据');
  const visualTokens = tokens || resolveArticleImageTokens(workdir);
  const { html, width, height } = buildGenerateImageHtml(generate, ratio, visualTokens);
  const safeName = String(slotId || 'image').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  const imageDir = path.join(workdir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  // Windows 下 Node 对含中文的临时目录执行 recursive rm 可能静默残留；临时前缀保持 ASCII。
  const tempDir = fs.mkdtempSync(path.join(imageDir, '.generate-'));
  const tempHtmlPath = path.join(tempDir, `${safeName}.html`);
  const htmlPath = path.join(imageDir, `${safeName}.html`);
  const target = path.join(imageDir, `${safeName}.png`);
  try {
    fs.writeFileSync(tempHtmlPath, html, 'utf8');
    let execute = renderHtmlPages;
    if (!execute) {
      const screenshotModule = resolveSkillFile({ workspaceRoot, skillName: 'html-pages-to-images', relativePath: 'index.js' });
      ({ execute } = await import(`${pathToFileURL(screenshotModule).href}?v=${Date.now()}`));
    }
    const result = await execute({ htmlFile: tempHtmlPath, outputDir: tempDir, selector: '.page', pageWidth: width, pageHeight: height, deviceScaleFactor: 2 });
    if (!result.success) throw new Error(`配图生成截图失败：${result.message}`);
    const images = (result.data.images || []).map((item) => (typeof item === 'string' ? item : item.path || item.filePath)).filter(Boolean);
    if (!images.length || !fs.existsSync(images[0])) throw new Error('配图生成未产出 PNG');
    fs.copyFileSync(images[0], target);
    fs.copyFileSync(tempHtmlPath, htmlPath);
    return { localPath: target, htmlPath, width, height };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
