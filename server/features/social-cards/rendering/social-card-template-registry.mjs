import { SOCIAL_CARD_PAGE_ROLES } from './social-card-role.mjs';
import { getSocialCardSupplementSlots } from './social-card-supplement-slots.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

export const SOCIAL_CARD_RENDERER_BLOCK_TYPES = Object.freeze([
  'text', 'list', 'code', 'note', 'stats', 'compare', 'steps', 'timeline', 'scenes', 'highlight',
]);

export const SOCIAL_CARD_CHANNEL_BLOCK_TYPES = Object.freeze({
  wechat: Object.freeze(['text', 'list', 'code', 'note']),
  xiaohongshu: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
});

// 阶段 1 的容量基线：这是页面结构预检使用的“安全估算”，不是最终布局门禁。
// 最终是否溢出仍以 375×667 浏览器审计为准；阶段 2 才会用这些字段驱动拆页。
const ROLE_CAPACITY_BASELINES = Object.freeze({
  cover: Object.freeze({ bodyHeightPx: 470, maxTitleLines: 4, maxTextChars: 180, maxListItemLines: 2, minBodyUtilization: .45, maxBodyUtilization: .90, splitAllowed: false, splitBlockTypes: [] }),
  concept: Object.freeze({ bodyHeightPx: 432, maxTitleLines: 3, maxTextChars: 360, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note', 'code'] }),
  feature: Object.freeze({ bodyHeightPx: 424, maxTitleLines: 3, maxTextChars: 300, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note', 'code'] }),
  steps: Object.freeze({ bodyHeightPx: 420, maxTitleLines: 3, maxTextChars: 280, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['steps', 'list', 'text', 'note', 'code'] }),
  data: Object.freeze({ bodyHeightPx: 410, maxTitleLines: 3, maxTextChars: 240, maxListItemLines: 2, minBodyUtilization: .45, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['stats', 'compare', 'list', 'text', 'note', 'code'] }),
  compare: Object.freeze({ bodyHeightPx: 404, maxTitleLines: 3, maxTextChars: 220, maxListItemLines: 2, minBodyUtilization: .45, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['compare', 'list', 'text', 'note', 'code'] }),
  evidence: Object.freeze({ bodyHeightPx: 416, maxTitleLines: 3, maxTextChars: 300, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note', 'code'] }),
  timeline: Object.freeze({ bodyHeightPx: 408, maxTitleLines: 3, maxTextChars: 260, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['timeline', 'list', 'text', 'note', 'code'] }),
  risk: Object.freeze({ bodyHeightPx: 420, maxTitleLines: 3, maxTextChars: 280, maxListItemLines: 2, minBodyUtilization: .50, maxBodyUtilization: .94, splitAllowed: true, splitBlockTypes: ['list', 'text', 'note', 'code'] }),
  ending: Object.freeze({ bodyHeightPx: 430, maxTitleLines: 3, maxTextChars: 180, maxListItemLines: 2, minBodyUtilization: .20, maxBodyUtilization: .90, splitAllowed: false, splitBlockTypes: [] }),
});

function roleCapacity(role) {
  const baseline = ROLE_CAPACITY_BASELINES[role] || ROLE_CAPACITY_BASELINES.concept;
  return Object.freeze({
    ...baseline,
    calibration: 'phase1-baseline',
  });
}

function roleCapability(role, values) {
  return Object.freeze({ ...values, supplementSlots: getSocialCardSupplementSlots(role), capacity: roleCapacity(role) });
}

const STANDARD_ROLE_TEMPLATES = Object.freeze({
  cover: 'hero-stack',
  concept: 'concept-split',
  feature: 'feature-ledger',
  steps: 'sequence-rail',
  data: 'metric-board',
  compare: 'comparison-board',
  evidence: 'evidence-ledger',
  timeline: 'timeline-rail',
  risk: 'risk-sidebar',
  ending: 'closing-focus',
});

const STANDARD_ROLE_CAPABILITIES = Object.freeze(Object.fromEntries(
  SOCIAL_CARD_PAGE_ROLES.map((role) => [role, roleCapability(role, {
    template: STANDARD_ROLE_TEMPLATES[role],
    supportedBlocks: SOCIAL_CARD_RENDERER_BLOCK_TYPES,
    maxBlocks: role === 'cover' ? 2 : role === 'ending' ? 2 : 4,
    maxItems: 9,
  })]),
));

export const SOCIAL_CARD_TEMPLATE_PACKS = freeze({
  'standard-v1': {
    id: 'standard-v1',
    version: 1,
    label: '页面结构约束',
    renderer: 'current-deterministic-renderer',
    roleTemplates: STANDARD_ROLE_TEMPLATES,
    roles: STANDARD_ROLE_CAPABILITIES,
    fallbackTemplate: null,
  },
});

export const DEFAULT_SOCIAL_CARD_TEMPLATE_PACK = 'standard-v1';

export function getSocialCardTemplatePack(id = DEFAULT_SOCIAL_CARD_TEMPLATE_PACK) {
  return SOCIAL_CARD_TEMPLATE_PACKS[String(id || DEFAULT_SOCIAL_CARD_TEMPLATE_PACK)] || null;
}

export function listSocialCardTemplatePacks() {
  return Object.values(SOCIAL_CARD_TEMPLATE_PACKS);
}

export function socialCardTemplateEditorCatalog() {
  return listSocialCardTemplatePacks().map((pack) => ({
    id: pack.id,
    version: pack.version,
    label: pack.label,
    renderer: pack.renderer,
    fallbackTemplate: pack.fallbackTemplate,
    roleTemplates: { ...pack.roleTemplates },
    roles: Object.fromEntries(Object.entries(pack.roles).map(([role, value]) => [role, {
      template: value.template,
      maxBlocks: value.maxBlocks,
      maxItems: value.maxItems,
      supplementSlots: value.supplementSlots ? value.supplementSlots.map((slot) => ({ ...slot, blockTypes: [...slot.blockTypes] })) : [],
      capacity: value.capacity ? { ...value.capacity, splitBlockTypes: [...value.capacity.splitBlockTypes] } : null,
      supportedBlocks: [...value.supportedBlocks],
    }])),
  }));
}
