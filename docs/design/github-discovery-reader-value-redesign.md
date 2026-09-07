# GitHub 项目发现与读者价值重构方案

> 状态：阶段 1、2、3、4 已实施，等待真实内容反馈验证
>
> 日期：2026-09-07
>
> 目标：把 GitHub 项目发现从“按 Star 和 AI 兴趣找项目”调整为“按读者日常工作场景发现尚未覆盖、值得写的项目”，并将已发布项目历史覆盖前移；阶段 4 已接入，等待真实内容反馈验证。

## 1. 背景与结论

当前项目已经具备完整的 GitHub 项目采集能力：

- GitHub Trending 通过 RSSHub 采集；
- 普通 Search 通过 GitHub REST API 搜索近期新建仓库；
- AI Search 由 LLM 根据账号画像生成查询组，再调用 GitHub Search API；
- 采集结果按仓库归并，并进入统一热点、图文评分和历史覆盖流程。

核心实现位于：

- plugins/github-discovery/collector.mjs
- plugins/github-discovery/classification.mjs
- plugins/github-discovery/adapter.mjs
- server/features/collection/llm/repo-discovery.mjs
- server/features/collection/application/collection-job-manager.mjs
- server/features/research/domain/social-scoring.mjs

当前问题不是缺少 GitHub 项目，而是项目池与读者价值之间存在偏差：

1. AI 查询中的 llm、cli、kubernetes 等宽泛词会大量召回 Agent、Agent Framework、Agent Memory 和 Agent 优化项目。
2. 普通 Search 主要查询“最近 7 天创建、Star ≥ 1000”的仓库，会漏掉成熟但实用的工具、组件和工作流项目。
3. AI 兴趣过滤主要依据仓库简介、topics、语言和 Star，缺少“读者今天能用它解决什么问题”的结构化判断。
4. 项目类型与 AI 实现方式混在一起，容易把“AI 是内部机制的实用工具”和“纯 Agent 基础设施”放在同一池子里。
5. 系统已有同仓库历史图文查询，但尚未在 GitHub 采集和初筛阶段充分使用“写过什么、哪些场景读者真正看过”。
6. 公众号阅读量尚未形成对 GitHub 召回和排序的稳定反馈闭环。

现有阅读数据已经呈现出清晰信号。当前样本中，阅读表现较好的项目型内容集中在：

| 内容样本 | 阅读量 | 读者价值信号 |
|---|---:|---|
| 5k Stars 的 AI 写 UI 项目 | 2079 | AI 只是手段，核心结果是“少手工修改 UI” |
| 120K+ Star 开发者免费服务清单 | 1528 | 资源可直接使用，具备收藏价值 |
| 远程预览浏览器 | 1483 | 解决远程开发/测试的具体问题 |
| 后端开发必备 MCP 工具合集 | 1402 | 工具组合直接服务工作流 |
| PDF 转 Markdown 处理器 | 1350 | 具体输入、具体输出、上手目标明确 |
| 终端跑满 VS Code 远程开发 | 1289 | 贴合开发者日常工作环境 |
| Git 原生接入 AI 的知识库工具 | 1281 | 明确连接 Git、知识库和 AI 的工作结果 |

本方案采用以下总原则：

> AI 不是项目价值本身。项目是否值得发现，优先取决于它是否能对应一个真实、具体、可复用的工作场景。

## 2. 目标与非目标

### 2.1 目标

1. 提高实用工具、可复用组件、插件、Skill、Workflow 和有趣小工具在候选池中的占比。
2. 降低纯 Agent、Agent Framework、Agent 优化和 Prompt 工程项目对候选池的支配。
3. 发现成熟但非近期创建的项目，不再只依赖“最近创建 + 高 Star”。
4. 在候选初筛阶段识别同仓库、同场景和同主题历史覆盖。
5. 将历史文章阅读量、分享、关注转化等数据用于召回和排序校准。
6. 保留 AI 项目中的实用工具，不因为项目使用 AI 就整体排除。
7. 让每个候选都能回答：目标读者是谁、解决什么问题、多久能看到结果、为什么现在值得写。

### 2.2 非目标

- 不把阅读量直接当作项目质量的唯一标准。
- 不因为某个项目属于 AI 就全部过滤。
- 不在第一阶段训练黑盒推荐模型。
- 不用 GitHub Star 替代 README、安装入口、版本活跃度和许可证核验。
- 不自动把项目 README 的自述当作作者亲测体验。
- 不改变已经锁定的候选和已发布内容的历史结果。

## 3. 总体流程

    多通道 GitHub 召回
            ↓
    仓库规范化、缓存与基础元数据补全
            ↓
    项目类型识别 + 日常场景识别 + Agent 负面信号识别
            ↓
    同仓库 / 同场景历史覆盖判断
            ↓
    读者价值评分、Agent 惩罚、证据质量评分
            ↓
    按项目类型和场景做多样性选择
            ↓
    进入热点池与图文池
            ↓
    文章发布后的阅读数据匹配
            ↓
    更新场景权重、标题信号和召回配额

流程分为两个相互独立的判断：

1. projectValue：项目本身是否值得读者了解或尝试。
2. packagingPotential：这个项目能否被包装成当前账号容易获得阅读的内容。

这样可以避免把“项目很好但标题没写好”和“项目本身不适合读者”混为一谈。

## 4. 召回策略

### 4.1 召回通道

GitHub 发现从当前的 Trending + 普通 Search + AI Search，扩展为以下通道：

| 通道 | 目的 | 主要条件 |
|---|---|---|
| Trending | 发现正在获得关注的项目 | 保留当前 RSSHub 日榜，周榜/月榜可作为低频补充 |
| New | 发现新项目 | created 窗口 + 较低 Star 门槛 |
| Active | 发现近期重新活跃的成熟项目 | pushed 窗口 + Star/语言/主题条件 |
| Practical | 按具体日常场景搜索 | CLI、PDF、浏览器、终端、数据库、文件处理等关键词 |
| Component | 发现可复用组件和扩展 | library、SDK、plugin、extension、component、template |
| Skill/Workflow | 发现可直接嵌入工作流的项目 | skill、workflow、MCP、automation、integration |
| AI Utility | 发现有明确工作结果的 AI 工具 | 只保留场景明确的 AI 应用，不作为 Agent 泛召回 |

第一阶段建议的候选构成配额：

    实用工具 / 日常工作流       35%
    组件 / Library / SDK / 插件   25%
    Skill / Workflow / 自动化     20%
    有趣但可使用的小工具          15%
    纯 Agent / Agent 优化          5%

配额只用于最终选择，不用于硬删除召回结果。召回池中可以保留更多候选，避免错过跨类型项目。

### 4.2 日常场景词表

账号画像中的“开源与工程实践”应拆成可配置的场景组：

    file-content：PDF、Markdown、OCR、文档和文件转换
    terminal-remote：终端、SSH、远程开发、tmux、Shell
    browser-automation：浏览器自动化、网页测试、扩展
    data-observability：数据库、备份、同步、日志和可观测性
    developer-productivity：CLI、代码审查、开发者效率
    privacy-local：隐私、本地优先、自托管、离线工具
    reusable-components：Library、SDK、插件、组件、模板
    skills-workflows：Skill、Workflow、自动化和集成

词表只负责扩大召回，不直接决定是否保留。最终判断仍需要项目分类、场景证据和历史阅读反馈。

### 4.3 时间窗口

普通 Search 不再只有“最近 7 天创建”。建议使用三种时间窗口：

    New：created 最近 30 天，较低 Star 门槛
    Active：pushed 最近 30 天，允许成熟项目进入
    Evergreen：pushed 最近 180 天，较高质量和复用门槛

GitHub Search 的具体条件由场景组配置生成，不允许 LLM 自由添加无限制条件。查询组只负责关键词，created、pushed、stars、fork、archived 等安全限定符由程序统一追加。

### 4.4 AI 查询组改造

planRepoDiscoveryQueries 的输出从当前的 label/query/language/createdWithinDays/minStars 扩展为：

    {
      "label": "文件处理工具",
      "lane": "file-content",
      "query": "pdf markdown converter",
      "projectTypes": ["cli", "desktop-tool", "library"],
      "createdWithinDays": 90,
      "activityWindowDays": 180,
      "minStars": 50,
      "priority": 90
    }

LLM 规划要求：

- 至少 60% 查询组来自非 AI 日常场景；
- 至少 1 组覆盖组件、插件、Library 或 SDK；
- 至少 1 组覆盖 Skill、Workflow 或自动化；
- Agent 相关查询最多 1 组，且必须带具体场景词；
- 不允许单独使用 llm、agent、ai、prompt 等宽泛词作为查询；
- 每组必须说明读者使用后的直接结果；
- 生成失败时回退到程序内置的场景查询组，而不是完全关闭实用工具发现。

## 5. 项目类型与场景识别

### 5.1 类型枚举

候选需要归入以下受控类型：

    cli
    desktop-tool
    browser-extension
    library
    sdk
    ui-component
    plugin
    skill
    workflow
    automation
    content-tool
    data-tool
    infrastructure
    ai-utility
    agent
    agent-optimization
    other

类型识别依据包括仓库名称、简介、topics、语言、README 首段、安装入口和目录结构。仅凭仓库名称或 Star 不得完成高置信度分类。

### 5.2 场景字段

每个候选补充以下结构化字段：

    {
      "projectType": "cli",
      "scenarioIds": ["terminal-remote", "developer-productivity"],
      "targetUsers": ["后端开发者", "全栈开发者"],
      "directUseCase": "在远程服务器上启动并管理开发环境",
      "expectedOutput": "可运行的远程开发环境",
      "timeToValue": "within_10_minutes",
      "installationFriction": 2,
      "reusability": 8,
      "demonstrability": 9,
      "agentDependency": 0,
      "evidenceLevel": "metadata|readme|release|external"
    }

### 5.3 Agent 负面信号

以下信号不代表项目一定无价值，但会触发降权或人工复核：

- Agent Framework、Multi-Agent、Agent Memory、Agent Benchmark；
- Prompt Engineering、Prompt Optimization、LLM Router；
- 只提供模型编排，不提供面向具体工作的最终产物；
- README 主要描述“如何构建 Agent”，没有明确终端用户场景；
- 安装后仍需要较复杂的模型、工具、向量库和部署配置才能看到结果。

以下情况可以抵消 Agent 惩罚：

- 明确解决 PDF、代码审查、浏览器测试、知识库、终端自动化等具体问题；
- 具有可直接运行的 CLI、插件、Skill 或工作流；
- README 提供清晰的输入、输出、安装和示例；
- 读者可以在 10 分钟内获得可验证结果。

## 6. 证据补全与两阶段筛选

### 6.1 阶段一：低成本元数据筛选

对所有召回项目只使用 GitHub Search 返回的元数据，完成：

- 仓库规范化和去重；
- fork、archived、空简介、无效 URL 过滤；
- 基础项目类型和场景初判；
- 活跃时间、Star、语言、topics 记录；
- 历史仓库和场景覆盖初判。

### 6.2 阶段二：Top N 事实补全

只对第一阶段前 50～100 个候选补全：

- README 首段和安装入口；
- 最新 Release；
- License；
- 最近更新时间；
- 示例命令；
- 依赖和部署复杂度；
- 是否存在明确的输入/输出结果。

现有仓库检查能力已经支持元数据、README、版本和安装入口核验，可复用 cap_content_repository_inspect。补全结果不替代原始 GitHub 来源，应该作为候选事实快照附加保存。

### 6.3 失败策略

- 元数据搜索失败：保留其他通道结果；
- README 补全失败：项目可以继续作为低置信候选，但降低证据分；
- LLM 分类失败：使用确定性分类和“待复核”状态；
- 兴趣过滤失败：保留候选，不允许一次模型失败清空实用工具通道。

## 7. 历史覆盖判断

### 7.1 覆盖类型

为候选增加：

    same_repository_published
    same_repository_drafted
    same_scenario_published
    same_scenario_in_progress
    same_topic_only
    uncovered

### 7.2 判断顺序

1. 规范化 GitHub 仓库 URL，形成 owner/repo 主键。
2. 查询已经生成并交付的图文和文章。
3. 查询候选、草稿和历史图文中的仓库元数据。
4. 比较场景标签、标题关键词和项目类型。
5. 返回覆盖状态和证据来源。

已有的 findSimilarSocialCards 和 /api/candidates/:id/similar-social 可以作为查询基础。当前逻辑主要用于候选进入图文编辑室后的提示，应该抽出可复用的历史覆盖服务，前移到 GitHub 候选评分前。

### 7.3 覆盖惩罚

    同一仓库已发布：过滤
    同一仓库只有草稿：-20
    同一场景近 30 天已发布 2 篇以上：-10
    同类项目已经覆盖，但本项目有明显新能力：-3 到 -8
    场景未覆盖：+5

新版本项目只有在存在明确的新功能、重大更新、兼容变化或读者决策价值时才重新进入候选。

## 8. 读者价值评分

### 8.1 项目发现分

新增 projectReaderValue，建议满分 100：

| 维度 | 权重 | 判断内容 |
|---|---:|---|
| 日常工作贴合度 | 35 | 是否对应真实开发、办公或内容处理场景 |
| 立即上手价值 | 25 | 是否能快速安装并得到结果 |
| 结果清晰度 | 15 | 输入、输出和收益是否明确 |
| 可复用程度 | 10 | 是否能在多个项目或团队复用 |
| 新鲜感 / 趣味性 | 10 | 是否有反常识、巧妙或值得分享的点 |
| 证据质量 | 5 | README、Release、示例和外部证据完整度 |

惩罚项：

    纯 Agent / Agent 优化：-15 到 -25
    安装依赖复杂：-0 到 -10
    只有概念没有可运行结果：-10
    历史同仓库已发布：直接过滤

### 8.2 图文包装分

保留现有 G_social，但把项目型候选的信号改为：

- 是否有清晰演示前后对比；
- 是否能拆成安装、使用、验证三步；
- 是否有适合截图或图示的界面、命令、流程；
- 是否能用一句标题表达收益；
- 是否适合收藏、转发或搜索。

projectReaderValue 决定项目值不值得进入主池，G_social 决定是否适合做图文，两个分数不互相替代。

### 8.3 建议分流

    projectReaderValue >= 75：主推荐池
    projectReaderValue 60-74：候补 / 编辑复核
    projectReaderValue < 60：默认不进入主池

纯 Agent 但 directUseCase 明确：可进入候补或 AI 工具池。

纯 Agent 且没有日常场景：仅保留观察，不进入主推荐。

## 9. 阅读量反馈闭环

### 9.1 数据来源

复用现有公众号指标表：

- wechat_article_metrics：阅读、分享、关注、发布时间；
- wechat_article_metric_matches：指标与文章/候选的匹配关系；
- content_feedback_snapshots：已有反馈快照和信号汇总。

不要直接用绝对阅读量训练项目价值。需要同时考虑发布时间、账号阶段和文章分发条件。

### 9.2 特征提取

从已匹配文章中提取：

    projectType
    scenarioIds
    是否 AI 项目
    是否工具 / 组件 / Skill
    标题是否包含明确结果
    是否包含数字、清单、对比或教程承诺
    是否需要安装配置
    是否为纯项目介绍或场景型文章

重点关注：

- 标准化阅读量；
- 分享率；
- 阅读后关注率；
- 近 30 天趋势；
- 同场景文章的中位数表现。

### 9.3 校准方式

第一阶段不引入黑盒模型，采用可审计的分桶校准：

    某场景近 5 篇中位阅读量显著高于账号中位数：场景权重 +5
    某场景连续 5 篇低于账号中位数：场景权重 -3
    某项目类型分享率高：提高收藏 / 清单型包装推荐
    某项目类型阅读尚可但关注转化低：降低长期推荐权重

每次校准生成快照，记录：

- 使用了哪些文章指标；
- 调整了哪些场景权重；
- 调整前后的候选池变化；
- 是否出现某一场景过度垄断。

任何自动校准只影响下一批候选，不回写历史文章评分，也不覆盖人工配置。

## 10. 配置设计

建议在 githubDiscovery 下新增：

    {
      "retrievalMix": {
        "practical": 0.35,
        "components": 0.25,
        "skillsWorkflows": 0.20,
        "interestingTools": 0.15,
        "pureAgents": 0.05
      },
      "scenarioLanes": [],
      "newProjectWindowDays": 30,
      "activeProjectWindowDays": 30,
      "evergreenProjectWindowDays": 180,
      "agentPenalty": 20,
      "historyPenalty": true,
      "readerFeedback": {
        "enabled": true,
        "minimumMatchedArticles": 5,
        "refreshDays": 30
      }
    }

配置原则：

- 全局配置管理通道、权重和阈值；
- collection_sources.config_json 管理单个来源的关键词、时间窗和限制；
- LLM 只能生成经过 Schema 校验的查询组；
- 秘密字段仍由统一配置中心管理；
- 旧配置缺失时回退到当前行为，确保迁移可逆。

## 11. 实施阶段

### Phase 1：查询与分类改造

修改：

- server/features/collection/llm/repo-discovery.mjs
- plugins/github-discovery/collector.mjs
- plugins/github-discovery/classification.mjs
- plugins/github-discovery/manifest.json

内容：

1. 新增场景通道和查询组字段；
2. 禁止宽泛 llm / agent 单独查询；
3. 增加 New、Active、Evergreen 通道；
4. 增加项目类型、场景和 Agent 信号输出；
5. 增加内置查询组回退。

验收：非 AI 实用场景候选占比达到 60% 以上，且每批至少包含组件、工具或 Workflow 候选。

### Phase 2：历史覆盖前移

修改：

- server/platform/persistence/queries/workbench-query-service.mjs
- server/shared/domain/github-repository.mjs
- 新增历史覆盖领域服务；
- server/platform/core/store.mjs
- server/features/collection/application/collection-job-manager.mjs

内容：

1. 提取仓库主键和历史查询逻辑；
2. 采集后、入库前标记覆盖状态；
3. 对已发布同仓库做确定性过滤；
4. 对同场景重复做可解释扣分；
5. 将覆盖证据写入候选 raw_json 和候选快照；
6. 已发布同仓库在 `addHotspots` 前过滤，草稿和同场景重复保留惩罚字段。

验收：同一已发布仓库不再进入主推荐池；历史覆盖提示可回溯到文章或图文记录。

### Phase 3：读者价值评分

修改：

- server/features/research/domain/social-scoring.mjs
- 新增项目发现评分模块，或在现有评分前增加 projectReaderValue。

内容：

1. 实现项目类型门禁；
2. 实现日常场景、立即上手和结果清晰度评分；
3. 增加 Agent 惩罚；
4. 增加类型和场景多样性选择；
5. 在 UI 展示评分理由和具体使用场景。

验收：评分理由必须能够回答“读者为什么要看”和“读者拿它做什么”。

#### 阶段 3 实施结果（2026-09-07）

- 使用与新闻事件研判相同的 Top-K 旋钮，支持 5 / 8 / 10，默认 8；
- 只对项目图文榜前 Top-K 个仓库调用一次模型，其余项目沿用确定性项目发现分；
- 模型输出日常贴合度、立即上手、结果清晰度、复用性、新鲜感、证据质量、安装复杂度和 Agent 惩罚；
- 程序按权重合成 `projectReaderValue`，低于 60 的项目不进入图文候选线；
- 项目图文榜按 `projectReaderValue` 重排，并保留原 `projectDiscoveryScore` 供对照；
- 输入、结果和模型调用信息分别落盘到 `project-reader-value-input.json` 与 `project-reader-value.json`；模型失败时保留确定性榜单，不阻断整批研判。

### Phase 4：阅读量反馈（已实施）

已完成：

- 复用公众号指标与已确认图文产物的匹配链路；
- 新增项目发现反馈快照表，按 GitHub 场景、项目类型和仓库聚合阅读、分享、关注信号；
- 在“内容反哺”中新增“项目发现反哺”分支，支持重新生成、查看建议、人工应用或跳过；
- 人工应用后只对下一批 GitHub 项目排序增加有限偏置，不回写历史文章评分，也不修改文章和图文技能。

内容：

1. 从已确认图文指标关联的 GitHub 候选提取项目类型和场景标签；
2. 计算项目样本的相对阅读、分享率和阅读后关注率；
3. 以至少 5 个样本为门槛生成可审计的场景/类型调整建议；
4. 支持人工确认后应用有限排序偏置；
5. 暂不自动训练不可解释模型。

验收：系统可以展示“哪些场景过去表现好”，并能解释下一批为什么增加或减少某个场景。

## 12. 测试计划

### 单元测试

- 场景查询组 Schema 校验；
- 宽泛 Agent 查询拒绝；
- New / Active / Evergreen 查询条件生成；
- 项目类型和 Agent 信号分类；
- 同仓库规范化和历史覆盖；
- Agent 惩罚和场景评分；
- 配额选择和跨场景去重；
- 阅读反馈分桶计算。

### 集成测试

- LLM 查询规划失败时回退内置场景查询；
- GitHub API 缓存和多通道合并；
- README 补全失败不阻塞其他候选；
- 同一仓库被 Trending、Search、AI Search 同时发现时只保留一个项目；
- AI 项目有明确日常场景时不会被误过滤；
- 已发布同仓库不会再次进入主推荐池。

### 回放测试

使用最近至少 5 个批次回放，比较改造前后：

    实用工具占比
    组件 / 插件 / Skill 占比
    纯 Agent 占比
    历史重复率
    主推荐池的场景多样性
    人工淘汰率
    高阅读场景召回率

## 13. 关键验收指标

第一阶段建议目标：

| 指标 | 目标 |
|---|---:|
| 非纯 Agent 项目在 GitHub 候选池占比 | ≥ 80% |
| 工具 / 组件 / Skill / Workflow 占比 | ≥ 60% |
| 纯 Agent 项目进入主推荐池比例 | ≤ 5% |
| 已发布同仓库重复进入主池比例 | 0% |
| 候选有明确直接使用场景的比例 | ≥ 90% |
| 候选能给出安装或验证入口的比例 | ≥ 70% |
| 历史高阅读场景被召回的比例 | 持续提升，不低于当前基线 |

阅读量指标不设置“所有项目必须过千”的硬门槛。新项目、垂直工具和组件类项目应优先比较同场景中位数，而不是和爆款文章直接比较。

## 14. 风险与边界

### 14.1 过度排除 AI

惩罚的是“纯 Agent / 无明确结果”，不是项目是否使用 AI。AI PDF 工具、AI UI 工具、AI 知识库工具仍可正常进入。

### 14.2 阅读量被标题和发布时间干扰

阅读量只作为反馈信号，同时保留分享率、关注率、场景中位数和发布时间校正。

### 14.3 场景词表固化

场景词表由程序维护基础集合，LLM 可提出新场景，但必须经过人工或规则确认后进入正式配置。

### 14.4 过度依赖 README 自述

README 只作为项目事实证据之一；安装成功、版本、许可证和外部来源仍需单独记录，不能把 README 写成作者亲测。

### 14.5 自动反馈造成推荐单一化

为每个场景设置最低探索配额，并限制单一场景的最高占比；阅读量校准只调整排序权重，不删除其他场景。

## 15. 最终判断

这次重构的核心不是“把 Agent 项目删掉”，而是把 AI 从项目分类的中心位置移开：

    原逻辑：AI 兴趣 → GitHub 项目 → 读者价值

    新逻辑：读者场景 → 可用结果 → 项目类型 → AI 只是实现方式

最终希望系统优先发现的是：

> 读者今天遇到的问题，项目今天就能帮他解决，而且账号还没有写过。
