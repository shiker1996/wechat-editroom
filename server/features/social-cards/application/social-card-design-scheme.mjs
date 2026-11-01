import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MODEL_JSON_ERROR_CODES, parseModelJson } from '../../../platform/llm/model-json.mjs';
import { colorContrast } from '../../../shared/themes/theme-validator.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const PAGE_LAYOUTS = new Set(['poster', 'editorial', 'data', 'checklist', 'steps', 'minimal', 'timeline', 'comparison', 'evidence', 'feature']);
const PAGE_ROLES = new Set(['cover', 'content', 'ending']);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validateScheme(raw, pages) {
  const issues = [];
  const scheme = raw?.designScheme;
  if (!scheme || typeof scheme !== 'object') return { issues: [{ field: 'designScheme', message: '缺少设计方案对象' }] };
  const text = (field, max) => {
    const value = String(scheme[field] || '').trim();
    if (!value || value.length > max) issues.push({ field: `designScheme.${field}`, message: `文案需为 1–${max} 字` });
  };
  text('visualDirection', 100);
  const palette = scheme.palette || {};
  for (const key of ['background', 'surface', 'text', 'muted', 'accent', 'accentSecondary']) {
    if (!HEX.test(String(palette[key] || ''))) issues.push({ field: `designScheme.palette.${key}`, message: '必须是 #RRGGBB 颜色' });
  }
  if (HEX.test(palette.text || '') && HEX.test(palette.background || '') && colorContrast(palette.text, palette.background) < 4.5) {
    issues.push({ field: 'designScheme.palette.text', message: '与背景对比度至少为 4.5:1' });
  }
  if (HEX.test(palette.text || '') && HEX.test(palette.surface || '') && colorContrast(palette.text, palette.surface) < 4.5) {
    issues.push({ field: 'designScheme.palette.text', message: '与卡片表面对比度至少为 4.5:1' });
  }
  if (HEX.test(palette.accent || '') && HEX.test(palette.background || '') && colorContrast(palette.accent, palette.background) < 3) {
    issues.push({ field: 'designScheme.palette.accent', message: '与背景对比度至少为 3:1' });
  }
  if (HEX.test(palette.muted || '') && HEX.test(palette.surface || '') && colorContrast(palette.muted, palette.surface) < 3) {
    issues.push({ field: 'designScheme.palette.muted', message: '与卡片表面对比度至少为 3:1' });
  }
  const type = scheme.typography || {};
  if (!['sans', 'serif', 'mono'].includes(type.family)) issues.push({ field: 'designScheme.typography.family', message: '字体类别必须是 sans、serif 或 mono' });
  for (const [key, min, max] of [['titlePx', 30, 40], ['bodyPx', 13, 16], ['captionPx', 12, 14]]) {
    const value = Number(type[key]);
    if (!Number.isFinite(value) || value < min || value > max) issues.push({ field: `designScheme.typography.${key}`, message: `数值范围为 ${min}–${max}` });
  }
  const lineHeight = Number(type.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight < 1.45 || lineHeight > 1.7) issues.push({ field: 'designScheme.typography.lineHeight', message: '数值范围为 1.45–1.7' });
  const composition = scheme.composition || {};
  for (const key of ['grid', 'density', 'rhythm', 'motif']) {
    const value = String(composition[key] || '').trim();
    if (!value || value.length > 80) issues.push({ field: `designScheme.composition.${key}`, message: '需提供不超过 80 字的方案' });
  }
  if (!Array.isArray(scheme.pages) || scheme.pages.length !== pages.length) {
    issues.push({ field: 'designScheme.pages', message: `应与故事板页数一致（${pages.length} 页）` });
  } else {
    scheme.pages.forEach((item, index) => {
      if (Number(item?.page) !== index + 1) issues.push({ field: `designScheme.pages[${index}].page`, message: '页码必须连续且与故事板一致' });
      if (!PAGE_ROLES.has(String(item?.role || ''))) issues.push({ field: `designScheme.pages[${index}].role`, message: '页面职责不合法' });
      if (String(item?.role || '') !== pages[index]?.role) issues.push({ field: `designScheme.pages[${index}].role`, message: '页面职责必须与故事板一致' });
      if (!PAGE_LAYOUTS.has(String(item?.layout || ''))) issues.push({ field: `designScheme.pages[${index}].layout`, message: '版式不在允许范围' });
      for (const key of ['focus', 'treatment']) {
        const value = String(item?.[key] || '').trim();
        if (!value || value.length > 100) issues.push({ field: `designScheme.pages[${index}].${key}`, message: '需提供 1–100 字说明' });
      }
    });
  }
  return { issues, scheme };
}

function asMarkdown({ title, channelMode, scheme, audit }) {
  return [
    '# 本篇图文设计方案', '',
    `- 文章：${title}`,
    `- 渠道：${channelMode === 'xiaohongshu' ? '小红书' : '公众号'}`,
    `- 视觉方向：${scheme.visualDirection}`,
    `- 色彩：底色 ${scheme.palette.background}；卡片 ${scheme.palette.surface}；文字 ${scheme.palette.text}；强调 ${scheme.palette.accent} / ${scheme.palette.accentSecondary}`,
    `- 字体：${scheme.typography.family}；标题 ${scheme.typography.titlePx}px；正文 ${scheme.typography.bodyPx}px；注释 ${scheme.typography.captionPx}px；行高 ${scheme.typography.lineHeight}`,
    `- 版面：${scheme.composition.grid}；密度 ${scheme.composition.density}；节奏 ${scheme.composition.rhythm}；视觉母题 ${scheme.composition.motif}`,
    '', '## 分页安排', '',
    ...scheme.pages.map((page) => `${page.page}. ${page.role} / ${page.layout}：${page.focus}；${page.treatment}`),
    '', '## 校验', '',
    `- 方案校验：${audit.valid ? '通过' : '未通过'}；页数、色彩对比、字阶范围和允许版式均已检查。`, '',
  ].join('\n');
}

export async function generateSocialCardDesignScheme({ gateway, store = null, provider = '', batchId = null, candidateId = null, workdir, title = '', channelMode = 'wechat', contentType = 'event', pages = [], references = '', log = () => {} } = {}) {
  const runId = `run-social-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const story = (Array.isArray(pages) ? pages : []).map((page, index) => ({
    page: index + 1,
    role: ['cover', 'ending'].includes(String(page?.kind || page?.role || '')) ? String(page.kind || page.role) : 'content',
    title: String(page?.title || '').slice(0, 80),
    lead: String(page?.lead || '').slice(0, 120),
    layoutIntent: String(page?.layout_intent || '').slice(0, 120),
    composition: page?.composition || null,
  }));
  if (!story.length) throw new Error('无法为没有页面的故事板生成设计方案');
  const input = { title, channelMode, contentType, canvas: { width: 375, height: 667 }, pages: story };
  const system = `你是公众号与小红书图文设计师。针对当前文章和故事板，每次独立制定一份视觉方案；参考 Layout Guide，避免重复旧主题。事实内容只能来自输入，标题和页面职责不得改写。只返回紧凑 JSON，形状：{"designScheme":{"visualDirection":"","palette":{"background":"#RRGGBB","surface":"#RRGGBB","text":"#RRGGBB","muted":"#RRGGBB","accent":"#RRGGBB","accentSecondary":"#RRGGBB"},"typography":{"family":"sans|serif|mono","titlePx":34,"bodyPx":14,"captionPx":12,"lineHeight":1.55},"composition":{"grid":"","density":"","rhythm":"","motif":""},"pages":[{"page":1,"role":"cover|content|ending","layout":"poster|editorial|data|checklist|steps|minimal|timeline|comparison|evidence|feature","focus":"","treatment":""}]}}。pages 必须逐页对应输入，页数、顺序和 role 一致；不得添加新页面。视觉方向最多 100 字；每页 focus/treatment 各最多 100 字。颜色需满足标题文字与背景/卡片表面的对比度至少 4.5:1、注释文字至少 3:1、强调色与背景至少 3:1。字号限制：标题 30–40px、正文 13–16px、注释 12–14px、行高 1.45–1.7。方案负责视觉风格和页面层级，不改变原始信息、组件结构契约、分页与内容容量。\n\n## 参考排版规范\n${String(references || '').slice(0, 16000)}`;
  const messages = [
    { role: 'system', protected: true, content: system },
    { role: 'user', protected: true, content: JSON.stringify(input) },
  ];
  const configured = Number(gateway?.config?.providers?.[provider]?.maxOutputTokens)
    || Number(gateway?.config?.providers?.[gateway?.config?.defaultProvider]?.maxOutputTokens)
    || 3000;
  const call = (currentMessages, attempt) => gateway.complete({ provider, purpose: attempt ? 'social-card-design-scheme-repair' : 'social-card-design-scheme', batchId, candidateId, jsonMode: true, thinking: false, temperature: attempt ? 0.1 : 0.25, maxOutputTokens: Math.min(configured, 3600), messages: currentMessages });
  let outputs = [];
  let response;
  let raw;
  try {
    response = await call(messages, 0);
    outputs.push(String(response?.content ?? ''));
    raw = parseModelJson(response, { store, label: '本篇图文设计方案' });
  } catch (error) {
    if (![MODEL_JSON_ERROR_CODES.TRUNCATED, MODEL_JSON_ERROR_CODES.INVALID].includes(error.code)) throw error;
    log('图文设计方案 JSON 未完整返回，正在尝试一次紧凑修复…');
    response = await call([...messages.slice(0, 1), { role: 'system', protected: true, content: '上次 JSON 不完整，请返回完整、紧凑且不带说明的 JSON 对象。' }, ...messages.slice(1)], 1);
    outputs.push(String(response?.content ?? ''));
    raw = parseModelJson(response, { store, label: '本篇图文设计方案修复' });
  }
  let checked = validateScheme(raw, story);
  if (checked.issues.length) {
    log(`图文设计方案校验发现 ${checked.issues.length} 项问题，正在修复…`);
    response = await call([...messages, { role: 'assistant', content: outputs.at(-1) }, { role: 'user', protected: true, content: JSON.stringify({ repairOnly: true, issues: checked.issues, requiredPageCount: story.length }) }], 1);
    outputs.push(String(response?.content ?? ''));
    raw = parseModelJson(response, { store, label: '本篇图文设计方案修复' });
    checked = validateScheme(raw, story);
  }
  if (checked.issues.length) {
    const error = new Error(`图文设计方案未通过校验：${checked.issues.map((item) => `${item.field} ${item.message}`).join('；')}`);
    error.code = 'SOCIAL_DESIGN_SCHEME_INVALID';
    error.issues = checked.issues;
    throw error;
  }
  const audit = { valid: true, id: runId, attempts: outputs.length, generatedAt: new Date().toISOString(), checks: ['storyboard-page-fidelity', 'page-layout-enum', 'token-ranges', 'color-contrast'], issues: [] };
  const scheme = { schemaVersion: 1, id: runId, title, channelMode, contentType, input: { canvas: input.canvas, pageCount: story.length }, designScheme: checked.scheme, audit };
  scheme.markdown = asMarkdown({ title, channelMode, scheme: checked.scheme, audit });
  if (workdir) {
    const jsonPath = path.join(workdir, 'social-design-scheme.json');
    const markdownPath = path.join(workdir, 'social-design-scheme.md');
    writeJson(jsonPath, { ...scheme, markdown: undefined });
    fs.writeFileSync(markdownPath, `${scheme.markdown}\n`, 'utf8');
    if (store?.upsertArtifact) {
      for (const [kind, filePath] of [['图文设计方案', jsonPath], ['图文设计方案说明', markdownPath]]) {
        const stat = fs.statSync(filePath);
        store.upsertArtifact({ batchId, candidateId, track: 'social_cards', kind, name: path.basename(filePath), path: filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
    }
  }
  return scheme;
}
