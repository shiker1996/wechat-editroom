import { createHash } from 'node:crypto';

export const SOCIAL_CARD_VISUAL_PARADIGM_VERSION = 1;

const item = (id, name, summary, fit, layoutRule, layouts, cues) => Object.freeze({
  id, name, summary, fit, layoutRule,
  supportedLayouts: Object.freeze(layouts),
  cues: Object.freeze(cues),
  preview: Object.freeze({ kind: id, pages: Object.freeze(['cover', 'content-a', 'content-b', 'ending']) }),
});

export const SOCIAL_CARD_VISUAL_PARADIGMS = Object.freeze([
  item('editorial-atlas', '编辑档案结构', '结构范式：以标题、证据和注释组织一组内容；不预设配色、字体或视觉风格。', '适合脉络梳理、解释和有来源支撑的判断。', '封面建立主题；内页交替使用叙述、证据和对照；结尾收束判断。', ['poster','editorial','evidence','comparison','minimal'], ['背景','证据','来源','脉络','原因','变化','解读','结论']),
  item('continuous-scroll', '连续流程结构', '结构范式：用跨页线索连接阶段、步骤或时间节点；不预设配色、字体或视觉风格。', '适合流程、时间线、前后演变和连续关系。', '相邻页共享一条视觉线索，页面焦点沿线推进，禁止只靠重复页壳。', ['steps','timeline','feature','evidence','editorial'], ['步骤','流程','阶段','时间','先','再','之后','演进']),
  item('index-atlas', '索引图谱结构', '结构范式：用数字、分组、标签和对照帮助读者定位；不预设配色、字体或视觉风格。', '适合统计、排行、清单和多项比较。', '先给总览，再拆分分组；高密页要有明确主次，数字和标签成为图形。', ['data','checklist','comparison','evidence','poster'], ['数据','数字','排行','清单','对比','指标','几类','分别']),
  item('daily-brief', '事件进展结构', '结构范式：按时间、主体和影响层级组织事件；不预设新闻卡片外观或视觉风格。', '适合发布、事件复盘和多方动态汇总。', '按事件推进组织内容；事实、来源和影响分层呈现，避免统一新闻卡片堆叠。', ['editorial','timeline','evidence','checklist','comparison'], ['发布','回应','通知','事件','进展','影响','后续','当天']),
  item('collectible-cards', '对象卡组结构', '结构范式：每页聚焦一个可独立识别的对象，以共同索引保持系列感；不预设视觉皮肤。', '适合工具、人物、产品功能或同类对象介绍。', '同类对象使用稳定信息槽位，但每页主视觉与构图要变化。', ['feature','comparison','data','checklist','minimal'], ['功能','对象','工具','产品','能力','特点','方案','案例']),
  item('focal-essay', '单点特写结构', '结构范式：每页围绕一个核心对象或观点建立焦点；不预设留白量、配色或视觉风格。', '适合单一观点、关键结论、人物或物件特写。', '每页只突出一个重点；留白用于建立层级，不能造成内容空洞。', ['minimal','poster','editorial','evidence','feature'], ['一个','核心','观点','关键','本质','为什么','判断','值得']),
  item('product-sticker', '界面注释结构', '结构范式：以已提供的真实界面或产品素材为主，周围组织注释和步骤；不仿造缺失素材。', '适合有真实界面或产品素材的上手介绍。', '产品素材须来自输入；说明围绕素材组织，不仿造未提供的界面。', ['feature','steps','comparison','checklist','poster'], ['界面','截图','控件','上手','安装','配置','操作','设置']),
  item('freeform', '自由结构', '不套固定页面结构，由本篇内容和证据决定组织方式；视觉主题仍单独推导。', '适合范式目录无法表达或用户已有明确设计方向的内容。', '保留结构多样和系列锚点要求；颜色与风格按内容推导。', ['poster','editorial','data','checklist','steps','minimal','timeline','comparison','evidence','feature'], []),
]);

const PARADIGM_BY_ID = new Map(SOCIAL_CARD_VISUAL_PARADIGMS.map((paradigm) => [paradigm.id, paradigm]));

export function getSocialCardVisualParadigm(id) {
  return PARADIGM_BY_ID.get(String(id || '')) || null;
}

export function socialCardStoryboardFingerprint(pages = []) {
  return createHash('sha256').update(JSON.stringify(Array.isArray(pages) ? pages : [])).digest('hex');
}

export function resolveSocialCardParadigmSelection(editorial = {}, pages = []) {
  let stored = {};
  try { stored = JSON.parse(editorial.visual_paradigm_json || '{}'); } catch {}
  const currentFingerprint = socialCardStoryboardFingerprint(pages);
  const paradigm = getSocialCardVisualParadigm(stored.id);
  const current = Boolean(paradigm && stored.storyboardFingerprint === currentFingerprint);
  return { id: current ? paradigm.id : '', paradigm: current ? paradigm : null, stale: Boolean(paradigm && !current), selectedAt: current ? stored.selectedAt || '' : '', storyboardFingerprint: currentFingerprint };
}

export function rankSocialCardVisualParadigms(pages = [], { selectedId = '' } = {}) {
  const text = (Array.isArray(pages) ? pages : []).map((page) => [page?.title, page?.goal, page?.layout_intent, ...(page?.content_blocks || []).map((block) => `${block?.type || ''} ${block?.title || ''} ${block?.content || ''}`)].join(' ')).join(' ').toLowerCase();
  const blockTypes = (Array.isArray(pages) ? pages : []).flatMap((page) => (page?.content_blocks || []).map((block) => String(block?.type || '').toLowerCase()));
  const keywordScore = (cues) => cues.reduce((score, cue) => score + (text.includes(cue.toLowerCase()) ? 2 : 0), 0);
  const scores = new Map(SOCIAL_CARD_VISUAL_PARADIGMS.filter((option) => option.id !== 'freeform').map((option) => [option.id, keywordScore(option.cues)]));
  if (blockTypes.some((type) => ['steps','timeline','process'].includes(type))) scores.set('continuous-scroll', scores.get('continuous-scroll') + 5);
  if (blockTypes.some((type) => ['list','checklist','data','stats','comparison'].includes(type))) scores.set('index-atlas', scores.get('index-atlas') + 5);
  if (blockTypes.some((type) => ['quote','source','evidence','case'].includes(type))) scores.set('editorial-atlas', scores.get('editorial-atlas') + 3);
  if ((Array.isArray(pages) ? pages : []).filter((page) => page?.role === 'content' || page?.kind === 'content').length >= 3) scores.set('collectible-cards', scores.get('collectible-cards') + 1);
  const ranked = SOCIAL_CARD_VISUAL_PARADIGMS.filter((option) => option.id !== 'freeform')
    .map((option) => ({ ...option, score: scores.get(option.id) || 0, recommended: false }))
    .sort((left, right) => right.score - left.score || SOCIAL_CARD_VISUAL_PARADIGMS.findIndex((entry) => entry.id === left.id) - SOCIAL_CARD_VISUAL_PARADIGMS.findIndex((entry) => entry.id === right.id));
  const recommendations = ranked.slice(0, 3);
  for (const option of recommendations) option.recommended = true;
  const freeform = { ...getSocialCardVisualParadigm('freeform'), score: 0, recommended: false };
  const options = [...recommendations, freeform];
  if (selectedId && !options.some((option) => option.id === selectedId)) {
    const selected = getSocialCardVisualParadigm(selectedId);
    if (selected) options.splice(3, 0, { ...selected, score: scores.get(selectedId) || 0, recommended: false });
  }
  return options;
}
