# Agent CLI 与 Skills 接入技术方案

> 状态：接入方案与当前实现说明
> 日期：2026-11-01
> 范围：为 Codex、WorkBuddy 等具备本地命令执行或 Skill/CLI 接入能力的 Agent 提供选题采集、文章成稿与排版、封面和图文生成能力，以及读取画像、Skill 路由和安全配置状态的能力。
> 实施约束：领域规则、任务调度、持久化和产物生成继续由见字工作台承担。对外 CLI 名称统一为 `jianzi`（“见字”的拼音）。

## 1. 背景

见字工作台已经提供本机 HTTP 服务、批次与选题管理、采集和研判任务、文章流水线、AI 排版、封面生成和图文生成等能力。Agent 可以通过自然语言负责判断和组织流程，但目前没有稳定、统一、适合机器调用的命令接口。

本方案通过一个本地 CLI、stdio MCP Server 和 Agent Skills 提供统一接入。CLI 与 MCP 作为工作台 API 客户端，Skills 作为流程手册。Agent 根据任务选择步骤、进行编辑判断，再通过 CLI/MCP 执行工作台动作。

```text
用户自然语言任务
        │
        ▼
Codex / WorkBuddy Agent
        ├── 读取见字 Agent Skill：流程、判断点、停止条件
        └── 调用 jianzi CLI / MCP：结构化参数与结果
                       │ HTTP loopback
                       ▼
              见字本地工作台 API
                ├── Feature 用例与门禁
                ├── 后台任务与 Agent Harness
                ├── SQLite / Run Trace / 审计
                └── 本地文章、图片与图文产物
```

Codex/WorkBuddy 使用各自的模型来理解用户意图、做选题比较和组织工具调用；当前文章、AI 排版、封面与图文生成 MCP 工具会调用见字 ModelGateway。这两种模型运行时独立，Agent 模型凭据不会自动传给工作台。

## 2. 目标与非目标

### 2.1 目标

- 让 Agent 能以命令方式启动或查询话题采集、打标、研判与候选管理。
- 让 Agent 能按现有工作台流程生成文章、执行 AI 排版、生成封面和图文。
- 让 Agent 能读取账号画像、可用 Skills/能力路由和非敏感设置状态，以便按账号定位和当前配置完成任务。
- 为画像更新和受控设置变更定义显式的预览、确认、校验和审计流程。
- 所有异步任务可等待、查询状态、读取错误和获取产物索引。
- 给 Agent 返回稳定的 JSON 契约；人类仍可使用格式化终端输出。
- 复用工作台 API、后台任务和现有门禁，避免复制领域逻辑。
- Skills 复用项目现有编辑、事实核验、排版和图文生成规则。
- 初期面向同一台 Windows 电脑上的本地单用户工作台。

### 2.2 非目标

- 不重写采集器、选题评分、文章流水线、视觉生成器或任务调度器。
- 不允许 CLI 直接读写 SQLite 或绕过 Feature 层操作数据。
- 第一阶段不新增 MCP 服务端；后续可在相同应用层上增加 MCP 传输适配器。
- 不提供公众号发布、微信素材库上传、批次彻底删除、备份恢复、插件管理等高影响操作。
- 不将 Agent CLI 设计成跨用户或公网服务。
- 不把“安装 Skill”误当成可访问工作台的凭据授权；Skill 只描述流程。

## 3. 现状与实现依据

当前架构是本地优先的 Windows 单用户工作台，由 Node.js 原生 HTTP 服务、SQLite、后台任务管理器和浏览器 UI 组成。服务只监听 `127.0.0.1:4317`。相关架构说明见 [architecture.md](../architecture.md)。

现有接口已覆盖方案所需的大部分动作：

| 能力 | 现有 API / 用途 |
| --- | --- |
| 新建批次 | `POST /api/batches` |
| 启动采集 | `POST /api/batches/:id/collect` |
| 自动续跑打标、事件卡、研判 | `POST /api/batches/:id/ai/auto` |
| 单独打标或研判 | `POST /api/batches/:id/ai/tag`、`POST /api/batches/:id/ai/research` |
| 查看批次与候选 | `GET /api/batches/:id`、`GET /api/batches/:id/candidates` |
| 将热点加入候选池 | `POST /api/batches/:id/candidates` |
| 锁定文章简报 | `POST /api/candidates/:id/lock` |
| 生成文章 | `POST /api/candidates/:id/ai/article` |
| AI 排版 | `POST /api/batches/:id/ai/typeset` |
| 生成封面 | `POST /api/candidates/:id/cover/generate` |
| 读取或锁定图文故事板 | `/api/candidates/:id/card-editorial`、`/card-lock` |
| 生成图文 | `/api/candidates/:id/ai/social-card`、`/ai/social-card-beautify` |
| 查询异步任务 | `GET /api/jobs/:id` |
| 查询产物文件 | 文章、封面和图文各自的现有文件/API 路由 |

精确路由行为以 `server/platform/http/routes/` 中的现行代码为准。当前 `API.md` 仍包含已移除的排版主题等旧描述，实施 CLI 前需要先校正文档，并把后续命令契约写入 API 文档，避免 Agent 按过期参数调用。

现有本地安全模块通过 loopback Host/Origin 边界和 CSRF Token 防范浏览器跨站请求；`GET /api/security/session` 返回当前进程的 CSRF Token。它不是本地进程身份认证：拥有本机执行权限的进程可访问 loopback 并获取 Token。因此 CLI 命令白名单可减少误操作，但不构成针对恶意本机进程的安全沙箱。

## 4. 方案比较与选择

| 方案 | 优点 | 局限 | 结论 |
| --- | --- | --- | --- |
| CLI + Skills | 本地 Agent 可直接调用；容易调试；JSON/退出码适合自动化；Skills 说明流程 | 需要管理 CLI 安装和命令兼容 | **第一阶段采用** |
| MCP Server + Skills | Agent 以具名工具调用；参数 Schema 可在工具层展示；长任务状态更自然 | 增加 MCP Server 生命周期、stdio 适配和连接配置 | 与 CLI 共享命令服务，本分支实现 stdio 入口 |
| Agent 直接调用 HTTP / curl | 无需新增 CLI | 每个 Agent 要自行处理认证、轮询、错误和 JSON；命令细节容易漂移，也更难统一限制动作 | 不作为产品接入方式 |
| CLI 直接导入 Node 模块 | 省去 HTTP 请求 | 与服务进程状态、初始化顺序、SQLite 连接和任务调度耦合；容易形成第二入口 | 不采用 |

推荐结构是：**CLI 与 MCP 复用 HTTP API Client 和命令服务；Skills 复用业务流程规则。**

### 4.1 AI 模型归属与当前限制

当前接入层提供两类能力：

- 外部 Agent 自己完成的工作：根据账号画像研判选题、选择候选、撰写并保存编辑决策。
- 由见字内部模型完成的工作：自动打标/研判、文章成稿、排版、封面与图文视觉生成。

调用第二类工具要求见字配置可用的 Provider。若要让 Codex/WorkBuddy 当前模型直接完成文章/设计并将结果交给见字保存、校验和渲染，需要另外实现版本化结果导入接口；当前版本没有这项能力，也不会静默地把外部 Agent 对话当成 ModelGateway 调用。

## 5. 组件设计

### 5.1 CLI 入口与模块

对外入口位于 `scripts/agent-integration/`，避免把客户端命令实现混入 `server/` 路由或领域层。

```text
scripts/agent-integration/
├── cli.mjs              # jianzi CLI 入口、参数解析、退出码
├── mcp-server.mjs       # stdio MCP 入口
├── client.mjs           # loopback API Client、会话与 CSRF
├── tools.mjs            # CLI/MCP 共用工具定义与命令实现
└── install.mjs          # Codex / WorkBuddy 项目级配置与 Skills 安装
```

第一阶段用项目内 Node 入口运行，例如：

```powershell
node scripts/agent-integration/cli.mjs --help
```

同时增加 package script，便于 Agent 和用户简写：

```powershell
npm run jianzi -- batch candidates --batch <批次ID> --json
```

CLI 普通业务命令仍要求工作台服务已启动，`doctor` 报告连接错误，业务命令返回非零退出码；它们不会暗中启动第二个服务实例。外部 Agent 可显式调用 `jianzi_workbench_start`，或运行 `npm run jianzi -- workbench-start`；该入口复用项目官方启动脚本，不打开浏览器并等待健康端点 ready 后再复核 `jianzi_doctor`，随后核对健康响应中的不透明 `workspaceId`，防止误连其他项目。`npm run jianzi -- install --agent codex|workbuddy|both` 安装对应 Skills 并写入项目级 MCP 配置；`workbench-setup` 委托现有安装引导。

### 5.2 HTTP Client

Client 职责：

1. 默认连接 `http://127.0.0.1:4317`；仅允许 loopback 地址。`--server` 可用于本机非默认端口，不允许传入远程主机。
2. 先请求 `/api/system/health` 或 `/api/overview` 检查服务可用性。
3. 获取 `/api/security/session` 的 CSRF Token，并为非安全 HTTP 方法发送 `x-csrf-token`。
4. 统一处理 JSON、HTTP 状态、超时、连接中断和服务重启。
5. 绝不把 API Key、模型凭据或 CSRF Token 写入终端 JSON、Skill 文件、命令参数或运行日志。
6. API 返回本地绝对路径时，CLI 对外优先返回工作区相对路径；只有显式 `--include-absolute-paths` 才输出绝对路径。

Client 不直接读取配置文件中的模型凭据，也不负责选择模型。模型、Skill 路由和生成快照继续使用工作台当前配置。

### 5.3 命令层与服务 API 映射

命令名称是面向 Agent 的稳定契约，内部 API 路径属于适配实现。CLI 不向 Agent 暴露任意 HTTP 方法或任意 URL 参数。

| MCP 工具 | API 映射 | 模型归属 |
| --- | --- | --- |
| `jianzi_doctor`、`jianzi_account_profile`、`jianzi_settings_summary` | `/api/system/health`、`/api/system/account-context`、`/api/system/settings` | 只读，不触发模型 |
| `jianzi_batches_list/create`、`jianzi_batch_collect`、`jianzi_batch_ranking` | 批次、采集和排名 API | 采集调用现有采集服务 |
| `jianzi_batch_auto_research` | `POST /api/batches/:id/ai/auto` | 见字内部模型 |
| `jianzi_candidate_add/get`、`jianzi_candidate_editorial_update/lock` | 候选、编辑决策、锁题 API | Agent 可自己研判；锁题由工作台校验 |
| `jianzi_article_generate`、`jianzi_article_typeset`、`jianzi_cover_generate` | 现有文章、排版、封面 API | 见字内部模型，返回后台任务 |
| `jianzi_card_storyboard_generate`、`jianzi_card_generate` | 图文故事板和 AI 视觉 API | 见字内部模型，返回后台任务 |
| `jianzi_card_editorial_get/update/lock` | 图文故事板与 CARD GATE API | Agent 可自己规划并提交故事板 |
| `jianzi_job_get/wait` | `GET /api/jobs/:id` | 查询任务终态与错误 |

`topic add`、`article draft`、`article typeset` 等命令的参数 Schema 应从路由实际校验逻辑整理；在 API 文档完成更新前，不把旧版 `API.md` 中的主题字段纳入 CLI。

### 5.4 异步任务协议

对于返回 `202` 的 API，命令层提取任务 ID。`--wait` 打开时，使用 `GET /api/jobs/:id` 轮询，并在等待期间把简短进度写入 stderr。

```text
accepted → queued → running → completed
                         ├── failed
                         └── aborted（若任务 API 提供取消能力）
```

- `stdout` 在 `--json` 模式只写一个最终 JSON 对象，不混入日志或进度行。
- `stderr` 可输出如“采集 3/5 来源完成”这样的短进度，不输出模型凭据和完整敏感输入。
- 任务进入终态后返回 job 结果摘要、Run ID（如果有）、错误码和产物列表。
- 使用有上限的退避轮询；服务返回 404、连接重置或重启时返回明确错误，不无限等待。
- CLI 不因 POST 超时而自动重复生成任务。若请求已送达但响应丢失，输出 `SUBMISSION_UNKNOWN` 并提供查询线索；只有后端提供幂等键后才允许安全自动重试。
- 等待超时返回 `WAIT_TIMEOUT` 和仍在运行的 `jobId`，用户或 Agent 可再次执行 `job wait`。

### 5.5 输出契约

所有命令支持 `--json`。JSON 使用标准输出 UTF-8 编码；格式化输出是面向人类的可选模式。

成功结构：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "article.typeset",
  "data": {
    "batchId": "2026-11-01",
    "candidateId": 2415
  },
  "job": {
    "id": "job-id",
    "status": "completed"
  },
  "artifacts": [
    {
      "kind": "排版 HTML",
      "name": "article.ai.html",
      "relativePath": "articles/.../article.ai.html",
      "url": "/api/artifacts/123/content"
    }
  ]
}
```

错误结构：

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "article.typeset",
  "error": {
    "code": "FINAL_DOCUMENT_REQUIRED",
    "message": "请先完成文章终稿",
    "retryable": false,
    "details": {}
  }
}
```

推荐退出码：`0` 成功；`2` 参数错误；`3` 工作台不可用；`4` 业务前置条件/门禁未通过；`5` 任务失败；`6` 等待超时或提交状态未知；`7` CLI 内部错误。错误码稳定，错误文案可本地化。

### 5.6 画像与设置读取

- `jianzi_account_profile` 读取 `/api/system/account-context`，供 Agent 参考账号定位、内容支柱和写作边界。
- `jianzi_settings_summary` 只返回采集配置状态和文章字数范围，不返回密钥或个人配置路径。
- 当前不提供通过 CLI/MCP 修改画像、Provider 凭据、插件状态或其他工作台设置的能力。用户仍通过工作台设置界面完成配置。
- 外部 Agent Skills 由 `agent-integrations/skills/` 发布，安装命令将其复制到 Codex/WorkBuddy 各自的项目技能目录；它们不参与见字内部 Skill 注册。

### 5.7 Agent Skills 包

为避免把面向外部 Agent 的流程错误注册成工作台内部模型 Skill，Skills 源码放入独立目录，不放进运行时自动扫描的 `skills/`：

```text
agent-integrations/
└── skills/
    ├── jianzi-workbench-setup/SKILL.md
    ├── jianzi-topic-to-article/SKILL.md
    ├── jianzi-typeset-cover/SKILL.md
    └── jianzi-social-cards/SKILL.md
```

每个 Skill 使用标准 frontmatter（`name`、`description`），并采用渐进式指令：

- `SKILL.md` 只保留触发描述、前置检查、命令顺序、确认点、停止条件和汇报格式。
- 详细命令、错误恢复、字段解释放在该 Skill 的 `references/`。
- 不把可变业务门禁复制进长提示词；门禁仍由 API/Feature 实现。
- `npm run jianzi -- install --agent codex|workbuddy|both` 把 Skills 安装到客户端项目目录并注册项目级 stdio MCP。
- Agent 可独立完成选题研判和编辑判断；成稿、排版、封面与图文视觉生成目前调用工作台 ModelGateway。Agent 模型凭据不会自动传入工作台。

#### 选题到文章 Skill

```text
health check
  → 新建或选择批次
  → 启动采集并等待采集任务
  → Agent 结合来源和账号画像研判；需要内部 AI 自动打标/研判时调用对应工具
  → 查看排名和候选，核实来源与事实线索
  → 将用户指定或用户授权 Agent 选择的热点加入文章候选
  → 保存并锁定编辑决策，调用工作台内部模型生成文章
  → 返回文章和证据产物位置
```

Skill 不把模型评分结果表述成事实，不自动锁定用户没有确认的选题，不执行公众号发布。

#### 文章排版 Skill

```text
检查候选与终稿
  → 调用工作台 AI typeset 并等待任务
  → 读取排版 HTML 和门禁报告
  → 汇报 HTML、图片交付方式、失败原因和预览链接（若有）
```

Skill 遵守当前排版契约：只变更视觉结构、不改写文章正文；不再传固定排版主题参数。

#### 图文 Skill

```text
读取候选图文事实基座和故事板状态
  → 若无故事板，按现有编辑 API/界面支持路径补齐并通过事实门禁
  → 锁定故事板
  → 调用工作台故事板/AI 视觉生成并等待浏览器审计和截图
  → 汇报每页交付状态、视觉审计失败和产物位置
```

当前实现采用 `/api/candidates/:id/ai/card-editorial` 生成故事板、`/api/candidates/:id/card-lock` 执行门禁、`/api/candidates/:id/ai/social-card-beautify` 生成 AI 视觉产物。

### 5.8 MCP 传输与客户端安装

MCP 服务使用 stdio，调用与 CLI 共用的工具定义，不额外暴露任意 API 路径。Codex 安装命令写入项目级 `.codex/config.toml`，并将 Skills 安装到 `.agents/skills/`；WorkBuddy 生成项目级 `.mcp.json`，并将 Skills 安装到 `.codebuddy/skills/`。WorkBuddy 开放平台连接器元信息与 stdio 模板位于 `agent-integrations/workbuddy/`。

工作台只监听 loopback，因此 MCP 子进程必须运行在与见字工作台相同的本机，并能访问项目目录。WorkBuddy 连接器市场发布需要平台审核；本仓库提供的本机 stdio 集成不等于已在市场上架。

当前工具覆盖批次、采集、热点排名、候选、编辑决策、文章生成、排版、封面、图文故事板/视觉生成、任务轮询，以及账号画像和非敏感设置摘要。AI 成稿、排版、封面和图文视觉生成走见字内部 ModelGateway；外部 Agent 可以自行研判选题并提交编辑决策，但当前版本尚未提供外部生成文章/HTML/图片的受校验导入与渲染交付 API，因此这些生成仍要求工作台配置内部模型。

MCP Tool 与 CLI 共用 API Client 和工具 Schema。MCP Server 不直接调用数据库，也不另写流程编排。需要用户明确决定的锁题仍由 Skill 引导 Agent 先呈现编辑判断。

MCP Server 不直接调用数据库，也不另写流程编排。这样 CLI 与 MCP 只是两个传输入口，不会产生两套业务契约。

## 6. 工作流示例

用户对 Agent 说：“采集今天的热点，选一个适合账号的题目，完成文章并排版，给我图文 HTML 和图片。”

Agent 的处理方式：

1. 运行 `jianzi doctor --json` 检查服务和内容能力。
2. 用现有批次或创建今日批次，启动采集；需要内部 AI 打标和研判时调用 `jianzi_batch_auto_research`。
3. `job wait` 后检查采集/研判是否有未解决失败。
4. 读取候选列表，结合账号画像、来源和历史覆盖，由外部 Agent 当前模型给出选择依据。
5. Agent 基于来源和画像给出选题建议；按用户指示加入候选、保存并锁定编辑决策，再调用 `jianzi_article_generate` 由见字内部模型生成文章。
6. 文章终稿完成后调用 `jianzi_article_typeset` 生成排版；需要封面时调用 `jianzi_cover_generate`，等待任务并读取产物状态。
7. 图文生成前读取事实基座和故事板；保存或生成故事板，通过 CARD GATE 后调用 `jianzi_card_generate` 生成 AI 视觉图文，并等待浏览器审计和 PNG 截图。
8. 只读取已登记的产物索引，最终返回任务状态、产物位置和仍需人工处理的失败。

是否“一次请求自主完成”由用户任务和 Skill 的确认策略决定；CLI 本身不暗自跨过编辑锁定、事实门禁或发布步骤。

## 7. 安全与权限边界

### 7.1 传输与本机边界

- 默认只连接 `127.0.0.1` / `localhost`，阻止远程服务地址。
- 通过现有 session/CSRF 流程发起变更请求；不得把 CSRF Token 放进命令行参数。
- CLI 的 `--json` 输出、错误详情和进度信息不得包含模型 API Key、Cookie、工具凭据或未脱敏的原始模型上下文。
- 不提供通用 `request METHOD URL BODY`、`eval`、任意路径读写和任意 shell 代理命令。

### 7.2 副作用分级

| 级别 | 动作 | CLI 策略 |
| --- | --- | --- |
| 只读 | health、画像、设置状态、Skill 路由、批次/候选/任务/产物状态 | 可按当前任务读取；凭据只返回配置状态 |
| 可计费或写入 | 采集、研判、成稿、排版、封面、图文生成 | 必须是 Agent 当前任务明确要求的动作；展示批次/候选对象，支持 dry-run 前置检查 |
| 编辑/画像变更 | 加候选、锁定简报/故事板、更新账号画像 | 先预览目标与差异；按用户意图执行；画像通过 hash/version 冲突检测 |
| 配置管理 | 默认模型切换、Skill 设置/安装、采集源与订阅设置 | 首期只读；后续仅白名单精确操作，须 API Schema 和专门确认 |
| 高影响/不可逆 | 发布、外部上传、彻底删除、恢复备份、凭据管理、插件管理 | 第一阶段不暴露 |

`--dry-run` 只校验目标、前置状态和参数，不启动模型或采集任务。因现有 API 未必提供所有 dry-run 校验，CLI 可先使用只读 API 做前置检查；无法确定时明确返回“尚未执行的检查”，不假装完全等价于服务端门禁。

### 7.3 信任模型限制

工作台目前是本机单用户应用，loopback 与 CSRF 不能区分“Agent CLI”和同机其他进程。因此 CLI 的命令白名单主要防 Agent 误用，不是操作系统级隔离。若未来要运行不完全可信的 Agent，应另设计 CLI 专用短期 capability token、作用域授权和每次高影响操作确认；不要将浏览器 CSRF Token 误当成 Agent 专属凭据。

## 8. 错误处理与恢复

CLI 对 HTTP/业务错误保留服务端 `code`，并追加命令层分类：

| 错误类别 | Agent 建议动作 |
| --- | --- |
| `WORKBENCH_NOT_RUNNING` | 显式调用 `jianzi_workbench_start`；启动器发现同项目服务已运行时复用，发现端口冲突、项目指纹不匹配或环境问题时返回诊断，不终止未知进程 |
| `INVALID_ARGUMENT` | 根据 Schema 修正参数后重试 |
| `NOT_FOUND` | 重新查询 batch/candidate/job ID |
| `PRECONDITION_FAILED` / 业务 409 | 读取缺少的阶段/门禁，不盲目重复请求 |
| `PIPELINE_FAILURES_PENDING` | 展示失败阶段，按用户意图使用已有 retry/skip 操作；第一版可先只读报告 |
| `JOB_FAILED` | 返回错误摘要、失败阶段和可读取日志/Run Trace 的 ID |
| `SUBMISSION_UNKNOWN` | 查询近期任务确认是否已接收；不再次触发生成 |
| `WAIT_TIMEOUT` | 保留 job ID，允许稍后继续等待 |

自动重试仅用于幂等 GET 和明确标记为可重试的网络读取。涉及 POST 的生成/采集操作，未具备服务端幂等键前不自动重放。

## 9. 安装、分发与兼容性

### 阶段一：仓库内开发与试用

- CLI 与 MCP 入口在 `scripts/agent-integration/`。
- `package.json` 暴露 `npm run jianzi -- <args>`。
- Skills 放在 `agent-integrations/skills/`，不参与工作台内置 Skill 自动发现。
- 提供 PowerShell 命令示例和 Codex/WorkBuddy 手工配置指引。

### 阶段二：桌面应用分发

- Electron Builder 将 CLI 文件和 Skills bundle 纳入发布资源。
- 桌面安装器尚未注册全局 `jianzi` 命令；当前可在项目目录通过 Node 或 npm script 调用。
- 命令定位当前已运行的本机工作台服务；若端口非默认值，支持读取安全的本机配置或显式 loopback `--server`。
- CLI 与服务的 `cliProtocolVersion` 协议版本不兼容时，给出升级提示；API 兼容期由服务端维护。

### Agent 兼容矩阵

| Agent | 调用方式 | 前提 |
| --- | --- | --- |
| Codex | 项目级 stdio MCP + `.agents/skills/` | 信任项目，并能访问已启动的本机工作台 |
| WorkBuddy | 项目级 stdio MCP + `.codebuddy/skills/`，或导入连接器包 | MCP 子进程在可访问本地项目和工作台的同一电脑运行 |
| 仅云端运行的 Agent | 不直接连接本机 loopback | 需用户显式配置安全中继/远端 API；不在本方案第一阶段支持 |

具体安装命令和 WorkBuddy Skill 发布格式以该产品当前版本的官方接入说明为准；本设计不假定不同 Agent 的 Skill 搜索目录完全一致。

## 10. 可观测性与审计

- CLI 输出 `rootRunId`、`jobId`、`candidateId`、`batchId` 等相关 ID，方便查询现有 Job/Run Trace。
- 由工作台服务创建的模型调用、工具调用和产物继续写入现有审计与 Run Store；CLI 不另建第二套运行历史。
- CLI 记录轻量本地命令事件：命令名、CLI 版本、开始/结束时间、结果码、关联 ID。默认不存完整命令正文、文章正文、凭据或模型输入。
- 任务日志和产物内容通过现有授权路由读取；不把任意本地路径作为 HTTP 文件读取接口。

## 11. 实施阶段与交付

### 当前已实现

- 同一 loopback API Client 共享于 CLI 和 stdio MCP，自动获取 CSRF Token。
- 配置 Codex / WorkBuddy 项目 MCP 并安装四类 Skills。
- Codex Marketplace 提供独立项目引导插件；它可在目标仓库克隆前被安装，再由 Codex 克隆项目并运行 setup。
- 账号画像保存、采集器配置状态/保存/检查、采集源查看/新增/修改/测试均通过工作台现有 API，沿用服务端校验与秘密字段遮蔽。
- 覆盖采集、候选研判、文章成稿、排版、封面、图文生成和任务等待的 MCP/CLI 工具。
- 项目初始化仍委托现有 `npm run setup`；不在 Codex 插件安装时默认下载可选采集器。

### 后续工作

- 增加外部 Agent 结果导入 API，使文章/封面/图文可由 Codex 或 WorkBuddy 当前模型直接生成，再由工作台保存、确定性校验、浏览器审计和截图。
- 根据 WorkBuddy 客户端形态完善连接器打包、运行时托管和实际客户端兼容验证；市场上架需单独审核。
- 评估桌面安装包的全局 `jianzi` shim 和内置 Node 运行时注册。

## 12. 验收标准

1. CLI 能检测工作台未启动、端口不匹配、服务重启和 API 协议错误，并返回稳定退出码。
2. 账号画像和设置摘要不含凭据；采集器凭据的状态只返回 configured 标记，工作台模型依赖在 Skills 中明确说明。
3. Agent 可读取画像状态与内容，查询工作台内部 Skill 的当前有效路由和健康状态。
4. Agent 能新建批次、启动采集、读取来源和候选并以 JSON 得到结果。
5. Agent 可按现有门禁保存编辑决策，生成工具任务可查状态和产物。
6. MCP Server 仅暴露白名单工具，不提供任意 HTTP、文件、数据库或 shell 执行。
7. CLI `--json` 输出单一 JSON 文档，错误通过非零退出码和 stderr 返回。
8. Codex 可先安装仓库外的引导插件，再由 Skill 克隆和初始化新项目；项目配置与 MCP/Skills 路径可由 install 命令生成。
9. 现有 UI 工作流和 Agent 调用同一服务端门禁，产物和任务可在 UI 中查看。

## 13. 风险与待决策项

| 风险 / 待决策 | 处理建议 |
| --- | --- |
| `API.md` 仍有旧主题契约 | 后续校正；CLI 不把旧参数转成新 API 请求 |
| 任务 POST 超时后结果不确定 | 初始版返回 `SUBMISSION_UNKNOWN`；后续可为关键写操作加服务端 idempotency key |
| 人工确认点与 Agent 自动化程度冲突 | 由 Skills 按用户指令判断是否继续；候选/简报锁定前呈现对象和影响 |
| Agent 本地 Shell 权限较大 | CLI 命令白名单不视为安全沙箱；保留工作台单用户信任模型限制说明 |
| 打包后 Node 路径与服务端口不同 | 先完成仓库内 CLI，再加入 Electron Builder shim 和版本协议 |
| Skill 目录可能被工作台内部运行时扫描 | 外部 Agent Skills 与产品内部 `skills/` 隔离打包 |
| API 字段随服务演进 | 给 CLI 结果加 `schemaVersion`/`cliProtocolVersion`，同步维护 API 契约和兼容测试 |

## 14. 官方接入资料

- [OpenAI：Skills 工具指南](https://developers.openai.com/api/docs/guides/tools-skills)——Skills 用于复用流程指令；本地 Shell 场景从运行环境提供 Skill 文件。
- [OpenAI：Shell 工具指南](https://developers.openai.com/api/docs/guides/tools-shell)——Agent 可在受控运行环境中执行 Shell；本地 Shell 由用户侧运行时负责执行并回传结果。
- [腾讯云 WorkBuddy：连接器](https://cloud.tencent.com.cn/document/product/1831/134525)——连接器文档描述 MCP + CLI、Skill + CLI 接入形态。

