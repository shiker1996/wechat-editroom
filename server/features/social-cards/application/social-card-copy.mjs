import { selectSkillPromptReferences } from '../../../platform/llm/skill-runtime.mjs';

function copyReferences(contentType) {
  const primary = contentType === 'event'
    ? 'references\\copy-event.md'
    : contentType === 'custom' ? 'references\\copy-custom.md' : 'references\\copy-tool.md';
  const legacy = contentType === 'event' ? 'references\\wechat-event-cards.md'
    : contentType === 'custom' ? 'references\\custom-cards.md' : 'references\\wechat-tool-cards.md';
  return [primary, legacy];
}

export function buildSocialCardCopySkillPrompt(skillPrompt, { contentType } = {}) {
  return selectSkillPromptReferences(skillPrompt, {
    include: [...(contentType === 'repository' ? ['COPY_GUIDE.md'] : []), ...copyReferences(contentType)],
  });
}

export function buildSocialCardCopyInput({
  channelMode = 'wechat',
  outputMode = '',
  topic = '',
  contentType = 'event',
  storyboardClass,
  factData = {},
  sourceUrl = '',
  eventAnalysis = null,
  editorial = {},
  cardPlan = [],
  disclosure = '',
} = {}) {
  const sourceUrls = contentType === 'event'
    ? (eventAnalysis?.sources || factData?.sources || []).map((item) => item?.url).filter(Boolean)
    : contentType === 'custom'
      ? (factData?.materials || []).map((item) => item?.url).filter(Boolean)
      : [];
  return {
    channel_mode: outputMode || channelMode,
    topic,
    content_type: contentType,
    storyboard_class: contentType === 'event' ? storyboardClass : undefined,
    custom_content_type: contentType === 'custom' ? factData?.content_type : undefined,
    source_url: contentType === 'event' ? sourceUrls : contentType === 'custom' ? sourceUrls : sourceUrl,
    repository_facts: contentType === 'repository' ? factData : undefined,
    acquisition: contentType === 'repository' ? {
      repository_url: String(factData?.sourceUrl || sourceUrl || '').trim(),
      release_url: factData?.latestRelease?.version && factData?.latestRelease?.source
        ? String(factData.latestRelease.source).trim() : '',
      latest_release_available: Boolean(factData?.latestRelease?.version),
    } : undefined,
    event_analysis: contentType === 'event' ? (eventAnalysis || factData) : undefined,
    custom_facts: contentType === 'custom' ? factData : undefined,
    editorial_decisions: editorial,
    card_plan: cardPlan,
    disclosure,
  };
}

export function buildSocialCardCopySystemPrompt(skillPrompt, { channelMode = 'wechat', contentType = 'event', storyboardClass } = {}) {
  const titleLabel = channelMode === 'xiaohongshu' ? '小红书笔记标题' : '公众号发布标题';
  const repositoryTitleRules = contentType === 'repository'
    ? `
### GitHub 工具贴图标题补充
- 标题先让读者看懂“要完成什么任务、能得到什么结果”，项目名作为识别信息，不让仓库名或 Star 数代替价值说明。
- 优先使用“具体任务/输入 + 可见输出”或“具体场景 + 工具解决的问题”；例如只有事实基座确实支持时，才可写“PDF 转 Markdown”“一条命令生成可预览页面”。
- “免费”“一键”“几分钟”“省时/提效”“亲测”等词必须分别有价格/许可、完整命令、时长测量、对比数据或真实运行记录支持；没有就不用。
- 避免“神器、天花板、封神、闭眼冲”等不能说明任务结果的评价词。标题承诺必须能在封面和故事板中看到证据。

### GitHub 工具贴图配套文案补充
- 文案必须覆盖读者关心的三项：使用背景/具体痛点、项目最值得关注的 1–3 个亮点、明确的获取地址。
- 背景要具体到任务、输入或遇到的阻碍；不得泛称“程序员效率低”“工作太忙”，除非事实素材明确支持。
- 亮点优先写能解决该任务的核心能力、可见输出、真实上手路径或重要适用边界；每项都要能在事实基座或故事板中找到来源，不罗列与读者任务无关的功能。
- 获取地址单独成行。优先使用事实基座明确给出的 Releases/下载页；没有独立下载入口时使用 GitHub 仓库主页。不得把仓库主页冒称为安装包直链，也不得编造 URL。
- 文案输入没有可用获取地址时，明确写“获取地址待补”，不要省略该项或猜测地址。
`
    : '';
  return `${buildSocialCardCopySkillPrompt(skillPrompt, { contentType, storyboardClass })}

## 当前运行阶段
生成一个明确的发布标题和可直接发布的配套文案。第一行必须严格写成“${titleLabel}：<标题>”，空一行后输出文案正文；标题不要在正文重复。输出纯文本，不要 JSON、Markdown 围栏、页码或布局指令；严格遵守事实与禁用表达。

### ${titleLabel}规则
- 只生成一个推荐标题，直接供作者复制发布；不要给候选列表。
- 先确定读者最可能搜索的具体主体词、工具/产品名或主题词，以及其搜索意图；标题应与卡片内容和事实基座一致。
- 将最有辨识度的具体关键词自然放在标题前半句，再说明读者要解决的问题、了解的变化或获得的内容。优先采用具体问题或任务表达，避免“值得收藏”“终于来了”等无法检索的空泛钩子。
- 关键词必须有输入依据；不得编造搜索热度、排名、体验、效果、数字或结论，不堆砌近义词，不做标题党。
`;
}

export function parseSocialCardCopyOutput(value = '', { channelMode = 'wechat' } = {}) {
  const text = String(value || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBreak = text.search(/\r?\n/);
  const firstLine = (firstBreak < 0 ? text : text.slice(0, firstBreak)).trim();
  const match = firstLine.match(/^(?:公众号发布标题|小红书笔记标题|发布标题|标题)\s*[:：]\s*(.+)$/);
  if (!match) return { publishTitle: '', copy: text };
  const publishTitle = match[1].trim();
  const copy = (firstBreak < 0 ? '' : text.slice(firstBreak).replace(/^\r?\n\s*\r?\n/, '')).trim();
  return { publishTitle, copy };
}

export function formatSocialCardCopyArtifact({ publishTitle = '', copy = '', channelMode = 'wechat' } = {}) {
  const title = String(publishTitle || '').trim();
  const body = String(copy || '').trim();
  const label = channelMode === 'xiaohongshu' ? '小红书笔记标题' : '公众号发布标题';
  return `${title ? `${label}：${title}\n\n` : ''}${body}`;
}

export function validateSocialCardCopy(copy = '') {
  const value = String(copy || '').trim();
  const issues = [];
  if (!value) issues.push('配套文案为空');
  const copyTagCount = (value.match(/#[^#\s]{1,30}/g) || []).length;
  if (value && copyTagCount < 3) issues.push(`配套文案话题标签不足（检测到 ${copyTagCount} 个，末尾应有 6–8 个）`);
  return { valid: issues.length === 0, issues, tagCount: copyTagCount };
}

function ensureRepositoryAcquisitionAddress(copy, acquisition = {}) {
  const value = String(copy || '').trim();
  const releaseUrl = String(acquisition.release_url || '').trim();
  const repositoryUrl = String(acquisition.repository_url || '').trim();
  const preferredUrl = releaseUrl || repositoryUrl;
  const hasLabeledAddress = value.split(/\r?\n/).some((line) =>
    /(获取地址|下载入口|项目主页|release)/i.test(line) && line.includes(preferredUrl));
  if (!preferredUrl || hasLabeledAddress) return value;
  const label = releaseUrl ? '下载入口（GitHub Releases，具体文件以页面为准）' : '项目主页（安装与下载说明见 README）';
  return `${value}${value ? '\n\n' : ''}${label}：${preferredUrl}`;
}

export async function generateSocialCardCopy({
  gateway,
  provider,
  providerConfig = {},
  batchId,
  candidateId,
  skillPrompt,
  channelMode = 'wechat',
  outputMode = '',
  topic = '',
  contentType = 'event',
  storyboardClass,
  factData = {},
  sourceUrl = '',
  eventAnalysis = null,
  editorial = {},
  cardPlan = [],
  disclosure = '',
} = {}) {
  const input = buildSocialCardCopyInput({ channelMode, outputMode, topic, contentType, storyboardClass, factData, sourceUrl, eventAnalysis, editorial, cardPlan, disclosure });
  const result = await gateway.complete({
    provider,
    purpose: 'social-card-copy',
    batchId,
    candidateId,
    maxOutputTokens: Math.min(2400, Number(providerConfig.maxOutputTokens) || 2400),
    messages: [
      { role: 'system', protected: true, content: buildSocialCardCopySystemPrompt(skillPrompt, { channelMode, contentType, storyboardClass }) },
      { role: 'user', protected: true, content: JSON.stringify(input) },
    ],
  });
  const parsed = parseSocialCardCopyOutput(result?.content || '', { channelMode });
  const copy = contentType === 'repository'
    ? ensureRepositoryAcquisitionAddress(parsed.copy, input.acquisition)
    : parsed.copy;
  return { publishTitle: parsed.publishTitle, copy, result, input };
}
