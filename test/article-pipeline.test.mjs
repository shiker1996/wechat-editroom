import test from 'node:test';
import { ARTICLE_PROMPTS, articlePromptManifest, articleChangedPassages } from '../server/features/articles/application/article-prompts.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { articleLengthStatus, articleStageOutputIssue, articleGateBlockingIssues, articleGateNeedsEditorialReview, authorizedWritingBrief, buildDraftUserPrompt, buildDraftOutlineView, replaceArticleTitle, buildArticleStageSystem, buildReviewRepairPrompt, buildPublicationComplianceRepairPrompt, compositeSourceText, normalizePlanningResult, selectWriterSkill, ARTICLE_LENGTH_RANGE, ARTICLE_STAGE_CONTRACT, ARTICLE_QUALITY_GATE_TOOL, ARTICLE_REVIEW_GATE_TOOL, aiQualityGate, aiReviewGate, sourceCacheIssue, unverifiedFactBaseIssue } from '../server/features/articles/application/article-pipeline.mjs';
import { inspectPlanningMetaLeakage } from '../server/features/articles/domain/article-quality.mjs';
import { inspectArticleQuality, inspectTrafficStructure } from '../server/features/articles/domain/article-quality.mjs';
import { loadArticleSkillBundle, loadSkillBundle } from '../server/platform/llm/skill-runtime.mjs';

test('成稿规划兼容模型把数组字段返回为字符串', () => {
  const plan=normalizePlanningResult({distribution_lane:'通知池',reader_stake:'影响开发者成本',expectedAction:'收藏、分享',coreKeywords:'AI；编程工具',remainingRisks:'none',titleCandidates:'一个可用标题'});
  assert.deepEqual(plan.expectedAction,['收藏','分享']);
  assert.deepEqual(plan.coreKeywords,['AI','编程工具']);
  assert.deepEqual(plan.remainingRisks,[]);
  assert.deepEqual(plan.titleCandidates,[{title:'一个可用标题',reason:''}]);
  assert.equal(plan.distributionLane,'通知池');
  assert.equal(plan.readerStake,'影响开发者成本');
});

test('文章阶段输出门禁识别工具操作说明和非完整文章',()=>{
  assert.match(articleStageOutputIssue('我先读取相关契约文件，确认环境后开始处理 humanize 阶段。',{requireArticle:true}),/工具操作说明/);
  assert.match(articleStageOutputIssue('这里只是一段说明。',{requireArticle:true}),/一级标题/);
  assert.equal(articleStageOutputIssue('# 完整标题\n\n这是文章正文。',{requireArticle:true}),null);
});

test('内容问题进入编辑器待修订，模型输出契约问题仍阻断',()=>{
  const contentGate={pass:false,issues:[
    {type:'title',message:'标题需要增加作者判断限定'},
    {type:'citation',message:'claim-6 缺少 sourceUrl'},
    {type:'fact',message:'存在未经核验的新增断言'},
    {type:'publication_compliance',message:'正文应明确这是作者分析'},
  ]};
  assert.deepEqual(articleGateBlockingIssues(contentGate),[]);
  assert.equal(articleGateNeedsEditorialReview(contentGate),true);

  const outputGate={pass:false,issues:[{type:'output',message:'模型未返回完整 Markdown'}]};
  assert.equal(articleGateBlockingIssues(outputGate).length,1);
});

test('审稿正文不再承载 result 标记，门禁结论通过独立 decision tool 返回', async()=>{
  const calls=[];
  const gateway={
    config:{defaultProvider:'mock',providers:{mock:{supportsNativeTools:true}}},
    async complete(input){
      calls.push(input);
      return {callId:43,toolCalls:[{id:'call-review',name:'decision.article_review_gate',input:{pass:true,issues:[]},providerExecuted:false}]};
    },
  };
  const store={repositories:{extensionSettings:{get(){return {value:{decisionToolsEnabled:true}};}}}};
  const result=await aiReviewGate({gateway,store,provider:'mock',batchId:'b1',candidateId:'c1',article:'# 标题\n\n正文',factBase:{claims:[]},systemPrompt:'审稿门禁'});
  assert.deepEqual(result,{pass:true,issues:[]});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].toolChoice,{type:'function',name:'decision.article_review_gate'});
  assert.equal(calls[0].jsonMode,false);
  assert.deepEqual(calls[0].tools,[ARTICLE_REVIEW_GATE_TOOL]);
});

test('终稿统一字数门禁默认1300–2000个可见字符', () => {
  assert.deepEqual(ARTICLE_LENGTH_RANGE,{min:1300,max:2000});
  assert.deepEqual(articleLengthStatus(`# 标题\n\n${'字'.repeat(1166)}`),{count:1166,valid:false,shortfall:134,overflow:0});
  assert.deepEqual(articleLengthStatus(`# 标题\n\n${'字'.repeat(1450)}`),{count:1450,valid:true,shortfall:0,overflow:0});
  assert.deepEqual(articleLengthStatus(`# 标题\n\n${'字'.repeat(1900)}`),{count:1900,valid:true,shortfall:0,overflow:0});
  assert.deepEqual(articleLengthStatus(`# 标题\n\n${'字'.repeat(2100)}`),{count:2100,valid:false,shortfall:0,overflow:100});
});

test('成稿规划保留结构化数组并接纳单个风险对象', () => {
  const plan=normalizePlanningResult({remainingRisks:{message:'日期仍需核验'},titleCandidates:[{title:'标题',reason:'准确'}]});
  assert.deepEqual(plan.remainingRisks,[{message:'日期仍需核验'}]);
  assert.equal(plan.titleCandidates[0].title,'标题');
});

test('直写提示词保留简报和作者材料，忽略历史大纲', () => {
  const prompt = buildDraftUserPrompt('真实标题', {
    thesis: '真实命题', researchBasis: '已采用主线', authorOpinions: '作者判断',
    confirmedExperiences: '确认的实践', experienceRequired: false, rejectedAngles: ['舍弃方向'],
    factBase: { claims: [{ id: 'F1', claim: '吞吐提升', status: 'verified', evidence: '原始测量',
      sourceUrl: 'https://example.com', boundary: '仅在指定硬件', publishedAt: '2026-10-21' }] },
  }, '# 不应使用的历史大纲');
  const input = JSON.parse(prompt);
  assert.equal(input.working_title, '真实标题');
  assert.equal(input.brief.thesis, '真实命题');
  assert.equal(input.brief.research_basis, '已采用主线');
  assert.equal(input.brief.author_opinions, '作者判断');
  assert.equal(input.brief.confirmed_experiences, '确认的实践');
  assert.deepEqual(input.brief.rejected_angles, ['舍弃方向']);
  assert.equal(input.facts.claims[0].boundary, '仅在指定硬件');
  assert.equal(input.facts.claims[0].evidence, '原始测量');
  assert.doesNotMatch(prompt, /历史大纲|publicationRule/);
});

test('写作模型只接收结构大纲视图，不接收流量规划和剩余风险段', () => {
  const view = buildDraftOutlineView(`# 文章大纲\n\n## 结构大纲\n\n**H2-1 一条自述**\n- 交代来源性质\n- 自然转化为问题入口\n\n## 流量规划\n- 本文不写进正文\n\n## 剩余风险\n- 风险`);
  assert.match(view, /一条自述/);
  assert.match(view, /来源性质/);
  assert.doesNotMatch(view, /流量规划|本文不写进正文|剩余风险/);
});

test('结构视图兼容加粗结构标题和编号式章节，不会丢失完读推进', () => {
  const view = buildDraftOutlineView(`**核心判断**：岗位内能力形成被压缩\n\n**结构大纲**：\n1. 开头：具体自述与数据反差\n2. 中段：拆解训练端和入口端\n3. 结尾：回收标题并给出自查判断\n\n**增长承接**：\n- 不应进入正文`);
  assert.match(view, /具体自述与数据反差/);
  assert.match(view, /拆解训练端和入口端/);
  assert.match(view, /回收标题并给出自查判断/);
  assert.doesNotMatch(view, /增长承接|不应进入正文/);
});

test('最终标题锁定只替换唯一 H1，不改正文结构', () => {
  const article = '# 旧标题\n\n第一段。\n\n## 第一节\n\n正文。';
  assert.equal(replaceArticleTitle(article, '新标题'), '# 新标题\n\n第一段。\n\n## 第一节\n\n正文。');
  assert.equal(replaceArticleTitle('没有标题的正文', '新标题'), '# 新标题\n\n没有标题的正文');
});

test('规划元话语泄漏检查拦截 S001 类型的内部说明，但不拦截自然来源限定', () => {
  const leaked = inspectPlanningMetaLeakage('本文不写涉事公司，所以它只能当作提问的起点。');
  assert.equal(leaked.pass, false);
  assert.ok(leaked.issues.length >= 2);
  assert.equal(inspectPlanningMetaLeakage('这是一条单一来源的个人陈述，不能据此代表行业整体。').pass, true);
  assert.equal(inspectPlanningMetaLeakage('我会借助见字平台分析它能给读者带来什么收益（读者收益维度）。').pass, true);
});

test('必要修订只携带当前正文、问题和对应证据', () => {
  const issues = [{ type: 'attribution', message: '来源归属错误', quote: '原句', basis: 'F1', repair: '修正归属', return_to: 'draft' }];
  const prompt = buildReviewRepairPrompt({ factBase: { claims: [{ id: 'F1', claim: '事实', sourceTitle: '发布方' }] },
    outline: '# 旧大纲', article: '# 当前稿', review: { pass: false, issues } });
  const input = JSON.parse(prompt);
  assert.equal(input.article, '# 当前稿');
  assert.deepEqual(input.issues, issues);
  assert.equal(input.evidence.claims[0].id, 'F1');
  assert.doesNotMatch(prompt, /旧大纲|05-humanized|publicationRule/);
  assert.match(ARTICLE_PROMPTS.repair, /只修改问题所在句段/);
});

test('合规修订提示词要求 AI 直接修订标题、归因和来源展示', () => {
  const prompt = buildPublicationComplianceRepairPrompt({
    factBase: { claims: [{ id: 'claim-1', claim: '回购上限为30%', status: 'verified', sourceUrl: 'https://example.com/a' }] },
    claimRegister: [{ id: 'claim-1', claim: '回购上限为30%', status: 'verified', sourceUrl: 'https://example.com/a' }],
    issues: [{ type: 'title', message: '标题包含高影响财经数字' }],
    publicationScan: { title: '标题30%', titleBlockers: ['标题数字“30%”未明确归因'] },
    researchPoints: [{ point_id: 'I1', statement: '反常点' }],
    rejectedAngles: ['不得断言主动退市'],
    article: '# 标题30%\n\n正文。',
  });
  assert.match(prompt, /只在门禁明确指出标题问题时修改标题/);
  assert.match(prompt, /明确归因/);
  assert.match(prompt, /具体来源/);
  assert.match(prompt, /只输出修订后的完整 Markdown 文章/);
  assert.match(prompt, /不得新增事实、数字、日期/);
});

test('综合候选汇总全部已抓取来源，写作简报移除来源原文', () => {
  const candidate={composite:true,source_documents:[
    {title:'来源甲',url:'https://example.com/a',source:{status:'ok',content:'甲正文'}},
    {title:'来源乙',url:'https://example.com/b',source:{status:'ok',content:'乙正文'}},
    {title:'失败来源',url:'https://example.com/c',source:{status:'error',content:'不应进入'}},
  ]};
  const corpus=compositeSourceText(candidate);
  assert.match(corpus,/来源甲[\s\S]*甲正文/);
  assert.match(corpus,/来源乙[\s\S]*乙正文/);
  assert.doesNotMatch(corpus,/不应进入/);
  const safe=authorizedWritingBrief({topic:'主题',sourceText:corpus,factBase:{claims:[]}});
  assert.equal(safe.sourceText,undefined);
  assert.equal(safe.topic,'主题');
  assert.deepEqual(safe.factBase,{claims:[]});
});

test('审稿提示词检查证据和推理，允许明确的作者评价', () => {
  assert.match(ARTICLE_PROMPTS.review, /缺失前提、因果跳跃/);
  assert.match(ARTICLE_PROMPTS.review, /不因语气鲜明而要求弱化/);
  assert.match(ARTICLE_PROMPTS.review, /不要求用免责声明代替修正/);
  assert.match(ARTICLE_PROMPTS.drafting, /不虚构经历、引语、行为或结果/);
  assert.match(ARTICLE_PROMPTS.humanize, /删除没有增加信息的重复判断/);
});

test('文章质量门禁开关开启时消费 decision tool，且仍保持内部结果契约', async () => {
  const calls = [];
  const gateway = {
    config: { defaultProvider: 'mock', providers: { mock: { supportsNativeTools: true } } },
    async complete(input) {
      calls.push(input);
      return { callId: 42, toolCalls: [{ id: 'call-gate', name: 'decision.article_quality_gate', input: { pass: true, issues: [] }, providerExecuted: false }] };
    },
  };
  const store = { repositories: { extensionSettings: { get() { return { value: { decisionToolsEnabled: true } }; } } } };
  const result = await aiQualityGate({ gateway, store, provider: 'mock', purpose: 'unused', batchId: 'b1', candidateId: 'c1',
    article: '# 标题\n\n正文', factBase: { claims: [] }, systemPrompt: '质量门禁', stage: 'draft' });
  assert.deepEqual(result, { pass: true, issues: [] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].toolChoice, { type: 'function', name: 'decision.article_quality_gate' });
  assert.equal(calls[0].jsonMode, false);
  assert.deepEqual(calls[0].tools, [ARTICLE_QUALITY_GATE_TOOL]);
});

test('文章质量门禁在模型判定通过后仍拦截规划元话语泄漏', async () => {
  const gateway = {
    config: { defaultProvider: 'mock', providers: { mock: { supportsNativeTools: true } } },
    async complete() {
      return { callId: 42, toolCalls: [{ id: 'call-gate', name: 'decision.article_quality_gate', input: { pass: true, issues: [] }, providerExecuted: false }] };
    },
  };
  const store = { repositories: { extensionSettings: { get() { return { value: { decisionToolsEnabled: true } }; } } } };
  const result = await aiQualityGate({ gateway, store, provider: 'mock', batchId: 'b1', candidateId: 'c1',
    article: '# 标题\n\n本文不写公司，所以只能当作提问的起点。', factBase: { claims: [] }, systemPrompt: '质量门禁', stage: 'draft' });
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((issue) => issue.type === 'structure'));
});

test('仅修复规划元话语时要求保留标题、开头和结构', () => {
  const prompt = buildPublicationComplianceRepairPrompt({
    issues: [{ type: 'structure', message: '存在编辑规划元话语“本文不写”' }],
    article: '# 标题\n\n开头与正文。',
  });
  assert.match(prompt, /本次仅修复编辑规划元话语/);
  assert.match(prompt, /保留标题、开头、章节顺序、事实、来源、作者判断和结尾/);
  assert.match(prompt, /只改对应句子/);
});

test('发布标题在精修之后只生成一次', () => {
  const source = fs.readFileSync(new URL('../server/features/articles/application/article-pipeline.mjs', import.meta.url), 'utf8');
  const runtime = source.slice(source.indexOf('export async function runArticlePipeline'), source.indexOf('function readJsonIfPresent'));
  assert.equal([...runtime.matchAll(/await generateTitlePlan\(/g)].length, 1);
  assert.ok(runtime.indexOf("purpose: 'article-humanize'") < runtime.indexOf('await generateTitlePlan'));
  assert.match(runtime, /replaceArticleTitle\(final, titlePlan.selectedTitle\)/);
  assert.doesNotMatch(runtime, /article-seo|article-planning|aiQualityGate\(|aiVoiceQualityGate\(/);
});

test('审稿修订有次数上限，精修改动按差异复核', () => {
  const source = fs.readFileSync(new URL('../server/features/articles/application/article-pipeline.mjs', import.meta.url), 'utf8');
  const runtime = source.slice(source.indexOf('export async function runArticlePipeline'), source.indexOf('function readJsonIfPresent'));
  assert.match(runtime, /attempt < repairAttempts/);
  assert.match(runtime, /issue.return_to === 'materials'/);
  assert.match(runtime, /original_issues: issues, changed_passages:/);
  assert.match(runtime, /if \(current === previous\) break/);
  assert.deepEqual(articleChangedPassages('# 标题\n\n原文', '# 标题\n\n**原文**'), { before: [], after: [] });
  assert.deepEqual(articleChangedPassages('# 标题\n\n数字 1', '# 标题\n\n数字 2'), { before: ['数字 1'], after: ['数字 2'] });
});

test('爆款结构门禁要求钩子、3-5个章节和来源链接', () => {
  const article = `# 标题\n\n2026年，一场真实事件引出冲突，相关研究员公开说明了事件经过、组织决定和自己的离开原因。这意味着什么？真正的问题是技术由谁控制，以及公开承诺能否影响真实业务。\n\n第二段继续交代背景、关键参与者和读者最关心的问题，说明这不是普通的人事变化，而是研究理想进入合同、商业利益和组织权力之后产生的冲突。\n\n第三段明确作者判断：技术原则只有在高代价项目上仍能约束决策才有意义，并给出后续论证的核心方向和事实边界。\n\n## 第一节\n\n事实与解释。[来源](https://example.com/a)\n\n事实与判断。\n\n## 第二节\n\n事实、机制和影响。\n\n进一步分析。\n\n## 第三节\n\n反方与边界。\n\n结论与建议。`;
  assert.equal(inspectArticleQuality(article).pass, true);
  assert.equal(inspectArticleQuality('# 标题\n\n一句话。').pass, false);
});

test('爆款结构门禁接受陈述式钩子，不强制使用问号', () => {
  const article = `# 标题\n\n2026年，一名研究员公开了自己离开公司的原因，并列出内部推动改革失败的经过。他写过方案、联系过管理层，也试图争取技术领袖支持，但组织最终没有改变决定。真正值得讨论的不是一次普通离职，而是研究员是否还能控制自己参与创造的技术。\n\n事件背后连接着政府合同、商业利益和技术伦理。关键在于，公开原则进入高代价项目后还能不能影响组织决定，以及个人为什么很难通过内部流程改变已经商业化的技术方向。\n\n作者的判断很明确：原则只有在利益冲突中仍然有效，才称得上组织规则。后文将沿着事实、机制和影响展开，并区分公开证据、个人叙述和作者判断。\n\n## 第一节\n\n事实与解释。[来源](https://example.com/a)\n\n进一步分析。\n\n## 第二节\n\n组织机制与现实影响。\n\n补充事实边界。\n\n## 第三节\n\n反方解释与结论。\n\n给出具体建议。`;
  assert.equal(inspectArticleQuality(article).pass, true);
});

test('所有文章共用流量结构检查，缺少章节时明确暴露而不改变读者收益放置', () => {
  const article = '# 标题\n\n具体场景和冲突在这里展开，真正的问题是读者会承担什么代价。\n\n继续解释事实、机制和判断，给出来源与边界。';
  const report = inspectTrafficStructure(article);
  assert.equal(report.pass, false);
  assert.match(report.issues.join('；'), /3-5 个 H2/);
});

test('技能运行时加载完整写作技能并记录哈希', () => {
  const bundle = loadArticleSkillBundle({ workspaceRoot: process.cwd(), writerSkill: 'wechat-mp-tech-hotspot' });
  assert.equal(bundle.fallback, false);
  assert.match(bundle.prompt, /wechat-mp-tech-hotspot/);
  assert.match(bundle.hash, /^[a-f0-9]{64}$/);
  assert.ok(bundle.files.some((file) => /runtime-stage-contracts\.md$/.test(file)));
});

test('直写流程使用单阶段提示词，兼容旧技能组合器', () => {
  assert.deepEqual(ARTICLE_STAGE_CONTRACT.map(({ id }) => id), ['brief', 'fact-base', 'drafting', 'review', 'length-adjustment', 'humanize', 'title-lock']);
  const manifest = articlePromptManifest('wechat-mp-tech-deep');
  assert.equal(manifest.version, 'direct-brief-v2');
  assert.match(manifest.prompts.drafting.prompt, /技术深解需要解释机制/);
  assert.doesNotMatch(manifest.prompts.review.prompt, /## SKILL:|全流程|风格门禁/);
  assert.match(manifest.prompts.review.hash, /^[a-f0-9]{64}$/);
  const system = buildArticleStageSystem({ prompt: '旧编排契约' }, 'drafting', { prompt: '旧子技能' });
  assert.match(system, /旧编排契约/);
});

test('综合选题写作规则来自项目子技能而非执行器内置提示词', () => {
  const composite = loadSkillBundle({ workspaceRoot:process.cwd(), skillName:'wechat-mp-composite' });
  assert.equal(composite.fallback, false);
  assert.match(composite.prompt, /多个已核验热点/);
  const source = fs.readFileSync(new URL('../server/features/articles/application/article-pipeline.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /composeSkillPrompts|const compositeSkill|你是事实编辑/);
});

test('写作类型路由覆盖技术深解并保护严肃议题边界',()=>{
  assert.equal(selectWriterSkill({composite:true}).skill,'wechat-mp-composite');
  assert.equal(selectWriterSkill({category:'🤖 AI/技术动态',hotspot_title:'新模型发布',angle:'解释这次发布对开发者的影响'}).skill,'wechat-mp-tech-hotspot');
  assert.equal(selectWriterSkill({category:'🤖 AI/技术动态',hotspot_title:'MoE 模型',angle:'拆解推理架构和显存成本，给出可复算公式'}).skill,'wechat-mp-tech-deep');
  assert.equal(selectWriterSkill({category:'🏢 大厂战略',angle:'一个离谱的职场趣闻'}).skill,'wechat-mp-gossip-chill');
  assert.equal(selectWriterSkill({category:'🏢 大厂战略',angle:'离谱裁员事故背后的劳动关系'}).skill,'wechat-mp-deep-dive');
  assert.match(selectWriterSkill({category:'📈 行业趋势',angle:'分析参与方利益关系'}).reason,/参与方/);
});

test('热点文章契约明确拒绝伪装教程、工具清单和纯快讯',()=>{
  const skill=fs.readFileSync(new URL('../skills/wechat-mp-topic-to-article/SKILL.md',import.meta.url),'utf8');
  assert.match(skill,/writer_skill_reason/);
  assert.match(skill,/不承接纯资讯早报/);
  assert.match(skill,/教程必须先建立环境、步骤、成功标准和作者实践证据/);
  assert.match(skill,/工具 → 图文/);
  assert.match(skill,/distribution_lane/);
  assert.match(skill,/reader_stake/);
});

test('运行时删除大纲调用和读写依赖，保留研判输入和产物清单', () => {
  const source = fs.readFileSync(new URL('../server/features/articles/application/article-pipeline.mjs', import.meta.url), 'utf8');
  const runtime = source.slice(source.indexOf('export async function runArticlePipeline'));
  assert.doesNotMatch(runtime, /02-outline\.md|article-planning|buildDraftOutlineView|buildArticlePlanningView/);
  assert.match(runtime, /researchBasis:editorial.research_basis/);
  assert.match(runtime, /packaging: \{ distributionLane: brief.distributionLane, readerStake: brief.readerStake \}/);
  assert.match(runtime, /00-prompt-manifest.json/);
  assert.match(runtime, /activeReviewArtifacts/);
});

test('阶段子技能从项目 skills 目录加载，覆盖层只替换正文', () => {
  for (const skillName of ['title-generator','humanizer-zh','article-reviewer','seo-keyword-scoring','seo-content-optimizer','article-image-placeholders','wechat-mp-composite']) {
    const bundle = loadSkillBundle({ workspaceRoot: process.cwd(), skillName });
    assert.equal(bundle.fallback, false, skillName);
    assert.ok(bundle.root.startsWith(path.join(process.cwd(),'skills')), skillName+' 的技能包应从项目 skills 目录加载：'+bundle.root);
    assert.match(bundle.hash, /^[a-f0-9]{64}$/);
  }
});

test('来源缓存与热点 URL 不一致时给出拦截信息', () => {
  const candidate={url:'https://www.solidot.org/story?sid=84915',composite:false};
  const cached={url:'https://www.stcn.com/article/detail/4040493.html',content:'正文'};
  const issue=sourceCacheIssue(candidate,cached);
  assert.match(issue,/来源缓存与热点原文不一致/);
  assert.match(issue,/stcn\.com/);
  assert.equal(sourceCacheIssue(candidate,{url:'https://www.solidot.org/story?sid=84915',content:'正文'}),null);
  assert.equal(sourceCacheIssue(candidate,{url:'https://www.solidot.org/story?sid=84915/',content:'正文'}),null);
  assert.equal(sourceCacheIssue({...candidate,composite:true},cached),null);
  assert.equal(sourceCacheIssue(candidate,{url:'https://www.stcn.com/x',content:''}),null);
});

test('事实基座全部事实性主张未核实时给出拦截信息', () => {
  const allUnverified={claims:[
    {claim:'事件A',status:'unverified'},
    {claim:'事件B',status:'unverified'},
    {claim:'作者判断',status:'opinion'},
  ],missingEvidence:['原文内容']};
  const issue=unverifiedFactBaseIssue(allUnverified);
  assert.match(issue,/所有事实性主张均未核实/);
  assert.match(issue,/原文内容/);
  assert.equal(unverifiedFactBaseIssue({claims:[{claim:'事件A',status:'verified'},{claim:'事件B',status:'unverified'}]}),null);
  assert.equal(unverifiedFactBaseIssue({claims:[{claim:'作者判断',status:'opinion'}]}),null);
  assert.equal(unverifiedFactBaseIssue({}),null);
});

test('文章成稿路线门禁兼容 SQLite 的数值型 article_eligible', () => {
  const source = fs.readFileSync(new URL('../server/features/articles/application/article-pipeline.mjs', import.meta.url), 'utf8');
  assert.match(source, /Number\(candidate\.article_eligible\) === 0/);
});
