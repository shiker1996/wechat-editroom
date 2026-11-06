# DSH 见字内容工作台 当前流程契约

## 用户目标与边界

- 用户在 DSH 面板中发起热点/选题、文章生产或排版任务；DSH Agent 借助见字 MCP 工具执行。
- DSH Agent 负责外部模型写作与 HTML 生成；见字负责保存业务记录、提供材料并执行确定性排版校验。
- 业务数据与产物保存在本机见字工作台。插件不嵌入见字网页，不在客户端直连业务 API，也不负责向公众号发布。

## 入口与集成

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| DSH 流程面板 | `agent-integrations/dsh-workbench/lib/client.js` | 使用官方 Client Slots 注册侧栏入口与整页面板；调用 DSH `uiWorkspace.startSession` 在原生会话填入未发送的任务草稿 |
| DSH MCP 客户端 | `agent-integrations/dsh-workbench/cordis.patch.yml`、`package.json` | 通过官方 `@deepseek-ai/dsh-mcp-client` 启动本包 stdio 服务，服务名为 `jianzi_workbench` |
| MCP 服务入口 | `agent-integrations/dsh-workbench/mcp-server.mjs` | 使用打包进插件的共用 MCP server core、工具定义、执行器与 API 客户端 |
| 见字 MCP 实现 | `scripts/agent-integration/mcp-server.mjs`、`scripts/agent-integration/tools.mjs`、`scripts/agent-integration/client.mjs` | 见字独立 MCP 服务与 DSH 包共用工具和业务 API 路径 |

## 阶段与门禁

| 阶段 | 输入 | 输出/状态变化 | 关键工具 |
| --- | --- | --- | --- |
| 01 准备 | 无 | 检查工作台在线、RSSHub、账号画像、采集源与采集器配置；RSSHub 未装时给出手动安装步骤，不代为安装 | `jianzi_doctor`、`jianzi_collection_capabilities`、`jianzi_account_profile`、`jianzi_collection_sources_*`、`jianzi_collector_configuration_*` |
| 02 发现与选题 | 选题方向或补充要求、可选批次 ID | 复用/创建批次、采集、打标、事件与事实卡、研判管线；给用户候选排序，等待选择后再继续 | `jianzi_batches_list`、`jianzi_batch_create`、`jianzi_batch_collect`、`jianzi_job_wait`、`jianzi_batch_tags_submit`、`jianzi_batch_events`、`jianzi_batch_event_cards_submit`、`jianzi_research_stage_prepare/submit` |
| 03 文章生产 | 用户选定的候选与补充要求 | 如有必要先加入文章候选；抓取来源、读取账号和材料，确认编辑角度，保存并回读文章草稿 | `jianzi_candidate_add`、`jianzi_candidate_source_fetch`、`jianzi_candidate_get`、`jianzi_article_document_save` |
| 04 排版交付 | 用户确认的文章终稿 | 生成 HTML 并提交确定性排版，生成封面；返回排版与封面入口，不发布 | `jianzi_article_documents`、`jianzi_article_typeset_submit`、`jianzi_cover_submit` |
| 05 图文 | 可选批次/候选与补充要求 | 从图文榜单选工具或事件候选，故事板确认后锁定、生成并提交图文产物 | `jianzi_batch_social_ranking`、`jianzi_candidate_add`、`jianzi_card_editorial_*`、`jianzi_card_lock`、`jianzi_card_visual_submit` |

文章生产阶段仅保存 `draft`。用户确认已经生成的文章之后，Agent 才能保存 `final`；排版阶段检查到没有用户确认的终稿时必须停止。上述用户确认由 DSH 会话中的交互完成。

面板只负责生成阶段任务草稿并调用 `uiWorkspace.startSession`；具体流程由项目技能 `jianzi-workbench-setup`、`jianzi-topic-to-article`、`jianzi-typeset-cover`、`jianzi-social-cards` 定义。

## 数据流与实现边界

面板按钮只负责生成任务提示并打开 DSH 原生会话。用户检查并发送草稿后，DSH Agent 使用 `mcp__jianzi_workbench__jianzi_*` 工具调用 MCP 服务。官方 MCP client 管理 stdio 子进程并将发现的工具注册给 DSH；本地 MCP 服务调用共用的 `executeJianziTool` 和 `JianziApiClient`，默认访问 `http://127.0.0.1:4317`（可由 `JIANZI_WORKBENCH_URL` 覆盖）。

面板自身不调用 MCP 工具。它通过 Host 插件注册的只读路由读取同一套实现的数据：`/jianzi/status`（`jianzi_doctor`）、`/jianzi/batches`（`jianzi_batches_list`）、`/jianzi/candidates`（`jianzi_batch_candidates`）、`/jianzi/social-ranking`（`jianzi_batch_social_ranking`）、`/jianzi/jobs`（本地 `/api/jobs`）与 `/jianzi/calendar`（`jianzi_calendar_list`）。日历 Host 路由根据 MCP 返回的文章文档 ID 或图文产物 ID，附加由实际 `client.baseUrl` 生成的只读预览链接；文章链接访问 `/api/documents/{id}/content`，图文链接访问 `/api/artifacts/{id}/preview`。内容日历和选题快捷区的已有文章/图文预览均在 DSH 面板内以抽屉展示。选中文章候选时，如果已有终稿，面板显示现有预览与独立的“仍要准备新草稿”操作，Agent 必须保留旧终稿；若只有草稿状态，则先检查现有文档，避免重复成稿；若产物状态读取失败，禁用重新生成入口并提示用户重选批次。选中图文候选时会结合资格、是否入池和是否已有已交付产物显示对应操作；已有图文显示预览与单独的“准备重新生成”操作；再次提交会写回固定产物路径，可能替换现有 HTML/PNG，因此 Agent 必须在提交前再次说明影响并取得明确确认，门禁未通过时禁止提交。快捷操作只准备携带所选标题、ID 和状态的 DSH 原生任务草稿，不直接写入业务数据；图文未入池时，Agent 必须先获得用户明确同意才能加入。只读路由不提供写操作。

DSH Agent 可通过只读 MCP 工具 `jianzi_calendar_list` 查询 `/api/calendar` 的内容日历条目，按 `month`（`YYYY-MM`）可选过滤；结果包含终稿文章、已交付图文和写作计划。

MCP 工具定义与执行器以 `scripts/agent-integration/tools.mjs` 和 `scripts/agent-integration/client.mjs` 为源；插件打包前由 `agent-integrations/dsh-workbench/build.mjs` 复制到 `shared/`。当前路径使用 DSH 官方 `uiWorkspace` 与 Client Slots，不依赖 `desktopWorkbenches`，客户端插件也不会直接请求见字 API。

## 打包与交付

- 插件目录：`agent-integrations/dsh-workbench/`；插件清单图标复用 `build/brand-seal.svg`（exe 图标的矢量源）；构建后通过 `pnpm pack` 生成供 DSH 插件管理器安装的 `.tgz`。
- DSH 运行依赖：官方 `@deepseek-ai/dsh-mcp-client`，由 Harness 安装提供并在 `package.json` 中声明为 peer；Cordis patch 配置 stdio transport 和插件包内 MCP 服务入口。
- MCP 服务入口路径在 patch 中按 profile 定位（当前写死 `profiles/desktop`，与 DSH Desktop 的活动 profile 一致）；在其他 profile 安装时需同步修改该路径。
- 构建命令：`node agent-integrations/dsh-workbench/build.mjs`；打包命令：在插件目录运行 `pnpm pack`。
