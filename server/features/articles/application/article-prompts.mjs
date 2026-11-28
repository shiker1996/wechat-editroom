import { resolvePrompt } from '../../../platform/llm/prompt-registry.mjs';

// Runtime prompts own the shared contracts. The title prompt is the fallback when
// no user title Skill is selected; other stage prompts remain standalone.
export const ARTICLE_PROMPT_VERSION = 'direct-brief-v25';
export const ARTICLE_LENGTH_ADJUSTMENT_THRESHOLD = 200;

export function planArticleLengthAdjustment(currentVisibleChars, allowedRange) {
  const min = Number(allowedRange?.min) || 0;
  const max = Number(allowedRange?.max) || min;
  const margin = Math.min(50, Math.max(10, Math.round((max - min) * 0.05)));
  const adjustment = currentVisibleChars < min ? 'expand' : currentVisibleChars > max ? 'shorten' : 'none';
  const targetVisibleChars = adjustment === 'expand'
    ? Math.min(max, min + margin)
    : adjustment === 'shorten' ? Math.max(min, max - margin) : currentVisibleChars;
  const changeRequired = Math.abs(targetVisibleChars - currentVisibleChars);
  return {
    adjustment,
    targetVisibleChars,
    changeRequired,
    threshold: ARTICLE_LENGTH_ADJUSTMENT_THRESHOLD,
    strategy: changeRequired >= ARTICLE_LENGTH_ADJUSTMENT_THRESHOLD ? 'structural' : 'expressive',
  };
}

const STAGES = Object.freeze({ facts:'articles.facts', drafting:'articles.draft', review:'articles.review', repair:'articles.repair', lengthAdjust:'articles.length-adjust', title:'articles.title' });
const ARTICLE_TYPE_COMPONENTS = Object.freeze({ 'wechat-mp-tech-deep':'articles.type-tech-deep', 'wechat-mp-deep-dive':'articles.type-deep-dive', 'wechat-mp-gossip-chill':'articles.type-gossip-chill', 'wechat-mp-composite':'articles.type-composite' });
const stageAssets = Object.fromEntries(Object.entries(STAGES).map(([name,id])=>[name,name==='drafting'?resolvePrompt(id,{}, {components:[]}):resolvePrompt(id)]));
export const ARTICLE_PROMPTS = Object.freeze({
  ...Object.fromEntries(Object.entries(stageAssets).map(([name,asset])=>[name,asset.text])),
  // Kept for explicit/manual editing requests; the default pipeline skips both rewrites.
  fullEdit: resolvePrompt('articles.full-edit').text,
  humanize: resolvePrompt('articles.humanize').text,
});

export function draftSystemPrompt(articleType) {
  const component=ARTICLE_TYPE_COMPONENTS[articleType];
  return resolvePrompt('articles.draft',{}, {components:component?[component]:[]}).text;
}
export function articleReaderContext(account = {}) {
  return {
    description: account.description || '面向开发者和技术从业者，讨论技术、产品与平台变化。',
    readerProfile: account.readerProfile || '程序员和技术从业者，兼顾技术管理者与泛科技读者。',
    expression: '通俗、具体，保留必要专业细节；具体角度与立场沿用已确认简报。优先服务开发者、普通职场人和泛科技读者，管理者为次级受众，除非其为主要受影响者。可以用钩子开篇，但尽早交代支撑评论的事实、来源和边界，再展开推理；建议仅在主要受众确有具体选择且证据充分时提出。背景用于写作选择，不作为正文内容。',
  };
}

export function articlePromptManifest(articleType) {
  const prompts=Object.fromEntries(Object.entries(STAGES).map(([stage,id])=>{
    const component=stage==='drafting'?ARTICLE_TYPE_COMPONENTS[articleType]:null;
    const resolved=stage==='drafting'?resolvePrompt(id,{}, {components:component?[component]:[]}):resolvePrompt(id);
    return [stage,{id,version:resolved.version,components:resolved.components,prompt:resolved.text,hash:resolved.promptHash,sourceHashes:resolved.sourceHashes}];
  }));
  return {version:ARTICLE_PROMPT_VERSION,source:'prompts/manifest.json',prompts};
}
// Any wording change can alter scope or attribution. Compare normalized paragraphs,
// then reuse the factual reviewer only on affected text; formatting alone costs no call.
export function articleChangedPassages(before, after) {
  const paragraphs = (value) => String(value || '').split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
  // Do not strip identifier characters (foo_bar, C#, a*b) as if they were markup.
  const normalize = (text) => text.replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/[ \t]+$/gm, '').trim();
  const old = paragraphs(before), next = paragraphs(after);
  const oldKeys = new Set(old.map(normalize)), nextKeys = new Set(next.map(normalize));
  const changed = { before: old.filter((p) => !nextKeys.has(normalize(p))), after: next.filter((p) => !oldKeys.has(normalize(p))) };
  if (!changed.before.length && !changed.after.length && JSON.stringify(old.map(normalize)) !== JSON.stringify(next.map(normalize))) {
    return { before: old, after: next };
  }
  return changed;
}
