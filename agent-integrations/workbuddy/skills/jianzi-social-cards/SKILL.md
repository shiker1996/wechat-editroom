---
name: jianzi-social-cards
description: 在见字工作台中研判图文选题、制定故事板、生成 AI 视觉图文并检查任务产物。适用于公众号图文卡片、小红书卡片等分页内容。
---

# 图文故事板与 AI 视觉生成

编写或审核故事板前，先读取 `references/content-block-types.md`。公众号和小红书共用其中 10 种内容块；字段结构、建议长度和事实要求同时适用于外部 Agent 生成与工作台内部模型生成。长度是排版建议，不替代事实核验和工作台布局门禁。

开始业务流程前先调用 `jianzi_doctor`。若返回 `WORKBENCH_VERSION_MISMATCH`，停止业务工具调用，在目标项目根目录执行 `git pull`，按升级说明更新依赖并重新构建，重启工作台和 MCP 连接后再调用 doctor。若返回 `skillCopies.status: "stale"`，先调用 `jianzi_skills_sync`，同步后停止当前流程并重新载入 Skill；建议开启新会话，确保不沿用已加载的旧提示词。若工作台未连接，调用 `jianzi_workbench_start`，等待其返回 ready 且项目指纹匹配后再继续；DSH/npm 包需传本机项目绝对路径 `projectRoot` 或配置 `JIANZI_PROJECT_ROOT`。启动失败、指纹不匹配或超时后停止业务操作并报告诊断，不要重复启动。

## 图文适配与资源/教程方向

- 为每个方向给出 `cardFit`：强 / 有条件 / 弱，并说明依据。强适配至少具备一项：读者可访问并保存的资源、可复现且结果可核对的教程步骤、适合图示的机制/结构对比，或分页能显著提升理解的内容；同时保持来源和限制清楚。
- 自选教程调用 `jianzi_custom_social_create` 时，`thesis` 填读者可核对的预期结果，`limitations` 填适用环境和限制，`steps` 至少两步；资源包用 `list`，每项写资源名、用途和真实入口，并把来源放入 `materialUrls`。字段缺失先补问，不要假设为已就绪。
- 缺来源/入口、步骤、结果或限制时标记具体缺口并补料，不生成下载、安装、效果等未经证实的承诺。若主要是热点评论/抽象观点，且图示不能增加理解或保存价值，建议走文章或不做图文。
- `cardFit` 是内容形式判断，不取代 G_social、素材类型和既有入池门禁，不改动任何分数或名额。资源/教程类作为滚动内容实验优先观察，不保证推荐效果；事件热点只有在视觉表达带来额外理解/保存价值时才转卡片。

## 流程续接与下一步提示

- 先按用户要求识别完整目标，不要把中间工具调用结果当作最终完成。工具返回 `next_action`、`next_step`、`pending`、`jobId` 或明确后续工具时，若该后续属于用户要求的范围且不越过确认门禁，就在同一轮继续执行。
- 需要用户选择图文候选、认可故事板或补充素材时，停在对应门禁，明确列出待选对象/ID 或待确认方案，并说明用户接下来要做什么；不要泛泛地询问“还需要什么”。
- 回复结束时给出一个与当前状态匹配的具体下一步。交付产物时提供预览入口并说明如何查看；未完成当前流程时说明下一阶段；不得自动越过用户确认、覆盖或发布门禁。

1. 图文候选应位于 `social_cards` 轨道。使用 `jianzi_batch_candidates` 查询；缺少事件/仓库候选时调用 `jianzi_batch_social_ranking`，依据 G_social、入池资格、素材类型及理由向用户推荐，确认后用 `jianzi_candidate_add` 加入图文池。事件资讯显式设为 `socialMaterialType: "event"`；软件项目介绍设为 `repository`，其他自定义内容设为 `custom`。用户提出自选主题、教程、清单或观点图文时，调用 `jianzi_custom_social_create` 创建项目和事实基座，不要伪装成热点候选。
2. 调用 `jianzi_candidate_source_fetch` 抓取并保存候选关联原文，再根据抓取结果核对事实。
3. 若素材类型为 `repository`（工具/开源项目图文），必须先调用 `jianzi_candidate_repository_inspect` 核验仓库元数据、README、版本和安装入口；结果会保存到仓库事实基座。核验失败或没有仓库地址时，向用户报告错误并暂停，不得生成故事板。`event` 使用事件事实卡，`custom` 使用自定义事实基座，不调用仓库核验工具。之后调用 `jianzi_card_editorial_get` 查看故事板、事实基座和门禁状态。事件型图文缺少事件事实卡时，先完成批次外部研判：热点打标后调用 `jianzi_batch_events`，根据事件与原文生成事件事实卡，再调用 `jianzi_batch_event_cards_submit` 保存。
4. 默认由外部 Agent 基于完整来源与事实计划故事板，再调用 `jianzi_card_editorial_update` 保存；同时提交 `targetReader`、`painPoint`、`mustDisclose`、`forbiddenClaims`，让工作台执行读者、来源披露和禁止表达门禁。仓库或工具图文还应填写 `toolPositioning`、`mustHighlight`，按需填写 `gettingStarted`。根据 `jianzi_card_editorial_get` 返回的 `gate.issues` 补齐未通过项；只有用户明确要求工作台内部 AI 时才调用 `jianzi_card_storyboard_generate`。
5. 检查页数、每页目标、证据对应关系、事实覆盖、开头和结尾。故事板方案需用户认可后才能进入视觉范式选择；外部 Agent 在审计/提交前调用 `jianzi_card_lock`。
6. 用户认可故事板后，先调用 `jianzi_card_visual_paradigms` 读取 3 个推荐范式和自由设计项，向用户展示名称、适配理由与结构规则并等待明确选择；用户选定后调用 `jianzi_card_visual_paradigm_select` 保存。不得自行替用户决定，也不得把范式当成颜色/字体主题。内部工作台用户在同一阶段通过可视化预览选择。故事板变化后必须重新选择。范式选择后再按锁定故事板和事实基座制定视觉方案、生成分页 HTML 与配套文案。
   - 生成统一 `designScheme` v4（`schemaVersion: 4`），内外部路径共用同一结构：增加必填 `paradigmId`，并包含 `contentReading`（`subject`、`narrative`、`readerFeeling`、`visualAnchor`）、`visualDirection`、`palette`（6 个 #RRGGBB 色值）、结构化 `typography`、组级 `composition`（`grid`、`density`、`rhythm`、`motif`）、`designLanguage`（`colorLogic`、`shape`、`surface`、`graphics`、`imageTreatment`）、2–3 个 `{id, description}` `sharedAnchors` 和逐页 `pages`。每页含 `page`、归一职责 `role`（cover/content/ending）、`visualPurpose`、`layout`、`focus`、`treatment`、`composition`、`primaryVisual`、`backgroundMode`、`accentPlacement`。所选范式约束页面结构和允许版式，但不决定配色、字体或表面；视觉主题仍由本篇对象、叙事、读者感受和证据独立推导。四种页面兑现标记与锚点 ID 使用简短 kebab-case。
   - 5 页及以上至少使用 3 种不同构图和 2 种背景/表面标记，相邻页不能重复 `composition` 或 `primaryVisual`。色彩、字体、形状、表面、图形与图像处理要服务内容；保留 2–3 个 `sharedAnchors` 维持系列感。不能只换强调色，也不要默认全组使用终端深底、同一背景或同一卡片壳。
   - 每个 `.page` 根元素必须标记 `data-page`、`data-page-role`、`data-visual-composition`、`data-primary-visual`、`data-background-mode`、`data-accent-placement`，值与对应 `pages` 完全一致；每页还必须有一个带 `data-shared-anchor="<id>"` 的真实可见元素，对应全部共用锚点。标记只用于让工作台核对实际 DOM，不能代替真实设计。
   - 先调用 `jianzi_card_visual_audit`，同时传入完整 HTML 和同一份 `designScheme`。可指定 `page` 做局部检查；返修后必须省略 `page` 再审计整组。整组审计会在工具结果中返回图文联系表图片；必须实际查看图片，并结合审计报告核对主视觉是否出现、页面剪影是否重复、背景/表面区别是否一眼可辨。审计还会核对故事板页数/职责、页面标记、共用锚点、相邻构图、全组背景实际差异、溢出、内容密度与列表条目。未通过时按页级 issues 修复 HTML 或方案并重审；不得在方案和 HTML 标记不一致时提交。
   - 若多个页面仍像同一模板，只改标记不算通过；先调整页面构图与组件，再重新进行整组审计并查看新联系表。若宿主不能显示工具返回的联系表图片，应通过该宿主可用的图像查看能力打开审计预览后再提交；不得把仅有标记一致或机器审计通过当成视觉验收。
   - 最终调用 `jianzi_card_visual_submit` 时必须提交同一份 `designScheme`、HTML 和配套文案。提交接口会重新执行整组方案兑现审计、页面布局审计、截图与归档；没有通过提交门禁不能说已交付。MCP 外部路径在自己的 HTML 草稿中返修，不调用内部生成器专用的 `replace-page`。
   内容密度门禁：普通内容页 `.page-content-stack` 高度应达到 `.page-body` 可用高度的 65%–75%；低于 60% 会被审计拦截，封面和结尾页除外。低密度时放大已有事实的视觉表达、展开事实关系或重排组件；不准使用占位元素、重复文案或虚构事实。含 3 条及以上要点的列表页要有明确主次，并用流程、对比、分组、编号轨道或重点/补充层组织，避免同尺寸小卡或短 bullet 简单堆叠。每个条目必须使用 `<li>`、`.step`、`.flow-card`、`.list-item` 或 `data-list-item` 标记，且至少 32px 高，以便浏览器检查条目数量和扫读空间。复核 `contentUtilization` 和 `listMetrics`；内容页密度或列表视觉仍弱时继续改 HTML 并重审。
7. `jianzi_card_storyboard_generate` 和 `jianzi_card_generate` 是见字内部模型路径；只有用户明确要求时使用。提交工具成功返回后，才能说明 HTML/PNG 已通过工作台门禁。
8. 图文提交或生成成功后，从工具结果的 `artifactEntries` 取出与候选类型匹配的图文入口 URL（repository=工具图文、event=事件图文、custom=自定义图文），并在最终回复中提供可点击链接；异步任务在 `jianzi_job_wait` 的最终结果中也会返回入口。不能只说“已生成”而遗漏 HTML/PNG 的查看和下载入口。
