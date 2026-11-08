window.__ModuleLoader__.load({
  id: 'jianzi-content-workbench',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const NS = 'jianzi-content-workbench';
    const WORKBENCH_URL = 'http://127.0.0.1:4317/';

    // Copy is registered with the Client locale service. The panel translates on
    // every render; the sidebar label resolves once at registration time.
    const COPY = {
      en: {
        panelTitle: 'Jianzi content workbench',
        eyebrow: 'CONTENT DESK / DSH AGENT',
        heading: 'From signal to publish-ready',
        intro: 'Pick a stage and let the DSH Agent drive the Jianzi workflow through its MCP tools. Records stay in Jianzi; this panel only prepares the task.',
        tipLabel: 'Before you start',
        tipText: 'Run the Jianzi workbench at http://127.0.0.1:4317. If you have not configured it yet, start with stage 01.',
        statusTitle: 'Workbench status',
        statusLoading: 'Checking…',
        statusOnline: 'Online',
        statusOffline: 'Unavailable',
        statusRsshub: 'RSSHub',
        statusGithub: 'GitHub',
        statusOk: 'ok',
        statusBad: 'not ready',
        refresh: 'Refresh',
        startProject: 'Prepare start task',
        startingProject: 'Preparing DSH conversation…',
        projectReady: 'Startup task added to a native DSH conversation. Review it and press Send.',
        promptStartProject: 'Start the Jianzi workbench for the currently selected DSH workspace. Determine the absolute path of this conversation\'s selected workspace and pass it as projectRoot to the MCP tool jianzi_workbench_start. Do not use the DSH profile/plugin directory as the project path. Wait for the tool to confirm the service is ready and the workspace fingerprint matches. If the workspace path is unavailable, ask me for it instead of guessing. If startup fails, report the returned error and stop; do not retry or run setup/configuration tasks. After success, report the project path and service address, then end with one specific Next step recommending the environment-check card. If blocked, state the one correction needed. Do not perform any other work.',
        recentBatches: 'Recent batches (click to fill)',
        noBatches: 'No batches yet',
        pickBatch: 'Fill',
        boardTitle: 'Topics and runs',
        boardEmpty: 'Pick a batch to load its topics and runs.',
        jobsTitle: 'Batch runs',
        articlePicksTitle: 'Article picks',
        socialPicksTitle: 'Card picks',
        hotspotsLabel: 'hotspots',
        artifactsLabel: 'artifacts',
        briefLabel: 'Topic direction or extra instructions',
        briefPlaceholder: 'For example: AI tools for small teams; focus on practical takeaways for founders.',
        batchLabel: 'Batch ID (optional)',
        batchPlaceholder: 'Leave empty to list recent batches',
        candidateLabel: 'Candidate ID (optional)',
        candidatePlaceholder: 'Leave empty to list candidates',
        gateLabel: 'Gate',
        clearLabel: 'Clear',
        calendarTitle: 'Content calendar',
        calendarEmpty: 'No content in this month',
        calendarPrev: 'Previous month',
        calendarNext: 'Next month',
        calendarWeekday0: 'Mon',
        calendarWeekday1: 'Tue',
        calendarWeekday2: 'Wed',
        calendarWeekday3: 'Thu',
        calendarWeekday4: 'Fri',
        calendarWeekday5: 'Sat',
        calendarWeekday6: 'Sun',
        calendarUndated: 'Unscheduled',
        calendarMore: 'more',
        calendarOpenArticle: 'Open final article',
        calendarOpenSocial: 'Open delivered card set',
        previewClose: 'Close preview',
        previewDialog: 'Content preview',
        typeArticle: 'Article',
        typeSocial: 'Cards',
        typePlan: 'Plan',
        stage1: '01 / SETUP',
        stage1Title: 'Prepare the workbench',
        stage1Detail: 'Check the local service, RSSHub, account profile, and collection sources; fix what is missing.',
        stage1Action: 'Check environment',
        stage1Gate: 'Workbench online, sources configured',
        stage2: '02 / DISCOVER',
        stage2Title: 'Collect and assess topics',
        stage2Detail: 'Create or reuse a batch, collect hotspots, tag, build event cards, and run the research pipeline. Stop for your choice.',
        stage2Action: 'Prepare topic research',
        stage2Gate: 'Needs nothing; produces a ranked shortlist',
        stage3: '03 / WRITE',
        stage3Title: 'Develop an article',
        stage3Detail: 'Fetch the candidate source, agree on the angle, then save and re-read a draft for your review.',
        stage3Action: 'Prepare article draft',
        stage3Gate: 'Needs a chosen candidate; produces a draft',
        stage4: '04 / DELIVER',
        stage4Title: 'Typeset and cover',
        stage4Detail: 'Requires your confirmed final. Generates the WeChat HTML and the cover, then returns both preview links.',
        stage4Action: 'Prepare typesetting',
        stage4Gate: 'Needs a confirmed final',
        stage5: '05 / CARDS',
        stage5Title: 'Tool or event cards',
        stage5Detail: 'Turn a repository or news candidate into a social card set: storyboard, lock, visual submission.',
        stage5Action: 'Prepare card set',
        stage5Gate: 'Needs a card candidate and a locked storyboard',
        stage6: '06 / FEEDBACK',
        stage6Title: 'Review content feedback',
        stage6Detail: 'Upload a WeChat export table first; import it, link matched local content, then refresh signals and prepare a reviewable proposal.',
        stage6Action: 'Prepare feedback proposal',
        stage6Gate: 'Needs an attached WeChat export table; without one, ask for upload and stop',
        nextStepContract: 'At the end, include a short "Next step" with one concrete action I can take now and the exact reply or ID to use. Never end with a generic "anything else?". If the next action needs my choice or approval, say so and wait; do not cross that gate.',
        nextStep1: 'If setup checks pass, recommend starting topic research with stage 02. If blocked, name the single highest-priority correction and how I can unblock it.',
        nextStep2: 'Show the candidate IDs and recommend one with a brief evidence-based reason. Ask me to reply with that ID; do not add a candidate or draft before I choose.',
        nextStep3: 'After presenting the draft, recommend that I review it and reply with edits or explicit approval. Do not save a final or start typesetting before approval.',
        nextStep4: 'After returning both preview links, recommend reviewing the article and cover. If there is no confirmed final, point back to stage 03. Never publish.',
        nextStep5: 'After returning the card artifact, recommend reviewing the pages and copy and tell me how to request a specific revision. Never publish or replace a delivered artifact without my confirmation.',
        nextStep6: 'After generation, identify the pending proposal by ID and recommend reviewing its diff. Only apply it if I explicitly ask; otherwise leave it pending.',
        note: 'Each button opens a native DSH conversation with a task draft. Review and send it; after the task, the Agent gives one concrete next step.',
        working: 'Preparing DSH conversation…',
        failure: 'Could not prepare a DSH conversation. Check that this DSH profile provides the uiWorkspace client service.',
        sent: 'Task draft prepared in the native DSH conversation. Review it and press Send.',
        briefLead: 'Extra direction:',
        batchLead: 'Batch ID: ',
        candidateLead: 'Candidate ID: ',
        articleQuickReady: 'Prepare article draft',
        articleQuickContinue: 'Review existing draft',
        articleQuickCheck: 'Check writing readiness',
        articleQuickDone: 'Check existing delivery',
        articleQuickHint: 'The DSH Agent will open this candidate in a native conversation and follow its current status.',
        articleExistingWarning: 'A final article already exists for this candidate. Review it before choosing to create another draft.',
        articleExistingView: 'View existing final',
        articleRegenerate: 'Still prepare a new draft',
        articleDraftWarning: 'This candidate has draft or review activity. Check its existing document before creating another draft.',
        outputCheckFailed: 'Could not check for an existing delivery. Reselect this batch before preparing another task.',
        socialQuickReady: 'Prepare card storyboard',
        socialQuickAdd: 'Review and add candidate',
        socialQuickCheck: 'Review qualification',
        socialQuickBlocked: 'Blocked by qualification gate',
        socialQuickHint: 'The DSH Agent will use this exact topic and follow the source, evidence, and approval gates.',
        socialExistingWarning: 'A delivered card set already exists. Submitting again may replace its current HTML and PNG files; review it first.',
        socialExistingView: 'View existing card set',
        socialRegenerate: 'Prepare another card set…',
        selectedTopicLead: 'Selected topic: ',
        selectedTopicType: 'Material type: ',
        selectedTopicState: 'Current state: ',
        selectedTopicQualification: 'Qualification: ',
        selectedTopicInPool: 'Already in the social candidate pool: ',
        eventIdLabel: 'Event ID: ',
        hotspotIdLabel: 'Hotspot ID: ',
        yes: 'yes',
        no: 'no',
        promptSetup: 'Load the jianzi-workbench-setup skill if available; otherwise follow these instructions. Call jianzi_doctor first and use this DSH session’s workspace as projectRoot; never use the DSH profile/plugin directory. If offline and the project contains server.mjs plus scripts/runtime/start-workbench.ps1 or .sh, call jianzi_workbench_start and wait for ready plus a matching fingerprint. If no project exists, stop and ask whether to clone https://github.com/shiker1996/wechat-editroom.git into an empty directory; clone only after confirmation, never overwrite files, then run setup-workbench.cmd or ./setup-workbench.sh with my choices. Do not use --yes or install RSSHub unless I choose it. Once ready, verify RSSHub, sources, account profile, and collectors. Never read or output .env/secrets. If workspace or terminal tools are unavailable, give manual steps. Report each check in one line.',
        promptTopics: 'Load the jianzi-topic-to-article skill and run its topic-discovery stage. Follow the skill order strictly: create or reuse a batch, collect and wait for the job, submit tags, build events and fact cards, run the research stages, then read the rankings. Do not call any Jianzi internal-model tool. Finish with a ranked shortlist that includes batch ID, candidate/hotspot IDs, rationale, risks, and source links. Stop for my topic choice before adding a candidate or drafting an article.',
        promptArticle: 'Load the jianzi-topic-to-article skill and run its article stage. Fetch the candidate source first, read the candidate, account profile, and article-length settings, and show me the editorial angle for confirmation. Then save a draft and read it back. Do not save a final and do not start typesetting until I confirm the generated article.',
        promptTypeset: 'Load the jianzi-typeset-cover skill and run typesetting and cover generation. Read the article documents first: continue only when a user-confirmed final exists. If only a draft exists, stop and explain. Generate the WeChat HTML, submit it for typesetting, generate the cover, and return both preview links. Do not publish to WeChat and do not call Jianzi internal-model typesetting tools.',
        promptSocial: 'Load the jianzi-social-cards skill and run its card stage. Read the social ranking, pick a repository or event candidate, and confirm the material type with me if unclear. Then build the storyboard, let me approve it, lock it, and generate and submit the card visuals. Do not fake a hotspot candidate for a custom topic; use the custom social project flow instead.',
        promptFeedback: 'This card requests a feedback review and adjustment proposal. First check whether this turn includes an attached WeChat export table. If there is no attachment, ask me to upload the table (CSV/TSV or legacy XLS; convert XLSX to CSV/TSV first) and stop. Do not call any content-feedback MCP tools: do not read local feedback or strategy, list or inspect existing proposals, or generate a proposal. Once I provide an attachment, identify its import type from the headers and import the complete data with the content-feedback import MCP tool (use exact Base64 bytes or faithfully extracted CSV/TSV text; never summarize, invent rows, or change values). The import tool also links confirmed matches from this batch to local article bodies/social copy before rebuilding the snapshot. If I attached multiple tables, import all of them before generating a proposal. Check the returned content_links counts and next_action; for article-metric imports, if linking failed or no matching local body/content was linked, stop and report that instead of generating from an older snapshot. An empty content_links result is expected for aggregate-only tables such as user growth or content trends. Only when the requested scope has usable evidence (article body evidence for article; matched social samples for social), read the refreshed feedback and strategy, then call the adjustment-generation MCP tool in this same turn. End with a concise status, evidence limits, proposal ID, and one specific next action. If the proposal is pending, invite me to review its diff or explicitly ask to apply it; never confirm or write it yourself. If headers are unsupported, stop and explain the single best correction. If I explicitly asked only to import without generating a proposal, finish after import and state the recommended generation tool and scope.',
      },
      zh: {
        panelTitle: '见字内容工作台',
        eyebrow: '内容工作台 / DSH AGENT',
        heading: '从热点到可交付文章',
        intro: '先选一个阶段，再让 DSH Agent 通过见字 MCP 工具推进流程。业务记录仍保存在见字，这里只准备任务。',
        tipLabel: '开始之前',
        tipText: '先启动见字工作台 http://127.0.0.1:4317。还没配置过，就从 01 准备开始。',
        statusTitle: '工作台状态',
        statusLoading: '检查中…',
        statusOnline: '已连接',
        statusOffline: '未连接',
        statusRsshub: 'RSSHub',
        statusGithub: 'GitHub',
        statusOk: '正常',
        statusBad: '未就绪',
        refresh: '刷新',
        startProject: '准备启动任务',
        startingProject: '正在准备 DSH 会话…',
        projectReady: '启动任务已放入 DSH 原生会话，检查后按发送即可执行。',
        promptStartProject: '启动当前 DSH 会话所选工作空间对应的见字工作台。先确定本会话当前选中工作空间的本机绝对路径，并将该路径作为 projectRoot 参数传给见字 MCP 工具 jianzi_workbench_start。不要把 DSH profile 或插件目录当成项目路径。等待工具确认服务就绪且工作区指纹匹配；如果无法读取当前工作空间路径，先向我询问，不要猜路径。若启动失败，说明具体错误并停止，不要重试或继续配置。成功后汇报项目路径和服务地址，最后给出一个明确的「下一步」建议：先点「检查环境」；若仍有阻塞，只说最优先的一项修复。除此之外不要执行其他操作。',
        recentBatches: '最近批次（点击填入）',
        noBatches: '还没有批次',
        pickBatch: '填入',
        boardTitle: '选题与执行',
        boardEmpty: '先选一个批次，再查看选题与执行情况。',
        jobsTitle: '批次执行',
        articlePicksTitle: '文章选题',
        socialPicksTitle: '图文选题',
        hotspotsLabel: '热点',
        artifactsLabel: '产物',
        briefLabel: '选题方向或补充要求',
        briefPlaceholder: '例如：小团队怎样使用 AI 工具；重点讲创业者能马上实践的方法。',
        batchLabel: '批次 ID（可选）',
        batchPlaceholder: '留空则先列出最近批次',
        candidateLabel: '候选 ID（可选）',
        candidatePlaceholder: '留空则先列出候选',
        gateLabel: '前置',
        clearLabel: '清除',
        calendarTitle: '内容日历',
        calendarEmpty: '本月暂无内容',
        calendarPrev: '上个月',
        calendarNext: '下个月',
        calendarWeekday0: '一',
        calendarWeekday1: '二',
        calendarWeekday2: '三',
        calendarWeekday3: '四',
        calendarWeekday4: '五',
        calendarWeekday5: '六',
        calendarWeekday6: '日',
        calendarUndated: '未排日期',
        calendarMore: '项更多',
        calendarOpenArticle: '查看文章终稿',
        calendarOpenSocial: '查看已交付图文',
        previewClose: '关闭预览',
        previewDialog: '内容预览',
        typeArticle: '文章',
        typeSocial: '图文',
        typePlan: '计划',
        stage1: '01 / 准备',
        stage1Title: '准备见字工作台',
        stage1Detail: '检查本机服务、RSSHub、账号画像与采集源，缺什么补什么。',
        stage1Action: '检查环境',
        stage1Gate: '工作台在线、采集源已配置',
        stage2: '02 / 发现',
        stage2Title: '采集并研判选题',
        stage2Detail: '创建或复用批次、采集热点、打标、生成事件卡并跑研判管线，最后停下来等你选题。',
        stage2Action: '准备选题研判',
        stage2Gate: '无前置；产出选题排序',
        stage3: '03 / 写作',
        stage3Title: '推进文章成稿',
        stage3Detail: '抓取候选原文、确认编辑角度，保存并回读草稿供你审阅。',
        stage3Action: '准备文章草稿',
        stage3Gate: '需要有已选候选；产出草稿',
        stage4: '04 / 交付',
        stage4Title: '排版与封面',
        stage4Detail: '只接受你确认过的终稿，生成公众号 HTML 和封面，返回两个预览入口。',
        stage4Action: '准备排版交付',
        stage4Gate: '需要有已确认终稿',
        stage5: '05 / 图文',
        stage5Title: '工具图文与事件图文',
        stage5Detail: '把仓库或资讯候选做成一套图文：故事板、锁定、视觉提交。',
        stage5Action: '准备图文',
        stage5Gate: '需要有图文候选并锁定故事板',
        stage6: '06 / 复盘',
        stage6Title: '内容反馈与策略调整',
        stage6Detail: '先上传公众号导出表格；导入并关联本地产物后，再刷新快照和生成可审阅草案。',
        stage6Action: '生成反馈草案',
        stage6Gate: '必须先附上公众号导出表格；没有附件时先请我上传并停止',
        nextStepContract: '结尾必须单独给出「下一步」：只推荐一个现在可执行的动作，并写明我可以直接回复的内容或候选 ID。不要用「还需要什么帮助吗」之类泛泛收尾。若下一步需要我选择或确认，就明确停下等待；不要越过门禁。',
        nextStep1: '环境检查通过时，建议我接着点 02「准备选题研判」；若未通过，只指出优先级最高的一项修复和解法。',
        nextStep2: '列出候选 ID，并基于证据推荐一个。请我直接回复该 ID；我选择前不要加候选或写文章。',
        nextStep3: '展示草稿后，建议我审阅并回复修改意见或明确确认。未经确认不要保存终稿或开始排版。',
        nextStep4: '给出正文和封面预览链接后，建议我检查两项产物；若没有已确认终稿，明确引导回到 03「推进文章成稿」。绝不发布。',
        nextStep5: '给出图文产物入口后，建议我检查分页与配套文案，并说明如何提出具体修改。未经确认不要发布或替换已有产物。',
        nextStep6: '生成后给出待确认草案 ID，并建议我先查看 diff。只有我明确要求应用时才执行；否则保持待确认。',
        note: '按钮会在 DSH 原生会话中准备任务草稿，不会自动发送。检查后发送；任务完成后 Agent 会给出一个具体的下一步建议。',
        working: '正在准备 DSH 会话…',
        failure: '无法准备 DSH 会话。请确认当前 DSH profile 提供 uiWorkspace 客户端服务。',
        sent: '任务草稿已放入 DSH 原生会话，检查后按发送即可开始。',
        briefLead: '补充要求：',
        batchLead: '批次 ID：',
        candidateLead: '候选 ID：',
        articleQuickReady: '准备文章草稿',
        articleQuickContinue: '检查并继续草稿',
        articleQuickCheck: '检查写作条件',
        articleQuickDone: '查看已有交付',
        articleQuickHint: 'DSH Agent 会在原生会话中打开这个候选，并按当前状态推进。',
        articleExistingWarning: '这个候选已有文章终稿。建议先查看现有内容；确认需要重做后再准备新草稿。',
        articleExistingView: '查看已有终稿',
        articleRegenerate: '仍要准备新草稿',
        articleDraftWarning: '这个候选已有草稿或审阅记录。请先检查现有文档，避免重复成稿。',
        outputCheckFailed: '暂时无法检查是否已有交付产物。为避免重复或误覆盖，请重新选择这个批次后再试。',
        socialQuickReady: '准备图文故事板',
        socialQuickAdd: '确认后加入图文候选',
        socialQuickCheck: '复核图文资格',
        socialQuickBlocked: '资格门禁未通过',
        socialQuickHint: 'DSH Agent 会针对当前选题推进，并遵守来源、证据和确认门禁。',
        socialExistingWarning: '这个候选已有已交付图文。再次提交可能替换现有 HTML/PNG；请先查看，并在提交前确认替换。',
        socialExistingView: '查看已生成图文',
        socialRegenerate: '准备重新生成图文…',
        selectedTopicLead: '用户选定的选题：',
        selectedTopicType: '素材类型：',
        selectedTopicState: '当前状态：',
        selectedTopicQualification: '图文资格：',
        selectedTopicInPool: '已在图文候选池：',
        eventIdLabel: '事件 ID：',
        hotspotIdLabel: '热点 ID：',
        yes: '是',
        no: '否',
        promptSetup: '如可用，加载 jianzi-workbench-setup 技能；否则按本提示执行。先调用 jianzi_doctor，并使用当前 DSH 会话工作空间作为 projectRoot；不要用 DSH profile/插件目录。服务未连接且目录含 server.mjs 与 scripts/runtime/start-workbench.ps1 或 .sh 时，调用 jianzi_workbench_start，等待 ready 和 workspaceId 指纹匹配。若没有项目，停止启动并询问是否克隆 https://github.com/shiker1996/wechat-editroom.git 到空目录；确认后才克隆，不覆盖文件，再运行 setup-workbench.cmd 或 ./setup-workbench.sh 并逐项让我选择。不要用 --yes；未经我选择不要安装 RSSHub。就绪后检查 RSSHub、采集源、账号画像和采集器。不要读取或输出 .env/密钥。若无工作区或终端工具，提供手动步骤。每项检查用一句话汇报。',
        promptTopics: '加载 jianzi-topic-to-article 技能，执行选题阶段。严格按技能顺序：创建或复用批次 → 采集并等待任务完成 → 提交打标 → 生成事件与事实卡 → 运行研判阶段 → 读取榜单。不要调用见字内部模型工具。最后给我一份排序清单，包含批次 ID、候选/热点 ID、理由、风险和来源链接；等我选题后再加入候选或写文章。',
        promptArticle: '加载 jianzi-topic-to-article 技能，执行文章阶段。先抓取候选原文，读取候选、账号画像和文章字数设置，把编辑角度给我确认；确认后保存 draft 并回读。未经我确认不要保存 final，也不要开始排版。',
        promptTypeset: '加载 jianzi-typeset-cover 技能，执行排版与封面。先读取文章文档，只有存在我确认过的 final 才继续；只有 draft 就停下来说明。生成公众号 HTML 并提交排版，再生成封面，返回两个预览入口。不要发布到公众号，也不要调用见字内部模型排版工具。',
        promptSocial: '加载 jianzi-social-cards 技能，执行图文阶段。先读图文榜单，选择仓库或事件候选；素材类型不明确时先问我。然后制定故事板、等我确认后锁定、生成并提交图文产物。自选主题不要伪装成热点候选，走自定义图文项目。',
        promptFeedback: '这张卡片表示要复盘并生成调整草案。第一步先检查本轮是否附有公众号导出表格。没有附件时，只回复请我先上传表格（CSV/TSV 或旧版 XLS；XLSX 请先转成 CSV/TSV），然后停止；不要调用任何内容反哺 MCP 工具，不读取本地反馈或策略，不列出/查看已有草案，也不生成草案。收到附件后，先按表头判断导入类型，再用内容反哺导入 MCP 工具导入完整数据（传准确的 Base64 文件字节，或完整提取的 CSV/TSV 文本；不得汇总、编造行或改动数值）。导入工具会把本批次已确认的匹配关联到本地文章正文/图文文案，再刷新快照。如果附有多张表，先全部导入再考虑生成草案。检查返回的 content_links 和 next_action；对于文章表现表，如果有关联失败或没有匹配到本地正文/图文文案，停止并说明具体情况，不得拿旧快照生成草案。用户增长、内容趋势等汇总表没有 content_links 是正常的。所选范围有相应证据时（文章需有已关联正文；图文需有已匹配图文样本），读取刷新后的反馈和策略，然后在同一轮继续调用草案生成 MCP 工具。结尾明确当前状态、证据限制、草案 ID 和一个具体下一步。草案待确认时，提示我查看 diff 或明确要求应用；绝不自行确认或写入。如果表头不受支持，停止并给出最关键的修正建议。如果我明确只要求导入、不要求生成草案，则导入结束后告诉我建议调用的生成工具和范围。',
      },
    };

    const VALUE_LABELS = {
      zh: {
        batchStatus: { pending: '待处理', queued: '排队中', running: '运行中', completed: '已完成', review: '待复核', failed: '失败', interrupted: '已中断', cancelled: '已取消', stopped: '已停止' },
        batchStage: { collecting: '热点采集', collection: '热点采集', synthesis: '研判准备', research: '选题研判', editorial: '选题研判', drafting: '文章成稿', typeset: '排版交付', completed: '已完成' },
        jobType: { github: 'GitHub 采集', wechat: '公众号采集', rsshub: 'RSSHub 采集', paper: '论文采集', 'cover-image': '封面生成', collect: '热点采集', tag: '热点打标', retag: '热点重打标', 'event-cards': '事件卡生成', research: '选题研判', typeset: '文章排版', article: '文章成稿', 'social-card-beautify': '图文美化' },
        jobStatus: { pending: '待开始', queued: '排队中', running: '运行中', success: '成功', completed: '已完成', failed: '失败', interrupted: '已中断', cancelled: '已取消', stopped: '已停止' },
        candidateStatus: { pooled: '已入选题池', scored: '已评分', analyzed: '已研判', locked: '已锁定', drafting: '成稿中', review: '待审阅', preview: '待预览', published: '已发布', completed: '已完成' },
        socialQualification: { auto_eligible: '可自动生成', candidate: '达到候选线', below_threshold: '未达候选线', blocked: '风险拦截', reader_value_blocked: '读者价值不足', outcome_gate_blocked: '结果证据不足', type_gate_blocked: '内容类型不符合', evidence_gate_blocked: '来源证据不足' },
        materialType: { repository: '工具图文', event: '事件图文', custom: '自定义图文' },
      },
      en: {
        batchStatus: { pending: 'Pending', queued: 'Queued', running: 'Running', completed: 'Completed', review: 'Needs review', failed: 'Failed', interrupted: 'Interrupted', cancelled: 'Cancelled', stopped: 'Stopped' },
        batchStage: { collecting: 'Collecting topics', collection: 'Collecting topics', synthesis: 'Preparing research', research: 'Topic research', editorial: 'Topic review', drafting: 'Drafting article', typeset: 'Typesetting', completed: 'Completed' },
        jobType: { github: 'GitHub collection', wechat: 'WeChat collection', rsshub: 'RSSHub collection', paper: 'Paper collection', 'cover-image': 'Cover generation', collect: 'Topic collection', tag: 'Topic tagging', retag: 'Retagging topics', 'event-cards': 'Event cards', research: 'Topic research', typeset: 'Article typesetting', article: 'Article drafting', 'social-card-beautify': 'Card design' },
        jobStatus: { pending: 'Pending', queued: 'Queued', running: 'Running', success: 'Succeeded', completed: 'Completed', failed: 'Failed', interrupted: 'Interrupted', cancelled: 'Cancelled', stopped: 'Stopped' },
        candidateStatus: { pooled: 'In topic pool', scored: 'Scored', analyzed: 'Reviewed', locked: 'Locked', drafting: 'Drafting', review: 'In review', preview: 'Preview ready', published: 'Published', completed: 'Completed' },
        socialQualification: { auto_eligible: 'Ready for automatic generation', candidate: 'Meets candidate threshold', below_threshold: 'Below threshold', blocked: 'Blocked by risk gate', reader_value_blocked: 'Reader value too low', outcome_gate_blocked: 'Outcome evidence missing', type_gate_blocked: 'Content type not eligible', evidence_gate_blocked: 'Source evidence missing' },
        materialType: { repository: 'Tool card', event: 'News card', custom: 'Custom card' },
      },
    };

    function valueLabel(value, family, tr) {
      if (value === null || value === undefined || value === '') return '';
      const language = tr('statusOnline') === COPY.zh.statusOnline ? 'zh' : 'en';
      return VALUE_LABELS[language][family]?.[String(value)] || String(value);
    }

    const STAGES = [
      { id: 'setup', key: '1', promptKey: 'promptSetup', fields: [] },
      { id: 'topics', key: '2', promptKey: 'promptTopics', fields: ['batch', 'brief'] },
      { id: 'article', key: '3', promptKey: 'promptArticle', fields: ['candidate', 'brief'] },
      { id: 'typeset', key: '4', promptKey: 'promptTypeset', fields: ['candidate', 'brief'] },
      { id: 'social', key: '5', promptKey: 'promptSocial', fields: ['batch', 'candidate', 'brief'] },
      { id: 'feedback', key: '6', promptKey: 'promptFeedback', fields: [] },
    ];

    const styles = `
      .jianzi-desk{--desk-bg:#151613;--desk-panel:#1d1e1a;--desk-panel-raised:#242520;--desk-line:rgba(244,239,226,.13);--desk-copy:#f0eee7;--desk-muted:#b8b5aa;--desk-soft:#88877f;--desk-accent:#d7a66f;--desk-accent-ink:#21180f;box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:clamp(22px,3vw,42px);color:var(--desk-copy);font:14px/1.55 'Noto Sans SC','Microsoft YaHei',sans-serif;background:radial-gradient(ellipse at 14% -8%,rgba(181,125,69,.14),transparent 38%),radial-gradient(ellipse at 100% 22%,rgba(92,101,76,.08),transparent 32%),var(--desk-bg)}
      .jianzi-desk *{box-sizing:border-box}.jianzi-desk__inner{width:min(100%,1440px);margin:0 auto}
      .jianzi-desk__head{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,390px);align-items:center;gap:clamp(24px,4vw,64px);padding:8px 0 28px;border-bottom:1px solid var(--desk-line)}
      .jianzi-desk__eyebrow{margin:0 0 10px;color:var(--desk-accent);font-size:11px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
      .jianzi-desk h1{margin:0;font:500 clamp(30px,3vw,42px)/1.18 'Noto Serif SC','Source Han Serif SC','Songti SC',serif;letter-spacing:-.025em}
      .jianzi-desk__intro{margin:12px 0 0;max-width:680px;color:var(--desk-muted);font-size:14px;line-height:1.75}
      .jianzi-desk__mcp{padding:17px 18px;border:1px solid var(--desk-line);border-radius:14px;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.018));box-shadow:0 10px 28px rgba(0,0,0,.12)}
      .jianzi-desk__status-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .jianzi-desk__status-head strong{font-size:14px;font-weight:700}
      .jianzi-desk__refresh{border:1px solid var(--desk-line);background:rgba(255,255,255,.035);color:var(--desk-copy);border-radius:8px;padding:6px 10px;font:600 12px/1.2 'Noto Sans SC','Microsoft YaHei',sans-serif;cursor:pointer;transition:background .16s,border-color .16s}
      .jianzi-desk__refresh:hover{background:rgba(255,255,255,.08);border-color:rgba(215,166,111,.55)}
      .jianzi-desk__refresh:disabled{opacity:.55;cursor:default}
      .jianzi-desk__status-line{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;font-weight:650}
      .jianzi-desk__status-dot{width:8px;height:8px;flex:none;border-radius:50%;background:#d17f68;box-shadow:0 0 0 3px rgba(209,127,104,.13)}
      .jianzi-desk__status-dot--online{background:#8cc39b;box-shadow:0 0 0 3px rgba(140,195,155,.13)}
      .jianzi-desk__status-details{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
      .jianzi-desk__status-pill{padding:4px 8px;border:1px solid var(--desk-line);border-radius:999px;color:var(--desk-muted);font-size:11px;line-height:1.25}
      .jianzi-desk__status-pill b{margin-left:4px;color:var(--desk-copy);font-weight:650}
      .jianzi-desk__hint{display:block;margin-top:10px;color:var(--desk-soft);font-size:12px;line-height:1.5}
      .jianzi-desk__start{display:grid;gap:7px;margin-top:13px;padding-top:12px;border-top:1px solid var(--desk-line)}
      .jianzi-desk__start button{flex:none;border:1px solid rgba(215,166,111,.68);border-radius:8px;background:var(--desk-accent);color:var(--desk-accent-ink);padding:8px 11px;font:700 12px/1.2 'Noto Sans SC','Microsoft YaHei',sans-serif;cursor:pointer}
      .jianzi-desk__start button:disabled{opacity:.55;cursor:wait}
      .jianzi-desk__start-message{margin:0;color:var(--desk-muted);font-size:12px;line-height:1.45;white-space:pre-wrap}
      .jianzi-desk__start-message--ok{color:#9acaa5}.jianzi-desk__start-message--error{color:#e59a86}
      .jianzi-desk__batch-picker{padding:18px 0 2px}
      .jianzi-desk__picker-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:9px}
      .jianzi-desk__picker-head strong{font-size:13px;font-weight:700}.jianzi-desk__picker-head span{color:var(--desk-soft);font-size:12px}
      .jianzi-desk__chips{display:flex;flex-wrap:wrap;gap:8px}
      .jianzi-desk__chip{border:1px solid var(--desk-line);background:rgba(255,255,255,.025);color:var(--desk-muted);border-radius:8px;padding:7px 11px;font:600 12px/1.2 'Noto Sans SC','Microsoft YaHei',sans-serif;cursor:pointer;transition:all .16s}
      .jianzi-desk__chip:hover{border-color:rgba(215,166,111,.55);color:var(--desk-copy);background:rgba(215,166,111,.08)}
      .jianzi-desk__chip--active{border-color:var(--desk-accent);background:rgba(215,166,111,.13);color:#f2c18c}
      .jianzi-desk__selection{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin:14px 0 0;padding:11px 13px;border:1px solid var(--desk-line);border-radius:10px;background:rgba(255,255,255,.025);font-size:12px}
      .jianzi-desk__selection-label{color:var(--desk-soft)}
      .jianzi-desk__selection-item{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:4px 9px;border-radius:7px;border:1px solid rgba(215,166,111,.22);background:rgba(215,166,111,.07);color:var(--desk-copy)}
      .jianzi-desk__clear{border:0;background:transparent;color:var(--desk-muted);font:600 12px/1.3 'Noto Sans SC','Microsoft YaHei',sans-serif;cursor:pointer;padding:4px}
      .jianzi-desk__clear:hover{color:var(--desk-accent)}.jianzi-desk__clear:disabled{opacity:.3;cursor:default}
      .jianzi-desk__flows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin-top:21px}
      .jianzi-desk__flow{position:relative;display:flex;min-width:0;min-height:246px;flex-direction:column;padding:18px;border:1px solid var(--desk-line);border-radius:13px;background:linear-gradient(155deg,rgba(255,255,255,.055),rgba(255,255,255,.018) 72%);box-shadow:0 8px 20px rgba(0,0,0,.10);transition:transform .18s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease}
      .jianzi-desk__flow:hover{transform:translateY(-2px);border-color:rgba(215,166,111,.48);background:linear-gradient(155deg,rgba(215,166,111,.09),rgba(255,255,255,.022) 72%);box-shadow:0 14px 28px rgba(0,0,0,.17)}
      .jianzi-desk__number{display:flex;align-items:center;gap:8px;color:var(--desk-accent);font-size:11px;font-weight:750;letter-spacing:.1em}
      .jianzi-desk__number:after{content:'';height:1px;flex:1;background:linear-gradient(90deg,rgba(215,166,111,.35),transparent)}
      .jianzi-desk__flow h2{margin:20px 0 8px;font-size:17px;line-height:1.35;font-weight:700;letter-spacing:.01em}
      .jianzi-desk__flow p{margin:0 0 14px;color:var(--desk-muted);font-size:13px;line-height:1.65;flex:1}
      .jianzi-desk__gate{display:flex;gap:6px;margin:0 0 14px!important;color:var(--desk-soft)!important;font-size:11px!important;line-height:1.45!important;flex:initial!important}
      .jianzi-desk__gate b{flex:none;font-weight:700;color:var(--desk-accent)}
      .jianzi-desk__flow button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:38px;padding:9px 11px;border:1px solid rgba(215,166,111,.68);border-radius:8px;background:var(--desk-accent);color:var(--desk-accent-ink);font:700 12px/1.3 'Noto Sans SC','Microsoft YaHei',sans-serif;text-align:left;cursor:pointer;transition:background .16s,transform .16s}
      .jianzi-desk__flow button:hover{background:#e4b982;transform:translateY(-1px)}.jianzi-desk__flow button:disabled{cursor:wait;opacity:.55;transform:none}
      .jianzi-desk__board{margin-top:34px;padding-top:23px;border-top:1px solid var(--desk-line)}
      .jianzi-desk__section{margin:0 0 5px;color:var(--desk-copy);font-size:19px;line-height:1.3;font-weight:700;letter-spacing:-.01em}
      .jianzi-desk__board-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin-top:14px}
      .jianzi-desk__board-card{min-width:0;padding:17px 18px;border:1px solid var(--desk-line);border-radius:12px;background:rgba(255,255,255,.025)}
      .jianzi-desk__board-card h3{margin:0 0 7px;font-size:14px;letter-spacing:.01em}
      .jianzi-desk__board-meta{margin:0 0 10px;color:var(--desk-soft);font-size:12px;line-height:1.5}
      .jianzi-desk__rows{list-style:none;margin:0;padding:0;display:grid;gap:5px;max-height:250px;overflow:auto}
      .jianzi-desk__row{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:8px 9px;border-radius:7px;font:inherit;cursor:pointer}
      button.jianzi-desk__row:hover{background:rgba(255,255,255,.06)}
      .jianzi-desk__row[aria-pressed="true"]{background:rgba(215,166,111,.11);box-shadow:inset 2px 0 var(--desk-accent)}
      .jianzi-desk__row-title{color:var(--desk-copy);font-size:12px;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .jianzi-desk__row-meta{color:var(--desk-soft);font-size:11px;line-height:1.35}
      .jianzi-desk__quick-action{display:grid;gap:9px;margin-top:12px;padding:12px;border:1px solid rgba(215,166,111,.28);border-radius:9px;background:rgba(215,166,111,.055)}
      .jianzi-desk__quick-action p{margin:0;color:var(--desk-muted);font-size:11px;line-height:1.5}
      .jianzi-desk__quick-action button{justify-self:start;min-height:33px;padding:7px 11px;border:1px solid rgba(215,166,111,.65);border-radius:7px;background:var(--desk-accent);color:var(--desk-accent-ink);font:700 12px/1.25 'Noto Sans SC','Microsoft YaHei',sans-serif;cursor:pointer}
      .jianzi-desk__quick-action button:hover{background:#e4b982}.jianzi-desk__quick-action button:disabled{opacity:.55;cursor:not-allowed}
      .jianzi-desk__quick-action a{justify-self:start;min-height:33px;padding:7px 11px;border:1px solid rgba(215,166,111,.4);border-radius:7px;background:rgba(255,255,255,.04);color:var(--desk-copy);font:650 12px/1.25 'Noto Sans SC','Microsoft YaHei',sans-serif;text-decoration:none}
      .jianzi-desk__quick-action a:hover{border-color:var(--desk-accent);color:#f2c18c}
      .jianzi-desk__quick-action .jianzi-desk__view-existing{display:inline-flex;align-items:center;justify-self:start;min-height:33px;padding:7px 11px;border:1px solid rgba(215,166,111,.4);border-radius:7px;background:rgba(255,255,255,.04);color:var(--desk-copy);font:650 12px/1.25 'Noto Sans SC','Microsoft YaHei',sans-serif;text-decoration:none}
      .jianzi-desk__quick-action .jianzi-desk__view-existing:hover{border-color:var(--desk-accent);background:rgba(255,255,255,.08);color:#f2c18c}
      .jianzi-desk__preview{position:fixed;inset:40px 0 0;z-index:10000;display:flex;justify-content:flex-end;background:rgba(0,0,0,.58);backdrop-filter:blur(3px)}
      .jianzi-desk__preview-backdrop{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;cursor:default}
      .jianzi-desk__preview-panel{position:relative;z-index:1;display:flex;flex-direction:column;width:min(920px,78vw);height:100%;background:var(--desk-panel);border-left:1px solid var(--desk-line);box-shadow:-20px 0 60px rgba(0,0,0,.35);animation:jianzi-preview-in .18s ease-out}
      .jianzi-desk__preview-head{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:58px;padding:10px 18px;border-bottom:1px solid var(--desk-line)}
      .jianzi-desk__preview-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700}
      .jianzi-desk__preview-close{flex:none;width:34px;height:34px;border:1px solid var(--desk-line);border-radius:8px;background:rgba(255,255,255,.04);color:var(--desk-copy);font-size:22px;line-height:1;cursor:pointer}
      .jianzi-desk__preview-close:hover{border-color:var(--desk-accent);color:#f2c18c}
      .jianzi-desk__preview-frame{display:block;flex:1;width:100%;min-height:0;border:0;background:#fff}
      @keyframes jianzi-preview-in{from{transform:translateX(20px);opacity:.75}to{transform:translateX(0);opacity:1}}
      @media(max-width:760px){.jianzi-desk__preview-panel{width:100vw}}
      @media(prefers-reduced-motion:reduce){.jianzi-desk__preview-panel{animation:none}}
      .jianzi-desk__calendar{margin-top:36px;padding-top:23px;border-top:1px solid var(--desk-line)}
      .jianzi-desk__calendar-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .jianzi-desk__calendar-head .jianzi-desk__section{margin:0}
      .jianzi-desk__calendar-nav{display:flex;align-items:center;gap:9px}
      .jianzi-desk__calendar-nav button{display:grid;place-items:center;width:31px;height:31px;border:1px solid var(--desk-line);background:rgba(255,255,255,.03);color:var(--desk-copy);border-radius:8px;font:600 17px/1 'Noto Sans SC','Microsoft YaHei',sans-serif;cursor:pointer}
      .jianzi-desk__calendar-nav button:hover{border-color:rgba(215,166,111,.55);color:var(--desk-accent)}
      .jianzi-desk__calendar-month{min-width:82px;text-align:center;color:var(--desk-copy);font:650 14px/1.2 'Noto Sans SC','Microsoft YaHei',sans-serif}
      .jianzi-desk__calendar-totals{margin-left:8px;color:var(--desk-soft);font-size:12px}
      .jianzi-desk__calendar-weekdays,.jianzi-desk__calendar-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}
      .jianzi-desk__calendar-weekdays{margin-top:17px;padding:0 3px;color:var(--desk-soft);font-size:11px;font-weight:700;text-align:center}
      .jianzi-desk__calendar-days{margin-top:7px}
      .jianzi-desk__calendar-day{min-width:0;min-height:106px;padding:9px;border:1px solid var(--desk-line);border-radius:9px;background:rgba(255,255,255,.02);transition:border-color .15s,background .15s}
      .jianzi-desk__calendar-day--outside{border-color:transparent;background:rgba(255,255,255,.008);opacity:.38}
      .jianzi-desk__calendar-day--today{border-color:rgba(215,166,111,.68);background:rgba(215,166,111,.065)}
      .jianzi-desk__calendar-date{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;color:var(--desk-muted);font-size:12px;font-weight:650}
      .jianzi-desk__calendar-day--today .jianzi-desk__calendar-date strong{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:var(--desk-accent);color:var(--desk-accent-ink)}
      .jianzi-desk__calendar-count{color:var(--desk-soft);font-size:10px;font-weight:500}
      .jianzi-desk__calendar-events{list-style:none;display:grid;gap:4px;margin:0;padding:0}
      .jianzi-desk__calendar-event{min-width:0;padding:5px 6px;border-left:2px solid #8bb99a;border-radius:3px;background:rgba(139,185,154,.09);color:var(--desk-copy);font-size:10px;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .jianzi-desk__calendar-event--social_cards{border-color:#82a9c9;background:rgba(130,169,201,.09)}
      .jianzi-desk__calendar-event--writing_plan{border-color:var(--desk-accent);background:rgba(215,166,111,.09)}
      .jianzi-desk__calendar-link{display:block;width:100%;padding:0;border:0;background:transparent;color:var(--desk-copy);font:inherit;line-height:inherit;text-align:left;cursor:pointer;transition:color .15s}
      .jianzi-desk__calendar-link:after{content:' ›';color:var(--desk-accent);font-weight:700}
      .jianzi-desk__calendar-link:hover{color:#f2c18c}
      .jianzi-desk__calendar-more{margin:4px 0 0;color:var(--desk-soft);font-size:10px}
      .jianzi-desk__calendar-untimed{margin-top:12px;padding:12px 14px;border:1px dashed var(--desk-line);border-radius:9px}
      .jianzi-desk__calendar-untimed strong{display:block;margin-bottom:8px;color:var(--desk-muted);font-size:12px}
      .jianzi-desk label{display:grid;gap:7px;font-size:13px;font-weight:650;color:var(--desk-muted)}
      .jianzi-desk input,.jianzi-desk textarea{width:100%;border:1px solid var(--desk-line);border-radius:9px;background:var(--desk-panel);color:var(--desk-copy);font:inherit;padding:11px 12px;outline:none}
      .jianzi-desk input:focus,.jianzi-desk textarea:focus{border-color:var(--desk-accent);box-shadow:0 0 0 3px rgba(215,166,111,.17)}
      .jianzi-desk textarea{min-height:46px;max-height:130px;resize:vertical}
      .jianzi-desk__notice{display:flex;align-items:flex-start;gap:11px;margin-top:24px;padding:13px 15px;border:1px solid var(--desk-line);border-radius:9px;background:rgba(255,255,255,.025);color:var(--desk-muted);font-size:12px;line-height:1.55}
      .jianzi-desk__notice-mark{flex:none;width:7px;height:7px;margin-top:6px;border-radius:50%;background:var(--desk-accent)}
      .jianzi-desk__status{margin:12px 0 0;font-size:13px}.jianzi-desk__status--error{color:#e39b8c}.jianzi-desk__status--ok{color:#9bc8a5}
      .jianzi-desk button:focus-visible{outline:2px solid #f2c18c;outline-offset:2px}
      .jianzi-desk a:focus-visible{outline:2px solid #f2c18c;outline-offset:2px}
      @media(max-width:1380px){.jianzi-desk__flows{grid-template-columns:repeat(3,minmax(0,1fr))}.jianzi-desk__flow{min-height:230px}}
      @media(max-width:900px){.jianzi-desk__head{grid-template-columns:1fr;gap:20px}.jianzi-desk__mcp{max-width:none}.jianzi-desk__board-grid{grid-template-columns:1fr 1fr}}
      @media(max-width:760px){.jianzi-desk{padding:20px 16px}.jianzi-desk__flows{grid-template-columns:1fr 1fr;gap:10px}.jianzi-desk__flow{min-height:220px;padding:15px}.jianzi-desk__flow:last-child{grid-column:1/-1;min-height:160px}.jianzi-desk__flow h2{font-size:15px}.jianzi-desk__board-grid{grid-template-columns:1fr}.jianzi-desk__calendar-days,.jianzi-desk__calendar-weekdays{gap:3px}.jianzi-desk__calendar-day{min-height:80px;padding:5px;border-radius:6px}.jianzi-desk__calendar-event{padding:3px 4px;font-size:9px}.jianzi-desk__calendar-count{display:none}}
      @media(max-width:520px){.jianzi-desk__calendar-weekdays{display:none}.jianzi-desk__calendar-days{grid-template-columns:1fr;gap:5px}.jianzi-desk__calendar-day{display:flex;align-items:flex-start;gap:12px;min-height:0;padding:8px 10px}.jianzi-desk__calendar-day--outside,.jianzi-desk__calendar-day--empty{display:none}.jianzi-desk__calendar-date{flex:none;min-width:27px;margin:0;padding-top:2px}.jianzi-desk__calendar-day--today .jianzi-desk__calendar-date strong{width:24px;height:24px}.jianzi-desk__calendar-events{flex:1}.jianzi-desk__calendar-event{font-size:11px}}
      @media(max-width:420px){.jianzi-desk__flows{grid-template-columns:1fr}.jianzi-desk__flow,.jianzi-desk__flow:last-child{grid-column:auto;min-height:0}.jianzi-desk__flow h2{margin-top:14px}.jianzi-desk__flow p{margin-bottom:10px}}
      @media(prefers-reduced-motion:reduce){.jianzi-desk__flow,.jianzi-desk__chip,.jianzi-desk__refresh{transition:none}.jianzi-desk__flow:hover{transform:none}}
    `;

    const trFactory = (ctx) => {
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
      const fallback = (key) => COPY.zh[key] ?? COPY.en[key] ?? key;
      let bound;
      try {
        if (locale && typeof locale.register === 'function') locale.register(NS, COPY);
        if (locale && typeof locale.bind === 'function') bound = locale.bind(NS);
      } catch {
        bound = undefined;
      }
      if (typeof bound === 'function') {
        // The bound translator returns the key itself when the dictionary lacks
        // it; fall back to the built-in copy so a missing entry never reaches UI.
        return (key) => {
          const value = bound(key);
          return typeof value === 'string' && value !== key ? value : fallback(key);
        };
      }
      return (key) => {
        try {
          if (locale && typeof locale.resolveText === 'function') {
            const value = locale.resolveText({ zh: COPY.zh[key], en: COPY.en[key] });
            if (typeof value === 'string' && value.length > 0) return value;
          }
        } catch {
          // Fall through to the built-in copy.
        }
        return fallback(key);
      };
    };

    const currentMonth = () => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    };

    function Glyph({ size = 16 }) {      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } }, [
        h('path', { key: 'spark', d: 'M12 2.8 14.5 9.5 21.2 12 14.5 14.5 12 21.2 9.5 14.5 2.8 12 9.5 9.5 12 2.8Z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('circle', { key: 'dot', cx: 12, cy: 12, r: 1.7, fill: '#c99a62' }),
      ]);
    }

    function buildPrompt(stage, values, tr) {
      const base = tr(stage.promptKey);
      const extra = [];
      if (stage.fields.includes('batch') && values.batch.trim()) extra.push(`${tr('batchLead')}${values.batch.trim()}`);
      if (stage.fields.includes('candidate') && values.candidate.trim()) extra.push(`${tr('candidateLead')}${values.candidate.trim()}`);
      if (values.context) extra.push(values.context);
      return [base, ...extra, tr('nextStepContract'), tr(`nextStep${stage.key}`)].join('\n\n');
    }

    function Panel({ tr, startTask }) {
      const [batch, setBatch] = React.useState('');
      const [candidate, setCandidate] = React.useState('');
      const [selectedSocialKey, setSelectedSocialKey] = React.useState('');
      const [pending, setPending] = React.useState('');
      const [status, setStatus] = React.useState(null);
      const [health, setHealth] = React.useState(null);
      const [batches, setBatches] = React.useState([]);
      const [candidates, setCandidates] = React.useState([]);
      const [social, setSocial] = React.useState([]);
      const [socialCandidates, setSocialCandidates] = React.useState([]);
      const [batchOutputs, setBatchOutputs] = React.useState([]);
      const [outputsChecked, setOutputsChecked] = React.useState(false);
      const [jobs, setJobs] = React.useState([]);
      const [month, setMonth] = React.useState(currentMonth());
      const [calendar, setCalendar] = React.useState([]);
      const [preview, setPreview] = React.useState(null);
      const [loadingCalendar, setLoadingCalendar] = React.useState(true);
      const [loadingStatus, setLoadingStatus] = React.useState(true);
      const [startingProject, setStartingProject] = React.useState(false);
      const [startupMessage, setStartupMessage] = React.useState(null);

      const openPreview = (title, url) => setPreview({ title, url });

      React.useEffect(() => {
        if (!preview) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setPreview(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [preview]);

      const readJson = async (url) => {
        try {
          const response = await fetch(url, { headers: { accept: 'application/json' } });
          if (!response.ok) return null;
          const payload = await response.json();
          return payload && payload.ok ? payload.data : null;
        } catch {
          return null;
        }
      };

      const loadStatus = async () => {
        setLoadingStatus(true);
        const [doctor, list] = await Promise.all([
          readJson('/jianzi/status'),
          readJson('/jianzi/batches?limit=8'),
        ]);
        setHealth(doctor || null);
        setBatches(Array.isArray(list) ? list : []);
        setLoadingStatus(false);
      };

      const startProject = async () => {
        if (startingProject) return;
        setStartingProject(true);
        setStartupMessage(null);
        try {
          await startTask(tr('promptStartProject'));
          setStartupMessage({ kind: 'ok', text: tr('projectReady') });
        } catch (error) {
          setStartupMessage({ kind: 'error', text: error?.message || tr('failure') });
        } finally {
          setStartingProject(false);
        }
      };

      React.useEffect(() => {
        void loadStatus();
      }, []);

      React.useEffect(() => {
        let alive = true;
        setLoadingCalendar(true);
        void (async () => {
          const list = await readJson(`/jianzi/calendar?month=${encodeURIComponent(month)}`);
          if (!alive) return;
          setCalendar(Array.isArray(list) ? list : []);
          setLoadingCalendar(false);
        })();
        return () => {
          alive = false;
        };
      }, [month]);

      React.useEffect(() => {
        const batchId = batch.trim();
        setCandidate('');
        setSelectedSocialKey('');
        setOutputsChecked(false);
        if (!batchId) {
          setCandidates([]);
          setSocial([]);
          setSocialCandidates([]);
          setBatchOutputs([]);
          setJobs([]);
          return undefined;
        }
        let alive = true;
        void (async () => {
          const encoded = encodeURIComponent(batchId);
          const [candidateList, socialList, jobList, socialCandidateList, outputList] = await Promise.all([
            readJson(`/jianzi/candidates?batch=${encoded}`),
            readJson(`/jianzi/social-ranking?batch=${encoded}`),
            readJson(`/jianzi/jobs?batch=${encoded}&limit=8`),
            readJson(`/jianzi/candidates?batch=${encoded}&track=social_cards`),
            readJson(`/jianzi/calendar?batch=${encoded}`),
          ]);
          if (!alive) return;
          setCandidates(Array.isArray(candidateList) ? candidateList : []);
          setSocial(Array.isArray(socialList) ? socialList : []);
          setSocialCandidates(Array.isArray(socialCandidateList) ? socialCandidateList : []);
          setBatchOutputs(Array.isArray(outputList) ? outputList : []);
          setOutputsChecked(Array.isArray(outputList));
          setJobs(Array.isArray(jobList) ? jobList : []);
        })();
        return () => {
          alive = false;
        };
      }, [batch]);

      const run = async (stage, context = '') => {
        if (pending) return;
        setPending(stage.id);
        setStatus(null);
        try {
          await startTask(buildPrompt(stage, { batch, candidate: stage.id === 'social' ? '' : candidate, context }, tr));
          setStatus({ kind: 'ok', text: tr('sent') });
        } catch (error) {
          setStatus({ kind: 'error', text: error instanceof Error && error.message ? error.message : tr('failure') });
        } finally {
          setPending('');
        }
      };

      const cards = STAGES.map((stage) => ({
        id: stage.id,
        number: tr(`stage${stage.key}`),
        title: tr(`stage${stage.key}Title`),
        detail: tr(`stage${stage.key}Detail`),
        action: tr(`stage${stage.key}Action`),
        gate: tr(`stage${stage.key}Gate`),
      }));

      const currentBatch = batches.find((item) => item.id === batch.trim());
      const articlePicks = [...candidates]
        .sort((a, b) => (b.f_score || 0) - (a.f_score || 0))
        .slice(0, 6);
      const socialPicks = social
        .filter((item) => item.inPool || item.eligible)
        .sort((a, b) => (b.gSocial || 0) - (a.gSocial || 0))
        .slice(0, 6);
      const selectedArticle = articlePicks.find((item) => String(item.id) === candidate.trim());
      const socialKey = (item) => String(item.eventId || item.hotspotId || item.title || '');
      const selectedSocial = socialPicks.find((item) => socialKey(item) === selectedSocialKey);
      const existingArticleOutput = selectedArticle && batchOutputs.find((item) => item.content_type === 'article'
        && String(item.batch_id) === batch.trim() && Number(item.candidate_row_id) === Number(selectedArticle.id));
      const selectedSocialCandidate = selectedSocial && socialCandidates.find((item) => String(item.hotspot_id) === String(selectedSocial.hotspotId)
        || (Array.isArray(item.hotspot_ids) && item.hotspot_ids.map(String).includes(String(selectedSocial.hotspotId))));
      const existingSocialOutput = selectedSocialCandidate && batchOutputs.find((item) => item.content_type === 'social_cards'
        && String(item.batch_id) === batch.trim() && Number(item.candidate_row_id) === Number(selectedSocialCandidate.id));
      const articleQuickAction = (item) => {
        if (['drafting', 'review', 'preview'].includes(String(item?.status || ''))) return tr('articleQuickContinue');
        if (['published', 'completed'].includes(String(item?.status || ''))) return tr('articleQuickDone');
        if (item?.status === 'locked') return tr('articleQuickReady');
        return tr('articleQuickCheck');
      };
      const articleQuickContext = (item, regenerate = false) => {
        const state = valueLabel(item?.status, 'candidateStatus', tr) || tr('statusLoading');
        const existing = batchOutputs.find((entry) => entry.content_type === 'article'
          && String(entry.batch_id) === batch.trim() && Number(entry.candidate_row_id) === Number(item?.id));
        if (regenerate && existing) {
          return `${tr('selectedTopicLead')}${item.hotspot_title || ''}\n${tr('candidateLead')}${item.id} · ${item.candidate_id || item.id}\n该候选已有终稿：${existing.title || existing.hotspot_title || ''}。用户已明确要求重新成稿；请保留现有终稿，按文章技能抓取来源并确认编辑角度后，另存新 draft，不要覆盖或替换 final。`;
        }
        if (['drafting', 'review', 'preview'].includes(String(item?.status || ''))) {
          return `${tr('selectedTopicLead')}${item.hotspot_title || ''}\n${tr('candidateLead')}${item.id} · ${item.candidate_id || item.id}\n${tr('selectedTopicState')}${state}\n先按技能要求抓取并核对来源，再调用 jianzi_article_documents 检查该候选已有文章。若已有 draft，先回读交我审阅，不要重复生成；若没有，再按文章技能推进。`;
        }
        if (['published', 'completed'].includes(String(item?.status || ''))) {
          return `${tr('selectedTopicLead')}${item.hotspot_title || ''}\n${tr('candidateLead')}${item.id} · ${item.candidate_id || item.id}\n${tr('selectedTopicState')}${state}\n先查询该候选的现有文章文档并汇报当前交付状态；不要重复创建文章或改变已完成状态。`;
        }
        return `${tr('selectedTopicLead')}${item.hotspot_title || ''}\n${tr('candidateLead')}${item.id} · ${item.candidate_id || item.id}\n${tr('selectedTopicState')}${state}\n严格按文章技能检查来源、事实和锁题门禁；需要编辑角度确认时先停下来等我确认。`;
      };
      const socialQuickAction = (item) => {
        if (String(item?.qualificationStatus || '').endsWith('_blocked') || item?.qualificationStatus === 'blocked') return tr('socialQuickBlocked');
        if (item?.inPool && item?.eligible) return tr('socialQuickReady');
        if (item?.inPool) return tr('socialQuickCheck');
        return tr('socialQuickAdd');
      };
      const socialQuickContext = (item, regenerate = false) => {
        const alreadyInPool = Boolean(item?.inPool);
        const lines = [
          `${tr('selectedTopicLead')}${item?.title || ''}`,
          `${tr('selectedTopicType')}${valueLabel(item?.materialType, 'materialType', tr) || item?.materialType || ''}`,
          `${tr('eventIdLabel')}${item?.eventId || '\u2014'} · ${tr('hotspotIdLabel')}${item?.hotspotId || '\u2014'}`,
          `${tr('selectedTopicQualification')}${valueLabel(item?.qualificationStatus, 'socialQualification', tr) || ''}${item?.qualificationReason ? ` · ${item.qualificationReason}` : ''}`,
          `${tr('selectedTopicInPool')}${alreadyInPool ? tr('yes') : tr('no')}`,
        ];
        if (String(item?.qualificationStatus || '').endsWith('_blocked') || item?.qualificationStatus === 'blocked') {
          lines.push('当前资格门禁未通过。只解释原因并列出补充证据的可能路径；不要加入候选池、锁定或生成图文。');
        } else if (alreadyInPool) {
          lines.push('只处理这个已选候选，不要替换成榜单中的其他选题；先抓取来源并完成图文技能规定的事实、故事板与用户确认门禁。');
        } else {
          lines.push('这是用户明确点选但尚未入图文候选池的选题。先展示素材类型、资格理由和来源情况，等待我明确同意后才调用 jianzi_candidate_add；不得绕过来源抓取、事实核验、故事板确认与锁定门禁。');
        }
        if (regenerate && existingSocialOutput) {
          lines.push(`该候选已有已交付图文产物 ID ${existingSocialOutput.id}。用户已明确要求准备重做任务，但现有视觉提交会写回固定产物路径并可能替换旧 HTML/PNG。继续遵守故事板确认门禁；在调用 jianzi_card_visual_submit 前，必须向我明确说明会替换现有图文并再次取得确认。未得到这次确认时停止在故事板/方案，不得提交覆盖。`);
        }
        return lines.join('\n');
      };
      const recentJobs = jobs.slice(0, 6);

      const shiftMonth = (delta) => {
        const [year, monthIndex] = month.split('-').map(Number);
        const next = new Date(year, monthIndex - 1 + delta, 1);
        setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
      };
      const typeLabel = (type) => (type === 'social_cards' ? tr('typeSocial') : type === 'writing_plan' ? tr('typePlan') : tr('typeArticle'));
      const calendarEvent = (item) => {
        const content = `${typeLabel(item.content_type)} · ${item.title || ''}`;
        const title = `${item.content_type === 'social_cards' ? tr('calendarOpenSocial') : tr('calendarOpenArticle')} · ${item.title || ''}`;
        const className = `jianzi-desk__calendar-event jianzi-desk__calendar-event--${item.content_type || 'article'}`;
        if ((item.content_type === 'article' || item.content_type === 'social_cards') && typeof item.previewUrl === 'string' && item.previewUrl) {
          return h('li', {
            className,
            key: `${item.content_type}-${item.id}`,
            title,
          }, h('button', {
            type: 'button',
            className: 'jianzi-desk__calendar-link',
            'aria-label': title,
            onClick: () => openPreview(title, item.previewUrl),
          }, content));
        }
        return h('li', {
          className,
          key: `${item.content_type}-${item.id}`,
          title: item.content_type === 'writing_plan' ? `${typeLabel(item.content_type)} · ${item.title || ''}` : title,
        }, content);
      };
      const calendarByDate = calendar.reduce((acc, item) => {
        const date = item.batch_date || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return acc;
        (acc[date] = acc[date] || []).push(item);
        return acc;
      }, {});
      const undatedCalendar = calendar.filter((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.batch_date || ''));
      const [calendarYear, calendarMonthNumber] = month.split('-').map(Number);
      const monthStart = new Date(calendarYear, calendarMonthNumber - 1, 1);
      const leadingDays = (monthStart.getDay() + 6) % 7;
      const daysInMonth = new Date(calendarYear, calendarMonthNumber, 0).getDate();
      const calendarCellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const calendarCells = Array.from({ length: calendarCellCount }, (_, index) => {
        const day = index - leadingDays + 1;
        const date = new Date(calendarYear, calendarMonthNumber - 1, day);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return { day: date.getDate(), key, inMonth: day > 0 && day <= daysInMonth, isToday: key === todayKey, items: calendarByDate[key] || [] };
      });
      const articleCount = calendar.filter((item) => item.content_type === 'article').length;
      const socialCount = calendar.filter((item) => item.content_type === 'social_cards').length;
      const planCount = calendar.filter((item) => item.content_type === 'writing_plan').length;
      const batchSummary = currentBatch ? [
        valueLabel(currentBatch.status, 'batchStatus', tr),
        valueLabel(currentBatch.stage, 'batchStage', tr),
        `${tr('hotspotsLabel')} ${currentBatch.hotspot_count ?? 0}`,
        `${tr('artifactsLabel')} ${currentBatch.artifact_count ?? 0}`,
      ].filter(Boolean).join(' · ') : '';

      return h(React.Fragment, null,
        h('style', null, styles),
        h('section', { className: 'jianzi-desk', 'data-jianzi-workbench': '' },
          h('div', { className: 'jianzi-desk__inner' },
            h('header', { className: 'jianzi-desk__head' },
              h('div', null,
                h('p', { className: 'jianzi-desk__eyebrow' }, tr('eyebrow')),
                h('h1', null, tr('heading')),
                h('p', { className: 'jianzi-desk__intro' }, tr('intro')),
              ),
              h('aside', { className: 'jianzi-desk__mcp' },
                h('div', { className: 'jianzi-desk__status-head' },
                  h('strong', null, tr('statusTitle')),
                  h('button', {
                    type: 'button',
                    className: 'jianzi-desk__refresh',
                    onClick: () => void loadStatus(),
                    disabled: loadingStatus,
                  }, loadingStatus ? tr('statusLoading') : tr('refresh')),
                ),
                h('div', { className: 'jianzi-desk__status-line' },
                  h('span', { className: health ? 'jianzi-desk__status-dot jianzi-desk__status-dot--online' : 'jianzi-desk__status-dot', 'aria-hidden': true }),
                  h('span', null, health ? tr('statusOnline') : tr('statusOffline')),
                ),
                h('div', { className: 'jianzi-desk__status-details' },
                  [['RSSHub', Boolean(health && health.health && health.health.rsshub && health.health.rsshub.ok)], ['GitHub', Boolean(health && health.health && health.health.github && health.health.github.authenticated)]].map(([name, ready]) => h('span', { className: 'jianzi-desk__status-pill', key: name }, name, h('b', null, health ? (ready ? tr('statusOk') : tr('statusBad')) : '—'))),
                ),
                !health && !loadingStatus ? h('div', { className: 'jianzi-desk__start' },
                  h('button', { type: 'button', onClick: () => void startProject(), disabled: startingProject }, startingProject ? tr('startingProject') : tr('startProject')),
                  startupMessage ? h('p', { className: `jianzi-desk__start-message jianzi-desk__start-message--${startupMessage.kind}`, role: 'status' }, startupMessage.text) : null,
                ) : null,
                h('span', { className: 'jianzi-desk__hint' }, tr('tipText')),
              ),
            ),
            h('div', { className: 'jianzi-desk__flows' }, cards.map((card) => h('article', { className: 'jianzi-desk__flow', key: card.id },
              h('span', { className: 'jianzi-desk__number' }, card.number),
              h('h2', null, card.title),
              h('p', null, card.detail),
              h('p', { className: 'jianzi-desk__gate' }, h('b', null, tr('gateLabel')), h('span', null, card.gate)),
              h('button', { type: 'button', disabled: Boolean(pending), onClick: () => run(STAGES.find((stage) => stage.id === card.id)) },
                h('span', null, pending === card.id ? tr('working') : card.action),
                h('span', { 'aria-hidden': true }, '\u2192'),
              ),
            ))),
            h('section', { className: 'jianzi-desk__board' },
              h('h2', { className: 'jianzi-desk__section' }, tr('boardTitle')),
              h('section', { className: 'jianzi-desk__batch-picker', 'aria-label': tr('recentBatches') },
                h('div', { className: 'jianzi-desk__picker-head' },
                  h('strong', null, tr('recentBatches')),
                  h('span', null, batches.length ? `${batches.length} / 8` : tr('noBatches')),
                ),
                batches.length
                  ? h('div', { className: 'jianzi-desk__chips' }, batches.slice(0, 6).map((item) => h('button', {
                    key: item.id,
                    type: 'button',
                    className: item.id === batch.trim() ? 'jianzi-desk__chip jianzi-desk__chip--active' : 'jianzi-desk__chip',
                    title: `${item.title || item.id} · ${item.status || ''}`,
                    'aria-pressed': item.id === batch.trim(),
                    onClick: () => setBatch(item.id === batch.trim() ? '' : item.id),
                  }, `${item.batch_date || item.id}${item.status ? ` · ${valueLabel(item.status, 'batchStatus', tr)}` : ''}`)))
                  : h('p', { className: 'jianzi-desk__hint' }, tr('noBatches')),
              ),
              h('div', { className: 'jianzi-desk__selection' },
                h('span', { className: 'jianzi-desk__selection-label' }, tr('batchLead')),
                h('span', { className: 'jianzi-desk__selection-item' }, currentBatch ? (currentBatch.title || currentBatch.batch_date || batch.trim()) : (batch.trim() || '\u2014')),
                h('button', { type: 'button', className: 'jianzi-desk__clear', onClick: () => setBatch(''), disabled: !batch.trim() }, tr('clearLabel')),
                h('span', { className: 'jianzi-desk__selection-label' }, tr('candidateLead')),
                h('span', { className: 'jianzi-desk__selection-item' }, candidate.trim() || '\u2014'),
                h('button', { type: 'button', className: 'jianzi-desk__clear', onClick: () => setCandidate(''), disabled: !candidate.trim() }, tr('clearLabel')),
              ),
              (currentBatch || articlePicks.length || socialPicks.length || recentJobs.length)
                ? h('div', { className: 'jianzi-desk__board-grid' },
                  h('article', { className: 'jianzi-desk__board-card' },
                    h('h3', null, tr('jobsTitle')),
                    currentBatch
                      ? h('p', { className: 'jianzi-desk__board-meta' }, batchSummary)
                      : null,
                    recentJobs.length
                      ? h('ul', { className: 'jianzi-desk__rows' }, recentJobs.map((job) => h('li', { key: job.id },
                        h('span', { className: 'jianzi-desk__row-title' }, valueLabel(job.type || job.provider || job.run_kind, 'jobType', tr)),
                        h('span', { className: 'jianzi-desk__row-meta' }, `${valueLabel(job.status, 'jobStatus', tr)}${job.progress ? ` · ${job.progress}` : ''}`),
                      )))
                      : h('p', { className: 'jianzi-desk__hint' }, tr('boardEmpty')),
                  ),
                  h('article', { className: 'jianzi-desk__board-card' },
                    h('h3', null, tr('articlePicksTitle')),
                    articlePicks.length
                      ? h('ul', { className: 'jianzi-desk__rows' }, articlePicks.map((item) => h('li', { key: item.id },
                        h('button', {
                          type: 'button',
                          className: 'jianzi-desk__row',
                          'aria-pressed': candidate === String(item.id),
                          onClick: () => {
                            setSelectedSocialKey('');
                            setCandidate(candidate === String(item.id) ? '' : String(item.id));
                          },
                          'aria-expanded': candidate === String(item.id),
                          'aria-controls': 'jianzi-article-quick-action',
                        },
                        h('span', { className: 'jianzi-desk__row-title' }, `${item.candidate_id || item.id} · ${item.hotspot_title || ''}`),
                        h('span', { className: 'jianzi-desk__row-meta' }, `${Math.round(item.f_score || 0)} · ${valueLabel(item.status, 'candidateStatus', tr)}`),
                        ),
                      )))
                      : h('p', { className: 'jianzi-desk__hint' }, tr('boardEmpty')),
                    selectedArticle
                      ? h('div', { id: 'jianzi-article-quick-action', className: 'jianzi-desk__quick-action' },
                        h('p', null, !outputsChecked
                          ? tr('outputCheckFailed')
                          : existingArticleOutput
                          ? tr('articleExistingWarning')
                          : ['drafting', 'review', 'preview'].includes(String(selectedArticle.status || ''))
                            ? tr('articleDraftWarning')
                            : `${articleQuickAction(selectedArticle)} · ${tr('articleQuickHint')}`),
                        existingArticleOutput?.previewUrl
                          ? h('button', {
                            type: 'button',
                            className: 'jianzi-desk__view-existing',
                            onClick: () => openPreview(`${tr('calendarOpenArticle')} · ${existingArticleOutput.title || selectedArticle.hotspot_title || ''}`, existingArticleOutput.previewUrl),
                          }, tr('articleExistingView'))
                          : null,
                        h('button', {
                          type: 'button',
                          disabled: Boolean(pending) || !outputsChecked,
                          onClick: () => run(STAGES.find((stage) => stage.id === 'article'), articleQuickContext(selectedArticle, Boolean(existingArticleOutput))),
                        }, pending === 'article' ? tr('working') : existingArticleOutput ? tr('articleRegenerate') : articleQuickAction(selectedArticle)),
                      )
                      : null,
                  ),
                  h('article', { className: 'jianzi-desk__board-card' },
                    h('h3', null, tr('socialPicksTitle')),
                    socialPicks.length
                      ? h('ul', { className: 'jianzi-desk__rows' }, socialPicks.map((item) => h('li', { key: item.eventId || item.hotspotId },
                        h('button', {
                          type: 'button',
                          className: 'jianzi-desk__row',
                          'aria-pressed': selectedSocialKey === socialKey(item),
                          'aria-expanded': selectedSocialKey === socialKey(item),
                          'aria-controls': 'jianzi-social-quick-action',
                          onClick: () => {
                            setCandidate('');
                            setSelectedSocialKey(selectedSocialKey === socialKey(item) ? '' : socialKey(item));
                          },
                        },
                          h('span', { className: 'jianzi-desk__row-title' }, `${item.label || valueLabel(item.materialType, 'materialType', tr)} · ${item.title || ''}`),
                          h('span', { className: 'jianzi-desk__row-meta' }, `${Math.round(item.gSocial || 0)} · ${valueLabel(item.qualificationStatus, 'socialQualification', tr)}`),
                        ),
                      )))
                      : h('p', { className: 'jianzi-desk__hint' }, tr('boardEmpty')),
                    selectedSocial
                      ? h('div', { id: 'jianzi-social-quick-action', className: 'jianzi-desk__quick-action' },
                        h('p', null, !outputsChecked ? tr('outputCheckFailed') : existingSocialOutput ? tr('socialExistingWarning') : `${socialQuickAction(selectedSocial)} · ${tr('socialQuickHint')}`),
                        h('p', null, `${tr('selectedTopicQualification')}${valueLabel(selectedSocial.qualificationStatus, 'socialQualification', tr)}${selectedSocial.qualificationReason ? ` · ${selectedSocial.qualificationReason}` : ''} · ${tr('selectedTopicInPool')}${selectedSocial.inPool ? tr('yes') : tr('no')}`),
                        existingSocialOutput?.previewUrl
                          ? h('button', {
                            type: 'button',
                            className: 'jianzi-desk__view-existing',
                            onClick: () => openPreview(`${tr('calendarOpenSocial')} · ${existingSocialOutput.title || selectedSocial.title || ''}`, existingSocialOutput.previewUrl),
                          }, tr('socialExistingView'))
                          : null,
                        h('button', {
                          type: 'button',
                          disabled: Boolean(pending) || !outputsChecked || socialQuickAction(selectedSocial) === tr('socialQuickBlocked'),
                          onClick: () => run(STAGES.find((stage) => stage.id === 'social'), socialQuickContext(selectedSocial, Boolean(existingSocialOutput))),
                        }, pending === 'social' ? tr('working') : existingSocialOutput ? tr('socialRegenerate') : socialQuickAction(selectedSocial)),
                      )
                      : null,
                  ),
                )
                : h('p', { className: 'jianzi-desk__hint' }, tr('boardEmpty')),
            ),
            h('section', { className: 'jianzi-desk__calendar' },
              h('div', { className: 'jianzi-desk__calendar-head' },
                h('h2', { className: 'jianzi-desk__section' }, tr('calendarTitle')),
                h('div', { className: 'jianzi-desk__calendar-nav' },
                  h('button', { type: 'button', onClick: () => shiftMonth(-1), 'aria-label': tr('calendarPrev') }, '\u2039'),
                  h('span', { className: 'jianzi-desk__calendar-month' }, month),
                  h('button', { type: 'button', onClick: () => shiftMonth(1), 'aria-label': tr('calendarNext') }, '\u203a'),
                  h('span', { className: 'jianzi-desk__calendar-totals' }, loadingCalendar ? tr('statusLoading') : `${articleCount} ${tr('typeArticle')} \u00b7 ${socialCount} ${tr('typeSocial')} \u00b7 ${planCount} ${tr('typePlan')}`),
                ),
              ),
              h('div', { className: 'jianzi-desk__calendar-weekdays', 'aria-hidden': true }, Array.from({ length: 7 }, (_, index) => h('span', { key: index }, tr(`calendarWeekday${index}`)))),
              h('div', { className: 'jianzi-desk__calendar-days' }, calendarCells.map((cell) => h('article', {
                className: `jianzi-desk__calendar-day${cell.inMonth ? '' : ' jianzi-desk__calendar-day--outside'}${cell.isToday ? ' jianzi-desk__calendar-day--today' : ''}${cell.items.length ? '' : ' jianzi-desk__calendar-day--empty'}`,
                key: cell.key,
                'aria-label': cell.inMonth ? cell.key : undefined,
              },
              h('header', { className: 'jianzi-desk__calendar-date' },
                h('strong', null, String(cell.day)),
                cell.items.length ? h('span', { className: 'jianzi-desk__calendar-count' }, String(cell.items.length)) : null,
              ),
              cell.items.length ? h('ul', { className: 'jianzi-desk__calendar-events' }, cell.items.slice(0, 2).map(calendarEvent)) : null,
              cell.items.length > 2 ? h('p', { className: 'jianzi-desk__calendar-more' }, `+${cell.items.length - 2} ${tr('calendarMore')}`) : null,
              ))),
              undatedCalendar.length ? h('div', { className: 'jianzi-desk__calendar-untimed' },
                h('strong', null, `${tr('calendarUndated')} · ${undatedCalendar.length}`),
                h('ul', { className: 'jianzi-desk__calendar-events' }, undatedCalendar.slice(0, 5).map(calendarEvent)),
              ) : null,
              !loadingCalendar && calendar.length === 0 ? h('p', { className: 'jianzi-desk__hint' }, tr('calendarEmpty')) : null,
            ),
            h('div', { className: 'jianzi-desk__notice' }, h('span', { className: 'jianzi-desk__notice-mark', 'aria-hidden': true }), h('span', null, tr('note'))),
            status ? h('p', { className: `jianzi-desk__status jianzi-desk__status--${status.kind}`, role: status.kind === 'error' ? 'alert' : 'status' }, status.text) : null,
          ),
          preview
            ? h('div', { className: 'jianzi-desk__preview', role: 'presentation' },
              h('button', {
                type: 'button',
                className: 'jianzi-desk__preview-backdrop',
                'aria-label': tr('previewClose'),
                onClick: () => setPreview(null),
                tabIndex: -1,
              }),
              h('aside', { className: 'jianzi-desk__preview-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': preview.title || tr('previewDialog') },
                h('header', { className: 'jianzi-desk__preview-head' },
                  h('h2', { className: 'jianzi-desk__preview-title' }, preview.title || tr('previewDialog')),
                  h('button', { type: 'button', className: 'jianzi-desk__preview-close', onClick: () => setPreview(null), 'aria-label': tr('previewClose') }, '\u00d7'),
                ),
                h('iframe', { className: 'jianzi-desk__preview-frame', src: preview.url, title: preview.title || tr('previewDialog') }),
              ),
            )
            : null,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const tr = trFactory(ctx);
        const label = tr('panelTitle');
        const startTask = async (prompt) => {
          let uiWorkspace;
          try {
            uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace;
          } catch {
            uiWorkspace = undefined;
          }
          if (!uiWorkspace || typeof uiWorkspace.startSession !== 'function') throw new Error(tr('failure'));
          await uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' });
        };

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: NS,
          order: 100,
          label,
        }, Glyph));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: NS,
        }, () => h(Panel, { tr, startTask })));
      },
    };
  },
});
