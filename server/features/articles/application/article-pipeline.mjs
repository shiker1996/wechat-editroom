import fs from 'node:fs';
import path from 'node:path';
import { ARTICLE_PROMPTS, ARTICLE_PROMPT_VERSION, ARTICLE_LENGTH_ADJUSTMENT_THRESHOLD, planArticleLengthAdjustment, draftSystemPrompt, articleReaderContext, articlePromptManifest, articleChangedPassages } from './article-prompts.mjs';
import { buildArticleBriefView, articleFactAuthorityView } from './article-pipeline-contract.mjs';
import { illustrateArticle } from './article-illustration.mjs';
import { getAccountContext } from '../../../platform/application/account-context-service.mjs';
import { normalizeDistributionLane } from '../../../shared/domain/distribution-strategy.mjs';
import { parseModelJson } from '../../../platform/llm/model-json.mjs';
import { evaluateEditorialReadiness } from '../domain/editorial-readiness.mjs';
import { normalizeMaterialBrief, parseMaterialBrief } from '../../../shared/domain/material-brief.mjs';
import { deriveWritingStance, stanceOverlay, citationPolicyForStance, visualPolicyForStance } from '../../../shared/domain/writing-stance.mjs';
import { normalizeResearchPoints, normalizeRejectedAngles } from '../domain/research-selection.mjs';
import { loadArticleSkillBundle, loadSkillBundle } from '../../../platform/llm/skill-runtime.mjs';
import { bindGenerationSnapshot, bindPipelineHarnessGateway, prepareSkillRun } from '../../../platform/skills/pipeline-runtime.mjs';
import { configuredRepairAttempts, evaluateConfiguredGates } from '../../../platform/skills/configuration.mjs';
import { batchTopicsDir, batchArticlesDir, candidateArticleDir } from '../../../platform/core/workspace-paths.mjs';
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
  buildDraftUserPrompt, buildDraftOutlineView, buildArticlePlanningView, replaceArticleTitle, compositeSourceText, normalizePlanningResult, selectWriterSkill,
  readArticleSourceInput, sourceCacheIssue, unverifiedFactBaseIssue, buildResearchCoveragePrompt,
} from './article-pipeline-contract.mjs';
export {
  ARTICLE_LENGTH_RANGE, articleLengthStatus, articleStageOutputIssue, authorizedWritingBrief,
  buildDraftUserPrompt, buildDraftOutlineView, buildArticlePlanningView, replaceArticleTitle, compositeSourceText, normalizePlanningResult, selectWriterSkill,
  readArticleSourceInput, sourceCacheIssue, unverifiedFactBaseIssue, buildResearchCoveragePrompt,
} from './article-pipeline-contract.mjs';
export {
  buildPublicationClaimRegister, enrichFactBaseClaims, extractArticleTitle, publicationComplianceIssue,
  publicationCompliancePrompt, publicationFactBaseIssues, scanPublicationRisk,
} from '../domain/publication-compliance.mjs';

function writeFile(filePath,content) { fs.mkdirSync(path.dirname(filePath),{recursive:true}); const temp=`${filePath}.tmp`; fs.writeFileSync(temp,String(content).trimEnd()+'\n','utf8'); fs.renameSync(temp,filePath); return fs.statSync(filePath); }
function cleanMarkdown(value) { return String(value||'').trim().replace(/^```(?:markdown)?\s*/i,'').replace(/\s*```$/,''); }
function visibleChars(markdown) { return articleLengthStatus(markdown,{min:0,max:Number.MAX_SAFE_INTEGER}).count; }
function issueMessage(issue) { return typeof issue === 'string' ? issue : String(issue?.message || ''); }
function issueType(issue) { return typeof issue === 'string' ? '' : String(issue?.type || '').trim().toLowerCase(); }

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
    return parseJsonResult(await gateway.complete({ provider, purpose, batchId, candidateId, jsonMode: true, maxOutputTokens, messages }), store);
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
  if (!Array.isArray(decision.value?.titleCandidates) || !decision.value.titleCandidates.length) throw new Error('标题阶段未返回候选标题');
  const plan = normalizeDecisionTitlePlan(decision.value, { fallbackTitle });
  return applyHotspotAnchorRule(plan, { topic: [payload?.topic, payload?.article].filter(Boolean).join('\n'), requiredAnchor: payload?.hotspotAnchor || '' });
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

export function buildReviewRepairPrompt({ factBase = {}, article = '', review = {} }) {
  return JSON.stringify({ article, issues: typeof review === 'string' ? review : review.issues || [],
    evidence: articleFactAuthorityView(factBase) });
}

function artifact(store,batchId,kind,name,filePath,trace={}) { const stat=fs.statSync(filePath); store.upsertArtifact({batchId,candidateId:trace.candidateId??null,kind,name,path:filePath,size:stat.size,modifiedAt:stat.mtime.toISOString(),rootRunId:trace.rootRunId??null,workflowRunId:trace.workflowRunId??null,stageId:trace.stageId??null}); }
export const ARTICLE_STAGE_CONTRACT = Object.freeze([
  { id: 'brief', skill: 'wechat-mp-topic-to-article' },
  { id: 'fact-base', skill: 'wechat-mp-topic-to-article' },
  { id: 'drafting', skill: '$writer' },
  { id: 'review', skill: 'article-reviewer' },
  { id: 'length-adjustment', skill: '$writer' },
  { id: 'humanize', skill: 'humanizer-zh' },
  { id: 'title-lock', skill: 'title-generator' },
]);

// Legacy composition API retained for other consumers; the direct-brief lifecycle uses ARTICLE_PROMPTS.
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
            quote: { type: 'string', maxLength: 1000 },
            basis: { type: 'string', maxLength: 1000 },
            return_to: { type: 'string', enum: ['materials', 'draft'] },
          },
        },
      },
    },
  },
});

const ARTICLE_QUALITY_GATE_SCHEMA = ARTICLE_QUALITY_GATE_TOOL.function.parameters;

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
    {role:'user',protected:true,content:`作者采用的研判拓展点：${JSON.stringify(researchPoints)}\n\n作者明确不采用的方向：${JSON.stringify(rejectedAngles)}\n\n判定口径：正文事实只能来自下面唯一的发布主张登记；未核实事实不得写成确定结论。第一人称作者判断或阅读动作（如“我看”“我读完后的判断”）不是亲测；只有声称本人测试、部署、使用并得到结果，且没有已确认实践证据时，才按未经核实的亲测处理。保留有事实依据、推理链清楚的作者判断，不要求用“这是判断”“不代表官方说法”自我标注。\n\n${publicationCompliancePrompt({factBase,claimRegister:publicationClaimRegister,scan:publicationScan,writingStance,citationPolicy})}\n\n待检查文章：\n${article}`},
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

export async function aiReviewGate({gateway,store,provider,batchId,candidateId,article,factBase,brief={},researchPoints=[],rejectedAngles=[],scope=null,systemPrompt=ARTICLE_PROMPTS.review,maxOutputTokens=3500}) {
  const purpose='article-review-gate';
  const messages=[
    {role:'system',protected:true,content:systemPrompt},
    {role:'user',protected:true,content:JSON.stringify({brief:buildArticleBriefView({...brief,adoptedResearchPoints:brief.adoptedResearchPoints||brief.adopted_research_points||researchPoints,rejectedAngles:brief.rejectedAngles||brief.rejected_angles||rejectedAngles}),evidence:articleFactAuthorityView(factBase),article,...(scope?{recheck:scope}:{})})},
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
  if (typeof decision.value?.pass !== 'boolean' || !Array.isArray(decision.value?.issues)) throw new Error('审稿阶段未返回有效的 pass/issues 结果');
  if (decision.value.pass === false && !decision.value.issues.length) throw new Error('审稿未通过，但没有定位具体问题');
  return appendPlanningMetaLeakage(decision.value, article);
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
    angle:candidate.angle,thesis:candidate.thesis||materialBrief.thesis,researchBasis:editorial.research_basis,adoptedResearchPoints:normalizeResearchPoints(editorial.adopted_research_points),confirmedFacts:editorial.confirmed_facts,authorOpinions:editorial.author_opinions,
    confirmedExperiences:editorial.confirmed_experiences,rejectedAngles:normalizeRejectedAngles(editorial.rejected_angles),forbiddenClaims:editorial.forbidden_claims,
    experienceRequired:Boolean(editorial.experience_required),distributionLane,readerStake,composite:Boolean(candidate.composite),materialBrief,
    articleType,writingStance,stanceSource:stanceDecision.source,citationPolicy,visualPolicy:visualDecision.policy,
    action:materialBrief.action,affectedGroup:materialBrief.affected_group,readerConsequence:materialBrief.reader_consequence,
    conflict:materialBrief.conflict,baselineChange:materialBrief.baseline_change,counterEvidence:materialBrief.counter_evidence,
    evidenceBoundary:materialBrief.evidence_boundary,readerAction:materialBrief.reader_action,materialReadiness:materialBrief.material_readiness};
  // 原文用于准备事实记录，正文写作只消费可追溯的记录。
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
  };
  const stageSkills={
    'title-generator':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.title}),
    'humanizer-zh':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.humanizer}),
    'article-reviewer':loadSkillBundle({workspaceRoot,skillName:selectedStageIds.reviewer}),
    'article-image-placeholders':loadSkillBundle({workspaceRoot,skillName:'article-image-placeholders'}),
    'article-visual-planner':loadSkillBundle({workspaceRoot,skillName:'article-visual-planner'}),
  };
  const runtime=await prepareSkillRun({gateway,store,batchId,candidateId,purpose:'article',bundles:[writerSkillBundle,orchestratorSkill,...Object.values(stageSkills)],provider,snapshotId,
    selection:(skillSelection||stageSelections)?{...writerSelection,entryPoint:'hotspot-article',stages:stageSelections||{}}:null});
  gateway=bindGenerationSnapshot(gateway,runtime.snapshotId);
  gateway=bindPipelineHarnessGateway(gateway,{store,batchId,candidateId,provider,
    generationSnapshotId:runtime.snapshotId,rootRunId:rootRunId||`batch:${batchId}`,workflowRunId:workflowRunId||`article:${batchId}:${candidateId??'batch'}`,entryPoint:'article-pipeline'});
  provider=runtime.provider;providerConfig=runtime.providerConfig;
  const configuredLength=writerSkillBundle.config?.gates?.length;
  // 优先级：技能覆盖层 gates.length > config.local.json articleLength（含 pipelines.article 差异覆盖）> 默认目标 1600、区间 1300–1800
  const resolvedArticleLength=resolveArticleLength({articleLength},'article');
  const articleLengthRange=configuredLength
    ? {
      min:Number(configuredLength.minVisibleChars),
      max:Number(configuredLength.maxVisibleChars),
      targetVisibleChars:Math.min(Number(configuredLength.maxVisibleChars),Math.max(Number(configuredLength.minVisibleChars),resolvedArticleLength.targetVisibleChars)),
    }
    : resolvedArticleLength;
  const repairAttempts=Math.max(0, Math.min(2, configuredRepairAttempts(writerSkillBundle.config,1)));
  const stageExecutions=[];
  const activeArtifacts = [];
  const stageManifestPath = path.join(workdir, '00-stage-executions.json');
  const flushStages = () => writeFile(stageManifestPath, JSON.stringify({
    pipelineVersion: ARTICLE_PROMPT_VERSION, generatedAt: new Date().toISOString(), stages: stageExecutions, activeArtifacts,
  }, null, 2));
  flushStages();
  artifact(store, batchId, '阶段执行清单', '00-stage-executions.json', stageManifestPath, { candidateId, rootRunId, workflowRunId, stageId: 'article-pipeline' });
  const recordStage=(stage,bundle,inputArtifacts,outputArtifact,gate='passed')=>{
    const expected=ARTICLE_STAGE_CONTRACT[stageExecutions.length];
    const actualSkill=bundle.skillName||bundle.writerSkill;
    const expectedSkill=expected?.skill==='$writer'?chosenWriterSkill
      : expected?.skill==='article-reviewer'?selectedStageIds.reviewer
        : expected?.skill==='title-generator'?selectedStageIds.title
          : expected?.skill==='humanizer-zh'?selectedStageIds.humanizer:expected?.skill;
    if(!expected||expected.id!==stage||expectedSkill!==actualSkill)throw new Error(`成稿契约阶段不一致：期望 ${expected?.id||'结束'}/${expectedSkill||'-'}，实际 ${stage}/${actualSkill}`);
    stageExecutions.push({stage,skill:actualSkill,skillHash:bundle.hash,skillFiles:bundle.files,inputArtifacts,outputArtifact,gate,fallback:bundle.fallback,promptVersion:ARTICLE_PROMPT_VERSION,promptSource: "article-prompts.mjs"});
    activeArtifacts.push(...(Array.isArray(outputArtifact) ? outputArtifact : [outputArtifact]));
    flushStages();
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
  writeFile(skillManifestPath,JSON.stringify({pipelineVersion:ARTICLE_PROMPT_VERSION,promptMode:'standalone-runtime',skillsUsedFor:'routing-and-configuration',orchestrator:{skill:'wechat-mp-topic-to-article',hash:orchestratorSkill.hash,files:orchestratorSkill.files,fallback:orchestratorSkill.fallback},writerSkill:chosenWriterSkill,writerSkillSelection:writerSelection,articleType,writingStance,stanceSource:stanceDecision.source,stanceOverlayVersion:null,citationPolicy,visualPolicy:visualDecision.policy,stageSkillSelections:stageSelections||historicalStages,hash:skillBundle.hash,files:skillBundle.files,fallback:skillBundle.fallback,stageSkills:Object.fromEntries(Object.entries(stageSkills).map(([name,bundle])=>[name,{skill:bundle.skillName,hash:bundle.hash,files:bundle.files,fallback:bundle.fallback}])),loadedAt:new Date().toISOString()},null,2));
  recordStage('brief',orchestratorSkill,['editorial','article-brief.md','editorial-research-selection.json'],'00-article-brief.md');
  onProgress('Step 1.5 基于来源建立结构化事实基座');
  // 事实基座包含逐条主张、证据和来源映射，内容量会随素材增长。
  // 不要在这里传固定 maxOutputTokens：gateway 的 article-fact-base
  // profile 需要在 finish=length 时从 5000 自动扩容到供应商上限，否则
  // parseModelJson 只能看到半截 JSON，后续成稿不会开始。
  // Always regenerate from the locked brief and current source inputs. An older
  // editor-room preflight artifact is only a readiness snapshot, never a fact-base cache.
  const rawFactBase=parseJsonResult(await gateway.complete({provider,purpose:'article-fact-base',batchId,candidateId,jsonMode:true,messages:[
      {role:'system',protected:true,content:ARTICLE_PROMPTS.facts},
      {role:'user',protected:true,content:JSON.stringify({topic:brief.topic,researchBasis:brief.researchBasis,adoptedResearchPoints:brief.adoptedResearchPoints,rejectedAngles:brief.rejectedAngles,confirmedFacts:brief.confirmedFacts,authorOpinions:brief.authorOpinions,forbiddenClaims:brief.forbiddenClaims,materialBrief:brief.materialBrief,sourceUrl:brief.sourceUrl,sourceText:brief.sourceText||''})},
    ]}),store);
  const factBase=enrichFactBaseClaims(rawFactBase,{citationPolicy});
  brief.factBase=factBase;
  const publicationClaimRegister=buildPublicationClaimRegister(factBase,{citationPolicy});
  brief.publicationClaimRegister=publicationClaimRegister;
  const writingBrief=authorizedWritingBrief(brief);
  const writingBriefPath=path.join(workdir,'00-writing-brief.json');
  writeFile(writingBriefPath,JSON.stringify(buildArticleBriefView(writingBrief),null,2));
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
  const readerContext = articleReaderContext(getAccountContext({ workspaceRoot }));
  const promptManifestPath = path.join(workdir, '00-prompt-manifest.json');
  writeFile(promptManifestPath, JSON.stringify(articlePromptManifest(chosenWriterSkill), null, 2));
  const paths = Object.fromEntries(['04-draft.md', '06-reviewed.md', '06-review-quality-gate.json', '07-length-adjusted.md',
    '07-length-adjustment.json', '05-humanized.md',
    '03-titles.md', '03-title-lock.json', '03-title-risk.json', '08-quality-gate.json', '10-publication-compliance.json', '09-FINAL.md']
    .map((name) => [name, path.join(workdir, name)]));
  const modelInput = { provider, batchId, candidateId };
  const maxTextTokens = Math.min(6500, providerConfig.maxOutputTokens || 6500);
  const requireArticle = (result) => {
    const article = cleanMarkdown(result.content);
    const issue = articleStageOutputIssue(article, { requireArticle: true });
    if (issue) throw new Error(issue);
    return article;
  };
  const reviewHistory = [];
  const reviewArticle = async (article, scope = null) => {
    const decision = await aiReviewGate({ gateway, store, ...modelInput, article, factBase, brief: writingBrief,
      scope, maxOutputTokens: Math.min(3500, providerConfig.maxOutputTokens || 3500) });
    reviewHistory.push({ scope: scope || 'full', decision });
    writeFile(paths['06-review-quality-gate.json'], JSON.stringify({ ...decision, history: reviewHistory }, null, 2));
    return decision;
  };
  // Repairs are bounded, and an unresolved material gap returns to the editor.
  const reviewAndRepair = async (article, scope = null) => {
    let current = article;
    let decision = await reviewArticle(current, scope);
    for (let attempt = 0; attempt < repairAttempts && articleGateNeedsEditorialReview(decision); attempt++) {
      if (decision.issues?.some((issue) => issue.return_to === 'materials')) break;
      const previous = current;
      const issues = decision.issues || [];
      onProgress('按审稿定位修订问题句段');
      const offBrief = issues.some((issue) => issue.type === 'brief');
      current = requireArticle(await textCall(gateway, { ...modelInput, purpose: offBrief ? 'article-drafting-pipeline' : 'article-review-repair' },
        offBrief ? draftSystemPrompt(chosenWriterSkill) : ARTICLE_PROMPTS.repair,
        offBrief
          ? JSON.stringify({ task: JSON.parse(buildDraftUserPrompt(brief.topic, writingBrief, { readerContext, length: articleLengthRange })), previous_article: current, issues })
          : buildReviewRepairPrompt({ factBase, article: current, review: decision }), maxTextTokens));
      if (current === previous) break;
      decision = await reviewArticle(current, { original_issues: issues, changed_passages: articleChangedPassages(previous, current) });
    }
    return { article: current, decision };
  };
  const combineReviewDecisions = (...decisions) => {
    const issues = [];
    const seen = new Set();
    for (const decision of decisions) {
      for (const issue of Array.isArray(decision?.issues) ? decision.issues : []) {
        const key = [issue.type || '', issue.message || '', issue.quote || '', issue.return_to || ''].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push(issue);
      }
    }
    return {
      ...(decisions.at(-1) || {}),
      pass: decisions.every((decision) => !articleGateNeedsEditorialReview(decision)),
      issues,
    };
  };

  onProgress('Step 2 简报与事实材料直接生成初稿');
  const draft = requireArticle(await textCall(gateway, { ...modelInput, purpose: 'article-drafting-pipeline' },
    draftSystemPrompt(chosenWriterSkill), buildDraftUserPrompt(brief.topic, writingBrief, { readerContext, length: articleLengthRange }), maxTextTokens));
  writeFile(paths['04-draft.md'], draft);
  recordStage('drafting', writerSkillBundle, ['00-article-brief.md', '02-fact-base.json'], '04-draft.md');
  store.saveDocument({ batchId, candidateId, kind: 'draft', title: extractArticleTitle(draft), content: draft, filePath: paths['04-draft.md'], status: 'draft' });

  onProgress('Step 3 事实与逻辑审稿');
  const reviewed = await reviewAndRepair(draft);
  let reviewDecision = reviewed.decision;
  let final = reviewed.article;
  writeFile(paths['06-reviewed.md'], final);
  recordStage('review', stageSkills['article-reviewer'], ['04-draft.md', '00-article-brief.md', '02-fact-base.json'],
    ['06-reviewed.md', '06-review-quality-gate.json'], articleGateNeedsEditorialReview(reviewDecision) ? 'needs_review' : 'passed');

  onProgress('Step 4 按目标字数扩缩写');
  const reviewedLength = articleLengthStatus(final, articleLengthRange);
  let lengthStageStatus = 'skipped_in_range';
  let lengthAdjustmentChanged = false;
  const lengthAdjustmentAttempts = [];
  if (!reviewedLength.valid) {
    let currentLength = reviewedLength;
    for (let attempt = 1; attempt <= 2 && !currentLength.valid; attempt++) {
      const beforeCount = currentLength.count;
      const plan = planArticleLengthAdjustment(currentLength.count, articleLengthRange);
      const previous = final;
      const adjusted = requireArticle(await textCall(gateway, { ...modelInput, purpose: 'article-final-repair-length' },
        ARTICLE_PROMPTS.lengthAdjust,
        JSON.stringify({
          reader_context: readerContext,
          brief: writingBrief,
          fact_authority: articleFactAuthorityView(factBase),
          current_visible_chars: currentLength.count,
          target_visible_chars: plan.targetVisibleChars,
          allowed_range: articleLengthRange,
          adjustment: plan.adjustment,
          strategy: plan.strategy,
          change_required: plan.changeRequired,
          structural_threshold: plan.threshold,
          article: final,
        }), maxTextTokens));
      const lengthChanges = articleChangedPassages(previous, adjusted);
      const changed = lengthChanges.before.length > 0 || lengthChanges.after.length > 0;
      lengthAdjustmentChanged ||= changed;
      final = adjusted;
      currentLength = articleLengthStatus(final, articleLengthRange);
      lengthAdjustmentAttempts.push({
        attempt,
        before: beforeCount,
        target: plan.targetVisibleChars,
        after: currentLength.count,
        changeRequired: plan.changeRequired,
        strategy: plan.strategy,
        adjustment: plan.adjustment,
        valid: currentLength.valid,
        changed,
      });
      if (changed) {
        onProgress('核对字数调整对事实与论证的影响');
        const lengthDecision = await reviewArticle(adjusted, {
          changed_passages: lengthChanges,
          instruction: '仅检查字数调整新增、删除或合并的句段及受影响论证；只报告本次调整新增或加重的问题。',
        });
        reviewDecision = combineReviewDecisions(reviewDecision, lengthDecision);
        writeFile(paths['06-review-quality-gate.json'], JSON.stringify({ ...reviewDecision, history: reviewHistory }, null, 2));
      }
      if (!changed || currentLength.valid) break;
    }
    lengthStageStatus = currentLength.valid ? 'passed' : 'completed_out_of_range';
  }
  const finalAdjustedLength = articleLengthStatus(final, articleLengthRange);
  writeFile(paths['07-length-adjusted.md'], final);
  writeFile(paths['07-length-adjustment.json'], JSON.stringify({
    status: lengthStageStatus,
    range: articleLengthRange,
    before: reviewedLength,
    after: finalAdjustedLength,
    attempted: lengthStageStatus !== 'skipped_in_range',
    changed: lengthAdjustmentChanged,
    policy: { structuralThreshold: ARTICLE_LENGTH_ADJUSTMENT_THRESHOLD, targetMargin: Math.min(50, Math.max(10, Math.round((articleLengthRange.max - articleLengthRange.min) * 0.05))) },
    attempts: lengthAdjustmentAttempts,
  }, null, 2));
  recordStage('length-adjustment', writerSkillBundle, ['06-reviewed.md'], ['07-length-adjusted.md', '07-length-adjustment.json'], lengthStageStatus);

  onProgress('Step 5 表达精修');
  const polished = requireArticle(await textCall(gateway, { ...modelInput, purpose: 'article-humanize' },
    ARTICLE_PROMPTS.humanize, JSON.stringify({ reader_context: readerContext, article: final }), maxTextTokens));
  const changed = articleChangedPassages(final, polished);
  final = polished;
  if (changed.before.length || changed.after.length) {
    // The polish stage does not repair factual or logical issues. It only checks whether its own edits changed meaning.
    onProgress('核对精修改动涉及的事实与推理');
    const polishDecision = await reviewArticle(polished, {
      changed_passages: changed,
      instruction: '仅检查表达精修引入的改动及受影响的论证；未改正文作为上下文。只报告精修改动新增或加重的问题。',
    });
    reviewDecision = combineReviewDecisions(reviewDecision, polishDecision);
    writeFile(paths['06-review-quality-gate.json'], JSON.stringify({ ...reviewDecision, history: reviewHistory }, null, 2));
  }
  writeFile(paths['05-humanized.md'], final);
  recordStage('humanize', stageSkills['humanizer-zh'], ['07-length-adjusted.md'], '05-humanized.md',
    'passed');

  onProgress('Step 6 根据完成的正文生成发布标题');
  const titlePlan = await generateTitlePlan({ gateway, store, ...modelInput, systemPrompt: ARTICLE_PROMPTS.title,
    purpose: 'article-title-generation-final', fallbackTitle: extractArticleTitle(final) || brief.topic,
    payload: { topic: brief.topic, reader_context: readerContext, article: final,
      packaging: { distributionLane: brief.distributionLane, readerStake: brief.readerStake },
      keywords: parseMaterialBrief(editorial.material_brief).core_keywords || [], title_length: stageSkills['title-generator'].config?.gates?.length || null } });
  final = replaceArticleTitle(final, titlePlan.selectedTitle);
  writeFile(paths['03-titles.md'], '# 发布标题\n\n' + titlePlan.titleCandidates.map((item) => '- ' + item.title + '：' + item.reason).join('\n') + '\n\n推荐：' + titlePlan.selectedTitle);
  writeFile(paths['03-title-lock.json'], JSON.stringify({ ...titlePlan, stage: 'after-polish' }, null, 2));
  recordStage('title-lock', stageSkills['title-generator'], ['05-humanized.md'], ['03-titles.md', '03-title-lock.json']);

  // Visual work is opt-in and happens after the body lifecycle. Do not run SEO rewrites.
  const visualNeed = parseMaterialBrief(editorial.material_brief).visual_need;
  let visualPlanPath = null;
  if (!articleGateNeedsEditorialReview(reviewDecision) && visualDecision.policy !== 'off' && visualNeed && !['off', 'auto'].includes(visualNeed)) {
    onProgress('按已确认的配图需求生成视觉内容');
    const illustrated = await illustrateArticle({ gateway, store, ...modelInput, markdown: final, factBase: JSON.stringify(articleFactAuthorityView(factBase)),
      workspaceRoot, maxOutputTokens: Math.min(8000, providerConfig.maxOutputTokens || 8000), visualPolicy: visualDecision.policy,
      visualNeed, imageSkillPrompt: stageSkills['article-image-placeholders'].prompt, onProgress });
    const changes = articleChangedPassages(final, illustrated.markdown);
    if (changes.before.length || changes.after.length) {
      const checked = await reviewAndRepair(illustrated.markdown, { changed_passages: changes, instruction: '只核对新增视觉内容及受影响句段的事实和推理。' });
      final = checked.article;
      reviewDecision = checked.decision;
    }
    visualPlanPath = path.join(workdir, '09-visual-plan.json');
    writeFile(visualPlanPath, JSON.stringify(illustrated.visualPlan, null, 2));
  }

  const publicationScan = scanPublicationRisk({ article: final, factBase });
  writeFile(paths['03-title-risk.json'], JSON.stringify(publicationScan, null, 2));
  const length = articleLengthStatus(final, articleLengthRange);
  const configured = evaluateConfiguredGates(writerSkillBundle.config, { factBase, output: final, visibleChars: length.count });
  const localIssues = [
    ...(articleStageOutputIssue(final, { requireArticle: true }) ? [{ type: 'output', message: articleStageOutputIssue(final, { requireArticle: true }) }] : []),
    ...(!length.valid ? [{ type: 'length', message: `正文可见字数 ${length.count} 超出配置范围 ${articleLengthRange.min}–${articleLengthRange.max}` }] : []),
    ...configured.issues,
    ...publicationScan.titleBlockers.map((message) => ({ type: 'title', message })),
  ];
  const delivery = { pass: !localIssues.length, issues: localIssues, length, warnings: configured.warnings, mode: 'deterministic' };
  writeFile(paths['08-quality-gate.json'], JSON.stringify(delivery, null, 2));
  const needsEditorialReview = articleGateNeedsEditorialReview(reviewDecision) || !delivery.pass;
  writeFile(paths['10-publication-compliance.json'], JSON.stringify({
    generatedAt: new Date().toISOString(), mode: 'review-plus-local-checks', scan: publicationScan,
    gate: { pass: !needsEditorialReview, issues: [...(reviewDecision.issues || []), ...localIssues] },
  }, null, 2));
  writeFile(paths['09-FINAL.md'], final);
  const finalTitle = extractArticleTitle(final);
  if (finalTitle !== titlePlan.selectedTitle) {
    writeFile(paths['03-title-lock.json'], JSON.stringify({ ...titlePlan, selectedTitle: finalTitle,
      generatedTitle: titlePlan.selectedTitle, stage: 'targeted-review-repair' }, null, 2));
    writeFile(paths['03-titles.md'], '# 发布标题\n\n' + titlePlan.titleCandidates.map((item) => '- ' + item.title + '：' + item.reason).join('\n')
      + '\n\n审稿定点修订后的发布标题：' + finalTitle);
  }
  store.saveDocument({ batchId, candidateId, kind: 'final', title: finalTitle, content: final, filePath: paths['09-FINAL.md'],
    status: needsEditorialReview ? 'needs_review' : 'finalized', reviewState: needsEditorialReview ? 'needs_review' : 'passed' });
  if (stageExecutions.length !== ARTICLE_STAGE_CONTRACT.length) throw new Error('成稿契约未完整执行');
  const outputs = [
    ['技能配置清单', '00-skill-manifest.json', skillManifestPath], ['提示词清单', '00-prompt-manifest.json', promptManifestPath],
    ['锁定简报', '00-article-brief.md', briefPath], ['写作输入', '00-writing-brief.json', writingBriefPath],
    ['研判采用清单', 'editorial-research-selection.json', researchSelectionPath],
    ['事实基座', '02-fact-base.json', factBasePath], ['发布主张登记', '02-publication-claim-register.json', publicationClaimRegisterPath],
    ...Object.entries(paths).map(([name, file]) => [({
      '04-draft.md': '文章初稿', '06-reviewed.md': '审稿稿', '07-length-adjusted.md': '字数调整稿',
      '07-length-adjustment.json': '字数调整记录', '05-humanized.md': '表达精修稿',
      '06-review-quality-gate.json': '事实与逻辑审稿', '03-titles.md': '标题候选',
      '03-title-lock.json': '最终标题锁定', '03-title-risk.json': '标题检查',
      '08-quality-gate.json': '交付检查', '10-publication-compliance.json': '发布检查', '09-FINAL.md': '文章终稿',
    })[name], name, file]),
    ...(visualPlanPath ? [['图表规划', '09-visual-plan.json', visualPlanPath]] : []),
  ];
  activeArtifacts.splice(0, activeArtifacts.length, ...outputs.map(([, name]) => name), '00-stage-executions.json');
  flushStages();
  outputs.push(['阶段执行清单', '00-stage-executions.json', stageManifestPath]);
  for (const [kind, name, file] of outputs) artifact(store, batchId, kind, name, file, { candidateId, rootRunId, workflowRunId, stageId: 'article-pipeline' });
  store.updateBatch(batchId, { stage: 'typeset', status: 'review' });
  onProgress('成稿完成：' + length.count + ' 个可见字符' + (!length.valid ? '（字数超出配置范围，可在编辑器调整）' : ''));
  return { workdir, finalPath: paths['09-FINAL.md'], visibleChars: length.count, writerSkill: chosenWriterSkill,
    skillHash: skillBundle.hash, skillFallback: skillBundle.fallback, title: finalTitle, needsEditorialReview, publicationReady: !needsEditorialReview };
}

function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

// Review the saved document once, using the same factual review task as generation.
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
  const factBase = readJsonIfPresent(path.join(workdir, '02-fact-base.json'),
    readJsonIfPresent(path.join(workdir, documentKind.startsWith('daily-') ? '01-news-items.json' : '01-tutorial-fact-base.json'), {}));
  const editorial = candidate?.editorial || {};
  const brief = readJsonIfPresent(path.join(workdir, '00-writing-brief.json'), {
    topic: candidate?.hotspot_title || document.title, angle: candidate?.angle, thesis: candidate?.thesis,
    researchBasis: editorial.research_basis, adoptedResearchPoints: normalizeResearchPoints(editorial.adopted_research_points),
    rejectedAngles: normalizeRejectedAngles(editorial.rejected_angles), authorOpinions: editorial.author_opinions,
    confirmedExperiences: editorial.confirmed_experiences, forbiddenClaims: editorial.forbidden_claims,
    materialBrief: normalizeMaterialBrief(editorial.material_brief),
  });
  const reviewerSkill = loadSkillBundle({ workspaceRoot, skillName: 'article-reviewer' });
  const runtime = await prepareSkillRun({ gateway, store, batchId, candidateId, purpose: 'article-review', bundles: [reviewerSkill], provider });
  gateway = bindPipelineHarnessGateway(bindGenerationSnapshot(gateway, runtime.snapshotId), {
    store, batchId, candidateId, generationSnapshotId: runtime.snapshotId, rootRunId, workflowRunId, entryPoint: 'article-review',
  });
  onProgress('审核当前文稿的事实、推理及核心命题');
  const reviewDecision = await aiReviewGate({ gateway, store, provider: runtime.provider, batchId, candidateId, article,
    factBase, brief, maxOutputTokens: Math.min(3500, runtime.providerConfig?.maxOutputTokens || 3500) });
  const publicationScan = scanPublicationRisk({ article, factBase });
  const localIssues = publicationScan.titleBlockers.map((message) => ({ type: 'title', message }));
  const outputIssue = articleStageOutputIssue(article, { requireArticle: true });
  if (outputIssue) localIssues.push({ type: 'output', message: outputIssue });
  if (!Object.keys(factBase).length || (Array.isArray(factBase.claims) && !factBase.claims.length)) localIssues.push({ type: 'fact', message: '缺少可追溯的事实记录，请补齐材料后重新审核', return_to: 'materials' });
  const needsReview = articleGateNeedsEditorialReview(reviewDecision) || localIssues.length > 0;
  const reports = [
    ['事实与逻辑审稿', '06-review-quality-gate.json', { ...reviewDecision, reviewMode: 'manual-rerun' }],
    ['标题检查', '03-title-risk.json', publicationScan],
    ['交付检查', '08-quality-gate.json', { pass: !localIssues.length, issues: localIssues, mode: 'deterministic' }],
    ['发布检查', '10-publication-compliance.json', { scan: publicationScan, gate: { pass: !needsReview, issues: [...(reviewDecision.issues || []), ...localIssues] }, reviewMode: 'manual-rerun' }],
  ];
  for (const [kind, name, value] of reports) {
    const file = path.join(workdir, name);
    writeFile(file, JSON.stringify({ ...value, reviewedAt: new Date().toISOString() }, null, 2));
    artifact(store, batchId, kind, name, file, { candidateId, rootRunId, workflowRunId, stageId: 'article-review' });
  }
  // Scope report collection to this review, including for pre-migration articles.
  const manifestPath = path.join(workdir, '00-stage-executions.json');
  const manifest = readJsonIfPresent(manifestPath, {});
  writeFile(manifestPath, JSON.stringify({ ...manifest, reviewVersion: ARTICLE_PROMPT_VERSION,
    activeReviewArtifacts: reports.map(([, name]) => name), reviewedAt: new Date().toISOString() }, null, 2));
  artifact(store, batchId, '阶段执行清单', '00-stage-executions.json', manifestPath, { candidateId, rootRunId, workflowRunId, stageId: 'article-review' });
  const isDraft = documentKind === 'draft' || documentKind === 'daily-draft';
  const status = isDraft ? 'draft' : needsReview ? 'needs_review' : 'finalized';
  const saved = store.saveDocument({ batchId, candidateId, kind: documentKind, title: extractArticleTitle(article) || document.title,
    content: article, filePath: document.file_path, status, reviewState: needsReview ? 'needs_review' : 'passed' });
  onProgress(needsReview ? '自动审核完成：仍有待编辑处理的问题' : '自动审核完成：当前文稿已通过');
  return { documentId: saved.id, status: saved.status, reviewState: saved.review_state, needsReview,
    issueCount: (reviewDecision.issues?.length || 0) + localIssues.length };
}
