import crypto from 'node:crypto';

// Runtime prompts deliberately stand alone. Skill configuration still selects models,
// length and routing; complete workflow/skill prose is not injected into each call.
export const ARTICLE_PROMPT_VERSION = 'direct-brief-v3';
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

export const ARTICLE_PROMPTS = Object.freeze({
  facts: `根据已确认简报和抓取的来源整理可追溯的事实记录，不写文章、不重新研判选题。
逐条保留主张、主体、时间、来源、对应证据以及影响含义的必要条件。区分已核实事实、来源单方说法、争议和作者观点；评论只说明有归属的个人看法或经历。
只返回 JSON：{"claims":[{"id":"F1","claim":"主张","status":"verified|disputed|unverified|opinion","evidence":"来源中的对应证据","sourceUrl":"原始URL","sourceTitle":"来源名称","sourceType":"official|media|user","publishedAt":"来源时间","boundary":"影响含义的必要条件","attributionRequired":false}],"missingEvidence":[]}。
来源声明的已核实对象是其作出的声明，不能把声明内容自动当作已独立证实。缺少材料的事实标记 unverified，不能补造证据。`,
  drafting: `你是一位面向开发者和技术从业者写作的公众号作者。
请根据已确认简报和事实材料，直接写出完整文章。沿着简报的角度与主线，自行安排章节和段落，让事实、解释和作者判断自然衔接。
开头尽快进入值得讨论的具体事件、细节或问题；正文讲清关键关系，让读者理解判断的依据及其实际含义。
允许明确表达作者态度、感受和评价。事实忠于材料，推断的力度与依据相称，不虚构经历、引语、行为或结果。
来源和必要条件自然写进相关事实句。已经交代清楚的限定不再重复说明，有依据的观点直接表达。
内容讲到哪，结构就展开到哪。合并没有新信息的重复解释，结尾在判断讲清时自然收束。
按本篇长度设置输出完整 Markdown 文章，以事件名作为唯一一级工作标题，不附写作过程或规划说明。`,
  review: `请审核文章中的事实与论证，并核对已确认简报的核心命题是否得到展开。
检查重要事实、数字、引语、来源归属和必要条件是否与证据一致；检查推断是否存在缺失前提、因果跳跃或超出依据的结论。
来源支持某人作出声明，不等于声明内容已经独立证实。有依据的作者评价和个人看法可以明确表达，不因语气鲜明而要求弱化。
每项问题必须定位原文，说明对应证据或具体推理缺口，给出最小修复建议。
证据不足的事实应纠正、删除或准确归因；关键推理不足应补清依据或收窄结论。
只报告影响事实、论证或核心命题的具体问题，不提出泛泛的谨慎建议，也不要求用免责声明代替修正。
返回 JSON：{"pass":true,"issues":[]}；有问题时 pass=false，每项包含 type（fact/attribution/reasoning/brief）、message、quote（原文）、basis（证据编号或推理缺口）、repair（最小修法）、return_to（materials/draft）。`,
  repair: `按照审稿清单修订文章，只修改问题所在句段和保持衔接所需的上下文。
事实错误依据材料纠正，推理缺口依据现有材料补清或收窄结论。
保留成立的作者观点和表达力度。不得新增事实，也不把局部问题扩写成全篇风险说明。
未涉及问题的内容保持原样，输出完整修订稿。`,
  lengthAdjust: `根据输入中的调整方向、调整幅度和策略扩写或缩写文章。保留核心命题、作者立场和事实准确性；按任务取舍段落、章节和表达方式，不必默认保留原有结构。
当 strategy 为 structural 且 adjustment 为 expand 时，补充与主线相关的次要内容，进一步解释观点背后的原因、机制、影响或读者处境。可以使用具体例子、比喻、对比、排比等写作手法，也可以在已有事实支持下深入展开判断。例子不得伪装成真实事件；不得编造数据、引语、来源或亲历。
当 strategy 为 expressive 且 adjustment 为 expand 时，主要调整现有段落的写法，以例子、比喻、对比、排比或更充分的解释增加少量篇幅；不另起次要章节。表达要增加理解或阅读体验，不得同义反复凑字数。
当 strategy 为 structural 且 adjustment 为 shorten 时，删除次要论点、次要章节、重复背景和不推进主线的内容，保留主旨成立所必需的事实与论据。允许重排或删除小标题、段落，不要求保留所有论证顺序。
当 strategy 为 expressive 且 adjustment 为 shorten 时，优先删减比喻、排比、对比铺陈、过场和重复修饰，把观点及其依据改为直接表达；只有修辞本身承载必要含义时才保留。
扩写时可以基于已有事实深入解释因果、机制和影响，但不能把推断写成已证实事实。缩写时不得删改事实含义、来源归属或作者立场。
根据输入中的 target_visible_chars 调整篇幅，结果必须落在 allowed_range 内。只输出完整 Markdown 文章，不说明调整过程。`,
  humanize: `请把文章编辑得清楚、自然、连贯。
删除没有增加信息的重复判断、过场和自我免责句，合并重复段落；保留有推进作用的回扣。
保留有效细节、修辞、作者态度和论证过程。遇到抽象空话，用文章已有的具体内容说清；没有支撑时删去，不编造解释。
调整句长与衔接，让段落顺着内容推进，不按固定句式或词表判断 AI 腔。
保持事实、来源、数值、适用条件和判断含义准确。来源已经说明归属时，不再附加同义声明。
只做表达处理，不承担扩写或缩写任务；不要新增或删除实质内容，精修前后可见字符数尽量接近。
结尾在话说完时结束。输出完整 Markdown 文章，保留一级工作标题，无需修改时返回原文，不附编辑说明。`,
  title: `为这篇公众号文章生成 5 个发布标题，并推荐其中一个。
从正文最有分量的事实、冲突或判断寻找点击理由，让目标读者一眼看懂文章在讨论什么。
保留必要的事件或主体名称，陌生专名可搭配白话含义。候选从不同角度表达，不只替换同义词。
标题可以有鲜明观点，但承诺必须由正文兑现，不新增未经支持的数字、因果、行为或结果。
对照正文核对每个候选，剔除夸大或歧义表达。输出候选、简短理由和唯一推荐标题，不修改正文。
返回 JSON：{"titleCandidates":[{"title":"标题","reason":"理由"}],"selectedTitle":"唯一推荐标题","hotspotAnchor":"必要事件或主体名","coreKeywords":["自然使用的关键词"]}。`,
});

const TYPE_HINTS = Object.freeze({
  'wechat-mp-tech-deep': '技术深解需要解释机制，使用材料中可以支持的技术细节。',
  'wechat-mp-deep-dive': '行业评论重点展开行为、利益关系和结果。',
  'wechat-mp-gossip-chill': '轻松趣闻通过真实细节和反差产生趣味。',
  'wechat-mp-composite': '围绕简报的共同命题组织多条材料，各事件的事实归属保持清楚。',
});

export function draftSystemPrompt(writerSkill) {
  return [ARTICLE_PROMPTS.drafting, TYPE_HINTS[writerSkill]].filter(Boolean).join('\n');
}

export function articleReaderContext(account = {}) {
  return {
    description: account.description || '面向开发者和技术从业者，讨论技术、产品与平台变化。',
    readerProfile: account.readerProfile || '程序员和技术从业者，兼顾技术管理者与泛科技读者。',
    expression: '通俗、具体，保留必要专业细节；具体角度与立场沿用已确认简报。背景用于写作选择，不作为正文内容。',
  };
}

export function articlePromptManifest(writerSkill) {
  const prompts = { ...ARTICLE_PROMPTS, drafting: draftSystemPrompt(writerSkill) };
  return { version: ARTICLE_PROMPT_VERSION, source: 'article-prompts.mjs', prompts: Object.fromEntries(
    Object.entries(prompts).map(([stage, prompt]) => [stage, { prompt, hash: crypto.createHash('sha256').update(prompt).digest('hex') }]),
  ) };
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
