# 见字 DSH 内容工作台

见字的 DSH 插件面板：把“准备 → 选题 → 文章 → 排版封面 → 图文”五段流程接进 DSH 原生会话。面板不嵌入见字网页，也不直接访问见字 API；它只准备任务草稿，由 Agent 加载项目技能、通过 MCP 工具操作见字。

## 五段流程

| 阶段 | 面板动作 | 对应技能 / 门禁 |
| --- | --- | --- |
| 01 准备 | 检查环境 | `jianzi-workbench-setup`：工作台在线、RSSHub、账号画像、采集源；RSSHub 未装时给出手动步骤 |
| 02 发现 | 准备选题研判 | `jianzi-topic-to-article`：批次、采集、打标、事件与事实卡、研判管线；产出排序并停下等用户选 |
| 03 写作 | 准备文章草稿 | 同技能文章阶段：抓原文、确认角度、保存 draft；不保存 final |
| 04 交付 | 准备排版交付 | `jianzi-typeset-cover`：只接受已确认终稿，生成 HTML 排版与封面，返回两个入口 |
| 05 图文 | 准备图文 | `jianzi-social-cards`：工具/事件候选、故事板、锁定、视觉提交 |

面板输入只有三项：补充要求、批次 ID（可选）、候选 ID（可选）。留空时由 Agent 先列出现有批次或候选。任务以未发送草稿的形式进入原生会话，用户检查后按发送才执行。工作台未连接时，状态卡会提供「准备启动任务」按钮；提示词要求 Agent 使用当前 DSH 会话选中的工作空间绝对路径作为 `projectRoot`，调用 `jianzi_workbench_start` 启动，并等待服务就绪和项目指纹校验。若本机没有有效项目目录，检查提示会先询问是否克隆到空目录，确认后才初始化；启动工具本身不会克隆或安装项目。

## 实现

- `lib/client.js`：官方 Client Slots（`sidebar.panellist` + `main`）注册侧栏入口和整页面板；点击按钮调用 `uiWorkspace.startSession` 写入任务草稿。
- `cordis.patch.yml`：用官方 `@deepseek-ai/dsh-mcp-client` 以 stdio 启动包内 `mcp-server.mjs`，DSH 暴露 `mcp__jianzi_workbench__jianzi_*` 工具。
- `mcp-server.mjs` + `shared/`：复用 `scripts/agent-integration/` 的工具定义、执行器与本机 API 客户端，默认 `http://127.0.0.1:4317`（`JIANZI_WORKBENCH_URL` 可覆盖）。
- DSH 中调用 `jianzi_workbench_start` 可启动已停止的本机项目并等待健康检查；通过 `projectRoot` 参数或 MCP 进程环境变量 `JIANZI_PROJECT_ROOT` 指定源码项目绝对路径。启动器复用项目内官方启动脚本，不会打开浏览器，并并行轮询就绪接口；服务有效响应后立即核对健康信息与项目指纹，避免启动器进程未退出造成误报。启动最多等待 90 秒，DSH MCP 单次调用上限为 120 秒。
- 面板文案不硬编码 MCP 工具名，也不复述流程细节；流程以项目技能为准，改流程只改技能。

## 面板读取的数据

面板不能调用 MCP 工具（那些注册在 Host 的模型工具表里）。读取能力由 Host 插件用同一套实现提供：

- `GET /jianzi/status` → `jianzi_doctor`（工作台连通、RSSHub、GitHub 状态）
- `GET /jianzi/batches?limit=8` → `jianzi_batches_list`
- `GET /jianzi/candidates?batch=<id>&track=article` → `jianzi_batch_candidates`（缺 batch 返回 400；`track=social_cards` 时读取图文候选）
- `GET /jianzi/social-ranking?batch=<id>` → `jianzi_batch_social_ranking`（图文选题、G_social、素材类型）
- `GET /jianzi/jobs?batch=<id>&limit=8` → `/api/jobs`（批次采集与后台任务执行情况）
- `GET /jianzi/calendar?month=YYYY-MM` → `jianzi_calendar_list`（内容日历：文章、已交付图文与写作计划）

DSH Agent 还可直接通过 MCP 工具 `jianzi_calendar_list` 读取内容日历，包含终稿文章、已交付图文和写作计划；可传 `month`（`YYYY-MM`）筛选月份。它复用见字现有 `/api/calendar` 查询，不修改日历。

Host 插件（`dsh/index.mjs`）通过官方 `ctx.webServer.register` 注册读取路由，供面板同源 `fetch` 使用；项目启动则通过 DSH 原生会话提示词调用 MCP 工具，不经过 Host 请求响应解析。提示词要求 Agent 从当前会话工作空间取得绝对路径并传给工具；MCP 子进程自身运行在 DSH profile 目录，不能用它的当前目录推断项目路径。

面板不再提供手填 ID 的输入框：点顶部「最近批次」chips 选择/取消批次，点「文章选题」列表选择/取消候选，顶部只显示当前选择并可一键清除。

选中批次后，面板下方的「选题与执行」区会显示三栏：批次状态与最近任务（`/jianzi/jobs`）、文章选题（按 F 分，点击填入候选 ID）、图文选题（按 G_social，标注工具/事件图文与资格状态）。

再往下是「内容日历」：按月展示文章、图文与写作计划，按日期分组并统计数量，可用 ‹ › 切换月份。

## 构建与安装

```sh
node agent-integrations/dsh-workbench/build.mjs
cd agent-integrations/dsh-workbench
pnpm pack
```

在官方 DeepSeek Harness 桌面应用（[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）的「插件 → 添加插件」选择生成的 `.tgz`，安装后在已安装插件中启用见字内容工作台。`@deepseek-ai/dsh-mcp-client` 与 `@deepseek-ai/schemastery` 由 Harness 提供，声明为 `peerDependencies`。如安装器提示需重启，再按提示重启或重新加载 DSH。

当前插件可从源码构建 `.tgz` 并本地安装；npm 包尚未发布，也没有发布供用户添加的 DSH 插件索引条目。官方 Harness 支持通过插件管理器安装包名、Git 仓库、tarball 或本地路径；本仓库插件位于 monorepo 子目录，现阶段推荐按上述步骤本地打包安装。详见官方[插件打包与发布说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)及[插件索引说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)。

MCP 服务入口路径在 patch 中按 profile 写死（当前 `profiles/desktop`）；在其他 profile 安装时需要同步修改。

## npm 正式发布

正式发布由仓库的 `Publish DSH plugin to npm` GitHub Actions 工作流执行。将插件 `package.json` 的版本更新并合入主分支后，推送对应标签 `dsh-plugin-v<版本号>`（例如 `dsh-plugin-v0.2.28`）。工作流会核对标签和包版本、构建、生成 `.tgz`、上传 GitHub Actions 产物，并将同一个 `.tgz` 发布到 npm。不要用普通 CI 提交触发发布。

首次发布前，需由维护者使用 npm 账号完成一次初始化发布，令 `jianzi-content-workbench` 出现在 npm Registry。随后在该 npm 包设置的 **Trusted Publisher** 中配置 GitHub Actions：用户 `shiker1996`、仓库 `wechat-editroom`、工作流文件名 `publish-dsh-plugin.yml`，并允许直接发布。当前 Registry 尚无此包；缺少这次初始化发布时，后续 CI 发布会收到 404。完成配置后，后续版本由上述标签触发，无需长期 npm 发布令牌。
