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
    include: ['COPY_GUIDE.md', ...copyReferences(contentType)],
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
    event_analysis: contentType === 'event' ? (eventAnalysis || factData) : undefined,
    custom_facts: contentType === 'custom' ? factData : undefined,
    editorial_decisions: editorial,
    card_plan: cardPlan,
    disclosure,
  };
}

export function buildSocialCardCopySystemPrompt(skillPrompt, { channelMode = 'wechat', contentType = 'event', storyboardClass } = {}) {
  const titleLabel = channelMode === 'xiaohongshu' ? '小红书笔记标题' : '公众号发布标题';
  return `${buildSocialCardCopySkillPrompt(skillPrompt, { contentType, storyboardClass })}

## 当前运行阶段
生成一个明确的发布标题和可直接发布的配套文案。第一行必须严格写成“${titleLabel}：<标题>”，空一行后输出文案正文；标题不要在正文重复。输出纯文本，不要 JSON、Markdown 围栏、页码或布局指令；严格遵守事实与禁用表达。

### ${titleLabel}规则
- 只生成一个推荐标题，直接供作者复制发布；不要给候选列表。
- 先确定读者最可能搜索的具体主体词、工具/产品名或主题词，以及其搜索意图；标题应与卡片内容和事实基座一致。
- 将最有辨识度的具体关键词自然放在标题前半句，再说明读者要解决的问题、了解的变化或获得的内容。优先采用具体问题或任务表达，避免“值得收藏”“终于来了”等无法检索的空泛钩子。
- 关键词必须有输入依据；不得编造搜索热度、排名、体验、效果、数字或结论，不堆砌近义词，不做标题党。
${channelMode === 'xiaohongshu' ? '小红书渠道：文案口语化、段落短，适度使用 emoji，末尾带 6–8 个话题标签，标签不得含夸大功效词。' : '公众号渠道：文案信息密度优先、结构清晰，末尾带 6–8 个准确话题标签，标签须与内容严格相关。'}${contentType === 'event' ? ' 未核实主张必须注明说话者和“尚未获独立证实”等边界；不得把技术能力、趋势判断或争议定性为超出证据的结论。' : ''}${contentType === 'custom' ? ' 体验性表述只能来自 source_level=author_experience 的要点；user_material 必须保留来源归属；model_suggestion 只能写成建议或参考，禁止写成亲测、效果或收益。' : ''}`;
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
  const { publishTitle, copy } = parseSocialCardCopyOutput(result?.content || '', { channelMode });
  return { publishTitle, copy, result, input };
}
