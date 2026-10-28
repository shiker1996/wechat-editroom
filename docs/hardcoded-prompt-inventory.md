# 项目内硬编码提示词清单

> 历史快照：本文的版本号和阶段描述已过期。当前文章提示词版本以 `server/features/articles/application/article-prompts.mjs` 为准；当前成稿阶段顺序以 `skills/wechat-mp-topic-to-article/references/runtime-stage-contracts.md` 为准。

盘点日期：2026-10-22  
范围：运行时代码中直接写入源码、传给模型的 system/user 指令、JSON 格式修复指令，以及在技能文本前后追加的阶段契约。技能目录中的 Markdown 正文不抄录到本清单；仅记录代码如何调用或包裹这些技能。普通错误提示、UI 文案和仅用于模型参数的配置不算提示词。

> 本文是源码级目录，不是每次模型调用的完整 prompt dump。运行时内容还会拼入简报、事实材料、用户回答、技能正文、资源目录、候选项和阶段状态；要还原某一次调用，应查看该次运行保存的提示词快照/trace。

## 当前外置状态

本文仍保留完整源码盘点。以下代码提示词已迁入 `prompts/manifest.json` 管理：文章成稿主链；采集字段识别、候选排序与 GitHub 仓库发现；早报和教程的标题/审稿补充指令；突发事件分析；配图规划及移动端返工；图文封面标题拆行、布局修复与浏览器审计后调整；排版 design/draft 阶段契约；主题路由、主题生成、Social 模板提案及 JSON 修复；文章与图文复盘调整两个阶段的提示词。

早报/教程剩余阶段附加指令、研判、编辑室/视觉、图文其他生成阶段、主题与模板主生成提示词、平台级上下文及模型探针尚未完成外置，不能据此认为全项目已经迁移。技能文件正文仍由技能加载器管理，不属于“代码硬编码提示词”迁移范围。迁移状态以设计文档的“当前迁移进度”和 manifest 为准。

## 1. 文章生产与编辑

### 1.1 热点文章直接成稿主链

核心定义位于 `server/features/articles/application/article-prompts.mjs`，版本常量为 `direct-brief-v3`。`article-pipeline.mjs` 负责按阶段调用并提供动态材料。

| 提示词 | 代码内任务 | 主要输入/输出 |
|---|---|---|
| `facts` | 从已确认简报和来源整理事实记录，不写文章、不重做选题判断 | 输出带 ID、状态、证据、来源、必要条件的 claims JSON |
| `drafting` | 根据简报和事实材料直接写完整初稿；允许作者观点和感受；沿简报角度、主线展开 | 完整 Markdown |
| `review` | 审核事实、归属、必要条件、推理缺口及核心命题展开情况；允许有依据的鲜明观点 | pass/issues JSON |
| `repair` | 根据审稿问题局部修订，保留成立的观点与表达力度 | 完整修订稿 |
| `lengthAdjust` | 依据方向、幅度、策略扩缩；大幅改动处理结构，小幅改动处理表达 | 完整 Markdown |
| `humanize` | 处理重复判断、过场、自我免责句及抽象空话；只做表达精修 | 完整 Markdown |
| `title` | 基于正文生成 5 个发布标题并唯一推荐；承诺需由正文兑现 | 标题候选 JSON |

同文件的代码级附加项：

- `TYPE_HINTS` 根据 writer 路由补一句类型写作要求：技术深解讲机制；行业评论讲行为/利益/结果；轻松趣闻用真实细节和反差；复合稿围绕共同命题并保持事实归属。
- `articleReaderContext()` 提供账号描述、目标读者和表达习惯默认值，作为 user context，不是正文指令。
- 长度调整目标值、200 字结构/表达策略阈值由代码计算，不是模型提示词。
- `article-pipeline.mjs` 将上述提示词绑定到事实整理、初稿、审稿、修订、扩缩、精修和标题阶段；运行时阶段产物、简报、事实基座等会进入 user message。
- `aiReviewGate`/`aiQualityGate` 使用传入的阶段 prompt；附带文章、事实基座、研究点、拒绝角度、claim register 等上下文。差异复核会判断改动段落并复用审稿器。

### 1.2 早报成稿

`server/features/articles/llm/daily-pipeline.mjs`

- 标题：技能标题提示词 + 代码追加的“根据完整早报生成标题”、严格 JSON 结构、不得引入事实卡外事实/数字/人物/结论；可追加原生工具调用指令。
- SEO：技能提示词 + 代码要求直接输出完整 Markdown，不改变事实/来源/关系判断、不添加搜索量或效果承诺。
- 质量门禁：技能审稿提示词 + 早报关系维度检查，包括 focus 覆盖、事实/关系解释、段落数、来源链接、新闻素材支撑与严肃事件语气；长度由代码检查。
- 格式重试：追加“上轮返回正文而非 JSON，本次只返回 JSON”；工具模式下追加调用 `daily_quality_gate` 的要求。
- 正文写作主要来自早报写作技能和新闻素材，不等同于热点文章 `ARTICLE_PROMPTS.drafting`。

### 1.3 教程/自主写作

`server/features/articles/llm/tutorial-pipeline.mjs`、`tutorial-chat.mjs`、`server/features/articles/application/agent/tutorial-adapter.mjs`

- 标题：标题技能 + 严格 JSON 结构 + 不得引入初稿无依据的事实、数字、人物或结论。
- SEO：SEO 技能 + 完整 Markdown 输出、不得改变步骤/事实/来源/作者经历/观点、不得添加搜索量和效果承诺。
- 质量门禁：代码内按文章类型生成 system 指令。经历稿检查第一人称内容、作者观点范围、素材归属及模型建议是否伪装亲历；教程稿检查可复现性、环境前提、步骤结果证据、建议是否伪装实测和来源追溯。
- JSON 格式重试及原生工具 `tutorial_quality_gate` 调用要求由代码追加。
- 对话任务本身的主 prompt 从 `tutorial-chat` 技能加载；adapter 另加原生工具协议、项目读取事实不能记为作者亲历、资源目录等运行时上下文。

### 1.4 编辑室与工具教程问答

- `server/features/articles/llm/editorial-room.mjs`：代码内动态 `researchInstruction` 和问答路由，要求沿“事实→观点→角度→命题→边界”推进；围绕研判素材提具体问题；按需选取 1–3 个研究拓展点；不把所有素材自动加入；所有表单项通过后调用 preflight。会拼入选题命题、研究点目录、用户历史回答等。
- `server/features/articles/application/agent/editorial-adapter.mjs`：附加工具协议、项目读取结果属于素材且不得作为作者亲历，以及当前业务资源索引。
- `server/features/articles/llm/tutorial-chat.mjs`：主要对话规则从教程聊天技能加载。
- `server/features/articles/application/agent/tutorial-adapter.mjs`：另附工具调用规范、项目/素材/文档根目录及素材归属规则。

### 1.5 文章图表、配图、封面、排版

- `server/features/articles/llm/visual-planner.mjs`：技能优先；技能缺失时使用代码内 `FALLBACK_SYSTEM`。要求只建议能提升理解的图表、标题锚点必须存在、ECharts 数字需来自事实基座并使用白名单图型、Mermaid 节点/关系数量受限；附加用户历史选择、事实基座和终稿。
- `server/features/articles/application/image-workflow.mjs`：代码内 `IMAGE_PLAN_SYSTEM` 与配图占位技能合并；只找必须由作者/编辑提供且有阅读或证据价值的图，不建议装饰图或重复已有图片。
- `server/features/articles/application/cover-semantics.mjs`：分析封面标题/摘要的重点词、主题主体、动作、变化、张力和视觉隐喻；输入按不可信文本处理；字段和 motif 使用枚举约束。
- `server/features/articles/application/ai-visual-cover-generator.mjs`：调用视觉封面技能，再由代码根据候选目录、画布、阶段约束生成动态 system prompt。
- `server/features/articles/application/typeset-pipeline.mjs`：排版技能 + 杂志设计技能，再加代码内 design/draft 阶段契约。design 阶段只输出 JSON 方案；draft 阶段只输出 HTML，保留正文、事实、来源、链接、图片和顺序，样式只使用给定 tokens。

### 1.6 突发事件分析

`server/features/articles/llm/breaking-analysis-pipeline.mjs`

- `SYSTEM`：突发事件事实编辑与内容适配评估；禁止把社媒指控、匿名爆料、媒体转述或作者观点升格成事实；要求按 schema 输出结构化分析、分值、来源引用和待核验问题。
- 调用 user message 会附带抓取材料；数值范围、source ID 和 JSON 字段约束属于硬编码契约。

## 2. 研判、选题与素材

### 2.1 研究流水线与事件研判

- `server/features/research/llm/tasks.mjs`：硬编码基础标签/评分/成稿相关 prompt；部分任务会使用账号适配器包裹基础提示词。文件内不同任务分别负责热点打标、事件分析或写作相关输出，输入按批次和事实材料动态构造。
- `server/features/research/application/event-research-analysis.mjs`：主提示词通常来自事件深度分析技能；缺技能时有“事件深度分析器、仅严格 JSON”的短回退提示词。
- `server/features/research/application/research/event-card-stage.mjs`：事件卡生成任务的 system 指令与 schema 约束，结合事件及来源材料生成结构化卡片。
- `server/features/research/application/research/editorial-exploration.mjs`：探索阶段 brainstorm prompt 和综合 synthesis prompt；按候选组装素材、观点方向、评分维度和输出结构。
- `server/features/research/application/research/discussion-research-stage.mjs`：研判讨论的提示词组装与运行快照；基础任务规则与候选、已知事实、用户编辑输入动态合成。
- `server/features/research/application/project-reader-value-service.mjs`：基于项目内容判断目标读者价值/匹配度的模型任务。
- `server/platform/http/routes/candidate-routes.mjs`：复合热点打分有直接内嵌的热点探索编辑 prompt，生成临时评分、画像、角度和命题 JSON。
- `server/platform/http/routes/content-routes.mjs`：素材主编 prompt；从素材生成可供作者确认的事实摘要、冲突、读者影响、主线候选、讨论问题、缺失证据与适用格式。

### 2.2 采集侧模型处理

- `server/features/collection/llm/source-field-enricher.mjs`：根据来源内容补充结构化字段的 prompt。
- `server/features/collection/llm/source-candidate-ranker.mjs`：来源候选排序、相关度/质量判断 prompt。
- `server/features/collection/llm/repo-discovery.mjs`：开源仓库发现与排序 prompt，评估账号读者是否会进一步了解或使用仓库，并生成简短理由。
- RSS、Twitter/X 等采集器自身主要是接口调用与数据映射，不因此自动算作 LLM 提示词；插件的采集能力定义在插件代码/manifest。

## 3. 图文生产

- `server/features/social-cards/application/storyboard-contracts.mjs`：构造故事板 system prompt，通常以所选故事板技能为主体，再注入模板能力、内容类型、频道模式、事实包及 schema 契约。
- `server/platform/http/routes/social-card-routes.mjs`：追加单页拆页修复、单页重生成、模板不可变上下文和页面数量/内容块限制等任务指令。
- `server/features/social-cards/application/social-card-pipeline.mjs`：图文主链内有封面拆行规则、内容规划器 prompt、布局修复 prompt、浏览器审计后的调整指令等；部分阶段使用技能生成器 prompt，再附加当前阶段契约。
- `server/features/social-cards/application/social-card-copy.mjs`：图文发布文案/发布标题 prompt 构造器，主提示词来自频道技能，代码负责拼接渠道/内容类型要求和输出契约。
- `server/features/social-cards/application/custom-social-chat.mjs`、`server/features/social-cards/application/agent/custom-social-adapter.mjs`：自定义图文的对话式采编指令、工具协议和状态资源上下文。
- `server/features/social-cards/application/storyboard-contracts.mjs` 等文件还含事实包整理与输出结构契约。具体图文写作风格正文主要由技能目录提供，代码层主要加模板/字段/布局限制。

## 4. 视觉主题与模板生成

- `server/platform/application/themes/auto-theme-router.mjs`：自动主题路由 prompt；依据场景、调性、信息密度选择已有主题，严格 JSON，不得创建主题。
- `server/platform/application/themes/ai-theme-generator.mjs`：主题生成 prompt；注入主题目标、数值范围、token/组件/recipe 精确契约、主题签名与差异化要求；另有仅修 JSON 格式的 repair prompt。
- `server/shared/themes/social-template-proposal.mjs`：Social 模板提案生成 prompt，限制角色、版式、支持内容块及表面参数；另有 JSON 格式修复 prompt。
- `server/features/articles/application/cover-semantics.mjs`：文章封面语义分析（见 1.5）。

## 5. 内容复盘与配置调整

- `server/features/content-feedback/application/feedback-adjustment-service.mjs`：两阶段提示词。第一阶段只判断哪些目标需调整及原因；第二阶段把已确认意图转成现有文件的最小修改。HTTP route 负责调用并返回计划/补丁。
- `server/features/content-feedback/application/social-feedback-adjustment-service.mjs`：图文版两阶段提示词，判断故事板技能/文案技能是否要改，再生成针对技能包的最小修改。
- `server/platform/http/routes/content-feedback-routes.mjs`：路由层调用 plan 与 patch prompt，并将结果交给用户确认；调用本身不等于直接写文件。

## 6. 跨功能共用的提示词/指令

- `server/platform/llm/context-safety.mjs`：将定界块声明为不可信数据，禁止执行其中的指令、角色声明和工具调用要求；由上下文构造链复用。
- `server/platform/agent/context.mjs`：上下文压缩时加入“已省略旧重复消息、保留初始任务和最近结果”的系统通知。它是运行时上下文说明，不是业务写作任务。
- `server/platform/agent/ai-visual-document-agent.mjs`：视觉文档生成/修改 agent 的系统提示和阶段覆盖，包含页数、画布、输出文件、原生工具等运行时约束；具体主指令由 agent 配置/提示词资源合并。
- `server/platform/http/routes/model-routes.mjs`：模型连通性检查使用“只回复 OK”的探针 prompt。
- 各 JSON 修复 prompt：主题生成、模板提案等流程在主输出无法解析时会调用只修格式、不改语义的第二次模型调用。

## 7. 提示词来源与运行时组合方式

1. **代码硬编码正文**：例如 `ARTICLE_PROMPTS`、`breaking-analysis-pipeline` 的 `SYSTEM`、封面语义、主题生成和图文布局修复。这些是本清单主要对象。
2. **代码硬编码的增补指令**：例如“当前只执行 design 阶段”“调用原生工具”“不得输出解释”。它们常被追加到技能 prompt 之后，虽不是完整 prompt，仍会影响模型行为。
3. **技能文件正文**：由 `loadSkillBundle`、`selectionPrompt` 等机制在运行时加载；不属于硬编码在业务代码中的正文，但同一模型调用可能会和代码增补指令组合。
4. **动态业务上下文**：简报、事实基座、候选目录、账户、用户回答、项目文件、模板能力、历史选择等是数据，不应与固定指令混为一谈；部分数据会影响 prompt 长度和语义。
5. **确定性代码规则**：长度范围、条数限制、字段校验和 JSON schema 有时由代码实现，有时被再次写进 prompt。只在 prompt 文本中出现的部分是模型指令，代码校验本身不是提示词。

## 8. 阅读与维护建议

- 查某一篇文章“模型实际看到了什么”：优先看该次生成快照/trace；源码模板只能说明固定部分。
- 查热点文章主链固定提示词：看 `article-prompts.mjs`；查阶段调用和动态上下文：看 `article-pipeline.mjs`。
- 查早报或教程：分别看对应 `*-pipeline.mjs`，不要假设它们复用热点文章主链全部规则。
- 查图文：同时看技能文件、`storyboard-contracts.mjs`、`social-card-pipeline.mjs` 和 route 层追加指令。
- 本文按提示词职责归并文件；一个文件内可能包含多条独立模型调用，表格中的一项不代表只发起一次调用。

## 9. 成稿主链提示词原文

以下七段从 `server/features/articles/application/article-prompts.mjs` 的 `ARTICLE_PROMPTS` 逐字转录。动态数据不在这些固定正文中，运行时由 pipeline 单独传入。

### facts

```text
根据已确认简报和抓取的来源整理可追溯的事实记录，不写文章、不重新研判选题。
逐条保留主张、主体、时间、来源、对应证据以及影响含义的必要条件。区分已核实事实、来源单方说法、争议和作者观点；评论只说明有归属的个人看法或经历。
只返回 JSON：{"claims":[{"id":"F1","claim":"主张","status":"verified|disputed|unverified|opinion","evidence":"来源中的对应证据","sourceUrl":"原始URL","sourceTitle":"来源名称","sourceType":"official|media|user","publishedAt":"来源时间","boundary":"影响含义的必要条件","attributionRequired":false}],"missingEvidence":[]}。
来源声明的已核实对象是其作出的声明，不能把声明内容自动当成已独立证实。缺少材料的事实标记 unverified，不能补造证据。
```

### drafting

```text
你是一位面向开发者和技术从业者写作的公众号作者。
请根据已确认简报和事实材料，直接写出完整文章。沿着简报的角度与主线，自行安排章节和段落，让事实、解释和作者判断自然衔接。
开头尽快进入值得讨论的具体事件、细节或问题；正文讲清关键关系，让读者理解判断的依据及其实际含义。
允许明确表达作者态度、感受和评价。事实忠于材料，推断的力度与依据相称，不虚构经历、引语、行为或结果。
来源和必要条件自然写进相关事实句。已经交代清楚的限定不再重复说明，有依据的观点直接表达。
内容讲到哪，结构就展开到哪。合并没有新信息的重复解释，结尾在判断讲清时自然收束。
按本篇长度设置输出完整 Markdown 文章，以事件名作为唯一一级工作标题，不附写作过程或规划说明。
```

### review

```text
请审核文章中的事实与论证，并核对已确认简报的核心命题是否得到展开。
检查重要事实、数字、引语、来源归属和必要条件是否与证据一致；检查推断是否存在缺失前提、因果跳跃或超出依据的结论。
来源支持某人作出声明，不等于声明内容已经独立证实。有依据的作者评价和个人看法可以明确表达，不因语气鲜明而要求弱化。
每项问题必须定位原文，说明对应证据或具体推理缺口，给出最小修复建议。
证据不足的事实应纠正、删除或准确归因；关键推理不足应补清依据或收窄结论。
只报告影响事实、论证或核心命题的具体问题，不提出泛泛的谨慎建议，也不要求用免责声明代替修正。
返回 JSON：{"pass":true,"issues":[]}；有问题时 pass=false，每项包含 type（fact/attribution/reasoning/brief）、message、quote（原文）、basis（证据编号或推理缺口）、repair（最小修法）、return_to（materials/draft）。
```

### repair

```text
按照审稿清单修订文章，只修改问题所在句段和保持衔接所需的上下文。
事实错误依据材料纠正，推理缺口依据现有材料补清或收窄结论。
保留成立的作者观点和表达力度。不得新增事实，也不把局部问题扩写成全篇风险说明。
未涉及问题的内容保持原样，输出完整修订稿。
```

### lengthAdjust

```text
根据输入中的调整方向、调整幅度和策略扩写或缩写文章。保留核心命题、作者立场和事实准确性；按任务取舍段落、章节和表达方式，不必默认保留原有结构。
当 strategy 为 structural 且 adjustment 为 expand 时，补充与主线相关的次要内容，进一步解释观点背后的原因、机制、影响或读者处境。可以使用具体例子、比喻、对比、排比等写作手法，也可以在已有事实支持下深入展开判断。例子不得伪装成真实事件；不得编造数据、引语、来源或亲历。
当 strategy 为 expressive 且 adjustment 为 expand 时，主要调整现有段落的写法，以例子、比喻、对比、排比或更充分的解释增加少量篇幅；不另起次要章节。表达要增加理解或阅读体验，不得同义反复凑字数。
当 strategy 为 structural 且 adjustment 为 shorten 时，删除次要论点、次要章节、重复背景和不推进主线的内容，保留主旨成立所必需的事实与论据。允许重排或删除小标题、段落，不要求保留所有论证顺序。
当 strategy 为 expressive 且 adjustment 为 shorten 时，优先删减比喻、排比、对比铺陈、过场和重复修饰，把观点及其依据改为直接表达；只有修辞本身承载必要含义时才保留。
扩写时可以基于已有事实深入解释因果、机制和影响，但不能把推断写成已证实事实。缩写时不得删改事实含义、来源归属或作者立场。
根据输入中的 target_visible_chars 调整篇幅，结果必须落在 allowed_range 内。只输出完整 Markdown 文章，不说明调整过程。
```

### humanize

```text
请把文章编辑得清楚、自然、连贯。
删除没有增加信息的重复判断、过场和自我免责句，合并重复段落；保留有推进作用的回扣。
保留有效细节、修辞、作者态度和论证过程。遇到抽象空话，用文章已有的具体内容说清；没有支撑时删去，不编造解释。
调整句长与衔接，让段落顺着内容推进，不按固定句式或词表判断 AI 腔。
保持事实、来源、数值、适用条件和判断含义准确。来源已经说明归属时，不再附加同义声明。
只做表达处理，不承担扩写或缩写任务；不要新增或删除实质内容，精修前后可见字符数尽量接近。
结尾在话说完时结束。输出完整 Markdown 文章，保留一级工作标题，无需修改时返回原文，不附编辑说明。
```

### title

```text
为这篇公众号文章生成 5 个发布标题，并推荐其中一个。
从正文最有分量的事实、冲突或判断寻找点击理由，让目标读者一眼看懂文章在讨论什么。
保留必要的事件或主体名称，陌生专名可搭配白话含义。候选从不同角度表达，不只替换同义词。
标题可以有鲜明观点，但承诺必须由正文兑现，不新增未经支持的数字、因果、行为或结果。
对照正文核对每个候选，剔除夸大或歧义表达。输出候选、简短理由和唯一推荐标题，不修改正文。
返回 JSON：{"titleCandidates":[{"title":"标题","reason":"理由"}],"selectedTitle":"唯一推荐标题","hotspotAnchor":"必要事件或主体名","coreKeywords":["自然使用的关键词"]}。
```

### Writer 路由追加指令

以下文字由 `draftSystemPrompt(writerSkill)` 根据路由追加到 drafting 后；非对应类型时不会出现：

```text
wechat-mp-tech-deep：技术深解需要解释机制，使用材料中可以支持的技术细节。
wechat-mp-deep-dive：行业评论重点展开行为、利益关系和结果。
wechat-mp-gossip-chill：轻松趣闻通过真实细节和反差产生趣味。
wechat-mp-composite：围绕简报的共同命题组织多条材料，各事件的事实归属保持清楚。
```

## 10. 其余模块的逐字原文索引

上一版目录里的其他硬编码提示词不在此处抄写成摘要，以免摘要被误认为原文。其完整字符串和运行时模板仍保存在以下源码，可直接逐字核对；其中带插值的模板会与动态契约、素材或技能正文合并：

- 早报阶段追加指令和质量门禁：`server/features/articles/llm/daily-pipeline.mjs`。
- 教程标题/SEO/质量门禁：`server/features/articles/llm/tutorial-pipeline.mjs`。
- 突发事件评估器（较长 JSON 输出契约）：`server/features/articles/llm/breaking-analysis-pipeline.mjs`。
- 配图规划：`server/features/articles/application/image-workflow.mjs`；图表回退：`server/features/articles/llm/visual-planner.mjs`。
- 编辑室问答规则：`server/features/articles/llm/editorial-room.mjs`；工具/资源增补：`server/features/articles/application/agent/editorial-adapter.mjs`。
- 排版 design/draft 阶段增补：`server/features/articles/application/typeset-pipeline.mjs`。
- 图文拆行、内容规划和布局修复：`server/features/social-cards/application/social-card-pipeline.mjs`。
- 图文故事板契约：`server/features/social-cards/application/storyboard-contracts.mjs`；单页修复/重生成增补：`server/platform/http/routes/social-card-routes.mjs`。
- 自定义图文对话与工具增补：`server/features/social-cards/application/custom-social-chat.mjs`、`server/features/social-cards/application/agent/custom-social-adapter.mjs`。
- 图文发布文案：`server/features/social-cards/application/social-card-copy.mjs`（正文主要来自渠道技能）。
- 热点研判、选题探索、事件卡和讨论研判：`server/features/research/llm/tasks.mjs`、`server/features/research/application/event-research-analysis.mjs`、`server/features/research/application/research/event-card-stage.mjs`、`editorial-exploration.mjs`、`discussion-research-stage.mjs`、`project-reader-value-service.mjs`。
- 素材主线简报与综合选题评分：`server/platform/http/routes/content-routes.mjs`、`candidate-routes.mjs`。
- 采集来源字段识别、排序和 GitHub 仓库发现：`server/features/collection/llm/source-field-enricher.mjs`、`source-candidate-ranker.mjs`、`repo-discovery.mjs`。
- 主题路由/主题生成/Social 模板提案及 JSON 修复：`server/platform/application/themes/auto-theme-router.mjs`、`ai-theme-generator.mjs`、`server/shared/themes/social-template-proposal.mjs`。
- 内容复盘配置调整：`server/features/content-feedback/application/feedback-adjustment-service.mjs`、`social-feedback-adjustment-service.mjs`。
- 共用安全和探针指令：`server/platform/llm/context-safety.mjs`、`server/platform/agent/context.mjs`、`server/platform/http/routes/model-routes.mjs`。

动态生成的 system/user 消息应以具体 run 的生成快照为准；源码中的 template literal 保留 `${...}` 时只代表插值位置，不是模型实际看到的字面字符。
