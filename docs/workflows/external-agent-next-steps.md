# 外部 Agent 流程续接当前流程契约

## 用户目标与范围

- Codex、WorkBuddy 和其他 MCP Agent 使用见字工具完成连续工作流时，能从中间结果继续必要步骤，或在用户确认门禁前给出清楚、可执行的下一步。
- 此契约只覆盖 Agent 获得流程指引与 Skills 规则的路径，不改变业务工具调用、门禁、数据状态或 DSH 面板交互。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 外部 MCP 初始化 | `scripts/agent-integration/mcp-server.mjs`、`scripts/agent-integration/mcp-server-core.mjs` | 外部 MCP 入口传入通用流程续接指引；共享核心按可选参数返回 |
| Codex 项目 Skills | `agent-integrations/skills/` → `.agents/skills/` | 安装脚本复制四个工作流 Skill，补充中间结果续接和下一步表达规则 |
| WorkBuddy 项目 Skills | `agent-integrations/skills/` → `.codebuddy/skills/` | 安装脚本复制同一组工作流 Skill |
| 手动接入说明 | `docs/agent-usage-guide.md` | 说明提示字段、确认门禁、宿主支持限制和客户端自定义指令补充方式 |
| 业务工具下一步 | `scripts/agent-integration/tools.mjs` 及各工具实现 | 保留工具已返回的 `next_action`、job 状态和已有调用链语义 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 握手提示 | MCP initialize 请求 | 返回 `instructions`，说明如何读取工具下一步、何时继续及何时停在确认门禁 | `mcp-server-core.mjs` |
| 客户端流程规则 | 安装脚本复制的 Skills | 根据用户完整目标续接明确且已授权的阶段；确认/选择/输入缺失时提示具体对象和操作 | `agent-integrations/skills/*/SKILL.md` |
| 业务阶段返回 | 工具结果、任务状态、产物入口 | Agent 继续调用或向用户呈现单一具体下一步；业务接口和持久状态不变 | `tools.mjs`、业务服务 |

规则要求：读取 `next_action`、`next_step`、`pending`、`jobId` 和工具说明作为续接信号；用户已要求端到端完成时，仅继续其范围内且不越过确认门禁的步骤。需要用户选择、审阅、确认、提供材料或授权时，停止并准确指出对象/ID与待办。回复不能只复述中间状态，也不应以泛化的“还需要什么吗”结束。

MCP 宿主是否将初始化 `instructions` 提供给模型由宿主决定。Codex 和 WorkBuddy 另由项目 Skills 提供补充规则；未加载初始化指引或 Skills 的其他 MCP Agent 不能由服务端保证其对话行为，用户可将指南中的流程续接约定加入该 Agent 的自定义指令。

## 入口间差异

- Codex 与 WorkBuddy 的安装入口不同，但均由 `scripts/agent-integration/install.mjs` 从同一 Skills 源复制规则。
- 其他 MCP Agent 若只连接 `stdio` server，可接收初始化指引，但其宿主可能忽略；若不加载 Skills，遵循程度由客户端自定义指令决定。
- DSH 的首页面板和阶段任务草稿有自己的 `agent-integrations/dsh-workbench/lib/client.js` 行为，不由本契约修改；其独立打包的 MCP 入口不传 `instructions`，因此本次不会改变 DSH 的初始化响应。

## 产物与验证

- 产物：MCP 初始化指引、Codex/WorkBuddy Skills 副本、外部 Agent 使用说明。
- 轻量验证：MCP 核心语法检查、`git diff --check`、核对 Skills 源与两个安装目录副本一致。

## 变更触点

- 外部 MCP 入口与可选握手字段：`scripts/agent-integration/mcp-server.mjs`、`scripts/agent-integration/mcp-server-core.mjs`。
- Codex/WorkBuddy Skills 源与副本：`agent-integrations/skills/`、`.agents/skills/`、`.codebuddy/skills/`；来源和复制入口：`scripts/agent-integration/install.mjs`。
- 使用说明：`docs/agent-usage-guide.md`。
- 相邻业务工具契约：`docs/workflows/content-feedback-adjustments.md`；本变更不修改其状态流转。
