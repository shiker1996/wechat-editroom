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
| 06 内容反哺 | 必须有本轮上传的公众号导出表格 | 无附件时请用户上传并停止，不读取本地反馈/策略或现有草案；有附件时导入、匹配并关联该批次的本地正文/图文文案，再刷新快照；关联失败时停下说明，不生成旧数据草案 | `jianzi_content_feedback_import`、`jianzi_content_feedback_adjustment_generate` |

文章生产阶段仅保存 `draft`。用户确认已经生成的文章之后，Agent 才能保存 `final`；排版阶段检查到没有用户确认的终稿时必须停止。上述用户确认由 DSH 会话中的交互完成。

面板只负责生成阶段任务草稿并调用 `uiWorkspace.startSession`；具体流程由项目技能 `jianzi-workbench-setup`、`jianzi-topic-to-article`、`jianzi-typeset-cover`、`jianzi-social-cards` 定义。

## 数据流与实现边界

面板按钮只负责生成任务提示并打开 DSH 原生会话。用户检查并发送草稿后，DSH Agent 使用 `mcp__jianzi_workbench__jianzi_*` 工具调用 MCP 服务。官方 MCP client 管理 stdio 子进程并将发现的工具注册给 DSH；本地 MCP 服务调用共用的 `executeJianziTool` 和 `JianziApiClient`，默认访问 `http://127.0.0.1:4317`（可由 `JIANZI_WORKBENCH_URL` 覆盖）。

DSH Agent 每次业务工具调用前检查工作台 `appVersion` 是否不低于已安装插件/MCP 包版本；版本不足或旧项目不支持该字段时返回 `WORKBENCH_VERSION_MISMATCH`，阻止业务读写，并指导用户在项目目录 `git pull`、按升级说明更新/构建、重启工作台和 MCP。状态卡会显示版本号及更新步骤，并隐藏“准备启动任务”，避免把代码过旧误报为服务未连接。当工作台服务未运行时，DSH Agent 可调用 `jianzi_workbench_start`；DSH 面板状态卡的「准备启动任务」按钮会把启动提示词放入 DSH 原生会话，由 Agent 在用户发送后调用该 MCP 工具。提示词要求 Agent 从当前会话选中的 DSH 工作空间取得本机绝对路径并作为 `projectRoot` 传入，用户不必在面板重复输入；若 Agent 无法获取工作空间路径，应先询问用户，不得把 DSH profile/插件目录当作项目路径。工具复用 `scripts/runtime/start-workbench.ps1` 或 `.sh`，无浏览器启动，并异步轮询 `/api/overview`；就绪接口返回有效 JSON 后立即执行核心健康检查和 `workspaceId` 指纹比对，最长等待 90 秒。DSH MCP 单次工具调用 timeout 为 120 秒。端口被占用、环境错误或 90 秒内未就绪时，Agent 应报告具体原因并停止重试；发现指纹不匹配或服务版本不支持指纹时，不得继续业务读写。

「检查环境」任务先检查当前工作空间是否为有效见字项目。若目录不存在或缺少启动入口，启动工具不会尝试安装；Agent 会先说明需要克隆项目，并征求是否克隆到空目录的确认。克隆后按项目向导逐项配置，不自动安装 RSSHub 或覆盖现有文件。

完整的启动恢复契约见[外部 Agent 工作台生命周期](external-agent-workbench-lifecycle.md)。

面板自身不直接调用 MCP 工具。它通过 Host 插件注册的只读路由读取同一套实现的数据：`/jianzi/status`（`jianzi_doctor`）、`/jianzi/batches`（`jianzi_batches_list`）、`/jianzi/candidates`（`jianzi_batch_candidates`）、`/jianzi/social-ranking`（`jianzi_batch_social_ranking`）、`/jianzi/jobs`（本地 `/api/jobs`）与 `/jianzi/calendar`（`jianzi_calendar_list`）。需要执行启动时，面板通过 `uiWorkspace.startSession` 准备 DSH 原生会话草稿，由 Agent 调用 `jianzi_workbench_start`。日历 Host 路由根据 MCP 返回的文章文档 ID 或图文产物 ID，附加由实际 `client.baseUrl` 生成的只读预览链接；文章链接访问 `/api/documents/{id}/content`，图文链接访问 `/api/artifacts/{id}/preview`。内容日历和选题快捷区的已有文章/图文预览均在 DSH 面板内以抽屉展示。选中文章候选时，如果已有终稿，面板显示现有预览与独立的“仍要准备新草稿”操作，Agent 必须保留旧终稿；若只有草稿状态，则先检查现有文档，避免重复成稿；若产物状态读取失败，禁用重新生成入口并提示用户重选批次。选中图文候选时会结合资格、是否入池和是否已有已交付产物显示对应操作；已有图文显示预览与单独的“准备重新生成”操作；再次提交会写回固定产物路径，可能替换现有 HTML/PNG，因此 Agent 必须在提交前再次说明影响并取得明确确认，门禁未通过时禁止提交。快捷操作只准备携带所选标题、ID 和状态的 DSH 原生任务草稿，不直接写入业务数据；图文未入池时，Agent 必须先获得用户明确同意才能加入。

DSH Agent 可通过只读 MCP 工具 `jianzi_calendar_list` 查询 `/api/calendar` 的内容日历条目，按 `month`（`YYYY-MM`）可选过滤；结果包含终稿文章、已交付图文和写作计划。

MCP 工具定义与执行器以 `scripts/agent-integration/tools.mjs` 和 `scripts/agent-integration/client.mjs` 为源；插件打包前由 `agent-integrations/dsh-workbench/build.mjs` 复制到 `shared/`。当前路径使用 DSH 官方 `uiWorkspace` 与 Client Slots，不依赖 `desktopWorkbenches`，客户端插件也不会直接请求见字 API。

## 打包与交付

- 插件目录：`agent-integrations/dsh-workbench/`；插件清单图标复用 `build/brand-seal.svg`（exe 图标的矢量源）；普通用户在 DSH 插件管理器中输入 npm 包名 `jianzi-content-workbench` 安装；开发者可用统一 release 命令或单独 `npm pack` 生成 `.tgz` 本地调试。
- DSH 运行依赖：官方 `@deepseek-ai/dsh-mcp-client`，由 Harness 安装提供；插件 peer 声明使用 `*`，不因 MCP client 版本变化阻止插件安装或加载。Cordis patch 配置 stdio transport 和插件包内 MCP 服务入口。若 MCP 工具不可用或出现 client 启动、传输、握手、协议错误，Agent 应停止业务操作，提示更新 DSH 与插件并重启；复现后请用户携带版本和脱敏日志提交 GitHub issue。
- MCP 服务入口路径在 patch 中按 profile 定位（当前写死 `profiles/desktop`，与 DeepSeek Harness 桌面端的活动 profile 一致）；在其他 profile 安装时需同步修改该路径。
- 统一发布打包命令：`npm run release`；tag 构建先把版本戳记到项目和插件清单，再构建桌面端与独立 DSH `.tgz`，并为全部产物生成校验和。只调试插件时运行 `npm run build --prefix agent-integrations/dsh-workbench` 和 `node scripts/release/pack-dsh-plugin.mjs ./dist`。
- 数字版本 tag 同时触发 GitHub Release 和 DSH npm 发布，二者使用相同 tag 版本；旧式 `dsh-plugin-v<版本>` 标签仍兼容。
- 当前交付状态：`jianzi-content-workbench` 已发布到 npm，普通用户可在官方 DeepSeek Harness 插件管理器中直接输入包名安装；DSH 插件索引尚未单独发布。npm 发布工作流见插件 README；官方索引可按 [插件索引说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)单独生成和托管。
