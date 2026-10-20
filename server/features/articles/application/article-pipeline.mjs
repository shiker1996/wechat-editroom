import fs from 'node:fs';
import path from 'node:path';
import { illustrateArticle } from './article-illustration.mjs';
import { scoreKeywords } from './seo-score.mjs';
import { formatAccountContext } from '../../../shared/domain/account-context-model.mjs';
import { getAccountContext } from '../../../platform/application/account-context-service.mjs';
import { normalizeDistributionLane } from '../../../shared/domain/distribution-strategy.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { evaluateEditorialReadiness } from '../domain/editorial-readiness.mjs';
import { normalizeMaterialBrief } from '../../../shared/domain/material-brief.mjs';
import { deriveWritingStance, stanceOverlay, citationPolicyForStance, visualPolicyForStance } from '../../../shared/domain/writing-stance.mjs';
import { normalizeResearchPoints, normalizeRejectedAngles } from '../domain/research-selection.mjs';
import { normalizeResearchCoverageResult, researchCoverageNeedsRevision } from '../domain/research-coverage.mjs';
import { loadArticleSkillBundle, loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { bindGenerationSnapshot, bindPipelineHarnessGateway, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../../../platform/skills/configuration.mjs';
import { batchTopicsDir, candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
import { resolveArticleLength } from '../../../platform/core/config.mjs';
import { evaluateArticleFactEligibility } from '../domain/article-fact-eligibility.mjs';
import { inspectPlanningMetaLeakage } from '../domain/article-quality.mjs';
import { readDiscussionResearchContext } from '../../research/index.mjs';
import { callDecisionTool, DECISION_TITLE_PLAN_TOOL, decisionToolDefinition, normalizeDecisionTitlePlan } from '../../../platform/llm/decision-tools.mjs';
import {
  buildPublicationClaimRegister, enrichFactBaseClaims, extractArticleTitle, publicationComplianceIssue,
  publicationCompliancePrompt, publicationFactBaseIssues, scanPublicationRisk,
} from '../domain/publication-compliance.mjs';
import {
  ARTICLE_LENGTH_RANGE, articleLengthStatus, articleStageOutputIssue, authorizedWritingBrief,
  buildDraftUserPrompt, buildDraftOutlineView, replaceArticleTitle, compositeSourceText, normalizePlanningResult, selectWriterSkill,
  readArticleSourceInput, sourceCacheIssue, unverifiedFactBaseIssue, buildResearchCoveragePrompt,
} from './article-pipeline-contract.mjs';
export {
  ARTICLE_LENGTH_RANGE, articleLengthStatus, articleStageOutputIssue, authorizedWritingBrief,
  buildDraftUserPrompt, buildDraftOutlineView, replaceArticleTitle, compositeSourceText, normalizePlanningResult, selectWriterSkill,
  readArticleSourceInput, sourceCacheIssue, unverifiedFactBaseIssue, buildResearchCoveragePrompt,
} from './article-pipeline-contract.mjs';
export {
  buildPublicationClaimRegister, enrichFactBaseClaims, extractArticleTitle, publicationComplianceIssue,
  publicationCompliancePrompt, publicationFactBaseIssues, scanPublicationRisk,
} from '../domain/publication-compliance.mjs';

function writeFile(filePath,content) { fs.mkdirSync(path.dirname(filePath),{recursive:true}); const temp=`${filePath}.tmp`; fs.writeFileSync(temp,String(content).trimEnd()+'\n','utf8'); fs.renameSync(temp,filePath); return fs.statSync(filePath); }
function cleanMarkdown(value) { return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,''); }
function outputExcerpt(value,max=180) { return String(value||'').replace(/\s+/g,' ').trim().slice(0,max); }
function complianceRepairNeedsRetry(original, repaired, issues = []) {
  const source = String(original || '').trim();
  const result = String(repaired || '').trim();
  if (!result || result === source) return true;
  const flaggedPhrases = issues.flatMap((issue) => {
    const message = typeof issue === 'string' ? issue : String(issue?.message || '');
    return [...message.matchAll(/'([^']{2,80})'|“([^”]{2,80})”|‘([^’]{2,80})’/g)]
      .map((match) => match[1] || match[2] || match[3])
      .filter((value) => value && !/^(?:来源|公告|媒体|作者|观点|事实|标题)$/.test(value));
  });
  if (flaggedPhrases.some((phrase) => source.includes(phrase) && result.includes(phrase))) return true;
  const titleIssue = issues.some((issue) => {
    const type = typeof issue === 'string' ? '' : String(issue?.type || '');
    const message = typeof issue === 'string' ? issue : String(issue?.message || '');
    return ['title', 'publication_compliance', 'financial'].includes(type) && /标题|高影响|绝对化|财经数字/.test(message);
  });
  return titleIssue && extractArticleTitle(source) === extractArticleTitle(result);
}
function visibleChars(markdown) { return articleLengthStatus(markdown,{min:0,max:Number.MAX_SAFE_INTEGER}).count; }
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
function issueList(value) { return asArray(value).map((item)=>typeof item==='string'?item:(item?.message||JSON.stringify(item))); }
function issueMessage(issue) { return typeof issue === 'string' ? issue : String(issue?.message || ''); }
function issueType(issue) { return typeof issue === 'string' ? '' : String(issue?.type || '').trim().toLowerCase(); }
function gateMentionsTitle(issues = []) { return issues.some((issue) => /标题|title|headline/i.test(issueMessage(issue)) || issueType(issue) === 'title'); }

// 文章内容问题与“模型没有产出文章”分开处理：前者可以把终稿交给编辑器修订，
// 后者说明当前阶段没有可供编辑的文章，仍然需要终止流水线。
const ARTICLE_OUTPUT_BLOCKER_PATTERN = /模型返回空内容|工具操作说明|未返回.*(?:文章|Markdown)|输出无效|无法生成|模型调用失败/i;
export function articleGateBlockingIssues(gate = {}) {
  return (Array.isArray(gate?.issues) ? gate.issues : []).filter((issue) => {
    const type = issueType(issue);
    return type === 'output' || ARTICLE_OUTPUT_BLOCKER_PATTERN.test(issueMessage(issue));
  });
}

export function articleGateNeedsEditorialReview(gate = {}) {
  return gate?.pass === false || (Array.isArray(gate?.issues) && gate.issues.length > 0);
}

function parseJsonResult(result,store) {
  return parseModelJson(result,{store,label:'文章流水线'});
}

async function generateTitlePlan({ gateway, store, provider, batchId, candidateId, systemPrompt, purpose, payload, fallbackTitle, maxOutputTokens = 5000 }) {
  const messages = [
    { role: 'system', content: systemPrompt, protected: true },
    { role: 'user', content: JSON.stringify(payload), protected: true },
  ];
  const fallback = async () => {
    try {
      return parseJsonResult(await gateway.complete({ provider, purpose, batchId, candidateId, jsonMode: true, maxOutputTokens, messages }), store);
    } catch {
      return {};
    }
  };
  const decision = await callDecisionTool({
    gateway,
    provider,
    repository: store?.repositories?.extensionSettings,
    purpose,
    batchId,
    candidateId,
    definition: DECISION_TITLE_PLAN_TOOL,
    schema: DECISION_TITLE_PLAN_TOOL.function.parameters,
    messages: [
      { ...messages[0], content: `${messages[0].content}\n\n如果当前调用提供了 decision.title_plan 工具，必须调用一次该工具；工具参数就是标题规划结果，不要输出解释文字。` },
      messages[1],
    ],
    fallback,
  });
  const plan = normalizeDecisionTitlePlan(decision.value, { fallbackTitle });
  const fallbackCandidateTitle = String(fallbackTitle || '').trim();
  if (fallbackCandidateTitle && !plan.titleCandidates.some((item) => item.title === fallbackCandidateTitle)) {
    const fallbackCandidate = { title: fallbackCandidateTitle, reason: '保留当前标题作为热点锚点备选' };
    if (plan.titleCandidates.length >= 12) plan.titleCandidates[11] = fallbackCandidate;
    else plan.titleCandidates.push(fallbackCandidate);
  }
  return applyHotspotAnchorRule(plan, { topic: payload?.topic, requiredAnchor: payload?.hotspotAnchor || plan.hotspotAnchor || payload?.topic });
}

function compactAnchorText(value) {
  return String(value || '').toLocaleLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]+/gu, '');
}

function isSpecificHotspotAnchor(value) {
  const compact = compactAnchorText(value);
  if (!compact || ['ai', 'llm', '技术', '科技', '公司', '企业', '产品', '行业', '大模型', '人工智能', '订阅', '用户', '裁员', '融资', '收购', '开源', '回应', '发布', '更新', '工具', '模型', '争议', '发展', '限制', '数据', '价格', '业务', '组织', '新闻'].includes(compact)) return false;
  return compact.length >= 4 || ['moe', 'rea', 'gpt'].includes(compact);
}

function applyHotspotAnchorRule(plan, { topic = '', requiredAnchor = '' } = {}) {
  const requestedAnchor = String(requiredAnchor || plan?.hotspotAnchor || '').trim();
  const anchor = isSpecificHotspotAnchor(requestedAnchor) ? requestedAnchor : '';
  const sourceHasAnchor = Boolean(anchor) && (Boolean(requiredAnchor)
    || compactAnchorText(topic).includes(compactAnchorText(anchor)));
  const titleCandidates = Array.isArray(plan?.titleCandidates) ? plan.titleCandidates : [];
  const matchingCandidates = sourceHasAnchor
    ? titleCandidates.filter((item) => compactAnchorText(item?.title).includes(compactAnchorText(anchor)))
    : [];
  const selected = matchingCandidates.find((item) => item.title === plan?.selectedTitle)
    || matchingCandidates.slice().sort((left, right) => (Number(right?.score) || 0) - (Number(left?.score) || 0))[0];
  return {
    ...plan,
    hotspotAnchor: anchor,
    hotspotAnchorStatus: !sourceHasAnchor ? 'anchor_missing_or_unverified' : matchingCandidates.length ? 'matched' : 'title_anchor_missing',
    selectedTitle: selected?.title || plan?.selectedTitle,
  };
}

function titleHasHotspotAnchor(title, anchor) {
  return Boolean(isSpecificHotspotAnchor(anchor)
    && compactAnchorText(title).includes(compactAnchorText(anchor)));
}

export function buildReviewRepairPrompt({ factBase, outline, article, review }) {
  return `事实基座：
${JSON.stringify(factBase)}

文章大纲（对应 02-outline.md）：
${String(outline || '').trim()}

待修订文章（对应 05-humanized.md）：
${String(article || '').trim()}

首次审稿门禁结果与修订要求：
${String(review || '').trim()}

请逐条处理审稿门禁指出的问题。先判断每条问题针对的是可核验事实、来源说法、基于事实的作者推断，还是价值判断：只有可核验事实需要事实基座中的直接证据；来源说法要明确归因；作者推断只要推理依据在文中可见，就保留其判断和语气，不要统一改成“可能”“笔者认为”等免责声明。对 IPO、上市、估值、融资、违法、造假、压榨、骚扰、事故伤亡以及公司/个人负面事实主张，若缺少直接可靠证据，只修改对应主张，删除或准确归因；不能把风险扩大到同段其他观点。

只修改门禁明确指出的句子及理解该句所必需的最小上下文。其余段落、标题、论证顺序、作者推断、修辞和结尾原样保留；除非门禁明确指出相应内容，否则不得重写或调整。若问题是编辑规划元话语（例如“本文不写”“只能当作提问的起点”、H2 编号或写作要求），只改对应句子。输出完整 Markdown 文章以供保存，但未涉及的正文必须逐字保留。不要输出审阅过程、审稿报告、文件缺失说明或 REVIEW 注释。`;
}

function artifact(store,batchId,kind,name,filePath,trace={}) { const stat=fs.statSync(filePath); store.upsertArtifact({batchId,candidateId:trace.candidateId??null,kind,name,path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString(),rootRunId:trace.rootRunId??null,workflowRunId:trace.workflowRunId??null,stageId:trace.stageId??null}); }
function writerSkill(candidate) {
  return selectWriterSkill(candidate).skill;
}

export const ARTICLE_STAGE_CONTRACT = Object.freeze([
  { id:'brief', skill:'wechat-mp-topic-to-article' },
  { id:'fact-base', skill:'wechat-mp-topic-to-article' },
  { id:'planning', skill:'wechat-mp-topic-to-article' },
  { id:'drafting', skill:'$writer' },
  { id:'draft-quality-gate', skill:'article-reviewer' },
  { id:'title-generation', skill:'title-generator' },
  { id:'humanize', skill:'humanizer-zh' },
  { id:'voice-quality-gate', skill:'article-reviewer' },
  { id:'review', skill:'article-reviewer' },
  { id:'title-lock', skill:'title-generator' },
  { id:'seo-keyword-scoring', skill:'seo-keyword-scoring' },
  { id:'seo-optimization', skill:'seo-content-optimizer' },
  { id:'final-quality-gate', skill:'article-reviewer' },
  { id:'research-coverage', skill:'article-reviewer' },
  { id:'visual-planning', skill:'article-visual-planner' },
  { id:'image-planning', skill:'article-image-placeholders' },
  { id:'publication-safety-gate', skill:'article-reviewer' },
]);

export function buildArticleStageSystem(orchestrator, stage, ...children) {
  const total = String(orchestrator?.prompt || '').trim();
  if (!total) throw new Error('项目成稿总技能缺失，无法执行');
  const childPrompts = children.flat().filter((bundle) => bundle?.prompt).map((bundle) => bundle.prompt);
  return [total, ...childPrompts, `## 当前运行阶段\n\n只执行 \`${stage}\` 阶段，严格遵守总契约中该阶段的输入、输出和门禁；不要提前执行其它阶段。`].join('\n\n---\n\n');
}

export function buildStanceStageSystem(orchestrator, stage, stance, ...children) {
  return `${buildArticleStageSystem(orchestrator, stage, ...children)}\n\n---\n\n${stanceOverlay(stance)}\n\n立场 overlay 只改变表达方式，不改变事实状态、来源边界、禁止主张或任何发布门禁。`;
}

export function buildPublicationComplianceRepairPrompt({ factBase = {}, claimRegister = [], article = '', issues = [], publicationScan = {}, researchPoints = [], rejectedAngles = [], preserveVisuals = false } = {}) {
  const planningOnly = issues.length > 0 && issues.every((issue) => {
    const type = typeof issue === 'string' ? '' : String(issue?.type || '').trim().toLowerCase();
    return type === 'structure' && /规划|结构|提问的起点|编辑/.test(issueMessage(issue));
  });
  const preservationRule = planningOnly
    ? '- 本次仅修复编辑规划元话语。保留标题、开头、章节顺序、事实、来源、作者判断和结尾；只改对应句子。'
    : '';
  return `你是公众号文章的合规修订编辑。请直接修订文章，不要输出审阅报告、修订说明、工具操作过程或 JSON。

修订目标：只解决门禁明确指出的发布风险，保留作者已经确认的事实、观点、角度、命题和研判拓展点。只能使用事实基座中已有的信息，不得新增事实、数字、日期、人物行为、来源、引语或作者经历。输出完整文章时，未被问题涉及的句段必须原样保留。

必须执行的修订规则：
- 只在门禁明确指出标题问题时修改标题。标题中的事实主张按事实证据核验；标题中的作者判断按观点表达处理。不得仅因标题有判断、数字或修辞，就默认改成中性标题。
- 先区分可核验事实、来源说法、作者推断和价值判断。可核验事实缺少支持时，修正对应事实；来源说法要准确归因；有事实依据且推理链可理解的作者推断和价值判断可以保留，不要求统一添加“笔者认为”“从……看”“这可能意味着”等标记。
- 只有当作者推断被写成了可核验的客观事实，且门禁指出具体句子时，才在该句作最小修改；不要把限定扩展到邻近观点或全篇。
- 争议、负面和动机事实主张要准确归因；不得把作者解读写成公司已经承认的事实。作者对动机的推断可作为推断保留，但不得伪装成当事方已确认事实。
- 事实中的数字、折价率、营收、分红和时间信息，必须就近使用事实基座登记的具体来源。保留数字时，在对应句末使用登记中的具体来源标题和 URL，例如“（来源：[登记中的来源标题](登记中的 sourceUrl)）”；不得只写“据媒体”“据市场观察”或其他无法追溯的笼统来源。登记中没有 sourceUrl 的数字或高影响事实必须删除、改成不含数字的概括，不能自行补 URL、来源名称或外部事实。
- 严格遵守作者明确不采用的方向和禁写边界，不得为了增强冲突补写退市、挤压投入、价格高估/低估、管理层动机或未披露时间表等结论。
- 保留并兑现作者采用的研判拓展点，但不得把研判假设改写成已核验事实。
${preserveVisuals ? '- 保留现有全部 Markdown 图片、图片占位 HTML 注释、Mermaid/ECharts 产物和相关链接，只修改必要的文字与标题，不得删除或重排这些视觉产物。' : ''}
${preservationRule}

这是定向修订，不是整篇重写。门禁明确指出的具体风险必须修复；没有指出的问题不应自行扩大。标题仅在标题问题被明确指出时修改。观点标题可直接表达作者判断，只要不把未核实事实伪装成事实。事实基座没有对应 claim 的计算结果、经济后果、历史动作或动机不得写成已发生事实；若作者以明确推理表达观点，可保留推断并保留原有表达力度。

逐项修订顺序：对照每条门禁问题定位对应句段；标记其类别（事实、来源说法、作者推断、价值判断）；只核验事实和归因；只修改确有问题的句段；最后确认其余段落、观点力度和文章结构保持不变。不得把门禁没有指出的内容扩展成修订任务。

门禁问题：
${JSON.stringify(issues)}

程序风险扫描：
${JSON.stringify(publicationScan)}

事实基座：
${JSON.stringify(factBase)}

发布主张登记（来源只能从这里使用）：
${JSON.stringify(claimRegister)}

作者采用的研判拓展点：
${JSON.stringify(researchPoints)}

作者明确不采用的方向：
${JSON.stringify(rejectedAngles)}

待修订文章：
${String(article || '').trim()}

只输出修订后的完整 Markdown 文章，必须保留唯一一级标题。输出前必须确认标题已按上述规则重新审核，且不得与原文风险标题相同。`;
}

async function textCall(gateway,input,system,user,maxOutputTokens=5000) {
  const systemContent = String(system || '').trim();
  const userContent = String(user || '').trim();
  if (!systemContent || !userContent) throw new Error('成稿请求消息为空，无法提交模型');
  return gateway.complete({...input,maxOutputTokens,messages:[{role:'system',content:systemContent,protected:true},{role:'user',content:userContent,protected:true}]});
}

export const ARTICLE_QUALITY_GATE_TOOL = decisionToolDefinition({
  name: 'decision.article_quality_gate',
  description: '返回文章质量门禁结果，只包含是否通过以及需要修复的问题。',
  parameters: {
    type: 'object',
    required: ['pass', 'issues'],
    properties: {
      pass: { type: 'boolean' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 500 },
            type: { type: 'string', maxLength: 80 },
            repair: { type: 'string', maxLength: 500 },
            evidence: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  },
});

export const ARTICLE_REVIEW_GATE_TOOL = decisionToolDefinition({
  name: 'decision.article_review_gate',
  description: '返回文章审稿门禁结果，只包含是否通过以及需要修复的问题。',
  parameters: {
    type: 'object',
    required: ['pass', 'issues'],
    properties: {
      pass: { type: 'boolean' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 500 },
            type: { type: 'string', maxLength: 80 },
            repair: { type: 'string', maxLength: 500 },
            evidence: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
  },
});

const ARTICLE_QUALITY_GATE_SCHEMA = ARTICLE_QUALITY_GATE_TOOL.function.parameters;

export const RESEARCH_COVERAGE_TOOL = decisionToolDefinition({
  name: 'decision.research_coverage',
  description: '检查文章是否兑现已选择的研判拓展点。',
  parameters: {
    type: 'object',
    required: ['status', 'summary', 'items', 'omitted_points', 'contradicted_points', 'rejected_point_leakage', 'repair_suggestions'],
    properties: {
      status: { type: 'string', enum: ['pass', 'needs_revision', 'skipped'] },
      summary: { type: 'string', maxLength: 500 },
      items: { type: 'array', maxItems: 30, items: { type: 'object', required: ['point_id', 'status', 'coverage', 'explanation', 'article_excerpt'], properties: {
        point_id: { type: 'string', maxLength: 80 },
        status: { type: 'string', enum: ['full', 'partial', 'partial_core', 'omitted', 'contradicted'] },
        coverage: { type: 'string', maxLength: 300 },
        explanation: { type: 'string', maxLength: 500 },
        article_excerpt: { type: 'string', maxLength: 160 },
      } } },
      omitted_points: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 120 } },
      contradicted_points: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 120 } },
      rejected_point_leakage: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 160 } },
      repair_suggestions: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 300 } },
    },
  },
});

function appendPlanningMetaLeakage(gate = {}, article = '') {
  const leakage = inspectPlanningMetaLeakage(article);
  if (!leakage.issues.length) return gate;
  return {
    ...gate,
    pass: false,
    issues: [...(Array.isArray(gate.issues) ? gate.issues : []), ...leakage.issues],
  };
}

export async function aiQualityGate({gateway,store,provider,batchId,candidateId,article,factBase,sourceText='',researchPoints=[],rejectedAngles=[],publicationClaimRegister=[],publicationScan={},writingStance='analysis',citationPolicy='cluster',systemPrompt,stage,maxOutputTokens=3500}) {
  const purpose=`article-quality-gate-${stage}`;
  const messages=[
    {role:'system',protected:true,content:systemPrompt},
    {role:'user',protected:true,content:`事实基座：${JSON.stringify(factBase)}\n\n作者采用的研判拓展点：${JSON.stringify(researchPoints)}\n\n作者明确不采用的方向：${JSON.stringify(rejectedAngles)}\n\n判定口径：正文事实只能来自事实基座中的 verified 项；来源标题、URL、模型常识和未进入事实基座的来源原文不能补充授权。第一人称作者判断或阅读动作（如“我看”“我读完后的判断”）不是亲测；只有声称本人测试、部署、使用并得到结果，且没有已确认实践证据时，才按未经核实的亲测处理。文章应保留并兑现作者采用的研判拓展点，但不得把研判假设当成已核实事实，也不得重新写入明确舍弃的方向。\n\n${publicationCompliancePrompt({factBase,claimRegister:publicationClaimRegister,scan:publicationScan,writingStance,citationPolicy})}\n\n待检查文章：\n${article}`},
  ];
  const fallback=async()=>parseJsonResult(await gateway.complete({provider,purpose,batchId,candidateId,jsonMode:true,maxOutputTokens,messages}),store);
  const toolMessages=[
    { ...messages[0], content:`${messages[0].content}\n\n如果当前调用提供了 decision.article_quality_gate 工具，必须调用一次该工具；工具参数就是最终门禁结果，不要输出文章正文或工具操作说明。` },
    messages[1],
  ];
  const decision=await callDecisionTool({
    gateway,
    provider,
    repository:store?.repositories?.extensionSettings,
    purpose,
    batchId,
    candidateId,
    definition:ARTICLE_QUALITY_GATE_TOOL,
    schema:ARTICLE_QUALITY_GATE_SCHEMA,
    messages:toolMessages,
    fallback,
  });
  return appendPlanningMetaLeakage(decision.value, article);
}

export async function aiReviewGate({gateway,store,provider,batchId,candidateId,article,factBase,outline='',researchPoints=[],rejectedAngles=[],publicationClaimRegister=[],publicationScan={},writingStance='analysis',citationPolicy='cluster',systemPrompt,maxOutputTokens=3500}) {
  const purpose='article-review-gate';
  const messages=[
    {role:'system',protected:true,content:systemPrompt},
    {role:'user',protected:true,content:`事实基座：${JSON.stringify(factBase)}\n\n文章大纲：${String(outline||'').trim()}\n\n作者采用的研判拓展点：${JSON.stringify(researchPoints)}\n\n作者明确不采用的方向：${JSON.stringify(rejectedAngles)}\n\n${publicationCompliancePrompt({factBase,claimRegister:publicationClaimRegister,scan:publicationScan,writingStance,citationPolicy})}\n\n待审文章：\n${article}`},
  ];
  const fallback=async()=>parseJsonResult(await gateway.complete({provider,purpose,batchId,candidateId,jsonMode:true,maxOutputTokens,messages}),store);
  const toolMessages=[
    {...messages[0],content:`${messages[0].content}\n\n如果当前调用提供了 decision.article_review_gate 工具，必须调用一次该工具；工具参数就是最终审稿门禁结果，不要输出文章正文或工具操作说明。`},
    messages[1],
  ];
  const decision=await callDecisionTool({
    gateway,provider,repository:store?.repositories?.extensionSettings,purpose,batchId,candidateId,
    definition:ARTICLE_REVIEW_GATE_TOOL,schema:ARTICLE_REVIEW_GATE_TOOL.function.parameters,
    messages:toolMessages,fallback,
  });
  return appendPlanningMetaLeakage(decision.value, article);
}

export async function aiVoiceQualityGate({gateway,store,provider,batchId,candidateId,article,systemPrompt,maxOutputTokens=2500}) {
  const purpose='article-voice-quality-gate';
  const messages=[
    {role:'system',protected:true,content:systemPrompt},
    {role:'user',protected:true,content:`请判断这篇文章是否存在明显、影响阅读体验的模板化/AI 腔。只基于文章本身，不猜作者身份，不使用 AI 检测器，不因单个词、修辞偏好、缺少第一人称或文章类型判失败。逐条问题必须提供可在原文定位的短引文，并给出能直接执行的修订建议。检查重复论点、机械对称的章节/转折、空泛口号或比喻、没有信息增量的过场、每节重复“事实—影响—总结”模板、为互动而硬加的提问，以及抽象判断缺少文章自身材料支撑等；正常论证结构、必要的事实归纳和有内容的修辞不算问题。只报告至少两处相互印证、或一处足以显著损害真实感的具体问题。通过时 issues 必须为空。

文章：
${article}`},
  ];
  const definition=decisionToolDefinition({
    name:'decision.article_voice_quality_gate',
    description:'检查文章是否有具体、可定位且影响阅读体验的模板化表达问题。',
    parameters:{
      type:'object',required:['pass','issues'],properties:{
        pass:{type:'boolean'},
        issues:{type:'array',maxItems:12,items:{type:'object',required:['message','evidence','repair'],properties:{
          message:{type:'string',minLength:1,maxLength:500},
          evidence:{type:'string',minLength:1,maxLength:300},
          repair:{type:'string',minLength:1,maxLength:500},
          type:{type:'string',maxLength:80},
        }}},
      },
    },
  });
  const fallback=async()=>parseJsonResult(await gateway.complete({provider,purpose,batchId,candidateId,jsonMode:true,maxOutputTokens,messages}),store);
  const decision=await callDecisionTool({
    gateway,provider,repository:store?.repositories?.extensionSettings,purpose,batchId,candidateId,
    definition,schema:definition.function.parameters,
    messages:[{...messages[0],content:`${messages[0].content}\n\n若提供 decision.article_voice_quality_gate 工具，必须调用一次并只返回门禁结果。`},messages[1]],fallback,
  });
  const gate=decision.value&&typeof decision.value==='object'?decision.value:{pass:false,issues:[]};
  const issues=Array.isArray(gate.issues)?gate.issues:[];
  if(gate.pass!==true&&issues.length===0)issues.push({type:'voice_gate_uncertain',message:'风格门禁未能确认通过，需要人工检查自然表达',evidence:'',repair:'编辑判断是否存在重复、空泛或机械模板；不要为通过门禁而机械改写'});
  const normalizedIssues=issues.map((issue)=>({...issue,evidence:String(issue?.evidence||issue?.quote||'').trim()}));
  const invalidEvidence=normalizedIssues.filter((issue)=>!issue.evidence||!String(article||'').includes(issue.evidence));
  return invalidEvidence.length
    ? {...gate,pass:false,issues:[...normalizedIssues,...invalidEvidence.map((issue)=>({type:'voice_gate_evidence',message:'风格门禁问题缺少可在原文定位的证据引文，需人工复核',evidence:'',repair:'重新检查原文；只保留可精确定位且影响阅读体验的问题'}))]}
    : {...gate,pass:gate.pass===true&&normalizedIssues.length===0,issues:normalizedIssues};
}

async function repairArticleForPublicationCompliance({ gateway, orchestratorSkill, reviewerSkill, provider, batchId, candidateId, article, factBase, publicationClaimRegister, publicationScan, issues, researchPoints, rejectedAngles, writingStance = 'analysis', preserveVisuals = false, maxOutputTokens = 6500 }) {
  const systemPrompt = buildStanceStageSystem(orchestratorSkill, 'publication-compliance-repair', writingStance, reviewerSkill);
  const repairPrompt = buildPublicationComplianceRepairPrompt({ factBase, claimRegister: publicationClaimRegister, article, issues, publicationScan, researchPoints, rejectedAngles, preserveVisuals });
  let result = await textCall(gateway, { provider, purpose: 'article-publication-compliance-repair', batchId, candidateId }, systemPrompt, repairPrompt, maxOutputTokens);
  let repaired = cleanMarkdown(result.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi, '').trim();
  const outputIssue = articleStageOutputIssue(repaired, { requireArticle: true });
  if (outputIssue) throw new Error(`合规修订输出无效：${outputIssue}；返回摘要：${outputExcerpt(repaired)}`);
  if (complianceRepairNeedsRetry(article, repaired, issues)) {
    const retrySystem = `${systemPrompt}\n\n这是合规修订重试。上一次输出没有实际改写门禁指出的风险，不能再次复制原文章。必须先改写标题和被点名的风险句，再输出完整文章；如果无法在事实基座中证明某个数字或判断，就删除它或改为明确的限定性分析。`;
    const retryPrompt = `${repairPrompt}\n\n上一次修订未生效。请强制改写被门禁点名的标题/句子，不得原样返回原文；尤其不能继续使用原标题中的观点性结论。`;
    result = await textCall(gateway, { provider, purpose: 'article-publication-compliance-repair-retry', batchId, candidateId }, retrySystem, retryPrompt, maxOutputTokens);
    repaired = cleanMarkdown(result.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi, '').trim();
    const retryIssue = articleStageOutputIssue(repaired, { requireArticle: true });
    if (retryIssue) throw new Error(`合规修订重试输出无效：${retryIssue}；返回摘要：${outputExcerpt(repaired)}`);
  }
  return { article: repaired, result };
}


async function fitArticleLength({gateway,provider,batchId,candidateId,article,factBase,systemPrompt,purpose,maxOutputTokens=5000,onProgress=()=>{},maxAttempts=3,range=ARTICLE_LENGTH_RANGE,lockedTitle=''}) {
  let current=article;
  let best=article;
  const distance=(value)=>{
    const {count}=articleLengthStatus(value,range);
    if(count<range.min)return range.min-count;
    if(count>range.max)return count-range.max;
    return 0;
  };
  for(let attempt=1;attempt<=maxAttempts;attempt+=1){
    const status=articleLengthStatus(current,range);
    if(status.valid)return current;
    const tooShort=status.count<range.min;
    const direction=tooShort
      ? `补充必要的事实解释、因果链、反方边界和读者可执行信息；当前至少还差 ${status.shortfall} 个可见字符`
      : `压缩重复背景、次要案例和同义结论；当前至少需要减少 ${status.overflow} 个可见字符`;
    onProgress(`长度修复 ${attempt}/${maxAttempts}：当前 ${status.count} 字`);
    const result=await textCall(gateway,{provider,purpose:`${purpose}-${attempt}`,batchId,candidateId},systemPrompt,
      `将下文调整到 ${range.min}–${range.max} 个可见字符，当前为 ${status.count}。请${direction}。

这是第 ${attempt}/${maxAttempts} 次长度修复。必须输出完整文章，不能只输出新增段落或修改说明。只能使用给定事实基座支持的信息；不得新增事实、数字、引语、案例或作者亲历；保留唯一 H1 标题、核心立场、关键来源和风险边界，结构可按论证需要调整，不必维持固定 H2 数量。${lockedTitle ? `H1 标题必须保持为“${lockedTitle}”，不得改写。` : ''}只输出调整后的完整 Markdown 正文。

事实基座：${JSON.stringify(factBase)}

待调整文章：
${current}`,maxOutputTokens);
    const repaired=cleanMarkdown(result.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim();
    if(!repaired)continue;
    current=lockedTitle ? replaceArticleTitle(repaired, lockedTitle) : repaired;
    if(distance(current)<distance(best))best=current;
  }
  return articleLengthStatus(current,range).valid?current:best;
}

export async function runArticlePipeline({gateway,store,batchId,candidateId,provider,workspaceRoot,snapshotId=null,skillSelection=null,stageSelections=null,articleLength=null,rootRunId=null,workflowRunId=null,onProgress=()=>{}}) {
  const candidate=store.getCandidate(candidateId); if(!candidate||candidate.batch_id!==batchId)throw new Error('候选不存在或不属于当前批次');
  const classification = { editorial_category: candidate.editorial_category || '', material_type: candidate.material_type || '',
    article_route_approved: Boolean(candidate.article_route_approved), article_eligible: Boolean(candidate.article_eligible),
    article_eligibility_reason: candidate.article_eligibility_reason || '' };
  const routeSnapshot = String(candidate.content_route || '').trim();
  const routeGate = (candidate.article_eligible === false || Number(candidate.article_eligible) === 0 || (routeSnapshot && routeSnapshot !== 'article'))
    ? { eligible: false, reason: candidate.article_eligibility_reason || '候选尚未取得文章路线资格' }
    : evaluateArticleFactEligibility({ classification });
  if (!routeGate.eligible) throw new Error(`文章路线门禁未通过：${routeGate.reason}`);
  const editorial=candidate.editorial;
  if(editorial.brief_status!=='LOCKED')throw new Error('必须先完成编辑会并锁定 article-brief.md');
  const researchContext=readDiscussionResearchContext({workspaceRoot,batchId,candidate});
  const editorialReadiness=evaluateEditorialReadiness({candidate:{...candidate,research_context:researchContext},editorial});
  if(!editorialReadiness.ready)throw new Error(`编辑底稿未就绪,仍缺：${editorialReadiness.missing.join('、')}`);
  // F 分数只决定自动入池；能完成编辑会并锁定简报，表示作者已人工确认该选题，
  // 手动确认的低分选题也应允许进入成稿链。
  const batch=store.getBatch(batchId); const workdir=candidateArticleDir(workspaceRoot,batch,candidate);
  fs.mkdirSync(workdir,{recursive:true}); let providerConfig=gateway.config.providers[provider||gateway.config.defaultProvider];
  const sourceInput=readArticleSourceInput({candidate,workspaceRoot,store});
  const sourceUrls=sourceInput.sourceUrls.join(String.fromCharCode(10));
  const readerStake=String(candidate.reader_stake||'').trim();
  const requestedDistributionLane=normalizeDistributionLane(candidate.distribution_lane);
  const distributionLane=requestedDistributionLane==='通知池'&&!readerStake?'实验池':requestedDistributionLane;
  const materialBrief=normalizeMaterialBrief(editorial.material_brief);
  const articleType=materialBrief.article_type || selectWriterSkill(candidate).skill;
  const stanceDecision=deriveWritingStance({ articleType, materialBrief, editorial });
  const writingStance=stanceDecision.stance;
  const citationPolicy=citationPolicyForStance(writingStance);
  const visualDecision=visualPolicyForStance({ stance:writingStance, articleType });
  materialBrief.article_type=articleType;
  materialBrief.writing_stance=writingStance;
  const brief={candidateId:candidate.candidate_id,topic:candidate.hotspot_title,sourceUrl:sourceUrls,category:candidate.category,score:candidate.f_score,
    angle:candidate.angle,thesis:candidate.thesis,researchBasis:editorial.research_basis,adoptedResearchPoints:normalizeResearchPoints(editorial.adopted_research_points),confirmedFacts:editorial.confirmed_facts,authorOpinions:editorial.author_opinions,
    confirmedExperiences:editorial.confirmed_experiences,rejectedAngles:normalizeRejectedAngles(editorial.rejected_angles),forbiddenClaims:editorial.forbidden_claims,
    experienceRequired:Boolean(editorial.experience_required),distributionLane,readerStake,composite:Boolean(candidate.composite),materialBrief,
    articleType,writingStance,stanceSource:stanceDecision.source,citationPolicy,visualPolicy:visualDecision.policy,
    action:materialBrief.action,affectedGroup:materialBrief.affected_group,readerConsequence:materialBrief.reader_consequence,
    conflict:materialBrief.conflict,baselineChange:materialBrief.baseline_change,counterEvidence:materialBrief.counter_evidence,
    evidenceBoundary:materialBrief.evidence_boundary,readerAction:materialBrief.reader_action,materialReadiness:materialBrief.material_readiness};
  // 将已抓取的原始来源一并交给规划器，禁止模型凭常识补写日期、任职经历和合同细节。
  if (sourceInput.issue) throw Object.assign(new Error(sourceInput.issue), { fatalSourceCache: true });
  brief.sourceText=sourceInput.sourceText;
  const historicalSnapshot=snapshotId?store.getGenerationSnapshot?.(snapshotId):null;
  const historicalWriter=historicalSnapshot?.snapshot?.selection?.selectedSkill
    ||historicalSnapshot?.snapshot?.skills?.[0]?.id;
  const writerDecision=selectWriterSkill({...candidate,article_type:articleType});
  const chosenWriterSkill = historicalWriter || skillSelection?.selectedSkill || writerDecision.skill;
  const writerSelection={
    ...(skillSelection||{}),
    requestedSkill:skillSelection?.requestedSkill||'',
    selectedSkill:chosenWriterSkill,
    selectionSource:historicalWriter?'historical-snapshot':skillSelection?.selectionSource||'builtin-recommendation',
    articleType,
    recommendation:{skill:writerDecision.skill,reason:writerDecision.reason},
    selectionReason:historicalWriter?'复用历史生成快照中的写作技能'
      :skillSelection?.selectionSource==='user'?'用户手动指定写作技能'
        :writerDecision.reason,
  };
  const orchestratorSkill = loadSkillBundle({ workspaceRoot, skillName:'wechat-mp-topic-to-article' });
  const writerSkillBundle = loadSkillBundle({ workspaceRoot, skillName:chosenWriterSkill });
  const skillBundle = loadArticleSkillBundle({ workspaceRoot, writerSkill: chosenWriterSkill });
  const historicalStages=historicalSnapshot?.snapshot?.selection?.stages||{};
  const selectedStageIds={
    title:historicalStages.title?.selectedSkill||stageSelections?.title?.selectedSkill||'title-generator',
    reviewer:historicalStages.reviewer?.selectedSkill||stageSelections?.reviewer?.selectedSkill||'article-reviewer',
    humanizer:historicalStages.humanizer?.selectedSkill||stageSelections?.humanizer?.selectedSkill||'humanizer-zh',
    seo:historicalStages.seo?.selectedSkill||stageSelections?.seo?.selectedSkill||'seo-content-optimizer',
  };
  const stageSkills={
    'title-generator':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.title}),
    'humanizer-zh':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.humanizer}),
    'article-reviewer':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.reviewer}),
    'seo-keyword-scoring':loadSkillBundle({workspaceRoot,skillName:'seo-keyword-scoring'}),
    'seo-content-optimizer':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.seo}),
    'article-image-placeholders':loadSkillBundle({workspaceRoot,skillName:'article-image-placeholders'}),
    'article-visual-planner':loadSkillBundle({workspaceRoot,skillName:'article-visual-planner'}),
  };
  const stageSystem=(stage,...children)=>buildStanceStageSystem(orchestratorSkill,stage,writingStance,...children);
  const gateStance={writingStance,citationPolicy};
  const runtime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:'article',bundles:[writerSkillBundle,orchestratorSkill,...Object.values(stageSkills)],provider,snapshotId,
    selection:(skillSelection||stageSelections)?{...writerSelection,entryPoint:'hotspot-article',stages:stageSelections||{}}:null});
  gateway=bindGenerationSnapshot(gateway,runtime.snapshotId);
  gateway=bindPipelineHarnessGateway(gateway,{store,batchId,candidateId,provider,
    generationSnapshotId:runtime.snapshotId,rootRunId:rootRunId||`batch:${batchId}`,workflowRunId:workflowRunId||`article:${batchId}:${candidateId??'batch'}`,entryPoint:'article-pipeline'});
  provider=runtime.provider;providerConfig=runtime.providerConfig;
  const configuredLength=writerSkillBundle.config?.gates?.length;
  // 优先级：技能覆盖层 gates.length > config.local.json articleLength（含 pipelines.article 差异覆盖）> 默认 1300–2000
  const articleLengthRange=configuredLength
    ? {min:Number(configuredLength.minVisibleChars),max:Number(configuredLength.maxVisibleChars)}
    : resolveArticleLength({articleLength},'article');
  const repairAttempts=configuredRepairAttempts(writerSkillBundle.config,3);
  const stageExecutions=[];
  const recordStage=(stage,bundle,inputArtifacts,outputArtifact,gate='passed')=>{
    const expected=ARTICLE_STAGE_CONTRACT[stageExecutions.length];
    const actualSkill=bundle.skillName||bundle.writerSkill;
    const expectedSkill=expected?.skill==='$writer'?chosenWriterSkill
      : expected?.skill==='article-reviewer'?selectedStageIds.reviewer
        : expected?.skill==='title-generator'?selectedStageIds.title
          : expected?.skill==='humanizer-zh'?selectedStageIds.humanizer
            : expected?.skill==='seo-content-optimizer'?selectedStageIds.seo:expected?.skill;
    if(!expected||expected.id!==stage||expectedSkill!==actualSkill)throw new Error(`成稿契约阶段不一致：期望 ${expected?.id||'结束'}/${expectedSkill||'-'}，实际 ${stage}/${actualSkill}`);
    stageExecutions.push({stage,skill:actualSkill,skillHash:bundle.hash,skillFiles:bundle.files,inputArtifacts,outputArtifact,gate,fallback:bundle.fallback});
  };
  onProgress('Step 0/1 校验锁定简报');
  const briefPath=path.join(workdir,'00-article-brief.md'); const sourceBrief=path.join(batchTopicsDir(workspaceRoot,batch),candidate.candidate_id,'article-brief.md');
  const sourceBriefText=fs.existsSync(sourceBrief)?fs.readFileSync(sourceBrief,'utf8'):`---\nbrief_status: LOCKED\ncandidate_id: ${candidate.candidate_id}\ndistribution_lane: ${brief.distributionLane}\nreader_stake: ${brief.readerStake}\nexperience_required: ${brief.experienceRequired}\ndecision_source: explicit-user\nfinal_readiness: WRITE_NOW\n---\n\n# ${brief.topic}\n\n## 采用的研判主线\n${brief.researchBasis}\n\n## 锁定命题\n${brief.thesis}\n`;
  const briefWithStance=/^writing_stance\s*:/m.test(sourceBriefText)
    ? sourceBriefText
    : `${sourceBriefText.trimEnd()}\n\n## 写作立场\n\n- article_type: ${articleType}\n- writing_stance: ${writingStance}\n- citation_policy: ${citationPolicy}\n- visual_policy: ${visualDecision.policy}\n`;
  writeFile(briefPath,briefWithStance);
  const researchSelectionPath=path.join(workdir,'editorial-research-selection.json');
  writeFile(researchSelectionPath,JSON.stringify({candidate_id:candidate.candidate_id,selected:brief.adoptedResearchPoints,rejected:normalizeRejectedAngles(brief.rejectedAngles),generated_at:new Date().toISOString()},null,2));
  const skillManifestPath=path.join(workdir,'00-skill-manifest.json');
  writeFile(skillManifestPath,JSON.stringify({orchestrator:{skill:'wechat-mp-topic-to-article',hash:orchestratorSkill.hash,files:orchestratorSkill.files,fallback:orchestratorSkill.fallback},writerSkill:chosenWriterSkill,writerSkillSelection:writerSelection,articleType,writingStance,stanceSource:stanceDecision.source,stanceOverlayVersion:'1',citationPolicy,visualPolicy:visualDecision.policy,stageSkillSelections:stageSelections||historicalStages,hash:skillBundle.hash,files:skillBundle.files,fallback:skillBundle.fallback,stageSkills:Object.fromEntries(Object.entries(stageSkills).map(([name,bundle])=>[name,{skill:bundle.skillName,hash:bundle.hash,files:bundle.files,fallback:bundle.fallback}])),loadedAt:new Date().toISOString()},null,2));
  recordStage('brief',orchestratorSkill,['editorial','article-brief.md','editorial-research-selection.json'],'00-article-brief.md');
  onProgress('Step 1.5 基于来源建立结构化事实基座');
  // 事实基座包含逐条主张、证据和来源映射，内容量会随素材增长。
  // 不要在这里传固定 maxOutputTokens：gateway 的 article-fact-base
  // profile 需要在 finish=length 时从 5000 自动扩容到供应商上限，否则
  // parseModelJson 只能看到半截 JSON，后续大纲和成稿都不会开始。
  // Always regenerate from the locked brief and current source inputs. An older
  // editor-room preflight artifact is only a readiness snapshot, never a fact-base cache.
  const rawFactBase=parseJsonResult(await gateway.complete({provider,purpose:'article-fact-base',batchId,candidateId,jsonMode:true,messages:[
      {role:'system',protected:true,content:buildArticleStageSystem(orchestratorSkill,'fact-base')},
      {role:'user',protected:true,content:JSON.stringify({topic:brief.topic,researchBasis:brief.researchBasis,adoptedResearchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,confirmedFacts:brief.confirmedFacts,authorOpinions:brief.authorOpinions,forbiddenClaims:brief.forbiddenClaims,materialBrief:brief.materialBrief,sourceUrl:brief.sourceUrl,sourceText:brief.sourceText||''})},
    ]}),store);
  const factBase=enrichFactBaseClaims(rawFactBase,{citationPolicy});
  brief.factBase=factBase;
  const publicationClaimRegister=buildPublicationClaimRegister(factBase,{citationPolicy});
  brief.publicationClaimRegister=publicationClaimRegister;
  const writingBrief=authorizedWritingBrief(brief);
  const factBasePath=path.join(workdir,'02-fact-base.json');
  const publicationClaimRegisterPath=path.join(workdir,'02-publication-claim-register.json');
  const factPublicationIssues=publicationFactBaseIssues(factBase);
  writeFile(factBasePath,JSON.stringify(factBase,null,2));
  writeFile(publicationClaimRegisterPath,JSON.stringify({generatedAt:new Date().toISOString(),claims:publicationClaimRegister},null,2));
  recordStage('fact-base',orchestratorSkill,['00-article-brief.md','source-cache'],['02-fact-base.json','02-publication-claim-register.json'],factPublicationIssues.length?'failed':'passed');
  if(factPublicationIssues.length)throw new Error(`事实基座发布合规门禁未通过：${factPublicationIssues.join('；')}`);
  const factIssue=unverifiedFactBaseIssue(factBase);
  if(factIssue)throw new Error(factIssue);
  const factGate = evaluateArticleFactEligibility({ classification, factBase });
  writeFile(path.join(workdir,'02-fact-gate.json'), JSON.stringify(factGate, null, 2));
  if (!factGate.eligible) throw new Error(`文章事实门禁未通过：${factGate.reason}`);
  onProgress('Step 2 根据锁定简报和事实基座生成文章大纲');
  const OUTLINE_SYSTEM = `你负责把已经锁定的文章简报和事实基座整理成一份文章大纲。简报中的写作角度、命题、主线、读者影响和冲突是写作条件；事实基座是可用事实的边界。\n\n只输出 JSON：{"outlineMarkdown":"..."}。outlineMarkdown 只包含按论证顺序排列的章节标题，每节用一两句话说明本节要讲的内容及其与主线的关系。\n\n只做文章结构设计：不生成作者素材、标题候选、分发信息、流量规划、读者收益说明、来源清单、风险清单、写作指令或正文段落；这些信息若对文章结构有用，只体现在章节安排中。不要设置固定章节数或固定推进次数。不要补充简报和事实基座没有支持的新事实、新判断或新角度。`;
  // 大纲阶段同样使用 output-budget 的 6000 -> 10000 自适应重试，
  // 由 providerMax 负责兜底，不要用调用方固定上限关闭该机制。
  const planningResult=await gateway.complete({provider,purpose:'article-planning',batchId,candidateId,jsonMode:true,
    messages:[{role:'system',content:`${OUTLINE_SYSTEM}\n\n## 账号上下文\n${formatAccountContext(getAccountContext({ workspaceRoot }))}`,protected:true},{role:'user',content:JSON.stringify(writingBrief),protected:true}]});
  const outlineResult=parseJsonResult(planningResult,store);
  const outlineMarkdown=String(outlineResult?.outlineMarkdown||outlineResult?.outline_markdown||'').trim();
  if(!outlineMarkdown)throw new Error('大纲阶段未返回 outlineMarkdown');
  const outline=`# 文章大纲\n\n${outlineMarkdown}`;
  const selectedTitle=String(brief.materialBrief.title_promise||candidate.hotspot_title).trim();
  const contentRole=String(brief.materialBrief.content_role||'').trim();
  const clickMechanism=String(brief.materialBrief.click_mechanism||'').trim();
  const openingHook=String(brief.materialBrief.opening_hook||'').trim();
  const retentionTurns=brief.materialBrief.retention_turns||[];
  const endingPayoff=String(brief.materialBrief.ending_payoff||'').trim();
  const shareTrigger=String(brief.materialBrief.share_trigger||'').trim();
  const p02=path.join(workdir,'02-outline.md'); writeFile(p02,outline);
  recordStage('planning',orchestratorSkill,['00-article-brief.md','02-fact-base.json'],['02-outline.md']);
  onProgress(`Step 4 使用 ${chosenWriterSkill} 完整技能生成初稿`);
  const skillPrompt = `${stageSystem('drafting',writerSkillBundle)}\n\n## 本次成稿任务边界\n只按锁定简报与事实基座确定文章写什么、按 02-outline.md 确定文章结构，然后写出完整文章。不要重新规划标题、流量、读者收益或来源清单；不要补充大纲以外的结构要求，也不要按固定章节数或固定推进次数扩写。`;
  const draftResult=await textCall(gateway,{provider,purpose:'article-drafting-pipeline',batchId,candidateId},skillPrompt,buildDraftUserPrompt(selectedTitle, writingBrief, outline),Math.min(6500,providerConfig.maxOutputTokens));
  let draft=cleanMarkdown(draftResult.content);
  const draftGateSystem=stageSystem('draft-quality-gate',writerSkillBundle,stageSkills['article-reviewer']);
   let draftQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:draft,factBase,sourceText:brief.sourceText||'',researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan:scanPublicationRisk({article:draft,factBase}),...gateStance,systemPrompt:draftGateSystem,stage:'draft',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
   if(!draftQuality.pass){
    const draftScan=scanPublicationRisk({article:draft,factBase});
    onProgress(`Step 4.2 AI 质量门禁未通过，执行定向事实与合规修订：${issueList(draftQuality.issues).join('；')}`);
    const draftRepair=await repairArticleForPublicationCompliance({
      gateway,
      orchestratorSkill,
      reviewerSkill:stageSkills['article-reviewer'],
      provider,
      batchId,
      candidateId,
      article:draft,
      factBase,
      publicationClaimRegister,
      publicationScan:draftScan,
      issues:draftQuality.issues || [],
      researchPoints:brief.adoptedResearchPoints,
      rejectedAngles:brief.rejectedAngles,
      writingStance,
      maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens),
    });
    draft=draftRepair.article;draftQuality={pass:false,issues:[]};
   }
  if(!draftQuality.pass)draftQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:draft,factBase,sourceText:brief.sourceText||'',researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan:scanPublicationRisk({article:draft,factBase}),...gateStance,systemPrompt:draftGateSystem,stage:'draft-recheck',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  const draftBlockers=articleGateBlockingIssues(draftQuality);
  if(draftBlockers.length)throw new Error(`AI 成稿输出门禁未通过：${issueList(draftBlockers).join('；')}`);
  const draftGatePath=path.join(workdir,'04-quality-gate.json');writeFile(draftGatePath,JSON.stringify(draftQuality,null,2));
  const p04=path.join(workdir,'04-draft.md');writeFile(p04,draft);
  recordStage('drafting',writerSkillBundle,['00-article-brief.md','02-outline.md','02-fact-base.json'],'04-draft.md');
  recordStage('draft-quality-gate',stageSkills['article-reviewer'],['04-draft.md','02-fact-base.json'],'04-quality-gate.json',draftQuality.pass?'passed':'needs_review');
  onProgress('Step 4.5 根据初稿正文生成标题');
  const titleGenSystem = stageSystem('title-generation',stageSkills['title-generator']);
  const titlePurpose='article-title-generation';
  let titleGen=await generateTitlePlan({gateway,store,provider,batchId,candidateId,systemPrompt:titleGenSystem,purpose:titlePurpose,fallbackTitle:selectedTitle,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),payload:{topic:candidate.hotspot_title,
    content_role:contentRole,packaging_mode:candidate.packaging_mode,distribution_lane:brief.distributionLane,reader_stake:brief.readerStake,click_mechanism:clickMechanism,opening_hook:openingHook,retention_turns:retentionTurns,ending_payoff:endingPayoff,share_trigger:shareTrigger,draft,factBase,publicationClaimRegister,
    hotspotAnchorRule:'从 topic 中选一个具体且可识别的主体/话题作为 hotspotAnchor；selectedTitle 与至少一条 titleCandidates 必须原样包含这个锚点（忽略大小写和标点）。不要用“AI/科技/公司”等泛词充当锚点。',
    materialBrief:brief.materialBrief,forbiddenClaims:brief.forbiddenClaims,publicationRiskRules:'高影响财经、名誉和敏感主张必须有已核验事实与明确归因；标题不得把传闻、推断或绝对化判断写成事实。'}});
  const finalSelectedTitle=String(titleGen.selectedTitle||selectedTitle).trim();
  brief.materialBrief.title_promise=String(brief.materialBrief.title_promise||finalSelectedTitle).trim();
  titleGen=normalizePlanningResult(titleGen);
  const finalTitleCandidates=titleGen.titleCandidates; const finalCoreKeywords=titleGen.coreKeywords;
  const updatedTitles='# 标题候选\n\ndistribution_lane: '+brief.distributionLane+'\nreader_stake: '+(brief.readerStake||'待明确')+'\nmaterial_title_promise: '+brief.materialBrief.title_promise+'\ncore_keywords: '+finalCoreKeywords.join('、')+'\n\n'+finalTitleCandidates.map((x,i)=>(i+1)+'. '+x.title+' - '+x.reason+(x.score!=null?' (得分:'+x.score+'/12)':'')).join('\n')+'\n\nSELECTED_TITLE: '+finalSelectedTitle+'; // 初稿正文重生成\nwriter_skill: '+chosenWriterSkill;
  writeFile(p03,updatedTitles);
  const selectedTitleRisk=scanPublicationRisk({title:finalSelectedTitle,article:draft,factBase});
  selectedTitleRisk.generatedTitle=finalSelectedTitle;
  selectedTitleRisk.hotspotAnchor={anchor:titleGen.hotspotAnchor||'',status:titleGen.hotspotAnchorStatus||'anchor_missing_or_unverified',preserved:titleHasHotspotAnchor(finalSelectedTitle,titleGen.hotspotAnchor)};
  const selectedTitleRiskPath=path.join(workdir,'03-title-risk.json');
  writeFile(selectedTitleRiskPath,JSON.stringify(selectedTitleRisk,null,2));
  recordStage('title-generation',stageSkills['title-generator'],['04-draft.md','02-fact-base.json'],['03-titles.md','03-title-risk.json'],selectedTitleRisk.titleBlockers.length||!selectedTitleRisk.hotspotAnchor.preserved?'needs_review':'passed');
  // 标题风险先保留到终稿编辑器处理；它不再阻断文章正文的生成。
  const humanSystem=stageSystem('humanize',stageSkills['humanizer-zh']);
  const humanizeInstruction=`作者采用的研判拓展点：${JSON.stringify(brief.adoptedResearchPoints)}\n\n作者明确不采用的方向：${JSON.stringify(brief.rejectedAngles)}\n\n本阶段只处理明确可定位的 AI 套话、重复表达和机械连接。先保留原文，只修改确有问题的句子；不要删段、合并、重排章节或重写结尾。保留作者的事实判断、推理链、观点力度、标题承诺、修辞和结尾余味；不要把作者推断改写成客观事实，也不要给观点句统一添加“可能”“笔者认为”等限定。不得新增事实、数字、来源、经历或作者观点；没有作者亲历素材时不要写成亲测。输出完整 Markdown 文章以供保存，未涉及的段落和句子必须逐字保留，不附说明。\n\n待自然化文章：\n${draft}`;
  let humanResult=await textCall(gateway,{provider,purpose:'article-humanize',batchId,candidateId},humanSystem,humanizeInstruction,Math.min(5000,providerConfig.maxOutputTokens));
  let human=cleanMarkdown(humanResult.content); let humanIssue=articleStageOutputIssue(human,{requireArticle:true});
  if(humanIssue){
    store.updateModelCall(humanResult.callId,{status:'invalid_output',error:humanIssue});
    onProgress(`Step 4 自然化输出异常，自动重试：${humanIssue}`);
    humanResult=await textCall(gateway,{provider,purpose:'article-humanize-repair',batchId,candidateId},humanSystem,
      `上一次输出无效：${humanIssue}。不要读取文件、调用工具、解释过程或复述任务。请按以下要求直接输出完整 Markdown 文章：仅修改明确的问题句；其余内容逐字保留；不得删段、合并、重排、改写观点或新增内容。\n\n${humanizeInstruction}`,Math.min(5000,providerConfig.maxOutputTokens));
    human=cleanMarkdown(humanResult.content);humanIssue=articleStageOutputIssue(human,{requireArticle:true});
  }
  const p05=path.join(workdir,'05-humanized.md');writeFile(p05,human);
  if(humanIssue){
    const reason=`自然化输出无效：${humanIssue}；返回摘要：${outputExcerpt(human)}`;
    store.updateModelCall(humanResult.callId,{status:'invalid_output',error:reason});
    throw new Error(reason);
  }
  recordStage('humanize',stageSkills['humanizer-zh'],['04-draft.md','02-fact-base.json'],'05-humanized.md');
  onProgress('Step 4.8 独立检查模板化表达并最多返修一次');
  const voiceGateSystem=`你是中文特稿的风格编辑。${stageSystem('voice-quality-gate',stageSkills['article-reviewer'])}\n\n本门禁只查具体、可定位且显著损害真实感的模板化表达，不做个人审美裁决，也不要求第一人称。必须给出原文短引文和可执行修改建议；不因固定词语、单个修辞或段落结构本身判失败。`;
  let voiceGate=await aiVoiceQualityGate({gateway,store,provider,batchId,candidateId,article:human,systemPrompt:voiceGateSystem,maxOutputTokens:Math.min(2500,providerConfig.maxOutputTokens)});
  let voiceRepairResult=null;
  if(!voiceGate.pass){
    onProgress(`风格门禁发现具体问题，执行一次局部表达修订：${issueList(voiceGate.issues).join('；')}`);
    voiceRepairResult=await textCall(gateway,{provider,purpose:'article-humanize-voice-repair',batchId,candidateId},humanSystem,
      `只修复风格门禁列出的具体句子，不做结构性返修。保留事实、来源、推理链、作者判断力度、修辞和其余原文；不得删段、合并、重排、改写结尾或新增观点。输出完整 Markdown 文章，未涉及内容逐字保留。\n\n门禁问题：\n${JSON.stringify(voiceGate.issues)}\n\n文章：\n${human}`,Math.min(6000,providerConfig.maxOutputTokens));
    const repairedHuman=cleanMarkdown(voiceRepairResult.content);
    const repairIssue=articleStageOutputIssue(repairedHuman,{requireArticle:true});
    if(!repairIssue){human=repairedHuman;writeFile(p05,human);voiceGate=await aiVoiceQualityGate({gateway,store,provider,batchId,candidateId,article:human,systemPrompt:voiceGateSystem,maxOutputTokens:Math.min(2500,providerConfig.maxOutputTokens)});}
    else voiceGate={pass:false,issues:[{type:'output',message:`风格返修未生成有效文章：${repairIssue}`,evidence:outputExcerpt(repairedHuman),repair:'由编辑检查并继续修订'}]};
  }
  const voiceGatePath=path.join(workdir,'05-voice-quality-gate.json');
  const voiceGateArtifact={generatedAt:new Date().toISOString(),pass:voiceGate.pass===true,attempts:voiceRepairResult?2:1,gate:voiceGate};
  writeFile(voiceGatePath,JSON.stringify(voiceGateArtifact,null,2));
  artifact(store,batchId,'风格门禁','05-voice-quality-gate.json',voiceGatePath,{candidateId,rootRunId,workflowRunId,stageId:'article-pipeline'});
  recordStage('voice-quality-gate',stageSkills['article-reviewer'],['05-humanized.md'],'05-voice-quality-gate.json',voiceGate.pass?'passed':'needs_review');
  if(!voiceGate.pass){
    onProgress(`风格门禁返修后仍有待处理建议：${issueList(voiceGate.issues).join('；')}；继续生成可编辑终稿，完成后交由编辑确认`);
  }
  onProgress('Step 5 审稿与事实/逻辑/风险门禁');
  const reviewSystem=stageSystem('review',stageSkills['article-reviewer']);
  const reviewLogPath=path.join(workdir,'06-review-gate.md');
  let reviewed=human;
  let reviewDecision=await aiReviewGate({gateway,store,provider,batchId,candidateId,article:human,factBase,outline,researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan:scanPublicationRisk({article:human,factBase}),...gateStance,systemPrompt:reviewSystem,maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  let reviewIssue=null;
  let finalReviewResult=null;
  let reviewLog=`# 审稿门禁结果\n\n${JSON.stringify(reviewDecision,null,2)}`;
  writeFile(reviewLogPath,reviewLog);
  if(!reviewDecision.pass) {
    onProgress(`Step 5 审稿发现明确问题，执行一次局部修订：${issueList(reviewDecision.issues).join('；')}`);
    const repairResult=await textCall(gateway,{provider,purpose:'article-review-repair',batchId,candidateId},reviewSystem,
      `${buildReviewRepairPrompt({factBase,outline,article:human,review:JSON.stringify(reviewDecision)})}\n\n作者采用的研判拓展点：${JSON.stringify(brief.adoptedResearchPoints)}；作者明确不采用的方向：${JSON.stringify(brief.rejectedAngles)}。只修复门禁列出的具体问题，保留未涉及的句段、作者推断和观点语气。`,Math.min(6500,providerConfig.maxOutputTokens));
    reviewed=cleanMarkdown(repairResult.content);
    finalReviewResult=repairResult;
    reviewIssue=articleStageOutputIssue(reviewed,{requireArticle:true});
    reviewLog+=`\n\n# 定向修订响应\n\n${reviewed}`;
    writeFile(reviewLogPath,reviewLog);
    if(!reviewIssue) {
      reviewDecision=await aiReviewGate({gateway,store,provider,batchId,candidateId,article:reviewed,factBase,outline,researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan:scanPublicationRisk({article:reviewed,factBase}),...gateStance,systemPrompt:reviewSystem,maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
    }
  }
  const reviewBlockers=reviewIssue ? [{type:'output',message:reviewIssue}] : articleGateBlockingIssues(reviewDecision);
  if(reviewBlockers.length){
    const reason=reviewIssue
      ? `审稿修订响应不符合输出契约：${reviewIssue}；原始响应已保存到 06-review-gate.md；返回摘要：${outputExcerpt(reviewed)}`
      : `审稿复审未返回可供编辑的文章：${issueList(reviewBlockers).join('；')||'模型判定需要返工'}；原始响应已保存到 06-review-gate.md；返回摘要：${outputExcerpt(reviewed)}`;
    if(finalReviewResult?.callId)store.updateModelCall(finalReviewResult.callId,{status:'invalid_output',error:reason});
    throw new Error(reason);
  }
  const p06=path.join(workdir,'06-reviewed.md');writeFile(p06,reviewed);
  const reviewGatePath=path.join(workdir,'06-review-quality-gate.json');writeFile(reviewGatePath,JSON.stringify(reviewDecision,null,2));
  recordStage('review',stageSkills['article-reviewer'],['05-humanized.md','02-fact-base.json'],'06-reviewed.md',reviewDecision.pass?'passed':'needs_review');
  onProgress('Step 5.5 锁定最终发布标题');
  const titleLockSystem=stageSystem('title-lock',stageSkills['title-generator']);
  const reviewTitle=extractArticleTitle(reviewed)||finalSelectedTitle;
  const requiredHotspotAnchor=String(titleGen.hotspotAnchor||'').trim();
  let finalTitleGen=await generateTitlePlan({gateway,store,provider,batchId,candidateId,systemPrompt:titleLockSystem,purpose:'article-title-generation-final',fallbackTitle:reviewTitle,maxOutputTokens:Math.min(5000,providerConfig.maxOutputTokens),payload:{
    topic:candidate.hotspot_title,content_role:contentRole,packaging_mode:candidate.packaging_mode,distribution_lane:brief.distributionLane,reader_stake:brief.readerStake,
    click_mechanism:clickMechanism,opening_hook:openingHook,retention_turns:retentionTurns,ending_payoff:endingPayoff,share_trigger:shareTrigger,
    draft:reviewed,factBase,publicationClaimRegister,materialBrief:brief.materialBrief,forbiddenClaims:brief.forbiddenClaims,
    hotspotAnchor:requiredHotspotAnchor,hotspotAnchorRule:'必须沿用 hotspotAnchor，不可改成泛词或删掉。selectedTitle 必须原样包含该锚点（忽略大小写和标点）；若没有合适标题候选，显式保留锚点并标记待编辑确认。',
    current_title:reviewTitle,title_lock:true,publicationRiskRules:'标题必须兑现最终正文，不得把传闻、推断或绝对化判断写成事实。返回的 selectedTitle 将被确定性写回唯一 H1，后续 SEO、长度修复和门禁必须保留该标题。',
  }});
  const lockedTitle=String(finalTitleGen.selectedTitle||reviewTitle).trim();
  const lockedHotspotAnchor=requiredHotspotAnchor||String(finalTitleGen.hotspotAnchor||'').trim();
  const lockedAnchorPreserved=titleHasHotspotAnchor(lockedTitle,lockedHotspotAnchor);
  reviewed=replaceArticleTitle(reviewed,lockedTitle);
  writeFile(p06,reviewed);
  brief.materialBrief.title_promise=lockedTitle;
  store.saveEditorial(candidateId,{material_brief:brief.materialBrief});
  finalTitleGen=normalizePlanningResult(finalTitleGen);
  const titleLockRisk=scanPublicationRisk({title:lockedTitle,article:reviewed,factBase});
  const titleLockPath=path.join(workdir,'03-title-lock.json');
  writeFile(titleLockPath,JSON.stringify({generatedAt:new Date().toISOString(),title:lockedTitle,previousTitle:reviewTitle,candidates:finalTitleGen.titleCandidates,coreKeywords:finalTitleGen.coreKeywords,hotspotAnchor:{anchor:lockedHotspotAnchor,preserved:lockedAnchorPreserved,status:finalTitleGen.hotspotAnchorStatus||'anchor_missing_or_unverified'},risk:titleLockRisk},null,2));
  const lockedTitleMarkdown='# 标题候选\n\ndistribution_lane: '+brief.distributionLane+'\nreader_stake: '+(brief.readerStake||'待明确')+'\nhotspot_anchor: '+(lockedHotspotAnchor||'待编辑确认')+'\nhotspot_anchor_status: '+(lockedAnchorPreserved?'已保留':'待编辑确认')+'\nmaterial_title_promise: '+lockedTitle+'\ncore_keywords: '+finalTitleGen.coreKeywords.join('、')+'\n\n'+finalTitleGen.titleCandidates.map((x,i)=>`${i+1}. ${x.title} - ${x.reason}${x.score!=null?` (得分:${x.score}/12)`:''}`).join('\n')+'\n\nSELECTED_TITLE: '+lockedTitle+'; // 最终标题已锁定\nwriter_skill: '+chosenWriterSkill;
  writeFile(p03,lockedTitleMarkdown);
  recordStage('title-lock',stageSkills['title-generator'],['06-reviewed.md','02-fact-base.json'],['03-title-lock.json','03-titles.md'],titleLockRisk.titleBlockers.length||!lockedAnchorPreserved?'needs_review':'passed');
  const lockedCoreKw=finalTitleGen.coreKeywords;
  const coreKw=lockedCoreKw;
  const explicitSeo=candidate.seo_enabled === true || candidate.seo_enabled === 1;
  const explicitSeoOff=candidate.seo_enabled === false || candidate.seo_enabled === 0;
  const seoEnabled=!explicitSeoOff && (explicitSeo || contentRole==='搜索' || String(candidate.packaging_mode||'').trim()==='搜索型');
  onProgress(seoEnabled ? 'Step 6.1 SEO 关键词评分（百度+360 搜索联想）' : 'Step 6.1 普通流量文跳过 SEO 改写，保留原审稿稿');
  let seoScores=[]; let keywordsMarkdown;
  if (seoEnabled && coreKw.length) {
    try { seoScores = await scoreKeywords(coreKw); } catch (e) { /* score silently */ }
    keywordsMarkdown = '# SEO 关键词评分\n\n' +
      '评分方法:百度+360 搜索联想结果数均值(0-10),仅表示相对搜索信号,非微信搜索量。\n\n' +
      seoScores.map(k => {
        const score = k.seo_score == null ? '数据不可用' : `${k.seo_score}/10`;
        const from = k.available_sources ? `（可用来源 ${k.available_sources}/2）` : '';
        return `- ${k.keyword}: ${score}${from}` +
          (k.related_keywords?.length ? `\n  - 相关词: ${k.related_keywords.slice(0,5).join('、')}` : '');
      }).join('\n') + '\n\n' +
      '> 局限:联想数据只用于比较候选关键词的相对热度,不能证明在微信搜一搜中的实际需求。\n';
  } else if (seoEnabled) {
    keywordsMarkdown = '# SEO 关键词\n\n无核心关键词,跳过评分。\n';
  } else {
    keywordsMarkdown = '# SEO 关键词\n\n普通流量文未启用 SEO，保留标题张力与完读节奏。\n';
  }
  const p07=path.join(workdir,'07-seo-keywords.md');writeFile(p07,keywordsMarkdown);
  recordStage('seo-keyword-scoring',stageSkills['seo-keyword-scoring'],['06-reviewed.md'],'07-seo-keywords.md',seoEnabled?'passed':'skipped');
  const seoContext = seoScores.length
    ? `\n\n关键词评分:${seoScores.map(k => `${k.keyword}=${k.seo_score??'N/A'}`).join(', ')}。相关词:${seoScores.flatMap(k=>k.related_keywords||[]).join('、')}`
    : '';
  let final=reviewed;
  if(seoEnabled){
    onProgress('Step 6.2 搜一搜优化');
    const seoResult=await textCall(gateway,{provider,purpose:'article-seo',batchId,candidateId},stageSystem('seo-optimization',stageSkills['seo-content-optimizer']),`核心关键词: ${coreKw.join('、')}${seoContext}\n\n已锁定标题：${lockedTitle}\n\n事实基座：${JSON.stringify(factBase)}\n\n发布主张登记：${JSON.stringify(publicationClaimRegister)}\n\nSEO 前风险扫描：${JSON.stringify(scanPublicationRisk({article:reviewed,factBase}))}\n\nSEO 不得新增高影响事实、财经数字、负面指控或绝对化判断；不得改变 writing_stance=${writingStance} 或 citation_policy=${citationPolicy}；若关键词与事实冲突，保留事实边界；若改写损害标题张力、前 200 字或完读节奏，保留原句；不得改写已锁定的 H1 标题。\n\n待优化文章：\n${reviewed}`,Math.min(6500,providerConfig.maxOutputTokens));
    final=replaceArticleTitle(cleanMarkdown(seoResult.content).replace(/<!--\s*REVIEW[\s\S]*?-->/gi,'').trim(),lockedTitle);
  }
  if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max){onProgress(`终稿当前 ${visibleChars(final)} 字，调整到 ${articleLengthRange.min}–${articleLengthRange.max} 字`);final=await fitArticleLength({gateway,provider,batchId,candidateId,article:final,factBase,systemPrompt:stageSystem('length-repair',writerSkillBundle),purpose:'article-length-gate',maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens),onProgress,maxAttempts:repairAttempts,range:articleLengthRange,lockedTitle});}
  if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max)onProgress(`字数警告：终稿有 ${visibleChars(final)} 个可见字符，不在 ${articleLengthRange.min}–${articleLengthRange.max} 字区间，可稍后在编辑器手动删减，流程继续`);
  const configuredGate=evaluateConfiguredGates(writerSkillBundle.config,{factBase,output:final,visibleChars:visibleChars(final)});
  if(!configuredGate.pass)throw new Error(`技能配置门禁未通过：${configuredGate.issues.map((item)=>item.message).join('；')}`);
  const finalGateSystem=stageSystem('final-quality-gate',writerSkillBundle,stageSkills['article-reviewer']);
  let finalPublicationScan=scanPublicationRisk({article:final,factBase});
  let finalQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan:finalPublicationScan,...gateStance,systemPrompt:finalGateSystem,stage:'final',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  if(!finalQuality.pass){
    onProgress(`Step 6.3 AI 终稿门禁未通过，执行定向合规修订：${issueList(finalQuality.issues).join('；')}`);
    const finalRepair=await repairArticleForPublicationCompliance({ gateway, orchestratorSkill, reviewerSkill:stageSkills['article-reviewer'], provider, batchId, candidateId, article:final, factBase, publicationClaimRegister, publicationScan:finalPublicationScan, issues:finalQuality.issues || [], researchPoints:brief.adoptedResearchPoints, rejectedAngles:brief.rejectedAngles, writingStance, maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens) });
    final=finalRepair.article;
    if(!gateMentionsTitle(finalQuality.issues))final=replaceArticleTitle(final,lockedTitle);
    if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max)final=await fitArticleLength({gateway,provider,batchId,candidateId,article:final,factBase,systemPrompt:stageSystem('length-repair',writerSkillBundle),purpose:'article-final-repair-length',maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens),onProgress,maxAttempts:repairAttempts,range:articleLengthRange,lockedTitle});
    finalPublicationScan=scanPublicationRisk({article:final,factBase});
    finalQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan:finalPublicationScan,...gateStance,systemPrompt:finalGateSystem,stage:'final-recheck',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  }
  if(visibleChars(final)<articleLengthRange.min||visibleChars(final)>articleLengthRange.max)onProgress(`字数警告：终稿有 ${visibleChars(final)} 个可见字符，不在 ${articleLengthRange.min}–${articleLengthRange.max} 字区间，可稍后在编辑器手动删减，流程继续`);
  const finalQualityBlockers=articleGateBlockingIssues(finalQuality);
  if(finalQualityBlockers.length)throw new Error(`AI 终稿输出门禁未通过：${issueList(finalQualityBlockers).join('；')}`);
  const finalGatePath=path.join(workdir,'08-quality-gate.json');writeFile(finalGatePath,JSON.stringify(finalQuality,null,2));
  const seoFinal=final;
  const p08=path.join(workdir,'08-seo-optimized.md'),p09=path.join(workdir,'09-FINAL.md');writeFile(p08,seoFinal);
  recordStage('seo-optimization',stageSkills['seo-content-optimizer'],['06-reviewed.md','07-seo-keywords.md'],'08-seo-optimized.md',seoEnabled?'passed':'skipped');
  recordStage('final-quality-gate',stageSkills['article-reviewer'],['08-seo-optimized.md','02-fact-base.json'],'08-quality-gate.json',finalQuality.pass?'passed':'needs_review');
  onProgress('Step 6.4 检查终稿是否兑现作者采用的研判拓展点');
  let researchCoverage;
  if (brief.adoptedResearchPoints.length) {
    const coveragePurpose='article-research-coverage';
    const coverageMessages=[
      {role:'system',protected:true,content:stageSystem('research-coverage',stageSkills['article-reviewer'])},
      {role:'user',protected:true,content:buildResearchCoveragePrompt({article:final,researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles})},
    ];
    const coverageFallback=async()=>normalizeResearchCoverageResult(parseJsonResult(await gateway.complete({provider,purpose:coveragePurpose,batchId,candidateId,jsonMode:true,maxOutputTokens:Math.min(4500,providerConfig.maxOutputTokens),messages:coverageMessages}),store));
    const coverageDecision=await callDecisionTool({gateway,provider,repository:store?.repositories?.extensionSettings,purpose:coveragePurpose,batchId,candidateId,
      definition:RESEARCH_COVERAGE_TOOL,schema:RESEARCH_COVERAGE_TOOL.function.parameters,
      messages:[{...coverageMessages[0],content:`${coverageMessages[0].content}\n\n如果当前调用提供了 decision.research_coverage 工具，必须调用一次该工具；工具参数就是最终检查结果，不要输出解释文字。`},coverageMessages[1]],fallback:coverageFallback});
    researchCoverage=normalizeResearchCoverageResult(coverageDecision.value);
  } else {
    researchCoverage={status:'skipped',summary:'未选择研判拓展点，跳过贴合度检查。',items:[],omitted_points:[],contradicted_points:[],repair_suggestions:[]};
  }
  const researchCoveragePath=path.join(workdir,'research-coverage-review.json');
  writeFile(researchCoveragePath,JSON.stringify(researchCoverage,null,2));
  // 贴合度报告始终登记，失败时由终稿状态提示编辑器处理。
  artifact(store,batchId,'研判贴合度检查','research-coverage-review.json',researchCoveragePath,{candidateId,rootRunId,workflowRunId,stageId:'research-coverage'});
  recordStage('research-coverage',stageSkills['article-reviewer'],['08-seo-optimized.md','editorial-research-selection.json'],'research-coverage-review.json',researchCoverage.status);
  // 研判贴合度是可在编辑器中补齐的内容问题；保留报告并把终稿标为待审核。
  onProgress('Step 7 自动配图：先插入 Mermaid/ECharts 图表，再规划手动供图占位');
  const illustration=await illustrateArticle({
    gateway,store,provider,batchId,candidateId,markdown:final,factBase:JSON.stringify(factBase),
    workspaceRoot,maxOutputTokens:Math.min(8000,providerConfig.maxOutputTokens),
    visualPolicy:visualDecision.policy,
    visualNeed:brief.materialBrief.visual_need||'auto',
    imageSkillPrompt:stageSystem('image-planning',stageSkills['article-image-placeholders']),
    onProgress,
  });
  final=replaceArticleTitle(illustration.markdown,extractArticleTitle(final)||lockedTitle);
  const visualPlanPath=path.join(workdir,'09-visual-plan.json');writeFile(visualPlanPath,JSON.stringify(illustration.visualPlan,null,2));
  recordStage('visual-planning',stageSkills['article-visual-planner'],['08-seo-optimized.md','02-fact-base.json'],'09-visual-plan.json');
  writeFile(p09,final);
  recordStage('image-planning',stageSkills['article-image-placeholders'],['08-seo-optimized.md','09-visual-plan.json'],'09-FINAL.md');
  onProgress('Step 7.2 执行发布合规专项门禁');
  let publicationScan=scanPublicationRisk({article:final,factBase});
  let publicationQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan,...gateStance,systemPrompt:stageSystem('publication-safety-gate',stageSkills['article-reviewer']),stage:'publication-safety',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
  let publicationIssues=publicationComplianceIssue({scan:publicationScan,gate:{pass:true}});
  if(publicationIssues.length)publicationQuality={...publicationQuality,pass:false,issues:[...(Array.isArray(publicationQuality.issues)?publicationQuality.issues:[]),...publicationIssues.map((message)=>({type:'publication_compliance',message,repair:'删除、降格或补充可靠来源；标题和高影响主张需重新审核'}))]};
  if(!publicationQuality.pass){
    const complianceIssues=publicationQuality.issues||[];
    onProgress(`Step 7.3 发布合规门禁未通过，执行定向合规修订：${issueList(complianceIssues).join('；')}`);
    const complianceRepair=await repairArticleForPublicationCompliance({ gateway, orchestratorSkill, reviewerSkill:stageSkills['article-reviewer'], provider, batchId, candidateId, article:final, factBase, publicationClaimRegister, publicationScan, issues:complianceIssues, researchPoints:brief.adoptedResearchPoints, rejectedAngles:brief.rejectedAngles, writingStance, preserveVisuals:true, maxOutputTokens:Math.min(6500,providerConfig.maxOutputTokens) });
    final=complianceRepair.article;
    if(!gateMentionsTitle(complianceIssues))final=replaceArticleTitle(final,lockedTitle);
    writeFile(p09,final);
    publicationScan=scanPublicationRisk({article:final,factBase});
    publicationQuality=await aiQualityGate({gateway,store,provider,batchId,candidateId,article:final,factBase,sourceText:brief.sourceText||'',researchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,publicationClaimRegister,publicationScan,...gateStance,systemPrompt:stageSystem('publication-safety-gate',stageSkills['article-reviewer']),stage:'publication-safety-recheck',maxOutputTokens:Math.min(3500,providerConfig.maxOutputTokens)});
    publicationIssues=publicationComplianceIssue({scan:publicationScan,gate:{pass:true}});
    if(publicationIssues.length)publicationQuality={...publicationQuality,pass:false,issues:[...(Array.isArray(publicationQuality.issues)?publicationQuality.issues:[]),...publicationIssues.map((message)=>({type:'publication_compliance',message,repair:'删除、降格或补充可靠来源；标题和高影响主张需重新审核'}))]};
  }
  const publicationCompliancePath=path.join(workdir,'10-publication-compliance.json');
  writeFile(publicationCompliancePath,JSON.stringify({generatedAt:new Date().toISOString(),scan:publicationScan,gate:publicationQuality},null,2));
  recordStage('publication-safety-gate',stageSkills['article-reviewer'],['09-FINAL.md','02-fact-base.json','02-publication-claim-register.json'],'10-publication-compliance.json',publicationQuality.pass?'passed':'needs_review');
  const publicationBlockers=articleGateBlockingIssues(publicationQuality);
  if(publicationBlockers.length)throw new Error(`发布合规输出门禁未通过：${issueList(publicationBlockers).join('；')}`);
  if(stageExecutions.length!==ARTICLE_STAGE_CONTRACT.length)throw new Error('成稿契约未完整执行');
  const stageManifestPath=path.join(workdir,'00-stage-executions.json');writeFile(stageManifestPath,JSON.stringify({generatedAt:new Date().toISOString(),stages:stageExecutions},null,2));
  // title 字段以最终锁定并经发布门禁确认的正文 H1 为准；合规门禁只有在发现标题风险时才允许覆盖锁定标题。
  const draftTitle=draft.match(/^#\s+(.+)$/m)?.[1]?.trim()||selectedTitle;
  const finalTitle=extractArticleTitle(final)||finalSelectedTitle;
  store.saveDocument({batchId,candidateId,kind:'draft',title:draftTitle,content:draft,filePath:p04,status:'draft'});
  const finalTitleRisk=scanPublicationRisk({article:final,factBase});
  const needsEditorialReview = Boolean(
    !voiceGate.pass
      || finalTitleRisk.titleBlockers.length
      || articleGateNeedsEditorialReview(draftQuality)
      || articleGateNeedsEditorialReview(reviewDecision)
      || articleGateNeedsEditorialReview(finalQuality)
      || articleGateNeedsEditorialReview(publicationQuality)
      || !lockedAnchorPreserved
      || researchCoverageNeedsRevision(researchCoverage)
  );
  store.saveDocument({batchId,candidateId,kind:'final',title:finalTitle,content:final,filePath:p09,status:needsEditorialReview?'needs_review':'finalized'});
  for(const [kind,name,file] of [['技能清单','00-skill-manifest.json',skillManifestPath],['阶段执行清单','00-stage-executions.json',stageManifestPath],['锁定简报','00-article-brief.md',briefPath],['研判采用清单','editorial-research-selection.json',researchSelectionPath],['事实基座','02-fact-base.json',factBasePath],['发布主张登记','02-publication-claim-register.json',publicationClaimRegisterPath],['文章大纲','02-outline.md',p02],['标题候选','03-titles.md',p03],['标题风险扫描','03-title-risk.json',selectedTitleRiskPath],['最终标题锁定','03-title-lock.json',titleLockPath],['文章初稿','04-draft.md',p04],['初稿AI门禁','04-quality-gate.json',draftGatePath],['去AI稿','05-humanized.md',p05],['风格门禁','05-voice-quality-gate.json',voiceGatePath],['审稿门禁原始响应','06-review-gate.md',reviewLogPath],['审稿质量门禁','06-review-quality-gate.json',reviewGatePath],['审稿稿','06-reviewed.md',p06],['SEO关键词','07-seo-keywords.md',p07],['SEO优化稿','08-seo-optimized.md',p08],['终稿AI门禁','08-quality-gate.json',finalGatePath],['研判贴合度检查','research-coverage-review.json',researchCoveragePath],['图表规划','09-visual-plan.json',visualPlanPath],['文章终稿','09-FINAL.md',p09],['发布合规门禁','10-publication-compliance.json',publicationCompliancePath]])artifact(store,batchId,kind,name,file,{candidateId,rootRunId,workflowRunId,stageId:'article-pipeline'});
  store.updateBatch(batchId,{stage:'typeset',status:'review'}); onProgress(`成稿完成:${visibleChars(final)} 个可见字符`);
  return {workdir,finalPath:p09,visibleChars:visibleChars(final),writerSkill:chosenWriterSkill,skillHash:skillBundle.hash,skillFallback:skillBundle.fallback,title:finalTitle,needsEditorialReview,publicationReady:!needsEditorialReview};
}

function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function readTextIfPresent(filePath, fallback = '') {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback;
}

// 只重跑当前已保存正文的门禁，不经过写作、改写、SEO 或配图阶段。
export async function runArticleReview({ gateway, store, batchId, candidateId = null, documentKind = 'final', provider, workspaceRoot, rootRunId = null, workflowRunId = null, onProgress = () => {} }) {
  const document = store.getDocument(batchId, candidateId, documentKind);
  if (!document) throw new Error('待审核文稿不存在');
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const candidate = candidateId == null ? null : store.getCandidate(candidateId);
  if (candidateId != null && (!candidate || candidate.batch_id !== batchId)) throw new Error('候选不存在或不属于当前批次');
  const workdir = candidate ? candidateArticleDir(workspaceRoot, batch, candidate) : batchArticlesDir(workspaceRoot, batch);
  const article = String(document.content || '');
  if (!article.trim()) throw new Error('当前文稿为空，无法执行自动审核');

  onProgress('读取当前文稿及已有事实基座');
  const factBase = readJsonIfPresent(path.join(workdir, '02-fact-base.json'), {});
  const claimRegisterFile = readJsonIfPresent(path.join(workdir, '02-publication-claim-register.json'), {});
  const researchSelection = readJsonIfPresent(path.join(workdir, 'editorial-research-selection.json'), {});
  const outline = readTextIfPresent(path.join(workdir, '02-outline.md'));
  const reviewerSkill = loadSkillBundle({ workspaceRoot, skillName: 'article-reviewer' });
  const orchestratorSkill = loadSkillBundle({ workspaceRoot, skillName: 'wechat-mp-topic-to-article' });
  const runtime = await prepareSkillRun({ gateway, store, batchId, candidateId, purpose: 'article-review', bundles: [orchestratorSkill, reviewerSkill], provider });
  gateway = bindGenerationSnapshot(gateway, runtime.snapshotId);
  const reviewProvider = runtime.provider;
  const maxOutputTokens = Math.min(3500, runtime.providerConfig?.maxOutputTokens || 3500);
  const researchPoints = Array.isArray(researchSelection.selected) ? researchSelection.selected : [];
  const rejectedAngles = Array.isArray(researchSelection.rejected) ? researchSelection.rejected : [];
  const reviewMaterialBrief = candidate?.editorial?.material_brief && typeof candidate.editorial.material_brief === 'object' ? candidate.editorial.material_brief : {};
  const reviewStanceDecision = deriveWritingStance({ articleType: reviewMaterialBrief.article_type, materialBrief: reviewMaterialBrief, editorial: candidate?.editorial || {} });
  const reviewWritingStance = reviewStanceDecision.stance;
  const reviewCitationPolicy = citationPolicyForStance(reviewWritingStance);
  const publicationClaimRegister = Array.isArray(claimRegisterFile.claims) ? claimRegisterFile.claims : [];
  const publicationScan = scanPublicationRisk({ article, factBase });
  const isDraft = documentKind === 'draft' || documentKind === 'daily-draft';
  const qualityStage = isDraft ? 'draft' : 'final-review';
  const qualityFileName = documentKind === 'daily-final' || documentKind === 'daily-draft' ? '06-quality-gate.json' : isDraft ? '04-quality-gate.json' : '08-quality-gate.json';
  const qualityArtifactKind = isDraft ? '初稿AI门禁' : '终稿AI门禁';

  onProgress('执行正文质量门禁');
  const quality = await aiQualityGate({
    gateway, store, provider: reviewProvider, batchId, candidateId, article, factBase,
    sourceText: factBase.sourceText || '', researchPoints, rejectedAngles, publicationClaimRegister,
    publicationScan, writingStance: reviewWritingStance, citationPolicy: reviewCitationPolicy, systemPrompt: buildStanceStageSystem(orchestratorSkill, isDraft ? 'draft-quality-gate' : 'final-quality-gate', reviewWritingStance, reviewerSkill),
    stage: qualityStage, maxOutputTokens,
  });
  const qualityPath = path.join(workdir, qualityFileName);
  writeFile(qualityPath, JSON.stringify({ ...quality, reviewedAt: new Date().toISOString(), reviewMode: 'manual-rerun' }, null, 2));
  artifact(store, batchId, qualityArtifactKind, qualityFileName, qualityPath, { candidateId, rootRunId, workflowRunId, stageId: 'article-review' });

  onProgress('执行审稿门禁');
  const reviewDecision = await aiReviewGate({
    gateway, store, provider: reviewProvider, batchId, candidateId, article, factBase, outline,
    researchPoints, rejectedAngles, publicationClaimRegister, publicationScan,
    writingStance: reviewWritingStance, citationPolicy: reviewCitationPolicy, systemPrompt: buildStanceStageSystem(orchestratorSkill, 'review', reviewWritingStance, reviewerSkill), maxOutputTokens,
  });
  const reviewPath = path.join(workdir, '06-review-quality-gate.json');
  writeFile(reviewPath, JSON.stringify({ ...reviewDecision, reviewedAt: new Date().toISOString(), reviewMode: 'manual-rerun' }, null, 2));
  artifact(store, batchId, '审稿质量门禁', '06-review-quality-gate.json', reviewPath, { candidateId, rootRunId, workflowRunId, stageId: 'article-review' });

  onProgress('执行发布合规门禁');
  let publicationQuality = await aiQualityGate({
    gateway, store, provider: reviewProvider, batchId, candidateId, article, factBase,
    sourceText: factBase.sourceText || '', researchPoints, rejectedAngles, publicationClaimRegister,
    publicationScan, writingStance: reviewWritingStance, citationPolicy: reviewCitationPolicy, systemPrompt: buildStanceStageSystem(orchestratorSkill, 'publication-safety-gate', reviewWritingStance, reviewerSkill),
    stage: 'publication-safety-review', maxOutputTokens,
  });
  const complianceIssues = publicationComplianceIssue({ scan: publicationScan, gate: { pass: true } });
  if (complianceIssues.length) publicationQuality = {
    ...publicationQuality,
    pass: false,
    issues: [...(Array.isArray(publicationQuality.issues) ? publicationQuality.issues : []), ...complianceIssues.map((message) => ({ type: 'publication_compliance', message, repair: '删除、降格或补充可靠来源；标题和高影响主张需重新审核' }))],
  };
  const publicationPath = path.join(workdir, '10-publication-compliance.json');
  writeFile(publicationPath, JSON.stringify({ generatedAt: new Date().toISOString(), reviewMode: 'manual-rerun', scan: publicationScan, gate: publicationQuality }, null, 2));
  artifact(store, batchId, '发布合规门禁', '10-publication-compliance.json', publicationPath, { candidateId, rootRunId, workflowRunId, stageId: 'article-review' });

  const voiceGateArtifact = readJsonIfPresent(path.join(workdir, '05-voice-quality-gate.json'), {});
  const voiceGateNeedsReview = voiceGateArtifact.pass === false || voiceGateArtifact.gate?.pass === false;
  const needsReview = voiceGateNeedsReview || articleGateNeedsEditorialReview(quality) || articleGateNeedsEditorialReview(reviewDecision) || articleGateNeedsEditorialReview(publicationQuality);
  const status = isDraft ? 'draft' : needsReview ? 'needs_review' : 'finalized';
  const saved = store.saveDocument({ batchId, candidateId, kind: documentKind, title: document.title, content: article, filePath: document.file_path, status, reviewState: needsReview ? 'needs_review' : 'passed' });
  onProgress(needsReview ? '自动审核完成：仍有待编辑处理的问题' : '自动审核完成：当前文稿已通过');
  return { documentId: saved.id, status: saved.status, reviewState: saved.review_state, needsReview, issueCount: (quality.issues?.length || 0) + (reviewDecision.issues?.length || 0) + (publicationQuality.issues?.length || 0) };
}
