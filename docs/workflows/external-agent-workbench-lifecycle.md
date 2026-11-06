# 外部 Agent 工作台启动与就绪检查 当前流程契约

## 用户目标与范围

- 外部 Agent 发现本机见字服务未运行时，可显式启动目标项目并等待服务就绪，再继续 MCP 业务调用。
- 此流程只启动见字本机服务并执行健康检查；不修改业务数据，不自动安装依赖或 RSSHub，不终止未知端口进程。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| MCP | `scripts/agent-integration/tools.mjs` | `jianzi_workbench_start` 调用启动脚本、等待 ready、调用 `jianzi_doctor` 并核对项目指纹 |
| 源码 MCP 上下文 | `scripts/agent-integration/mcp-server.mjs`、`scripts/agent-integration/install.mjs` | 从当前源码集成路径确定项目根目录 |
| DSH npm 包 MCP | `agent-integrations/dsh-workbench/mcp-server.mjs` | 从 `JIANZI_PROJECT_ROOT` 或工具参数 `projectRoot` 获取源码项目绝对路径；面板启动提示词要求 Agent 传入当前 DSH 会话工作空间路径 |
| CLI | `scripts/agent-integration/cli.mjs` | `npm run jianzi -- workbench-start [--json]` |
| 启动与健康检查 | `scripts/runtime/start-workbench.ps1`、`scripts/runtime/start-workbench.sh`、`server/platform/http/routes/system-routes.mjs` | 现有脚本不打开浏览器、处理重复启动并轮询 `/api/overview`；健康 API 返回不透明 `workspaceId` |

## 阶段与数据流

1. Agent 调用 `jianzi_doctor` 检查服务；若未连接，显式调用 `jianzi_workbench_start`。
2. MCP 根据 `JIANZI_WORKBENCH_URL` 选择 loopback 目标端口，验证项目根目录包含 `server.mjs` 和当前平台启动脚本；源码 MCP 自动提供根目录，DSH 包需由 Agent 根据当前会话工作空间传入 `projectRoot`，或配置 `JIANZI_PROJECT_ROOT`。启动命令异步运行时，MCP 并行轮询 `/api/overview`，接口返回有效 JSON 后立即进入健康与指纹检查，最长等待 90 秒；DSH MCP 单次调用 timeout 配置为 120 秒。
3. 工具调用官方启动脚本并传入目标端口及无浏览器选项。启动脚本先检测环境和端口，再复用已就绪服务，或启动进程并最多轮询 45 秒。
4. 启动脚本成功后，工具调用 `jianzi_doctor` 检查核心 API，并比较健康响应中的 `workspaceId` 与请求项目路径的指纹；只有匹配时才返回 `ready: true`。
5. 端口冲突、环境错误、启动超时、指纹不匹配或旧服务缺少指纹时返回明确错误。Agent 停止业务读写并报告诊断，不盲目重试、不终止未知进程。

## 入口间差异

- 源码 MCP 与 CLI 从本仓库代码确定项目路径。
- DSH/npm 包安装在 DSH profile 中，不能从插件安装路径或 MCP 子进程当前目录推断源码路径；调用启动工具时应传入 DSH 会话当前工作空间的本机绝对路径，或配置 `JIANZI_PROJECT_ROOT`。
- Codex 工具调用超时为 300 秒，WorkBuddy 与 DSH MCP 配置为 120 秒；MCP 启动轮询最长 90 秒，服务提前就绪时立即进入健康检查与指纹核对。
- 普通业务工具不会自动启动服务。Agent 的 setup、文章、排版和图文 Skills 要求先检查 `jianzi_doctor`，服务未连接时再显式调用启动工具。

## 产物与验证

- 成功结果：目标 `address`、`ready: true`、健康状态和启动器输出。
- 诊断：`WORKBENCH_PROJECT_ROOT_REQUIRED`、`WORKBENCH_PROJECT_ROOT_INVALID`、`WORKBENCH_START_FAILED`、`WORKBENCH_START_TIMEOUT`、`WORKBENCH_IDENTITY_UNAVAILABLE`、`WORKBENCH_PROJECT_MISMATCH`。
- 启动日志继续写入项目 `logs/workbench.log` 与 `logs/workbench.error.log`。

## 变更触点

- MCP 工具实现：`scripts/agent-integration/tools.mjs`；打包同步：`agent-integrations/dsh-workbench/build.mjs`。
- 活跃 Skill 副本：`agent-integrations/skills/`、`agent-integrations/workbuddy/skills/`、项目 `.agents/skills/`。
- 指引与 DSH 入口：`docs/agent-usage-guide.md`、`docs/workflows/dsh-content-workbench.md`、`agent-integrations/dsh-workbench/lib/client.js`。
