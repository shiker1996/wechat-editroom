# DSH 见字内容工作台 当前流程契约

## 用户目标与范围

- 在 DSH Desktop 中让 Agent 使用见字完成热点采集、选题研判、文章生产和公众号排版交付。
- 业务数据与产物仍由本机见字工作台保存；本插件不复制数据，也不负责向公众号发布。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| DSH 工作台面板 | `agent-integrations/dsh-workbench/lib/client.js` | 展示三个流程入口并链接到见字对应界面；不依赖 DSH 会话即可打开 |
| DSH Agent 工具 | `agent-integrations/dsh-workbench/dsh/index.mjs` | 将见字 MCP 工具注册到 DSH `tools` 服务 |
| 原 MCP | `scripts/agent-integration/mcp-server.mjs` | 保持 stdio MCP 入口不变 |
| HTTP/API | `scripts/agent-integration/client.mjs`、`server/platform/http/routes/` | DSH 工具与 MCP 共用同一本机 API 客户端和业务路由 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 采集与选题 | Agent 对热点/选题的指令 | 创建批次、采集、读取排名、选入文章候选 | `scripts/agent-integration/tools.mjs` 的 `jianzi_batch_*`、`jianzi_candidate_*` |
| 文章生产 | 已选候选及锁定简报/事实基座 | 生成或保存草稿；终稿需用户确认后再保存 | 同文件 `jianzi_article_*` |
| 排版交付 | 已确认的终稿 | 见字执行排版门禁并归档预览产物 | `jianzi_article_typeset` / `jianzi_article_typeset_submit` |

## 入口间差异

MCP 与 DSH 工具共用 `JIANZI_TOOLS` 描述、`executeJianziTool` 执行器和 `JianziApiClient`，因此 API 路由、CSRF 刷新、校验及副作用相同；差异仅在工具宿主：MCP 返回 JSON-RPC 工具结果，DSH 通过 Harness `tools` 注册。DSH 面板目前是见字流程入口导航，实际业务操作继续在见字 UI 或 Agent 工具中完成。

本机 DSH Desktop 尚未完成面板加载验收；当前已发现的 DSH CLI Web profile 不含 Desktop `desktopWorkbenches` 服务。

## 产物与验证

- 插件包：`agent-integrations/dsh-workbench/`；本地包名 `jianzi-content-workbench`。
- 检查命令：`node agent-integrations/dsh-workbench/build.mjs`、`pnpm pack`（在包目录运行）。
- Desktop 安装、模式切换、缩窄窗口与真实面板验收需在包含 `dsh-desktop-workbenches` 的 Desktop profile 完成。

## 变更触点

- DSH 包约定：`agent-integrations/dsh-workbench/package.json`、`cordis.patch.yml`。
- 共用工具实现：`scripts/agent-integration/tools.mjs`、`scripts/agent-integration/client.mjs`。
- Agent 操作边界：`docs/agent-usage-guide.md`。
