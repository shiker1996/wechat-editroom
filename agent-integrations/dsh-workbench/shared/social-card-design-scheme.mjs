import { SOCIAL_CARD_VISUAL_PARADIGMS } from '../social-card-visual-paradigms.mjs';

export const SOCIAL_CARD_DESIGN_SCHEME_VERSION = 4;
export const SOCIAL_CARD_PAGE_LAYOUTS = Object.freeze(['poster', 'editorial', 'data', 'checklist', 'steps', 'minimal', 'timeline', 'comparison', 'evidence', 'feature']);

const textSchema = (description, maxLength = 120) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S', description });
const markerSchema = (description) => ({ type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', description });
const objectSchema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

export const SOCIAL_CARD_DESIGN_SCHEME_SCHEMA = objectSchema({
  schemaVersion: { type: 'integer', enum: [SOCIAL_CARD_DESIGN_SCHEME_VERSION] },
  contentReading: objectSchema({
    subject: textSchema('主题对象。'),
    narrative: textSchema('整组信息的叙事路径。'),
    readerFeeling: textSchema('希望读者产生的感受。'),
    visualAnchor: textSchema('最值得视觉化的证据或结果。'),
  }),
  paradigmId: { type: 'string', enum: SOCIAL_CARD_VISUAL_PARADIGMS.map((paradigm) => paradigm.id), description: '用户选定的整组结构范式；范式只限定结构，不预设配色和字体。' },
  visualDirection: textSchema('基于内容判断说明整组视觉方向。', 100),
  palette: objectSchema({
    background: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '画布背景色。' },
    surface: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '内容表面颜色。' },
    text: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '正文颜色。' },
    muted: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '辅助文字颜色。' },
    accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '主强调色。' },
    accentSecondary: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '次强调色。' },
  }),
  typography: objectSchema({
    family: { type: 'string', enum: ['sans', 'serif', 'mono'] },
    titlePx: { type: 'number', minimum: 30, maximum: 40 },
    bodyPx: { type: 'number', minimum: 13, maximum: 16 },
    captionPx: { type: 'number', minimum: 12, maximum: 14 },
    lineHeight: { type: 'number', minimum: 1.45, maximum: 1.7 },
  }),
  composition: objectSchema({
    grid: textSchema('整组网格原则。', 80),
    density: textSchema('整组信息密度原则。', 80),
    rhythm: textSchema('整组页面节奏。', 80),
    motif: textSchema('整组视觉母题。', 80),
  }),
  designLanguage: objectSchema({
    colorLogic: textSchema('配色选择及其内容依据。', 100),
    shape: textSchema('形状语言。', 100),
    surface: textSchema('表面处理。', 100),
    graphics: textSchema('图形语言。', 100),
    imageTreatment: textSchema('图像处理。', 100),
  }),
  sharedAnchors: {
    type: 'array', minItems: 2, maxItems: 3,
    items: objectSchema({ id: markerSchema('系列共用元素 ID。'), description: textSchema('系列共用元素说明。') }),
  },
  pages: {
    type: 'array', minItems: 4, maxItems: 10,
    items: objectSchema({
      page: { type: 'integer', minimum: 1 },
      role: { type: 'string', enum: ['cover', 'content', 'ending'] },
      visualPurpose: textSchema('本页的阅读/表达目的。'),
      layout: { type: 'string', enum: SOCIAL_CARD_PAGE_LAYOUTS },
      focus: textSchema('本页要突出的事实或视觉焦点。', 100),
      treatment: textSchema('本页对焦点的具体视觉处理。', 100),
      composition: markerSchema('页面构图标记。'),
      primaryVisual: markerSchema('页面主视觉标记。'),
      backgroundMode: markerSchema('页面背景/表面标记。'),
      accentPlacement: markerSchema('强调元素位置标记。'),
    }),
  },
});

export const SOCIAL_CARD_DESIGN_SCHEME_TOOL_SCHEMA = {
  ...SOCIAL_CARD_DESIGN_SCHEME_SCHEMA,
  description: '公众号/小红书图文统一视觉方案 v4。内外部生成路径共用用户选择的 paradigmId、内容判断、视觉令牌、系列锚点和分页字段；范式约束版式结构，不预设颜色或字体。HTML 每页须以 data-page、data-page-role、data-visual-composition、data-primary-visual、data-background-mode、data-accent-placement 回填同值，并在每页放置全部 data-shared-anchor 标记。',
};
