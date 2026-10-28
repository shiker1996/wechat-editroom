import { selectSkillPromptReferences } from '../../../platform/llm/skill-runtime.mjs';
import { resolvePrompt } from '../../../platform/llm/prompt-registry.mjs';

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
  const channelComponent = channelMode === 'xiaohongshu'
    ? 'social-cards.copy-channel-xiaohongshu'
    : 'social-cards.copy-channel-wechat';
  const contentComponent = contentType === 'repository'
    ? 'social-cards.copy-content-repository'
    : contentType === 'custom' ? 'social-cards.copy-content-custom' : 'social-cards.copy-content-event';
  const runtimePrompt = resolvePrompt('social-cards.copy', { titleLabel }, {
    components: [channelComponent, contentComponent],
  }).text;
  return `${buildSocialCardCopySkillPrompt(skillPrompt, { contentType, storyboardClass })}\n\n${runtimePrompt}`;
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
  const repositoryUrl = String(acquisition.repository_url || '').trim();
  if (!repositoryUrl) return value;
  const lines = value.split(/\r?\n/);
  const cleanedLines = lines.filter((line) => {
    const hasUrl = /https?:\/\//i.test(line);
    return !(hasUrl && (/下载入口|GitHub Releases|github\.com\/[^\s]+\/releases/i.test(line)));
  });
  const cleaned = cleanedLines.join('\n').trim();
  const hasRepositoryAddress = cleaned.split(/\r?\n/).some((line) =>
    /(获取地址|项目主页)/i.test(line) && line.includes(repositoryUrl));
  if (hasRepositoryAddress) return cleaned;
  return `${cleaned}${cleaned ? '\n\n' : ''}项目主页：${repositoryUrl}`;
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
