# Agent Runtime 适配层设计方案

> 类别：设计方案。状态：分阶段实施中。Codex OAuth、app-server 驱动、`runSkill` Runtime 选择、Tool Broker 回调和 `jianzi auth codex` 浏览器授权命令已接入。账号画像、编辑会、独立写作、自定义图文策划、AI 封面及社交图文视觉 Agent 已声明通用外部 Runtime 能力；工作台流水线 `stage-skill` 阶段仍由现有 ModelGateway 执行，Codex 暂不支持跨 Run 恢复。WorkBuddy Adapter 尚未实现。

## 1. 目标与问题边界

目标是让见字工作台的业务 Agent 复用用户已登录的 Agent 平台，不要求用户再为工作台配置一套模型 API Key。工作台内部采用同一份平台无关的 Runtime 协议，Codex、WorkBuddy 等差异只落在平台适配器中。

需要区分两种运行能力：

1. **模型网关（ModelGateway）**：调用模型推理接口，当前统一 `complete` / `streamComplete`，由见字管理 provider、模型能力、凭据、预算和模型调用审计。
2. **Agent Runtime**：启动/恢复一个 Agent 运行，处理会话、流式事件、工具使用、取消和最终产物。Codex `app-server`、WorkBuddy ACP / 任务 API 属于此类接入形态，不是可直接塞入 OpenAI 兼容 Gateway 的普通模型 endpoint。

本方案把可替换的 Runtime 执行后端纳入现有 Agent Harness，而不是另造一套 Feature 可直接调用的平行 Agent API。业务仍统一从 `runSkill` 进入；Harness 负责解析 Skill、准备 generation snapshot、策略与门禁，再按配置选择本地 Runtime 或平台 Runtime Adapter。Runtime Adapter 负责把统一请求/事件映射为目标 Agent 平台协议。

## 2. 设计原则

- **协议统一，平台隔离**：Feature、Workflow、Skill 不依赖 Codex / WorkBuddy SDK、OAuth 类型或事件格式。
- **工作台控制业务流程**：确定性阶段顺序、账号上下文、提示词选择、权限策略、领域校验、保存及最终交付仍属于见字。
- **平台 Runtime 执行 Agent 回合**：目标平台负责授权范围内的模型会话、推理和其 Runtime 自身支持的工具调用。
- **能力显式协商**：不支持的取消、恢复、工具回调、结构化输出等能力必须在启动前拒绝或选择经批准的降级策略，不得静默丢失语义。
- **隔离认证与审计**：各平台 OAuth 凭据进入独立的凭据存储；不复用、导出或猜测用户桌面客户端的私有登录文件。Run 审计标注实际 Runtime；没有可靠 token 用量时不伪造 `model_calls` 用量。
- **不把 MCP 当作 Runtime 协议**：MCP 可提供工作台工具给外部 Agent，或让平台 Runtime 访问工具；它本身不统一 Agent 会话、运行生命周期和事件流。

## 3. 目标架构

```text
Feature Workflow
      │ runSkill（唯一业务 Agent 入口）
      ▼
Agent Harness：Skill / snapshot / 权限 / gate / Run Trace
      │ 统一 RuntimeExecutionRequest / RuntimeEvent
      ▼
Runtime Registry + Policy
  ┌────────────┼──────────────┐
  ▼            ▼              ▼
本地 Harness   Codex Adapter   WorkBuddy Adapter  ...
本地 Tool     app-server      Open API / ACP
Broker +      + OAuth         + OAuth
ModelGateway

ModelGateway 仍服务本地 Harness 的模型推理；平台适配器不被伪装成普通 HTTP provider。
```

见字 `Workflow` 仍是外层 orchestrator：例如批次研判按现有业务顺序执行打标、聚类、事件卡、研判；每个需要模型 Agent 的阶段可以选择 `internal-model` 或某个 `agent-runtime`。Runtime 完成阶段后，结果回到原 Workflow，继续由见字执行 schema、领域门禁和持久化。

### 3.1 分层职责

| 层 | 职责 | 不负责 |
|---|---|---|
| Feature / Workflow | 业务阶段、输入组装、选择 Runtime profile、输出校验、落库、重试策略 | 平台 OAuth、ACP/App-server 细节；直接调用平台 SDK |
| Agent Harness | 唯一 `runSkill` 入口；Skill/snapshot/权限/门禁准备、Runtime 选择、事件与 Run Trace 归一 | 平台 OAuth、ACP/App-server 细节 |
| AgentRuntime protocol | Harness 与执行后端间的统一运行请求、事件、取消、恢复和结果形状 | 业务决策、平台协议细节 |
| Runtime Adapter | OAuth 授权生命周期、平台会话创建、事件映射、平台错误映射 | 改写业务规则或跳过门禁 |
| Runtime Credential Store | 按用户/平台安全保存 access/refresh token、过期时间、授权范围 | 模型 Prompt、运行输出 |
| ModelGateway | 原有模型 API provider 调用、流式、预算、调用审计 | Agent Runtime 会话托管 |

## 4. 统一 Runtime 协议草案

协议是见字内部的 TypeScript/JSDoc 契约，不要求 Codex 或 WorkBuddy 实现 A2A。第一版以“一次业务阶段 = 一次 Runtime Run”为边界，不尝试把平台的完整会话 UI 或平台内部 Agent Team 映射成见字内部子 Agent。

```ts
type AgentExecutionRequest = {
  runId: string;
  workflowRunId?: string;
  stageId: string;
  runtimeProfileId: string;
  instruction: string;          // 已解析的项目 Skill/Prompt 指令
  input: unknown;               // 符合该阶段 input schema 的业务数据
  outputSchema: object;         // 该阶段的输出契约
  artifacts?: ArtifactRef[];    // 显式授权的文件/资源引用
  tools?: ToolGrant[];          // 允许的平台工具或工作台工具能力
  session?: { key: string; resumeRef?: string };
  signal?: AbortSignal;
};

type AgentRuntimeEvent =
  | { type: 'run.started'; runtimeRunRef?: string }
  | { type: 'message.delta'; text: string }
  | { type: 'tool.requested'; callId: string; name: string; input: unknown }
  | { type: 'artifact.ready'; artifact: ArtifactRef }
  | { type: 'run.input_required'; prompt: string }
  | { type: 'run.completed'; output: unknown; usage?: Usage; runtimeRunRef?: string }
  | { type: 'run.failed'; code: string; message: string; retryable: boolean }
  | { type: 'run.cancelled' };

interface AgentRuntimeAdapter {
  id: string;
  getCapabilities(profile): Promise<RuntimeCapabilities>;
  run(request): AsyncIterable<AgentRuntimeEvent>;
  cancel(runtimeRunRef): Promise<void>;
  resume?(request, resumeRef): AsyncIterable<AgentRuntimeEvent>;
}
```

### 4.1 必需能力与能力级别

第一版的基础能力为：`run`、文本增量事件、完成/失败、取消、结构化结果校验和 Runtime 身份审计。本地 Harness 也实现同一协议，适配器负责调用当前 Agent 引擎与 ModelGateway；平台 Adapter 可逐步实现同一最小契约。以下能力需声明为可选：`resume`、`tool.requested` 回调、外部 artifact、真实 usage、用户交互等待。

`RuntimeCapabilities` 必须由 adapter 返回。业务阶段可声明 `requiredCapabilities`。如能力缺失，启动前返回明确错误，除非该阶段 manifest 明确列出可接受的降级方式。`run.input_required` 只有在调用方提供交互回调时才允许；批处理流程不能挂起等待无人接收的输入。

### 4.2 工具与安全

工具授权使用能力名和范围，不把见字内部任意工具对象或本地路径直接传给平台。平台能发起工具回调时，adapter 将请求映射到现有 Tool Broker，由 Broker 按当前用户确认、能力白名单、Schema、路径和副作用策略执行。若平台只支持其自身连接器而不支持宿主回调，则只能使用明确安装并授权的平台工具；Workflow 的关键写入仍由见字处理。

若某平台的 Team/Agent 工具不能保证调用见字 Tool Broker，第一版不允许将其用于需要工作台侧副作用的阶段。可先选纯生成/分析阶段作为验证切口。

## 5. 平台适配边界

| 平台 | 官方公开运行入口 | Adapter 的责任 | 需要验证的差异 |
|---|---|---|---|
| Codex | Sign in with ChatGPT OAuth + `codex app-server` JSON-RPC | 完成应用 OAuth、刷新 token、启动/管理 app-server、映射 thread/turn 与事件、恢复会话 | OAuth 应由见字作为独立应用完成；不可读取 Codex CLI 私有凭据。验证如何注入每阶段指令、限制工具、取消及结构化输出 |
| WorkBuddy | Open API：本地助理/云端任务；ACP 双向通道 | OAuth 2.1 授权、创建任务/会话、映射 ACP 事件、完成产物读取与取消 | 确认目标账号/版本开放的任务类型、会话上下文与授权范围；它公开的是 Agent 任务/对话能力，不应假定为原始模型推理 API |

官方资料：

- OpenAI Codex app-server OAuth：<https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server>
- WorkBuddy Open API / ACP：<https://open.workbuddy.cn/docs/openapi>
- WorkBuddy 第三方 OAuth 接入：<https://open.workbuddy.cn/docs/third-party-app>

Adapter 只映射传输协议和运行语义。不能把平台专有的 prompt、团队配置、权限或任务状态泄漏到 Feature 层；平台不支持统一协议某项能力时，由 capabilities 明确表示。

## 6. 与现有代码架构的关系

当前 Agent Harness（`server/platform/agent/harness.mjs`）通过 `runSkill` 统一 Skill、工具策略、generation snapshot、Run/Step/Event/Checkpoint 和门禁；Workflow 按业务需要调用 Gateway 或 `runSkill`。现有 `server/platform/llm/gateway.mjs` 是 OpenAI 兼容推理客户端。

拟在现有 Agent Harness 内扩展 Runtime Backend，不在 Feature 层建立第二套调用入口：

```text
server/platform/agent/
  runtime-contract.mjs         # request/event/capability 校验
  runtime-registry.mjs         # backend 发现与 profile resolve
  runtime-selector.mjs         # 由 runSkill 选择执行后端
  runtimes/
    local-harness.mjs           # 现有 runConversationAgent + ModelGateway/Tool Broker
    codex-app-server.mjs
    workbuddy-acp.mjs
server/platform/integrations/
  runtime-credentials.mjs      # OAuth token 加密持久化接口
```

Feature adapter 继续只调用 `runSkill`。Harness 内的 Runtime Selector 按 Skill/阶段配置选择 `local-harness`、Codex 或 WorkBuddy backend；各 backend 遵守同一 Runtime 协议，且事件回到同一个 Harness Run 生命周期。`ModelGateway` 不需要承载平台 OAuth 或 ACP 协议；已有本地模型路径由 `local-harness` 使用现有 Gateway，继续兼容。

Runtime 按技能能力策略 opt-in：Skill definition 使用 `runtimePolicy: { mode: 'external-agent', requiredCapabilities: [...] }` 声明可由外部 Agent 完整执行及所需通用能力，不列出 Codex/WorkBuddy 等平台名。Harness 通过 Runtime Registry 选择用户当前配置的平台，校验其能力满足该策略后再启动。已 opt-in 的交互 Agent 包含账号画像、编辑会、独立写作、自定义图文策划、AI 封面和社交图文视觉生成。新增平台时注册对应 adapter 和授权流程，已兼容技能无需逐个平台修改。批次研判、文章成稿与排版等 `stage-skill` 流水线阶段尚未接入外部 Runtime。

Codex 目前不支持恢复见字保存的历史 Agent Run；需要恢复时 Harness 明确返回不支持，不静默切换本地模型。外部 Runtime 的首轮交互与工具调用仍使用同一份 Skill 指令、工具白名单、Tool Broker、输出门禁和 Run Trace。

Runtime Run 应复用现有 `agent_runs`、`agent_run_events`、`agent_steps` 和 trace 关联字段（具体字段以当前 schema 为准），并扩展 metadata 记录 `runtimeId`、`runtimeProfileId`、平台任务/会话引用、能力快照和授权身份摘要。token 不进入 Run、Prompt、模型调用审计或日志。

`generationSnapshot` 应冻结执行 Runtime ID、adapter 版本、profile 引用、能力集合、Skill/Prompt 哈希、输入输出 schema 版本和工具授权。恢复时若平台任务已过期或 adapter/能力不兼容，明确要求重跑或用户处理，不静默改走另一个模型。

## 7. 配置与授权体验

用户在「模型 / Agent 运行时」设置中选择平台并执行一次 OAuth 连接，完成后建立 `runtimeProfileId`。阶段配置引用 profile，不保存 token。WorkBuddy/Codex 的账号状态和模型额度由平台管理；见字只展示授权有效性及最近调用结果，不要求填写 API Key。

首版建议仅允许一个默认 Runtime profile，并对阶段开放显式选择；不自动 fallback 到内部模型。用户需要知道每个阶段使用哪个平台账号。若后续加入 fallback，需再次确认并在运行前告知，且纳入 snapshot 和审计。

OAuth 凭据存储需使用系统凭据库或项目现有加密凭据机制；Windows/macOS/Linux 的可移植实现、token 刷新、撤销、导出/备份语义应先核实。OAuth 登录回调绑定 loopback 并校验 state/PKCE；不得把 access token 暴露给浏览器前端或 MCP 工具输出。

## 8. 分阶段实施步骤

### Phase 0：Runtime 能力核验

1. Codex `app-server` 已用用户授权账号完成最小任务与动态工具回调验证；WorkBuddy Open API/ACP 尚未验证。
2. 验证传入项目阶段指令/输入、接收增量文本与最终结构化产物、取消任务、刷新授权。
3. Codex 宿主动态工具调用已通过隔离 echo、真实只读项目工具及账号画像助手内存表单验证；仍需从工作台 UI 验证持久化边界和运行审计。
4. 输出 capability 对照矩阵。无法满足的能力明确为不支持，不在适配器中模拟成功。

### Phase 1：内部协议与假 Runtime

1. 确定 request/event/capability schema 和版本策略。
2. 在 `runSkill` 内扩展 Runtime protocol / Selector / Registry 与统一错误映射；Feature 不新增绕过 Harness 的调用入口。
3. 将 Runtime 事件映射到现有 Agent Run 事件流，保留 trace/runId 关联。
4. 验证取消、失败、结构化输出校验和审计，不接真实平台账号。

### Phase 2：首个平台垂直切片

1. 选择 Phase 0 能力最完整的平台，实现 OAuth 与一个轻量、无外部副作用的阶段 adapter。
2. 从见字现有 Skill/Prompt 装配 instruction/input/output schema，模型结果回到原 Workflow。
3. 由见字执行现有 schema、领域 gate 和持久化，验证运行 trace、取消、授权过期和重试语义。
4. 完成后再接第二个平台，不复制业务 Feature 逻辑。

### Phase 3：逐步扩展内部 Agent 阶段

1. 按阶段清单开放写作、研判、排版、封面、图文等纯生成能力。
2. 逐项评估图片/文件输入、工具授权、长任务、断点恢复和平台额度。
3. 更新模型/Runtime 选择设置和用户指南；每次运行显示所用 Runtime。
4. 在真实小批次下验证产物质量及审计信息。

## 9. 验收标准

- 同一个 Feature/Workflow 仍只调用 `runSkill`；统一 Runtime protocol 位于 Harness 内，Feature 不出现平台协议判断。
- 更换 Codex/WorkBuddy adapter 不要求改业务 Prompt、输出 Schema 或门禁。
- 用户授权平台账号后可运行至少一个见字内部 Agent 阶段，不要求另配模型 API Key。
- Runtime 事件被统一映射到工作台 Run Trace，完成、失败、取消状态准确。
- 结果先经见字的确定性/领域校验，校验未通过不得写为成功产物。
- token、私有凭据和未授权本地文件不泄漏到日志、浏览器或生成快照。
- 不支持的 capability、账号授权过期、平台限流和不可恢复会话均有可区分错误；无静默 fallback。

## 10. 风险与待决策

1. **Codex app-server 是 Agent Runtime，不是无状态模型 endpoint。**它可能拥有自己的系统指令、工具回路和会话状态。Phase 0 必须确认能否可靠承载见字每个 Skill 的角色指令，而不覆盖项目 prompt 或绕开 Tool Broker。
2. **WorkBuddy API 开放范围依产品版本/应用审核而定。**目前公开材料描述 Agent 对话/云端任务与 ACP，不等价于每个用户都能直接复用 WorkBuddy 客户端登录态；要核实开发者应用、scope、审核和本地/云端任务条件。
3. **统一的是我们的调用协议，不是平台行为完全等价。**同一任务在不同 Runtime 的工具、上下文窗口、内容策略、额度、恢复能力可能不同，应通过 capability 和运行快照呈现。
4. **工作台现有 ModelGateway 的预算/审计不能原样套用。**平台可能不返回完整 token/成本；统一记录平台 run 状态和可得 usage，避免虚构费用。
5. **并发、超时与取消**需要适配器将现有 AbortSignal 语义映射到平台任务取消；若某平台不支持硬取消，需要向用户展示“取消请求已发送/无法确认停止”，不能声称已停止。

## 11. 当前建议

采用“见字 Workflow + 平台无关 Agent Runtime 协议 + 平台 Adapter”的方向；保留现有 ModelGateway 作为独立运行路径，不把 Codex/WorkBuddy 伪装成普通 provider。先完成 Phase 0 的双平台能力核验，再决定首个平台和最小垂直切片。这样实现一次业务接入后可以复用统一生命周期、审计和门禁，同时把平台差异隔离在 adapters 内。
