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

面板输入只有三项：补充要求、批次 ID（可选）、候选 ID（可选）。留空时由 Agent 先列出现有批次或候选。任务以未发送草稿的形式进入原生会话，用户检查后按发送才执行。

## 实现

- `lib/client.js`：官方 Client Slots（`sidebar.panellist` + `main`）注册侧栏入口和整页面板；点击按钮调用 `uiWorkspace.startSession` 写入任务草稿。
- `cordis.patch.yml`：用官方 `@deepseek-ai/dsh-mcp-client` 以 stdio 启动包内 `mcp-server.mjs`，DSH 暴露 `mcp__jianzi_workbench__jianzi_*` 工具。
- `mcp-server.mjs` + `shared/`：复用 `scripts/agent-integration/` 的工具定义、执行器与本机 API 客户端，默认 `http://127.0.0.1:4317`（`JIANZI_WORKBENCH_URL` 可覆盖）。
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

Host 插件（`dsh/index.mjs`）通过官方 `ctx.webServer.register` 注册只读路由，面板同源 `fetch` 读取，因此不涉及 CORS，也不需要 typert Remote 装配。桌面壳会把 `dsh-app://app/**` 转发到本地 HTTP 服务，浏览器中则是同源请求。返回体统一为 `{ ok: true, data }` 或 `{ ok: false, error }`，失败时面板降级显示“未连接”，不影响按钮使用。

面板不再提供手填 ID 的输入框：点顶部「最近批次」chips 选择/取消批次，点「文章选题」列表选择/取消候选，顶部只显示当前选择并可一键清除。

选中批次后，面板下方的「选题与执行」区会显示三栏：批次状态与最近任务（`/jianzi/jobs`）、文章选题（按 F 分，点击填入候选 ID）、图文选题（按 G_social，标注工具/事件图文与资格状态）。

再往下是「内容日历」：按月展示文章、图文与写作计划，按日期分组并统计数量，可用 ‹ › 切换月份。

## 构建与安装

```sh
node agent-integrations/dsh-workbench/build.mjs
cd agent-integrations/dsh-workbench
pnpm pack
```

在 DSH 插件管理器用「添加插件」选择生成的 `.tgz`，或让 Agent 用 `plugin_manager` 的 `install_bundle` 指定本目录。`@deepseek-ai/dsh-mcp-client` 与 `@deepseek-ai/schemastery` 由 Harness 提供，声明为 `peerDependencies`。安装后重启或重新加载 DSH，让 patch 中的 MCP 客户端行生效。

MCP 服务入口路径在 patch 中按 profile 写死（当前 `profiles/desktop`）；在其他 profile 安装时需要同步修改。
