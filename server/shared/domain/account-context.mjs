/**
 * 账号上下文管理
 * 定义公众号的定位、读者群体、内容支柱、风格约束和转化承接。
 * 由编辑室和成稿流程读取，注入到 AI 上下文中。
 */
import fs from 'node:fs';
import path from 'node:path';

let cached = null;
let cachedFile = '';

const EDITABLE_FIELDS = new Set([
  'name', 'description', 'readerProfile', 'contentPillars', 'voiceGuardrails',
  'packagingModes', 'followReason', 'conversionBridge', 'differentiators',
  'articleFramework', 'contentRatio', 'distributionStrategy', 'notificationPolicy', 'scoring',
]);

function getDefaults() {
  return {
    name: '我的公众号',
    description: '科技行业观察与深度分析',
    readerProfile: '技术从业者、产品经理、科技行业观察者',
    contentPillars: ['AI/技术动态', '大厂战略分析', '行业深度', '职场与成长'],
    voiceGuardrails: [
      '不写标题党，不夸大事实',
      '保持客观中立的分析立场',
      '有信息增量，不重复已知结论',
    ],
    packagingModes: ['搜索型', '分享型', '双栖型', '推荐型', '通知型'],
    followReason: '关注后可获得持续的技术行业深度分析和独家观察视角',
    conversionBridge: '文末可承接课程推荐、行业报告或社群引流',
    distributionStrategy: {
      recommendation: {
        purpose: '拉新、分享、收藏与搜索长尾',
        preferredTopics: ['工具', '开源项目', '工程实践'],
        titleRule: '场景痛点 + 可信证据 + 可获得结果',
      },
      notification: {
        purpose: '维护存量读者与表达账号判断',
        preferredTopics: ['职场变化', '平台事件', '读者切身利益'],
        titleRule: '事件 + 对目标读者的直接影响',
      },
      experiment: {
        purpose: '验证新栏目、新角度和不确定需求',
        preferredTopics: ['新技术认知', '弱相关热点的新切口'],
        titleRule: '明确待验证的问题，不伪装成已确认需求',
      },
    },
    notificationPolicy: {
      minimumMatchedCriteria: 2,
      minimumNotificationFit: 4,
      minimumFactSupport: 4,
      maxPerBatch: 2,
      blockedRiskLevels: ['高', '较高'],
      readerStakes: ['工作', '收入', '岗位', '效率', '成本', '选择'],
      criteria: [
        '影响读者的工作或选择',
        '标题能说明为什么与读者有关',
        '除新闻复述外有明确判断或行动增量',
      ],
    },
  };
}

export function loadAccountContext(filePath = path.join(process.cwd(), 'account-context.json')) {
  if (fs.existsSync(filePath)) {
    try {
      cached = JSON.parse(fs.readFileSync(filePath, 'utf8'));cachedFile=path.resolve(filePath);
      return cached;
    } catch (e) {
      // fall through to defaults
    }
  }
  cached = getDefaults();cachedFile=path.resolve(filePath);
  return cached;
}

export function getAccountContext(options={}) {
  if(!Object.keys(options).length&&cached)return cached;
  const filePath=options.filePath||path.join(options.workspaceRoot||process.cwd(),'account-context.json');
  if (!cached||cachedFile!==path.resolve(filePath)||options.refresh) return loadAccountContext(filePath);
  return cached;
}

export function formatAccountContext(options={}) {
  const ctx = getAccountContext(options);
  const parts = [];
  if (ctx.name) parts.push(`## 账号信息\n- 名称：${ctx.name}`);
  if (ctx.description) parts.push(`- 简介：${ctx.description}`);
  if (ctx.readerProfile) parts.push(`- 核心读者：${ctx.readerProfile}`);
  if (ctx.contentPillars?.length) parts.push(`\n## 内容支柱\n${ctx.contentPillars.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
  if (ctx.voiceGuardrails?.length) parts.push(`\n## 风格约束\n${ctx.voiceGuardrails.map((g) => `- ${g}`).join('\n')}`);
  if (ctx.packagingModes?.length) parts.push(`\n## 包装模式\n可用模式：${ctx.packagingModes.join('、')}。搜索型优先使用真实主体和事件词，分享型突出冲突和切身影响。`);
  if (ctx.followReason) parts.push(`\n## 关注理由\n${ctx.followReason}`);
  if (ctx.conversionBridge) parts.push(`\n## 转化承接\n${ctx.conversionBridge}`);
  if (ctx.differentiators?.length) parts.push(`\n## 差异化定位\n${ctx.differentiators.map((d) => `- ${d}`).join('\n')}`);
  if (ctx.articleFramework?.length) parts.push(`\n## 习惯文章结构\n${ctx.articleFramework.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (ctx.contentRatio && typeof ctx.contentRatio === 'object') parts.push(`\n## 内容配比\n${Object.entries(ctx.contentRatio).map(([k, v]) => `- ${k}：约 ${v}`).join('\n')}`);
  if (ctx.distributionStrategy && typeof ctx.distributionStrategy === 'object') {
    const laneNames = { recommendation: '推荐池', notification: '通知池', experiment: '实验池' };
    const lanes = Object.entries(ctx.distributionStrategy).map(([key, lane]) => {
      if (!lane || typeof lane !== 'object') return '';
      const lines = [`### ${laneNames[key] || key}`];
      if (lane.purpose) lines.push(`- 目标：${lane.purpose}`);
      if (Array.isArray(lane.preferredTopics) && lane.preferredTopics.length) lines.push(`- 优先内容：${lane.preferredTopics.join('、')}`);
      if (lane.titleRule) lines.push(`- 标题规则：${lane.titleRule}`);
      return lines.join('\n');
    }).filter(Boolean);
    if (lanes.length) parts.push(`\n## 分发策略\n${lanes.join('\n\n')}`);
  }
  if (ctx.notificationPolicy && typeof ctx.notificationPolicy === 'object') {
    const policy = ctx.notificationPolicy;
    const lines = [];
    if (Number.isFinite(Number(policy.minimumMatchedCriteria))) lines.push(`- 最少满足条件数：${Number(policy.minimumMatchedCriteria)}`);
    if (Number.isFinite(Number(policy.minimumNotificationFit))) lines.push(`- 最低通知适配分：${Number(policy.minimumNotificationFit)}/5`);
    if (Number.isFinite(Number(policy.minimumFactSupport))) lines.push(`- 最低事实支持分：${Number(policy.minimumFactSupport)}/5`);
    if (Number.isFinite(Number(policy.maxPerBatch))) lines.push(`- 每批通知池上限：${Number(policy.maxPerBatch)} 条（允许为空）`);
    if (Array.isArray(policy.blockedRiskLevels) && policy.blockedRiskLevels.length) lines.push(`- 禁止进入通知池的风险等级：${policy.blockedRiskLevels.join('、')}`);
    if (Array.isArray(policy.readerStakes) && policy.readerStakes.length) lines.push(`- 读者利益：${policy.readerStakes.join('、')}`);
    if (Array.isArray(policy.criteria) && policy.criteria.length) lines.push(...policy.criteria.map((item, index) => `${index + 1}. ${item}`));
    if (lines.length) parts.push(`\n## 通知资格\n${lines.join('\n')}`);
  }
  return parts.join('\n');
}

function accountContextPath(options = {}) {
  return path.resolve(options.filePath || path.join(options.workspaceRoot || process.cwd(), 'account-context.json'));
}

function cleanText(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本`);
  return value.trim();
}

function cleanList(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`);
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error(`${field} 只能包含文本`);
    return item.trim();
  }).filter(Boolean);
}

function hasText(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function normalizeAccountPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('账号配置必须是对象');
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    if (['contentPillars', 'voiceGuardrails', 'packagingModes', 'differentiators', 'articleFramework'].includes(key)) {
      patch[key] = cleanList(value, key);
    } else if (['contentRatio', 'distributionStrategy', 'notificationPolicy', 'scoring'].includes(key)) {
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`${key} 必须是对象`);
      patch[key] = value;
    } else {
      patch[key] = cleanText(value, key);
    }
  }
  return patch;
}

export function isAccountContextConfigured(context, options = {}) {
  const filePath = accountContextPath(options);
  return fs.existsSync(filePath)
    && hasText(context?.name)
    && hasText(context?.description)
    && hasText(context?.readerProfile)
    && Array.isArray(context?.contentPillars)
    && context.contentPillars.length > 0;
}

export function saveAccountContext(input, options = {}) {
  const filePath = accountContextPath(options);
  let existing = {};
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = {};
    }
  }
  const patch = normalizeAccountPatch(input);
  const next = { ...existing, ...patch };
  if (!hasText(next.name) || !hasText(next.description) || !hasText(next.readerProfile) || !Array.isArray(next.contentPillars) || !next.contentPillars.length) {
    throw new Error('请至少填写账号名称、账号简介、核心读者和一个内容支柱');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
  cached = next;
  cachedFile = filePath;
  return next;
}
