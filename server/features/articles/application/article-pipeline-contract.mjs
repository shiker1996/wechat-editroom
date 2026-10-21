import fs from 'node:fs';
import path from 'node:path';
import { markdownVisibleChars } from '../../../shared/domain/markdown-visible-chars.mjs';

function cleanMarkdown(value) { return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,''); }
function asArray(value,{emptyWords=false}={}) {
  if(Array.isArray(value))return value.filter((item)=>item!=null&&String(item).trim()!=='');
  if(value==null)return [];
  if(typeof value==='string'){
    const text=value.trim();if(!text)return [];
    if(emptyWords&&/^(?:none|null|无|暂无|没有|无剩余风险|n\/a)$/i.test(text))return [];
    return text.split(/\r?\n|[、；;]+/).map((item)=>item.replace(/^[-*•\d.、)\s]+/,'').trim()).filter(Boolean);
  }
  if(typeof value==='object')return [value];
  return [value];
}
function normalizeUrl(value) { return String(value||'').trim().replace(/\/+$/,'').toLowerCase(); }

export function articleStageOutputIssue(value,{requireArticle=false}={}) {
  const text=cleanMarkdown(value);
  if(!text)return '模型返回空内容';
  if(/(?:我(?:先|需要|将|来)|让我)(?:读取|查看|检查|了解|确认|调用|使用|打开).{0,40}(?:文件|目录|环境|工具|技能|契约|工作区)/i.test(text))return '模型返回了工具操作说明，而不是文章内容';
  if(requireArticle&&!/^#\s+\S+/m.test(text))return '模型未返回包含一级标题的完整 Markdown 文章';
  return null;
}

export function normalizePlanningResult(input={}) {
  const plan=input&&typeof input==='object'&&!Array.isArray(input)?{...input}:{};
  plan.expectedAction=asArray(plan.expectedAction);
  plan.coreKeywords=asArray(plan.coreKeywords);
  plan.retentionTurns=asArray(plan.retentionTurns ?? plan.retention_turns);
  plan.remainingRisks=asArray(plan.remainingRisks,{emptyWords:true});
  plan.titleCandidates=asArray(plan.titleCandidates).map((item)=>typeof item==='string'?{title:item,reason:''}:item).filter((item)=>item&&item.title);
  plan.distributionLane=String(plan.distributionLane??plan.distribution_lane??'').trim();
  plan.readerStake=String(plan.readerStake??plan.reader_stake??'').trim();
  plan.readerEmotion=String(plan.readerEmotion??plan.reader_emotion??'').trim();
  plan.readerValueType=String(plan.readerValueType??plan.reader_value_type??'').trim();
  plan.readerValuePlacement=String(plan.readerValuePlacement??plan.reader_value_placement??'').trim();
  plan.visualNeed=String(plan.visualNeed??plan.visual_need??'auto').trim() || 'auto';
  plan.clickMechanism=String(plan.clickMechanism??plan.click_mechanism??'').trim();
  plan.openingHook=String(plan.openingHook??plan.opening_hook??'').trim();
  plan.endingPayoff=String(plan.endingPayoff??plan.ending_payoff??'').trim();
  plan.shareTrigger=String(plan.shareTrigger??plan.share_trigger??'').trim();
  return plan;
}

export function compositeSourceText(candidate,{maxChars=48000,perSourceChars=4000}={}) {
  if(!candidate?.composite)return '';
  const documents=Array.isArray(candidate.source_documents)?candidate.source_documents:[];
  let result='';
  for(const item of documents){
    const source=item?.source;
    if(source?.status!=='ok'||!String(source.content||'').trim())continue;
    const block=`\n\n## 来源：${item.title||source.title||'未命名'}\nURL：${item.url||source.final_url||source.url||''}\n${String(source.content).slice(0,perSourceChars)}`;
    if(result.length+block.length>maxChars){const remaining=maxChars-result.length;if(remaining>200)result+=block.slice(0,remaining);break;}
    result+=block;
  }
  return result.trim();
}

export function authorizedWritingBrief(brief) { const safe={...brief};delete safe.sourceText;return safe; }

function articleMaterialView(materialBrief = {}) {
  const material = materialBrief && typeof materialBrief === 'object' ? materialBrief : {};
  return Object.fromEntries(['action', 'affected_group', 'conflict', 'reader_consequence', 'reader_action']
    .map((key) => [key, material[key]])
    .filter(([, value]) => value != null && String(value).trim() !== ''));
}

export function articleFactAuthorityView(factBase = {}) {
  // Daily/tutorial documents use their own evidence schemas during manual review.
  if (!Array.isArray(factBase?.claims)) return { materials: factBase };
  const claims = Array.isArray(factBase?.claims) ? factBase.claims : [];
  return {
    claims: claims.filter((claim) => claim && typeof claim === 'object').map((claim) => ({
      id: claim.id,
      claim: claim.claim,
      subject: claim.subject || '',
      status: claim.status,
      sourceUrl: claim.sourceUrl || claim.source_url || '',
      sourceTitle: claim.sourceTitle || claim.source_title || '',
      sourceType: claim.sourceType || claim.source_type || '',
      attribution: claim.attribution || '',
      attributionRequired: claim.attributionRequired ?? claim.attribution_required ?? false,
      evidence: claim.evidence || '',
      publishedAt: claim.publishedAt || claim.published_at || '',
      boundary: claim.boundary || '',
      ...(claim.status === 'opinion' && claim.evidence ? { reasoningBasis: claim.evidence } : {}),
    })),
  };
}

/** Planning sees the article's argument and usable evidence, not duplicated editorial risk metadata. */
export function buildArticlePlanningView(brief = {}) {
  const materialBrief = brief?.materialBrief || brief?.material_brief || {};
  return {
    topic: brief?.topic,
    angle: brief?.angle,
    thesis: brief?.thesis,
    audience: brief?.audience || brief?.targetAudience || brief?.target_audience,
    article_type: brief?.articleType || brief?.article_type,
    material_brief: articleMaterialView(materialBrief),
    adopted_research_points: brief?.adoptedResearchPoints || brief?.adopted_research_points || [],
    facts: articleFactAuthorityView(brief?.factBase || brief?.fact_base || {}),
  };
}

const DRAFT_OUTLINE_SECTION_ENDINGS = new Set(['流量规划','读者收益','信息增量','实用增量','增长承接','来源','剩余风险','停止原因','写作立场','文章素材简报']);

function outlineHeading(line) {
  const markdown = String(line || '').match(/^(#{2,3})\s+(.+?)\s*$/);
  if (markdown) return { level: markdown[1].length, title: markdown[2].trim().replace(/[：:]\s*$/, '') };
  const bold = String(line || '').match(/^\*\*(.+?)\*\*\s*[：:]?\s*$/);
  return bold ? { level: 2, title: bold[1].trim() } : null;
}

function outlineSectionLines(outline) {
  const lines = String(outline || '').split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const heading = outlineHeading(line);
    return heading && ['结构大纲', '大纲', '章节推进'].includes(heading.title);
  });
  if (start < 0) return [];
  const startHeading = outlineHeading(lines[start]);
  const result = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = outlineHeading(lines[index]);
    const markdownHeading = String(lines[index] || '').match(/^(#{2,3})\s+/);
    const isContentHeading = /^\*\*H2(?:[-—:：\s]+)?/i.test(String(lines[index] || '').trim());
    if (markdownHeading && heading && heading.level <= startHeading.level) break;
    if (heading && DRAFT_OUTLINE_SECTION_ENDINGS.has(heading.title)) break;
    if (isContentHeading) result.push(lines[index]);
    else result.push(lines[index]);
  }
  return result;
}

/** 将完整编辑大纲压缩为写作模型可消费的结构视图。 */
export function buildDraftOutlineView(outline = '') {
  const lines = outlineSectionLines(outline);
  if (!lines.length) return String(outline || '').trim();
  const sections = [];
  let current = null;
  for (const line of lines) {
    const boldHeading = String(line).match(/^\*\*H2(?:[-—:：\s]+)?(.+?)\*\*\s*$/i);
    const structuralBold = String(line).match(/^\*\*(?!H2(?:[-—:：\s]+)?)(.+?)\*\*\s*[：:]?\s*$/i);
    const heading = outlineHeading(line);
    if (boldHeading || structuralBold || (heading && heading.level >= 3)) {
      current = { heading: (boldHeading ? boldHeading[1] : structuralBold ? structuralBold[1] : heading.title).trim(), goals: [] };
      sections.push(current);
      continue;
    }
    const numbered = String(line).match(/^\s*\d+[.)、]\s+(.+?)\s*$/);
    if (numbered) {
      current = { heading: numbered[1].trim(), goals: [] };
      sections.push(current);
      continue;
    }
    const bullet = String(line).match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bullet && current) current.goals.push(bullet[1].trim());
  }
  return JSON.stringify({
    sections: sections.filter((section) => section.heading || section.goals.length),
  }, null, 2);
}

export function sourceCacheIssue(candidate,sourceDoc) {
  if(!sourceDoc?.content||candidate?.composite)return null;
  const expected=normalizeUrl(candidate?.url); const actual=normalizeUrl(sourceDoc.url||sourceDoc.final_url);
  if(!expected||!actual||expected===actual)return null;
  return `来源缓存与热点原文不一致（缓存为 ${sourceDoc.url}，热点为 ${candidate.url}），编辑室粘贴的替代来源可能已覆盖原缓存；请重新抓取热点原文或回编辑室确认来源后再成稿`;
}

function readSourceCache(workspaceRoot, hotspotId) {
  if (!workspaceRoot || hotspotId == null) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'data', 'source-cache', `${hotspotId}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function supplementalSourceRows(store, candidateId) {
  if (!store || candidateId == null || typeof store.listCandidateSources !== 'function') return [];
  return store.listCandidateSources(candidateId).filter((item) =>
    (item?.status === 'ok' || item?.status === 'partial') && String(item?.content || '').trim());
}

function supplementalSourceText(rows, { maxChars = 12000, perSourceChars = 4000 } = {}) {
  let result = '';
  for (const item of rows) {
    const block = `\n\n## 补充来源：${item.title || '未命名'}\nURL：${item.final_url || item.url || ''}\n${String(item.content).slice(0, perSourceChars)}`;
    if (result.length + block.length > maxChars) {
      const remaining = maxChars - result.length;
      if (remaining > 200) result += block.slice(0, remaining);
      break;
    }
    result += block;
  }
  return result.trim();
}

export function readArticleSourceInput({ candidate, workspaceRoot, store, maxChars = 18000 } = {}) {
  const supplemental = supplementalSourceRows(store, candidate?.id);
  const supplementalText = supplementalSourceText(supplemental);
  const supplementalUrls = supplemental.map((item) => item.final_url || item.url).filter(Boolean);
  if (candidate?.composite) {
    const documents = Array.isArray(candidate.source_documents) ? candidate.source_documents : [];
    const missing = documents.filter((item) => item?.source?.status !== 'ok' && item?.source?.status !== 'partial');
    const primaryText = compositeSourceText(candidate);
    const sourceText = [primaryText, supplementalText].filter(Boolean).join('\n\n').slice(0, maxChars);
    const issue = !sourceText
      ? '综合选题尚未形成可用的来源原文，请先完成备料抓取'
      : missing.length
        ? `综合选题仍有 ${missing.length} 个来源未成功抓取，请先完成备料抓取`
        : null;
    const primaryUrls = documents.map((item) => item.url || item.source?.final_url || item.source?.url).filter(Boolean);
    return { sourceText, sourceUrls: [...new Set([...primaryUrls, ...supplementalUrls])], issue, primary: null, supplemental };
  }

  const primary = readSourceCache(workspaceRoot, candidate?.hotspot_id);
  const primaryText = String(primary?.content || '').trim();
  const mismatch = sourceCacheIssue(candidate, primary);
  const sourceText = [primaryText.slice(0, maxChars), supplementalText].filter(Boolean).join('\n\n').slice(0, maxChars);
  const issue = !sourceText ? '热点原文尚未抓取或没有可用正文，请先完成备料抓取' : null;
  const candidateUrls = candidate?.materials?.map((item) => item.url).filter(Boolean) || [];
  const sourceUrls = [...new Set([candidate?.url, ...candidateUrls, primary?.final_url || primary?.url, ...supplementalUrls].filter(Boolean))];
  return { sourceText, sourceUrls, issue, warning: mismatch, primary, supplemental };
}

export function unverifiedFactBaseIssue(factBase) {
  const claims=Array.isArray(factBase?.claims)?factBase.claims:[];
  const factual=claims.filter((item)=>item&&item.status!=='opinion');
  if(!factual.length||!factual.every((item)=>item.status==='unverified'))return null;
  const missing=asArray(factBase?.missingEvidence).join('；');
  return `事实基座中所有事实性主张均未核实${missing?`（待补：${missing}）`:''}，无法成稿；请抓取可核对的原文或回编辑室调整命题后再试`;
}

export const ARTICLE_LENGTH_RANGE=Object.freeze({min:1300,max:1800,targetVisibleChars:1600});

export function selectWriterSkill(candidate={}) {
  const rawMaterialBrief=candidate.materialBrief||candidate.material_brief||candidate.editorial?.material_brief||candidate.editorial?.materialBrief;
  let materialBrief=rawMaterialBrief;
  if(typeof rawMaterialBrief==='string'){
    try{materialBrief=JSON.parse(rawMaterialBrief);}catch{materialBrief={};}
  }
  const explicitType=String(candidate.article_type||candidate.articleType||materialBrief?.article_type||'').trim();
  if(explicitType&&['wechat-mp-composite','wechat-mp-gossip-chill','wechat-mp-tech-deep','wechat-mp-tech-hotspot','wechat-mp-deep-dive'].includes(explicitType)){
    return {skill:explicitType,reason:`锁定简报明确指定文章类型 ${explicitType}`,source:'locked_article_type'};
  }
  if(candidate.composite)return {skill:'wechat-mp-composite',reason:'候选由多个热点组成，需要按共同机制或趋势组织'};
  const angleText=[candidate.angle,candidate.thesis,candidate.editorial?.research_basis,candidate.editorial?.confirmed_facts].filter(Boolean).join(' ');
  const allText=[candidate.hotspot_title,candidate.category,angleText].filter(Boolean).join(' ');
  const serious=/裁员|事故|伤亡|骚扰|违法|诉讼|疾病|医疗|劳动仲裁|隐私泄露/.test(allText);
  if(!serious&&/趣闻|离谱|八卦|段子|奇葩|荒诞|整活|吐槽/.test(angleText))return {skill:'wechat-mp-gossip-chill',reason:'角度明确采用轻量趣闻或职场反差表达，且不涉及严肃伤害事件'};
  const deepIntent=/原理|机制拆解|架构拆解|技术拆解|性能拆解|成本拆解|成本测算|算一笔账|可复算|公式|吞吐|延迟|显存|算力成本|部署成本|推理成本|训练成本|量化|内核|技术路线|比较口径|基准测试/.test(angleText);
  const technicalSubject=/AI|模型|芯片|GPU|推理|训练|Token|MoE|Attention|Agent|数据库|框架|协议|算法|开源|性能|算力|架构|内核/i.test(allText);
  if(deepIntent&&technicalSubject)return {skill:'wechat-mp-tech-deep',reason:'命题要求解释技术机制，或对性能、成本和指标进行可复算拆解'};
  if(['🤖 AI/技术动态', '产品与技术动态'].includes(candidate.category)||technicalSubject)return {skill:'wechat-mp-tech-hotspot',reason:'主题属于技术、产品或行业动态，重点是事件影响而非完整原理推导'};
  return {skill:'wechat-mp-deep-dive',reason:'主题需要从参与方、利益关系、因果链与反方边界展开'};
}

export function articleLengthStatus(article, range = ARTICLE_LENGTH_RANGE) {
  const count=markdownVisibleChars(article);
  return {count,valid:count>=range.min&&count<=range.max,shortfall:Math.max(0,range.min-count),overflow:Math.max(0,count-range.max)};
}

export function replaceArticleTitle(article, title) {
  const nextTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const source = String(article || '').trim();
  if (!nextTitle) return source;
  if (/^#\s+.+$/m.test(source)) return source.replace(/^#\s+.+$/m, `# ${nextTitle}`);
  return `# ${nextTitle}\n\n${source}`.trim();
}

export function buildArticleBriefView(brief = {}) {
  const materialBrief = brief?.materialBrief || brief?.material_brief || {};
  return {
    topic: brief?.topic,
    angle: brief?.angle,
    thesis: brief?.thesis,
    audience: brief?.audience || brief?.targetAudience || brief?.target_audience,
    article_type: brief?.articleType || brief?.article_type,
    material_brief: articleMaterialView(materialBrief),
    research_basis: brief?.researchBasis || brief?.research_basis || '',
    writing_stance: brief?.writingStance || brief?.writing_stance || '',
    reader_stake: brief?.readerStake || brief?.reader_stake || '',
    baseline_change: brief?.baselineChange || brief?.baseline_change || materialBrief.baseline_change || '',
    counter_evidence: brief?.counterEvidence || brief?.counter_evidence || materialBrief.counter_evidence || [],
    adopted_research_points: brief?.adoptedResearchPoints || brief?.adopted_research_points || [],
    rejected_angles: brief?.rejectedAngles || brief?.rejected_angles || [],
    forbidden_claims: brief?.forbiddenClaims || brief?.forbidden_claims || '',
    author_opinions: brief?.authorOpinions || brief?.author_opinions || '',
    confirmed_experiences: brief?.confirmedExperiences || brief?.confirmed_experiences || '',
  };
}

export function buildDraftUserPrompt(selectedTitle, brief, options = {}) {
  const authority = articleFactAuthorityView(brief?.factBase || brief?.fact_base || {});
  return JSON.stringify({
    working_title: selectedTitle,
    reader_context: options?.readerContext || {},
    brief: buildArticleBriefView(brief),
    facts: authority,
    length: options?.length || ARTICLE_LENGTH_RANGE,
  });
}

export function buildResearchCoveragePrompt({ article = '', researchPoints = [], rejectedAngles = [] } = {}) {
  return `请检查下面的文章是否真正采纳了作者在编辑室明确选择的研判拓展点。只检查这些已选择的点，不要求文章覆盖未选择的研判材料。

判断标准：full=文章使用事实解释了该点，并展开了它对文章命题的意义；partial=仅提及或换词复述，没有形成论证；omitted=没有出现；contradicted=文章与该点相反且没有说明依据。只要核心采用点为 omitted、contradicted 或 partial_core，status 必须为 needs_revision；全部至少达到 full 或非核心 partial 时才 pass。

只返回 JSON，不要 Markdown、解释或前置文本，格式必须是：
{"status":"pass|needs_revision","summary":"一句话","items":[{"point_id":"对应 point_id","status":"full|partial|partial_core|omitted|contradicted","coverage":"一句话说明覆盖情况","explanation":"依据文章中的具体段落或缺口","article_excerpt":"不超过80字的原文摘录"}],"omitted_points":[],"contradicted_points":[],"rejected_point_leakage":[],"repair_suggestions":[]}

采用的研判拓展点：
${JSON.stringify(researchPoints)}

作者明确不采用的方向（不得重新写成文章事实或核心观点）：
${JSON.stringify(rejectedAngles)}

文章：
${String(article).trim()}`;
}
