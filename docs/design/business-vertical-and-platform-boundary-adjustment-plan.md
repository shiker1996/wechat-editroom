# 业务垂直能力与平台能力边界调整方案

> 状态：实施中：阶段 0 全部回归门禁已通过；阶段 1 已完成，阶段 2 已完成素材评估、Repository 与写入路由迁移
>
> 日期：2026-09-13
>
> 实施前提：端到端主链路测试、异常矩阵和工作台 Smoke 测试稳定通过后，再启动架构迁移。阶段 0 记录见 [阶段 0 基线](business-vertical-and-platform-boundary-phase0-baseline.md)。

## 1. 背景与核心判断

当前项目已经形成 `features / platform / shared` 的基本结构，`research`、`articles`、`collection`、`social-cards` 和 `batches` 也已经有一定的 `application / domain` 划分。但边界仍存在历史迁移残留：

- 素材入箱、素材简报、内容计划和公众号复盘全部集中在 `content-planning`。
- 部分 `features/*/domain` 文件直接读文件、访问 Store 或调用模型。
- HTTP 路由直接穿透 feature 内部实现，并在路由中承载业务编排。
- `platform/core` 反向依赖 `platform/application`，后者又依赖业务 feature。
- `shared/domain` 和 `shared/rendering` 中存在带文件系统或明显业务语义的实现。

本方案的核心判断是：

> 先按业务能力划分垂直，再按依赖方向划分 application、domain 和 platform；目录移动不能替代职责拆分。

本方案按阶段执行。阶段 0 只建立基线，不修改生产代码；端到端测试完善后进入阶段 1，先以兼容 facade 冻结边界，再逐步迁移实现。

## 2. 目标架构

```text
HTTP / Jobs / Platform Application
              ↓
       Feature Index（公开能力）
              ↓
       Feature Application
              ↓
       Feature Domain ───→ Shared Domain
              ↓
   Platform Ports：LLM、文件、数据库、外部服务
```

依赖规则：

1. `features/*/domain` 只包含纯业务规则、值对象、状态和确定性计算。
2. `features/*/application` 编排用例，可依赖本 feature 的 domain、shared 和稳定的 platform port。
3. 外部调用方优先从 `features/*/index.mjs` 获取能力，不直接穿透内部文件。
4. `shared/domain` 不依赖 feature、platform、LLM 或文件系统。
5. `platform/core`、`persistence`、`collectors`、`connectors`、`tools` 等低层目录不依赖业务 feature，也不依赖更高层的 platform application。
6. `platform/application` 可以作为跨业务装配层，但不应被 feature application 反向依赖。
7. HTTP 只负责路由、鉴权、输入输出转换和错误映射；业务用例放在 feature application。

## 3. 目标业务垂直

### 3.1 materials：素材资产垂直

新增 `server/features/materials`，负责作者或用户产生的素材资产：

- 素材入箱、查询、编辑和状态流转；
- 来源类型、标签、证据和记录时间；
- 素材基础完整度和账号适配度评估；
- 为文章、图文和自主写作提供素材读取能力。

建议结构：

```text
features/materials/
├─ domain/
│  ├─ material.mjs
│  └─ material-assessment.mjs
├─ application/
│  └─ material-service.mjs
├─ index.mjs
└─ README.md
```

当前 `/api/writing-materials` 和 `assessMaterial()` 位于
`server/platform/http/routes/content-routes.mjs`，应迁移到该垂直的 application。

### 3.2 content-planning：内容规划垂直

保留并收敛为：

- 栏目管理；
- 内容计划和日历；
- 素材简报、主线候选和锁定命题；
- 基于历史反馈的软推荐；
- 规划策略草案。

`material-brief-service.mjs` 的“简报就绪判断、主线和生产前导”仍属于内容规划，不属于原始素材入箱。

### 3.3 content-feedback：内容表现反馈垂直（可分阶段建立）

公众号导入、文章/图文匹配、内容特征抽取、表现反馈和技能反哺形成了一个独立反馈闭环，建议最终归入 `content-feedback`：

- 微信导出解析和导入；
- 公众号指标与文章/图文产物匹配；
- 文章和图文结构反馈；
- GitHub 项目发现反馈；
- 内容反馈驱动的技能调整草案。

如果暂时不新增该垂直，至少在 `content-planning` 内部建立 `feedback` 子目录，并禁止反馈实现继续与素材入箱代码混放。

## 4. 现有代码的重点调整项

### 4.1 domain 层混入基础设施

需要优先拆分以下文件：

- `features/research/domain/event-heat-ranking.mjs`：保留评分规则；Store 查询和历史排名文件读取移到 application。
- `features/research/domain/event-resolution-shadow.mjs`：保留事件归并规则；历史快照读取移到 application。
- `features/research/domain/discussion-research.mjs`：保留研判结构和 Markdown 生成；`readDiscussionResearchContext()` 移到 application。
- `features/research/domain/project-reader-value.mjs`：保留输入规范化和评分；`evaluateProjectReaderValue()` 的模型调用移到 application。
- `features/content-planning` 中直接使用 `fs`、网络、Store 或 LLM context 的模块按同一规则拆分。

架构测试应新增约束：`features/*/domain` 不得导入 `platform`、其他 feature、LLM prompt loader、`fs` 或直接访问 Store。

### 4.2 shared 层职责漂移

`server/shared/domain/account-context.mjs` 当前同时负责默认值、格式化、文件加载和文件保存。建议拆成：

- `shared/domain/account-context.mjs`：默认值、字段规范和纯格式化；
- `platform/application/account-context-service.mjs` 或 `platform/config/account-context-store.mjs`：缓存、路径、读写。

`shared/themes` 中的 `theme-loader`、主题注册表以及 AI 设计规范文件读写也应与纯主题契约、校验和编译逻辑分开。文件系统加载属于 platform；文章和图文专属主题规则应由对应 feature 公开入口提供。

### 4.3 feature 间直接穿透

需要收口以下依赖：

- `research/domain/social-scoring.mjs` 不直接依赖 `social-cards/domain/social-routing.mjs`；共同的内容分类或路由值对象应下沉到 `shared/domain`。
- `articles`、`social-cards` 和 `batches` 不直接依赖 `research/llm` 内部实现；通用技能 Prompt 加载器放到 `platform/skills`，业务调用从对应 feature index 暴露。
- `research/application/research-pipeline.mjs` 不直接穿透 `content-planning` 的项目反馈实现；反馈策略应作为独立反馈能力或注入式策略提供。
- `collection/application/collection-job-manager.mjs` 和 `research/llm/tasks.mjs` 不从本 feature 的 `index.mjs` 反向导入内部能力，改为直接依赖 domain 文件，避免 index 循环依赖。

### 4.4 platform 反向依赖

`platform/core/store.mjs` 当前通过 `platform/application/store-services.mjs` 创建 research 的 `CandidateSelectionService`，形成：

```text
platform/core → platform/application → features/research
```

应改为启动装配时创建业务服务，再通过构造参数注入 Store；Store 保留兼容外观，但不主动创建业务 feature 服务。

文章和图文 application 当前依赖 `platform/application/themes`。主题解析、注册和加载应下沉到独立的 `platform/themes` 能力，或通过接口注入，避免 feature application 反向依赖跨业务 application。

### 4.5 shared/rendering 中的 Social Card 专属实现

以下能力已经具有明确的 Social Card 业务语义，不宜长期放在 shared：

- `social-card-plan`、`social-card-layout`、`social-card-reflow`；
- `social-card-repair-policy`、`social-card-page-budget`；
- `social-card-template-registry`；
- `storyboard-*` 和 Social Card 专属模板；
- Social Card 反馈、布局和交付统计。

建议迁移到 `features/social-cards/domain` 或 `features/social-cards/rendering`。`shared/rendering` 只保留 HTML、Markdown 和真正跨业务的渲染基元。

### 4.6 `llm` 目录中的完整业务用例

`articles/llm/daily-pipeline.mjs`、`tutorial-pipeline.mjs`、`breaking-analysis-pipeline.mjs` 以及 `social-cards/llm/custom-social-chat.mjs` 实际上包含 Store、文件、模型和产物编排，不是单纯的 LLM 基础设施。

建议将完整流程迁移到 feature 的 `application`，`llm` 目录只保留：

- prompt 构造；
- 模型输入输出契约；
- feature 专属模型适配器。

## 5. HTTP 与持久化调整

### 5.1 HTTP 路由拆分

当前 `content-routes.mjs` 同时包含素材、内容计划、公众号复盘、文章发布、产物和日历接口。建议分为：

```text
platform/http/routes/
├─ material-routes.mjs
├─ content-planning-routes.mjs
├─ content-feedback-routes.mjs
├─ article-publication-routes.mjs
└─ artifact-routes.mjs
```

`candidate-routes.mjs` 也应逐步把素材解析、简报读取和自主写作编排移入对应 application。

### 5.2 Repository 拆分

当前 `content-planning-repository.mjs` 同时保存素材、栏目、简报、计划、文章发布、微信导入、匹配和反馈草案。建议按聚合拆分：

```text
platform/persistence/repositories/
├─ material-repository.mjs
├─ content-plan-repository.mjs
├─ content-feedback-repository.mjs
└─ article-publication-repository.mjs
```

数据库仍然属于 platform，但 Repository 的边界应与业务聚合一致。

## 6. 实施阶段与兼容策略

### Phase 0：冻结和基线

实施前必须完成：

1. `npm run test` 稳定通过；
2. `npm run test:e2e` 覆盖本次迁移范围内的素材/规划、文章、图文和工作台 Smoke；采集与研究现有行为由全量回归覆盖，待对应垂直迁移时再补专用 HTTP Smoke；
3. 异常矩阵覆盖采集失败、模型失败、非法 JSON、任务超时和取消；
4. 保存一次当前 API、数据库 schema、关键产物和任务状态基线。

### Phase 1：新增入口，不改变行为

- 新增 `materials/index.mjs`、`content-planning/index.mjs`，必要时新增 `content-feedback/index.mjs`。
- 先用转发导出保持旧模块路径可用。
- 增加架构扫描，但先以报告模式运行。
- 不改变 API 路径、数据库字段、Store 方法名和产物格式。

当前进度（2026-09-13）：

- 已新增 `features/materials/index.mjs` 与职责 README，先冻结素材公开能力清单；
- 已新增 `features/content-planning/index.mjs`，集中公开素材简报和内容规划的确定性能力；
- 已新增素材垂直入口与内容规划入口的架构测试；
- 已新增 `npm run architecture:report` 报告模式扫描，记录 domain I/O、低层 platform 反向依赖和 feature 跨垂直引用；
- 首次报告扫描 111 个 feature 文件和 160 个 platform 文件，发现 6 个既有 research domain 边界问题；
- 本阶段尚未移动旧实现，也未改变 API、数据库字段、Store 方法或产物格式；
- 依赖扫描目前只报告历史问题，不阻断兼容期；阶段 2 已开始 materials 实体迁移。

### Phase 2：抽取 materials

- 把素材实体、素材入箱、素材编辑和基础评估迁移到 `materials`。
- 将 `/api/writing-materials` 迁移到 `material-routes.mjs`。
- 拆出 `MaterialRepository`，旧 `ContentPlanningRepository` 暂时保留兼容代理。
- 更新文章、图文和自主写作调用方，统一从 materials 入口获取素材。

当前进度（2026-09-13）：

- 已将素材基础评估规则迁移到 `features/materials/domain/material-assessment.mjs`，历史反馈信号改为由上层注入，领域规则不再访问 Store 或反馈数据；
- 已新增独立 SQL `MaterialRepository`，Store 的素材读写和评估保存改走 `materials/application`；`ContentPlanningRepository` 仅保留简报/计划关联素材的存在性校验，不再持有素材 CRUD 和评估写入实现；
- 已将素材查询、创建、编辑和评估接口迁移到 `material-routes.mjs`，保持原 HTTP 方法、路径、状态码和响应结构；查询富化仍复用 content-planning 的确定性推荐能力，但不再由 `content-routes.mjs` 承载；
- 已新增 `features/materials/application/material-service.mjs`，由启动装配注入 Repository，统一承载素材创建、入箱评估、查询、编辑和重评估用例；Store 继续保留旧方法名作为兼容 facade；
- 简报、栏目和计划仍由 `content-planning` 承载，文章、图文和自主写作调用方的公开路径未改；API 路由门禁、15 条架构测试、8 条 E2E 和 1775 条全量测试均通过；
- 阶段 2 收尾完成。下一步进入阶段 3：拆分 content-planning 与 content-feedback，并补素材读模型的迁移前后响应快照。

### Phase 3：清理 content-planning 与 content-feedback

- 将简报、栏目、计划留在 content-planning。
- 将微信导入、匹配、表现反馈和技能反哺迁移到 content-feedback。
- 对混合文件进行纯规则与 I/O 拆分。
- 将公众号复盘路由拆出。

当前进度（2026-09-13）：

- 已新增 `features/content-feedback/index.mjs` 和职责 README，冻结公众号导入、匹配、反馈和技能反哺的垂直入口；
- 已新增 `content-feedback-routes.mjs`，迁移公众号复盘、导入、匹配、内容链接、文章/图文反馈、项目反馈、策略和技能调整接口，保持 API 方法、路径和响应结构不变；
- 已将复盘读模型装配移到 `features/content-feedback/application/wechat-review-service.mjs`，`content-routes.mjs` 不再承载公众号反馈 HTTP 路由；
- 已将公众号导入、匹配、反馈、项目发现反馈和技能反哺的 10 个实现文件物理迁入 `features/content-feedback`；`content-planning` 同名文件仅保留兼容转发，且新垂直入口只引用本目录实现；
- 已将文章洞察、项目发现反馈规则、账号策略建议、公众号导入字节流解析和文章匹配规则下沉到 `features/content-feedback/domain`，根目录保留薄 facade 或 Store/文件编排；
- 已补充物理迁移与 domain 纯规则架构门禁，相关定向测试 57/57、E2E 8/8、全量测试 1777/1777 通过；
- 已新增 `features/content-feedback/application`，将文章正文关联用例（本地授权读取、外部抓取、Store 快照保存）移入 `article-content-linking-service.mjs`，根目录保留兼容转发；
- 已将公众号复盘读模型装配移入 `application/wechat-review-service.mjs`，路由改为直接依赖应用服务，旧 `wechat-review-view.mjs` 仅保留兼容转发；
- 已将图文反馈文件读取留在 `application/social-content-feedback-service.mjs`，将图文特征计算和快照规则下沉到 `domain/social-content-feedback.mjs`；
- 已将文章反馈快照规则下沉到 `domain/wechat-content-feedback.mjs`，将 Prompt 上下文封装隔离在兼容 facade；
- 已将反馈调整、图文技能反哺移入 application，并将图文技能目标选择、技能文本精确替换等无 I/O 规则下沉到 `domain`；
- 阶段 3 完成：内容反馈的垂直入口、路由、物理迁移、application/domain 拆分和兼容转发均已落地，定向测试 59/59、E2E 8/8、全量测试 1777/1777 通过；下一步进入阶段 4，处理 platform/shared 边界。

### Phase 4：修复 platform/shared 边界

- 移除 `platform/core` 对 platform application 和 feature 的反向依赖。
- 把主题加载、账号配置读写从 shared domain 拆出。
- 把 Social Card 专属渲染从 shared/rendering 迁回 social-cards。
- 将完整业务流水线从 feature `llm` 目录移到 application。

当前进度（2026-09-13）：

- 已完成 research/domain 基础设施第一批清理：事件热榜历史文件、事件影子历史、讨论研判上下文和项目读者价值模型调用均已移入 `features/research/application`；research/domain 当前架构扫描为零违规；
- 已完成 `account-context` 第二批清理：默认值、字段规范和纯格式化位于 `shared/domain/account-context-model.mjs`，缓存、路径解析和 JSON 读写位于 `platform/application/account-context-service.mjs`，旧 shared 路径保留纯模型兼容入口；账号配置格式和缓存行为保持不变；
- 第二批验证通过：账号与安全上下文定向测试、架构测试通过；当时全量测试 `1777/1777`、E2E `8/8`，边界报告扫描 `0` 违规；
- 已完成 Store 装配第三批清理：研究垂直通过 `createCandidateSelectionService` 提供候选服务工厂，启动装配通过 `configureStoreServices` 注入，`platform/core/store.mjs` 不再依赖 `platform/application` 或 research；Store 方法名和候选写入行为保持不变；
- 第三批定向验证通过：Store、重构契约和架构测试 `74/74`，全量测试 `1779/1779`、E2E `8/8`，边界报告扫描 `0` 违规；
- 已完成 Social Card 模板资产第四批清理：四套 `templates/social` 物理迁移至 `features/social-cards/rendering/templates/social`，模板渲染入口和 pipeline 已改走垂直目录；shared 继续保留可复用渲染基元和跨层主题契约；
- 已完成 Social Card 渲染收口第五批清理：`social-card-*`、`storyboard-*` 和 `structured-card-*` 专属实现全部迁移至 `features/social-cards/rendering`；shared 仅保留旧路径 re-export 兼容 facade，通用 HTML/Markdown 基元仍留在 shared；
- 已完成 Social Card 业务编排第六批清理：自定义图文对话从 `features/social-cards/llm` 迁移至 application，Social Template Metrics Repository 迁移至 social-cards application 并由 Store 工厂注入，通用 `selectionPrompt` 迁移至 `platform/skills`；旧 `features/social-cards/llm` 仅保留兼容转发，低层 platform Repository 旧路径已移除；
- 阶段 4 收尾项已完成：定向架构/重构测试 `43/43`，图文专项测试 `68/68`，全量测试 `1781/1781`，E2E `8/8`，边界报告 `0` 违规；下一步仅在连续端到端回归和 API/产物快照验证通过后，进入阶段 5 删除兼容层。

### Phase 5：删除兼容层

只有在连续端到端回归、API 对比和数据迁移验证通过后，才删除旧路径、旧 Repository 代理和旧 route 入口。迁移期间禁止直接删除旧文件或修改已有数据库字段含义。

当前进度（2026-09-13）：

- 已完成兼容层清单核对：content-planning 反馈旧路径、research Prompt 转发、Social Card 对话转发和 shared/rendering 专属渲染转发均已无生产代码引用；
- 已删除上述旧转发文件，并将测试、主题适配和指标统计调用改为正式的垂直目录路径；content-feedback 根目录只保留稳定入口 `index.mjs`；
- 已同步更新 Social Card 当前实现映射、各模块 README 和架构门禁，旧 Social Card 渲染路径及旧 content-planning 反馈路径不再存在；
- 阶段 5 本地契约验证通过：定向测试 `104/104`，模块导入检查通过；全量测试 `1781/1781`、E2E `8/8`、边界报告 `0` 违规、旧路径残留检查通过；阶段 5 完成。

## 7. 每阶段验收门禁

每个阶段至少满足：

- 全量单元测试通过；
- E2E 主链路通过；
- 异常矩阵通过；
- 工作台关键页面 Smoke 通过；
- API 响应结构无未声明变化；
- 任务状态、运行记录和错误码无未声明变化；
- 文章、图文、素材简报和反馈产物可被旧数据读取；
- 架构扫描无新增违规；
- 可通过兼容入口回滚到迁移前调用路径。

重点增加的架构测试：

1. `features/*/domain` 不依赖 platform、fs、Store、LLM 和其他 feature。
2. feature 外部调用只能依赖 `index.mjs`，测试文件可声明例外。
3. `platform/core` 不依赖 `platform/application`。
4. `shared/domain` 不包含读写文件、网络和数据库操作。
5. Social Card 专属模块不得新增到 `shared/rendering`。
6. 每个业务垂直都有 README、稳定入口和公开能力清单。

## 8. 风险与回滚

主要风险：

- 路径移动造成隐藏 import 失效；
- Store 兼容方法和 Repository 拆分导致数据写入差异；
- 素材、简报和文章产物之间的 ID 关联断裂；
- feature index 引入循环依赖；
- 主题、技能和模型调用的运行时路径变化；
- 旧数据库或旧产物无法被新代码读取。

控制方式：

- 先新增入口，再迁移调用方；
- 兼容代理至少保留一个完整回归周期；
- 迁移前后对同一临时数据库执行 API 和产物快照对比；
- 每次只迁移一个聚合或一个业务垂直；
- 任何 E2E 回归失败都停止当前阶段，不继续扩大迁移范围；
- 保留旧文件和旧入口，直到下一阶段验收完成。

## 9. 当前决策

本方案确认以下顺序：

```text
端到端测试完善
  → 建立行为基线
  → 新增 materials 垂直
  → 拆分 content-planning / content-feedback
  → 修复 feature domain 边界
  → 修复 platform/shared 边界
  → 完成 API、产物和数据回归
  → 删除兼容层
```

在 Phase 0 完成前，不进行大规模目录移动，不修改现有生产路径，不删除任何兼容实现。
