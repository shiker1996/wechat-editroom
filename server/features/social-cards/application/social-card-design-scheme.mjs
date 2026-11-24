import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MODEL_JSON_ERROR_CODES, parseModelJson } from '../../../platform/llm/model-json.mjs';
import { visualDirectionReference } from '../../../shared/themes/visual-direction-catalog.mjs';
import { SOCIAL_CARD_DESIGN_SCHEME_VERSION, normalizedSocialCardRole, validateSocialCardDesignScheme } from './social-card-design-scheme-contract.mjs';

const COLOR_MOOD_PROMPT = '先根据具体主题对象、叙事方式、读者感受和要展示的证据/结果选择颜色；contentType 只是流程元数据，不得用它直接套风格。独立判断明暗（明亮/深沉）、冷暖（暖/冷/中性）和饱和度，三者不能绑定推断。将选择写进 contentReading、designLanguage 和 palette。不要把技术、数据、工具或事件类别直接等同于某种颜色；同类内容应按具体对象和表达目的产生不同方案。无论选择何种气质，都必须保证文字清晰可读并通过对比度校验。';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validateScheme(raw, pages, expectedParadigmId) {
  const scheme = raw?.designScheme;
  const result = validateSocialCardDesignScheme({ designScheme: scheme, storyboardPages: pages, expectedParadigmId });
  return { issues: result.issues, scheme };
}

function asMarkdown({ title, channelMode, scheme, audit }) {
  return [
    '# 本篇图文设计方案', '',
    `- 文章：${title}`,
    `- 渠道：${channelMode === 'xiaohongshu' ? '小红书' : '公众号'}`,
    `- 视觉范式：${scheme.paradigmId}`,
    `- 视觉方向：${scheme.visualDirection}`,
    `- 内容判断：主题对象 ${scheme.contentReading.subject}；叙事方式 ${scheme.contentReading.narrative}；读者感受 ${scheme.contentReading.readerFeeling}；视觉锚点 ${scheme.contentReading.visualAnchor}`,
    `- 色彩：底色 ${scheme.palette.background}；卡片 ${scheme.palette.surface}；文字 ${scheme.palette.text}；强调 ${scheme.palette.accent} / ${scheme.palette.accentSecondary}`,
    `- 字体：${scheme.typography.family}；标题 ${scheme.typography.titlePx}px；正文 ${scheme.typography.bodyPx}px；注释 ${scheme.typography.captionPx}px；行高 ${scheme.typography.lineHeight}`,
    `- 版面：${scheme.composition.grid}；密度 ${scheme.composition.density}；节奏 ${scheme.composition.rhythm}；视觉母题 ${scheme.composition.motif}`,
    `- 色彩依据：${scheme.designLanguage.colorLogic}`,
    `- 形状与表面：${scheme.designLanguage.shape}；${scheme.designLanguage.surface}`,
    `- 图形与图像：${scheme.designLanguage.graphics}；${scheme.designLanguage.imageTreatment}`,
    `- 系列锚点：${scheme.sharedAnchors.map((anchor) => `${anchor.id}（${anchor.description}）`).join('；')}`,
    '', '## 分页安排', '',
    ...scheme.pages.map((page) => `${page.page}. ${page.role} / ${page.layout} / ${page.composition}：${page.visualPurpose}；焦点 ${page.focus}；${page.treatment}`),
    '', '## 校验', '',
    `- 方案校验：${audit.valid ? '通过' : '未通过'}；页数、色彩对比、字阶范围和允许版式均已检查。`, '',
  ].join('\n');
}

export async function generateSocialCardDesignScheme({ gateway, store = null, provider = '', batchId = null, candidateId = null, workdir, title = '', channelMode = 'wechat', contentType = 'event', pages = [], paradigm = null, references = '', log = () => {} } = {}) {
  if (!paradigm?.id) throw new Error('生成视觉方案前必须先选择视觉范式');
  const runId = `run-social-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const story = (Array.isArray(pages) ? pages : []).map((page, index) => ({
    page: index + 1,
    role: normalizedSocialCardRole(page),
    title: String(page?.title || '').slice(0, 80),
    lead: String(page?.lead || '').slice(0, 120),
    layoutIntent: String(page?.layout_intent || '').slice(0, 120),
    composition: page?.composition || null,
  }));
  if (!story.length) throw new Error('无法为没有页面的故事板生成设计方案');
  const input = { title, channelMode, contentType, canvas: { width: 375, height: 667 }, pages: story };
  const system = `你是公众号与小红书图文设计师。针对当前内容独立制定统一视觉方案 v${SOCIAL_CARD_DESIGN_SCHEME_VERSION}。用户已选择视觉范式「${paradigm.name}」（${paradigm.id}）：${paradigm.summary}；范式结构规则：${paradigm.layoutRule}；仅可使用版式 ${paradigm.supportedLayouts.join('|')}。必须在方案中原样返回 paradigmId=${paradigm.id}，并让整组页级 layout、composition 和节奏体现该结构骨架。范式只决定页面结构，不决定颜色、字体或表面；视觉方向、配色、字阶和图形语言仍按本篇对象、叙事、读者感受与证据独立推导。先判断主题对象、叙事路径、读者感受和最值得看见的证据；再确定视觉方向、调色板、字号、整组网格/密度/节奏/母题、元素语言和2–3个系列锚点；最后逐页决定阅读目的、版式、焦点、处理方式及可核对的构图/主视觉/背景/强调位置标记。工具/事件/自定义仅是流程元数据，不直接映射风格。不能因同属数据分析、技术、工具或事件就复用方向。事实只能来自输入，不能更改页序、职责和内容容量。只返回紧凑 JSON，形状：{"designScheme":{"schemaVersion":${SOCIAL_CARD_DESIGN_SCHEME_VERSION},"contentReading":{"subject":"","narrative":"","readerFeeling":"","visualAnchor":""},"paradigmId":"${paradigm.id}","visualDirection":"","palette":{"background":"#RRGGBB","surface":"#RRGGBB","text":"#RRGGBB","muted":"#RRGGBB","accent":"#RRGGBB","accentSecondary":"#RRGGBB"},"typography":{"family":"sans|serif|mono","titlePx":34,"bodyPx":14,"captionPx":12,"lineHeight":1.55},"composition":{"grid":"","density":"","rhythm":"","motif":""},"designLanguage":{"colorLogic":"","shape":"","surface":"","graphics":"","imageTreatment":""},"sharedAnchors":[{"id":"series-mark","description":""},{"id":"page-rail","description":""}],"pages":[{"page":1,"role":"cover|content|ending","visualPurpose":"","layout":"poster|editorial|data|checklist|steps|minimal|timeline|comparison|evidence|feature","focus":"","treatment":"","composition":"split-panel","primaryVisual":"large-stat","backgroundMode":"solid-surface","accentPlacement":"left-rail"}]}}。所有必填文本按字段长度上限填写。pages 必须逐页匹配故事板并使用归一职责 cover/content/ending。标记必须是 kebab-case。5页及以上至少3种构图、至少2种背景，且相邻页构图和主视觉都不同。每页 HTML 后续会用标记兑现方案，不能只改标记而不改视觉。标题/正文颜色对比度至少4.5:1，强调色与背景至少3:1，辅助文字与表面至少3:1。字号范围：标题30–40px，正文13–16px，注释12–14px，行高1.45–1.7。\n\n## 参考排版规范\n${String(references || '').slice(0, 16000)}`;
  const messages = [
    { role: 'system', protected: true, content: `${system}\n\n${COLOR_MOOD_PROMPT}\n\n${visualDirectionReference('social')}` },
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
  let checked = validateScheme(raw, story, paradigm.id);
  if (checked.issues.length) {
    log(`图文设计方案校验发现 ${checked.issues.length} 项问题，正在修复…`);
    response = await call([...messages, { role: 'assistant', content: outputs.at(-1) }, { role: 'user', protected: true, content: JSON.stringify({ repairOnly: true, issues: checked.issues, requiredPageCount: story.length }) }], 1);
    outputs.push(String(response?.content ?? ''));
    raw = parseModelJson(response, { store, label: '本篇图文设计方案修复' });
    checked = validateScheme(raw, story, paradigm.id);
  }
  if (checked.issues.length) {
    const error = new Error(`图文设计方案未通过校验：${checked.issues.map((item) => `${item.field} ${item.message}`).join('；')}`);
    error.code = 'SOCIAL_DESIGN_SCHEME_INVALID';
    error.issues = checked.issues;
    throw error;
  }
  const audit = { valid: true, id: runId, attempts: outputs.length, generatedAt: new Date().toISOString(), checks: ['unified-schema-v4', 'selected-visual-paradigm', 'content-reading-fields', 'shared-anchors', 'storyboard-page-fidelity', 'page-layout-and-visual-markers', 'token-ranges', 'color-contrast', 'visual-diversity'], issues: [] };
  const scheme = { schemaVersion: SOCIAL_CARD_DESIGN_SCHEME_VERSION, id: runId, title, channelMode, contentType, input: { canvas: input.canvas, pageCount: story.length }, designScheme: checked.scheme, audit };
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
