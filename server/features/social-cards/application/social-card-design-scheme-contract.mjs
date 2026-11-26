import { colorContrast } from '../../../shared/themes/theme-validator.mjs';
import { SOCIAL_CARD_DESIGN_SCHEME_SCHEMA, SOCIAL_CARD_DESIGN_SCHEME_VERSION, SOCIAL_CARD_ORNAMENT_KINDS, SOCIAL_CARD_ORNAMENT_PLACEMENTS } from '../../../shared/domain/schemas/social-card-design-scheme.mjs';
import { getSocialCardVisualParadigm } from '../../../shared/domain/social-card-visual-paradigms.mjs';
export { SOCIAL_CARD_DESIGN_SCHEME_SCHEMA, SOCIAL_CARD_DESIGN_SCHEME_TOOL_SCHEMA, SOCIAL_CARD_DESIGN_SCHEME_VERSION } from '../../../shared/domain/schemas/social-card-design-scheme.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (value) => String(value ?? '').trim();
const normalized = (value) => clean(value).toLowerCase();
const explicitPageSequenceCue = /(?:页码|页序|页号|页脚.{0,16}(?:索引|编号)|每页.{0,16}(?:编号|索引)|本页.{0,16}(?:编号|索引|位置)|(?:索引|编号).{0,16}(?:每页|页码|页序|收尾|位置|封面)|(?:封面|结尾|收尾).{0,12}索引|\b0x\s*\/\s*\d{1,2}\b)/i;

function validateSchema(schema, value, field, issues) {
  const fail = (message) => issues.push({ code: 'DESIGN_SCHEME_SCHEMA_INVALID', field, message });
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('必须是对象');
    for (const key of schema.required || []) {
      if (!(key in value)) issues.push({ code: 'DESIGN_SCHEME_SCHEMA_INVALID', field: `${field}.${key}`, message: '缺少必填字段' });
    }
    for (const [key, item] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) issues.push({ code: 'DESIGN_SCHEME_SCHEMA_INVALID', field: `${field}.${key}`, message: '不允许额外字段' });
        continue;
      }
      validateSchema(childSchema, item, `${field}.${key}`, issues);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return fail('必须是数组');
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) fail(`至少需要 ${schema.minItems} 项`);
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) fail(`最多允许 ${schema.maxItems} 项`);
    value.forEach((item, index) => validateSchema(schema.items, item, `${field}[${index}]`, issues));
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return fail('必须是字符串');
    if (schema.minLength && value.length < schema.minLength) fail(`至少需要 ${schema.minLength} 个字符`);
    if (schema.maxLength && value.length > schema.maxLength) fail(`最多允许 ${schema.maxLength} 个字符`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) fail('格式不符合要求');
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return fail('必须是整数');
  } else if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    return fail('必须是数字');
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail(`必须是以下值之一：${schema.enum.join('、')}`);
  if (typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) fail(`不能小于 ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) fail(`不能大于 ${schema.maximum}`);
  }
}

export function normalizedSocialCardRole(page = {}) {
  const role = clean(page.role || page.kind).toLowerCase();
  if (role === 'cover') return 'cover';
  if (role === 'ending') return 'ending';
  return 'content';
}

export function validateSocialCardDesignScheme({ designScheme, storyboardPages = [], expectedParadigmId = '' } = {}) {
  const issues = [];
  const warnings = [];
  const scheme = designScheme;
  if (!scheme || typeof scheme !== 'object' || Array.isArray(scheme)) {
    return { valid: false, issues: [{ code: 'DESIGN_SCHEME_REQUIRED', field: 'designScheme', message: '必须提交统一的结构化视觉方案' }], warnings: [], diversity: { pageCount: 0, distinctCompositions: 0, distinctPrimaryVisuals: 0, distinctBackgroundModes: 0, sharedAnchorCount: 0 } };
  }
  validateSchema(SOCIAL_CARD_DESIGN_SCHEME_SCHEMA, scheme, 'designScheme', issues);
  const paradigm = getSocialCardVisualParadigm(scheme.paradigmId);
  if (!paradigm) issues.push({ code: 'DESIGN_PARADIGM_UNKNOWN', field: 'paradigmId', message: '必须选择目录中的视觉范式' });
  if (expectedParadigmId && scheme.paradigmId !== expectedParadigmId) issues.push({ code: 'DESIGN_PARADIGM_MISMATCH', field: 'paradigmId', message: `必须使用用户已选择的范式 ${expectedParadigmId}` });

  const palette = scheme.palette || {};
  if (HEX.test(palette.text || '') && HEX.test(palette.background || '') && colorContrast(palette.text, palette.background) < 4.5) issues.push({ code: 'DESIGN_SCHEME_CONTRAST_LOW', field: 'palette.text', message: '正文颜色与背景对比度至少为 4.5:1' });
  if (HEX.test(palette.text || '') && HEX.test(palette.surface || '') && colorContrast(palette.text, palette.surface) < 4.5) issues.push({ code: 'DESIGN_SCHEME_CONTRAST_LOW', field: 'palette.text', message: '正文颜色与内容表面对比度至少为 4.5:1' });
  if (HEX.test(palette.accent || '') && HEX.test(palette.background || '') && colorContrast(palette.accent, palette.background) < 3) issues.push({ code: 'DESIGN_SCHEME_CONTRAST_LOW', field: 'palette.accent', message: '强调色与背景对比度至少为 3:1' });
  if (HEX.test(palette.muted || '') && HEX.test(palette.surface || '') && colorContrast(palette.muted, palette.surface) < 3) issues.push({ code: 'DESIGN_SCHEME_CONTRAST_LOW', field: 'palette.muted', message: '辅助文字与内容表面对比度至少为 3:1' });

  const anchors = Array.isArray(scheme.sharedAnchors) ? scheme.sharedAnchors : [];
  const anchorIds = anchors.map((anchor) => clean(anchor?.id));
  if (new Set(anchorIds).size !== anchorIds.length) issues.push({ code: 'SHARED_ANCHOR_ID_DUPLICATE', field: 'sharedAnchors', message: 'sharedAnchors id 不能重复' });

  const pages = Array.isArray(scheme.pages) ? scheme.pages : [];
  const sharedPageSequenceLocations = [];
  anchors.forEach((anchor, index) => {
    if (explicitPageSequenceCue.test(clean(anchor?.description))) sharedPageSequenceLocations.push(`sharedAnchors[${index}].description`);
  });
  const ornamentPageSequenceLocations = [];
  pages.forEach((page, index) => {
    (Array.isArray(page?.ornaments) ? page.ornaments : []).forEach((ornament, ornamentIndex) => {
      if (normalized(ornament?.kind) === 'index' && explicitPageSequenceCue.test(clean(ornament?.purpose))) {
        ornamentPageSequenceLocations.push(`pages[${index}].ornaments[${ornamentIndex}].purpose`);
      }
    });
  });
  if (sharedPageSequenceLocations.length > 1 || (sharedPageSequenceLocations.length > 0 && ornamentPageSequenceLocations.length > 0)) warnings.push({
    code: 'PAGE_NUMBERING_REDUNDANT',
    field: 'sharedAnchors',
    message: `页面序号同时出现在多个实际组件位置（${[...sharedPageSequenceLocations, ...ornamentPageSequenceLocations].join('、')}）；整组页序最多只在一个稳定位置显示，其他共享锚点改为无编号的视觉标识，内容步骤编号与页序分开。此项是自动修正建议，不作为生成门禁`,
  });
  if (!Array.isArray(storyboardPages) || pages.length !== storyboardPages.length) issues.push({ code: 'DESIGN_PAGE_COUNT_MISMATCH', field: 'pages', message: `pages 必须与锁定故事板页数一致（${storyboardPages.length} 页）` });
  pages.forEach((page, index) => {
    const label = `pages[${index}]`;
    if (Number(page?.page) !== index + 1) issues.push({ code: 'DESIGN_PAGE_NUMBER_INVALID', page: index + 1, field: `${label}.page`, message: `第 ${index + 1} 页 page 值必须为 ${index + 1}` });
    const expectedRole = normalizedSocialCardRole(storyboardPages[index] || {});
    if (clean(page?.role) !== expectedRole) issues.push({ code: 'DESIGN_PAGE_ROLE_MISMATCH', page: index + 1, field: `${label}.role`, message: `第 ${index + 1} 页 role 必须为 ${expectedRole}` });
    if (paradigm && !paradigm.supportedLayouts.includes(page?.layout)) issues.push({ code: 'DESIGN_PARADIGM_LAYOUT_MISMATCH', page: index + 1, field: `${label}.layout`, message: `所选范式「${paradigm.name}」不支持 ${page?.layout} 版式` });
    const ornaments = Array.isArray(page?.ornaments) ? page.ornaments : [];
    const kinds = ornaments.map((ornament) => normalized(ornament?.kind)).filter(Boolean);
    if (new Set(kinds).size !== kinds.length) issues.push({ code: 'DECORATION_PLAN_DUPLICATE', page: index + 1, field: `${label}.ornaments`, message: `第 ${index + 1} 页装饰类型不能重复` });
    if (ornaments.some((ornament) => !SOCIAL_CARD_ORNAMENT_KINDS.includes(clean(ornament?.kind)) || !SOCIAL_CARD_ORNAMENT_PLACEMENTS.includes(clean(ornament?.placement)))) {
      issues.push({ code: 'DECORATION_PLAN_INVALID', page: index + 1, field: `${label}.ornaments`, message: `第 ${index + 1} 页装饰类型或位置不在组件目录中` });
    }
  });

  if (pages.length >= 5) {
    if (new Set(pages.map((page) => normalized(page?.composition))).size < 3) warnings.push({ code: 'DESIGN_COMPOSITION_DIVERSITY_LOW', field: 'pages', message: '5 页及以上建议使用 3 种或更多构图；按内容需要决定，不作为生成阻断条件' });
    if (new Set(pages.map((page) => normalized(page?.backgroundMode))).size < 2) warnings.push({ code: 'DESIGN_BACKGROUND_DIVERSITY_LOW', field: 'pages', message: '5 页及以上可考虑变化背景或表面处理；按内容需要决定，不作为生成阻断条件' });
    for (let index = 1; index < pages.length; index += 1) {
      if (normalized(pages[index - 1]?.composition) === normalized(pages[index]?.composition)) warnings.push({ code: 'ADJACENT_COMPOSITION_REPEATED', page: index + 1, field: `pages[${index}].composition`, message: `第 ${index + 1} 页与上一页重复构图，可结合叙事考虑变化` });
      if (normalized(pages[index - 1]?.primaryVisual) === normalized(pages[index]?.primaryVisual)) warnings.push({ code: 'ADJACENT_PRIMARY_VISUAL_REPEATED', page: index + 1, field: `pages[${index}].primaryVisual`, message: `第 ${index + 1} 页与上一页重复主视觉，可结合内容考虑变化` });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    diversity: {
      pageCount: pages.length,
      distinctCompositions: new Set(pages.map((page) => normalized(page?.composition)).filter(Boolean)).size,
      distinctPrimaryVisuals: new Set(pages.map((page) => normalized(page?.primaryVisual)).filter(Boolean)).size,
      distinctBackgroundModes: new Set(pages.map((page) => normalized(page?.backgroundMode)).filter(Boolean)).size,
      sharedAnchorCount: anchors.length,
    },
  };
}
