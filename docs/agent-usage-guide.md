# 使用 Codex / WorkBuddy / MCP Agent 安装和操作见字工作台

> 类别：使用指南  
> 状态：已实施  
> 适用于：Codex、WorkBuddy、DeepSeek Harness、Kimi 等可运行本机 MCP `stdio` 服务的 Agent 客户端；Windows 示例使用 PowerShell

本文介绍怎样让 Codex、WorkBuddy 或其他兼容 MCP 的 Agent 客户端连接见字工作台，配置账号画像和采集源，并通过自然语言完成采集、研判、文章、排版、封面和图文流程。

## 1. 先理解三个组成部分

| 组成 | 用途 |
|---|---|
| Codex 项目引导插件 | 在项目尚未安装时，指导 Codex 选择目录、克隆代码、运行安装向导，并初始化账号画像和采集源。它是 Codex 专用入口。 |
| 项目级 MCP 与 Skills | 安装在见字项目内。各客户端共用业务工具与流程规则；Codex、WorkBuddy 有安装预设，其他支持本机 MCP 的客户端可手动连接。 |
| 见字工作台内部模型 | 可选。只有用户明确选择工作台内部 AI 路径时才需要；默认外部 Agent 用当前会话完成研判、成稿、排版、封面和图文生成。 |

外部 Agent 的模型负责理解要求、分析内容并生成文章和视觉产物；见字通过 MCP 保存结果并执行确定性门禁、规范化、浏览器审计、截图和归档。因此默认外部 Agent 流程不要求配置见字内部模型。账号画像、采集源配置和批次数据仍由工作台保存和管理。

## 2. Codex：从空目录安装

### 2.1 准备 Codex 引导插件

在终端添加项目提供的 Codex 插件市场：

```powershell
codex plugin marketplace add shiker1996/wechat-editroom --ref codex/external-agent-tools --sparse agent-integrations/codex-marketplace
```

然后在 Codex 的 Plugins 目录中找到并安装 `jianzi-workbench-setup`。Codex 官方说明支持通过 `codex plugin marketplace add` 添加带 Git ref 和 sparse 路径的插件市场，插件本身通过 Plugins 目录安装。[Codex 插件市场说明](https://developers.openai.com/plugins/build/plugins)

安装后，新开一个 Codex 对话并提出类似请求：

> 帮我在 `E:\Jianzi` 初始化一个新的见字工作台项目。先检查 Git、Node.js 和 npm，安装时逐项解释选项；RSSHub 是可选项，先问我再安装。启动工作台后，带我配置账号画像和我指定的采集源，并测试采集源。

Codex 会使用 `$jianzi-project-onboarding` 引导 Skill。你也可以直接在对话中提到该 Skill。确认目标目录为空或不存在；不要让 Codex 克隆到已有项目目录上。

### 2.2 安装与启动工作台

引导流程会检查 Git 和平台 shell，在目标目录克隆项目，然后运行项目自带的 Node 引导入口：

```powershell
.\setup-workbench.cmd
.\start-workbench.cmd
```

macOS/Linux 使用 `./setup-workbench.sh` 和 `./start-workbench.sh`。入口会优先使用系统中满足项目要求的 Node；缺失或版本不足时，按项目规则下载到 `.node-runtime`。安装向导会询问是否安装依赖、是否创建本地配置，以及是否安装 RSSHub。RSSHub 是可选来源；只有你需要 RSSHub 路由时才安装。工作台默认在 `http://127.0.0.1:4317` 启动。

如果选择在全新项目中安装 RSSHub，首次向导先跳过 RSSHub；从 `server/platform/integrations/rsshub-installer.mjs` 读取固定 commit，在 `config.local.json` 指定的 RSSHub 目录获取并检出该 SHA，再次运行初始化入口安装 RSSHub 依赖。这样只影响新项目的 Agent 安装流程，不改动通用初始化逻辑，也不切换已有项目的 RSSHub 版本。为保留此交互步骤，不要给首次初始化入口传 `--yes`。

### 2.3 安装 MCP 与 Skills 并连接 Codex

在项目根目录安装 Codex 的项目级 MCP 配置和 Skills：

```powershell
npm run jianzi -- install --agent codex
npm run jianzi -- doctor --json
```

安装会创建项目级 `.codex/config.toml` 和 `.agents/skills/`。随后在 Codex 中信任该项目目录，并重载或重启 MCP 连接。确认 Codex 工具列表中出现 `jianzi_*` 工具，再调用 MCP 工具 `jianzi_doctor` 验证连通；CLI `doctor` 只验证工作台 API，不代替客户端 MCP 握手。MCP 子进程与工作台都运行在本机，连接默认 loopback 地址。

默认外部 Agent 工作流不需要在“运行与配置”中添加模型服务商。只有明确要调用 `jianzi_*_generate` 或 `jianzi_batch_auto_research` 等见字内部 AI 工具时，才配置并测试工作台模型。

## 3. WorkBuddy：连接已有项目

可以直接把 Git 仓库地址发给 WorkBuddy，让它在本机工作区克隆项目、运行安装向导、启动工作台并配置 WorkBuddy MCP。WorkBuddy 支持通过对话驱动 CLI 与 Skill；见[WorkBuddy 连接器文档](https://open.workbuddy.cn/docs/connector)。这要求当前 WorkBuddy 会话能操作本机终端和项目文件；纯远程会话无法连接本机 `127.0.0.1` 上的工作台。

例如可以这样提出请求：

> 请从 `https://github.com/shiker1996/wechat-editroom.git` 的 `codex/external-agent-tools` 分支克隆见字工作台到本机 `E:\Jianzi`，运行项目自带的 `setup-workbench.cmd`。安装选项逐项问我，RSSHub 暂时跳过。随后用 `start-workbench.cmd` 启动工作台，运行 `npm run jianzi -- install --agent workbuddy`，在 WorkBuddy 中启用项目 MCP 并刷新连接；调用 `jianzi_doctor` 确认工具可用，再带我设置账号画像和采集源。每个来源先测试，不要自动启动批次采集。默认使用 WorkBuddy 当前会话生成，不配置见字内部模型。

项目克隆完成后，WorkBuddy 还可以读取仓库中的 Skill 与连接器说明，继续完成下文配置。WorkBuddy 的 MCP 进程必须运行在能访问项目文件和本机工作台的同一台电脑上。

### 3.1 初始化项目并启动工作台

在项目根目录运行平台初始化入口并启动工作台：

```powershell
.\setup-workbench.cmd
.\start-workbench.cmd
```

macOS/Linux 使用 `./setup-workbench.sh` 和 `./start-workbench.sh`。

默认外部 Agent 流程不要求配置工作台模型；文章、排版、封面和图文由 WorkBuddy 当前会话生成，见字负责校验、渲染和归档。只有用户选择见字内部 AI 路径时，才需要配置并测试工作台模型。

### 3.2 安装 WorkBuddy 配置

在项目根目录运行：

```powershell
npm run jianzi -- install --agent workbuddy
npm run jianzi -- doctor --json
```

安装命令会生成项目级 `.mcp.json`，并将业务 Skills 复制到 `.codebuddy/skills/`。在 WorkBuddy 中打开并信任该项目，启用项目 MCP 后刷新或重启连接，再让它调用 `jianzi_doctor` 确认工作台连通。

如果当前 WorkBuddy 客户端不读取项目级 `.mcp.json`，在 MCP 设置中添加本机 stdio 服务：

| 字段 | 值 |
|---|---|
| 类型 | stdio |
| 命令 | 当前项目使用的 Node.js 可执行文件，或 `node` |
| 参数 | `<项目绝对路径>/scripts/agent-integration/mcp-server.mjs` |
| 工作目录 | `<项目绝对路径>` |

连接器配置模板和 WorkBuddy Skills 位于仓库的 `agent-integrations/workbuddy/`。MCP 进程必须运行在能访问项目文件和 `http://127.0.0.1:4317` 的同一台电脑上；远程 WorkBuddy 会话不能直接连接用户电脑的 loopback 服务。若通过 WorkBuddy 开放平台分发连接器，还需按平台要求打包并完成审核。

完成连接后，账号、采集源和日常内容生产的操作方式与本指南后续章节相同。可以直接向 WorkBuddy 提出例如：

> 先检查见字工作台是否连接。如果账号画像未配置，采访我并在确认后保存；然后列出采集器和当前采集源，说明每种来源的前置条件。先不要启动采集。

### 3.3 DeepSeek Harness、Kimi 和其他 MCP 客户端

只要客户端能在本机启动 MCP `stdio` 服务，就可以连接同一个工作台 MCP；无需申请平台 Runtime OAuth，也无需在见字中配置该 Agent 平台的模型。CLI 的 `install --agent` 目前为 Codex 与 WorkBuddy 生成项目级客户端配置；其他客户端在 MCP 设置中手动添加服务，并从 `agent-integrations/skills/` 安装其支持的项目 Skills。

通用配置示例（各客户端的字段名和设置界面可能不同）：

```json
{
  "mcpServers": {
    "jianzi_workbench": {
      "command": "<项目 Node.js 可执行文件或 node>",
      "args": ["<见字项目绝对路径>/scripts/agent-integration/mcp-server.mjs"],
      "env": {
        "JIANZI_WORKBENCH_URL": "http://127.0.0.1:4317"
      }
    }
  }
}
```

先启动见字工作台，再刷新客户端 MCP 连接，并调用 `jianzi_doctor`。若工作台使用非默认端口，将 `JIANZI_WORKBENCH_URL` 改为实际的本机地址。MCP 子进程必须运行在能访问项目目录和工作台 loopback 地址的同一台电脑上；纯云端、不能启动本机进程的 Agent 会话无法直接连接。

不同客户端安装 Skills 的方式由客户端决定。将 `agent-integrations/skills/` 下需要的技能目录添加到客户端的项目级 Skill 搜索路径，并在对话中要求 Agent 先读 `jianzi-workbench-setup`，再按本指南执行。完成接入后，Agent 可用当前会话模型生成结果；见字 MCP 负责读取项目资料、保存提交结果并运行工作台门禁。

## 4. 配置账号画像

可以让 Codex 或 WorkBuddy 通过问题访谈整理公众号名称、简介、核心读者、内容支柱、选题分类和写作边界。示例：

> 先读取当前账号画像。如果还没配置，请逐项采访我，整理成草案让我确认后再保存。不要猜测账号事实，也不要把 API Key 或其他凭据写入画像。

确认草案后，Agent 会通过 `jianzi_account_profile_update` 保存，并回读确认配置状态。已有画像时，要求 Agent 先读取并在展示差异、得到确认后再更新。

也可以使用 JSON 文件通过 CLI 更新：

```powershell
npm run jianzi -- account profile
npm run jianzi -- account update --file .\account-context.json
```

字段结构可参考仓库根目录的 [`account-context.example.json`](../account-context.example.json)。该文件用于编辑画像，不应存放模型密钥、采集器密钥或账号密码。

## 5. 配置采集器和采集源

建议先让 Agent 盘点可用能力和现有配置，再决定启用哪些来源：

> 检查当前支持的采集器、采集源和配置状态。告诉我每种来源需要的前置条件和凭据；不要先启动批次采集。我们确认来源和配置后，再逐个保存并测试。

Codex 会先读取采集器列表、能力目录、配置结构和现有来源。不同来源可能需要 RSS/Atom 地址、RSSHub 路由、Reddit 登录环境或服务商凭据。Codex 应根据工作台提供的字段结构询问必要信息，不应猜字段或输出密钥。

保存来源前，先核对来源类型、名称、地址/路由和启用状态。每个来源保存后单独测试，再回读来源列表，说明成功、失败和仍缺少的前置条件。测试通过不代表已经执行批次采集；是否采集由你决定。

CLI 查询入口：

```powershell
npm run jianzi -- collectors list
npm run jianzi -- collectors config-list
npm run jianzi -- sources capabilities
npm run jianzi -- sources list
```

采集器配置写入和来源创建需要 JSON 输入，格式应先依据对应采集器的配置 Schema 准备。命令示例：

```powershell
npm run jianzi -- collectors config-get --id <采集器ID>
npm run jianzi -- collectors config-set --id <采集器ID> --file .\collector-config.json
npm run jianzi -- collectors config-test --id <采集器ID>
npm run jianzi -- sources add --plugin <采集器ID> --label "来源名称" --file .\source-config.json
npm run jianzi -- sources test --id <采集源ID>
```

凭据只在用户确认后通过工作台受控配置接口保存；工具返回会遮蔽敏感字段。避免在终端命令行参数、聊天记录或共享 JSON 文件中写明文密钥。

## 6. 日常使用示例

### 6.1 采集与研判

> 新建一个今天的科技热点批次，使用已配置的来源采集。完成后告诉我哪些来源失败、有哪些候选热点；先给我研判结果，不要自动把所有热点都加入文章候选。

可通过 CLI 查看批次、创建批次、启动采集和查看排名：

```powershell
npm run jianzi -- batch list --json
npm run jianzi -- batch create --title "科技热点"
npm run jianzi -- batch collect --batch <批次ID>
npm run jianzi -- batch ranking --batch <批次ID>
```

AI 自动研判可使用 `npm run jianzi -- batch auto --batch <批次ID>`。命令返回后台任务时，使用 `npm run jianzi -- job wait --job <任务ID> --timeout 240` 等待，并根据任务最终状态报告结果。

### 6.2 文章成稿、排版与封面

> 从批次 `<批次ID>` 的候选中，结合账号画像比较选题。先向我说明事实依据、未知项和风险；我确认后再锁定候选、生成文章终稿，并继续生成 AI 排版和封面。

默认由 Codex 当前会话完成文章、排版和封面，再通过外部 Agent MCP 提交工具保存；见字执行门禁并归档。只有用户明确要求见字内部 AI 时，才调用内部生成工具并确认模型已配置。排版、封面或图文提交成功后，从工具结果 `artifactEntries` 取出预览入口，在最终回复中附上可点击链接；异步任务则从 `jianzi_job_wait` 结果读取入口。

### 6.3 图文生成

> 查看候选 `<候选ID>` 的图文事实基座和故事板。如果没有故事板，请先根据事实生成方案并让我确认；确认后锁定故事板，由你当前会话生成 AI 视觉图文并提交工作台审计。完成后汇报审计结果，并给我工作台事件图文入口链接。

默认由外部 Agent 当前会话生成图文 HTML 和配套文案，工作台负责门禁、视觉审计、PNG 截图和归档；提交成功后应从 `artifactEntries` 返回事件图文入口。只有用户明确选择见字内部 AI 时，才调用内部生成工具并配置相应模型。

## 7. 常用 CLI 命令

在见字项目根目录运行：

```powershell
npm run jianzi -- --help
npm run jianzi -- doctor --json
npm run jianzi -- account profile
npm run jianzi -- batch list --json
npm run jianzi -- candidate get --candidate <候选ID>
npm run jianzi -- article documents --batch <批次ID> --candidate <候选ID> --kind final
npm run jianzi -- job get --job <任务ID>
```

如果工作台使用非默认端口，可添加 `--server http://127.0.0.1:<端口>`。外部 Agent 默认使用自身会话模型；只有见字内部 AI 命令读取工作台模型配置。排版、封面与图文命令成功后，CLI JSON 结果包含 `artifactEntries` 入口。

## 8. 常见问题

### Codex 没看到见字工具或 Skill

确认 Codex 打开的就是已安装项目级配置的项目目录；检查 `.codex/config.toml` 是否包含 `jianzi_workbench`；在 Codex 中信任项目并重载或重启 MCP。项目级 Skills 位于 `.agents/skills/`。

### `doctor` 显示未连接

先确认 `npm start` 正在运行，并核对工作台端口。默认端口为 `4317`；非默认端口时给 CLI 增加 `--server`，再重新连接 MCP。

### 采集器或来源测试失败

查看测试结果给出的缺失配置、登录状态、地址或网络错误。只修改失败来源所需的配置，再单独重测；不要因此自动运行整批采集。

### 文章或图文生成失败

先检查任务是否走外部 Agent 提交路径，或走了见字内部 `*_generate` 路径。前者不依赖工作台模型；后者需检查工作台模型服务商是否已启用并测试成功，再查看任务错误和产物状态。Codex/WorkBuddy 与见字内部模型配置彼此独立。

## 9. 权限与使用边界

- 账号画像和采集源写入前，先向用户展示待保存的信息并取得确认。
- 采集器凭据和模型 API Key 不放入画像，也不在回复、日志或示例中复述。
- 不自动批量采集、删除数据或发布公众号内容；只有用户明确要求时才继续相应流程。
- MCP 只连接本机 loopback 工作台。远程 Codex 会话不能直接访问用户电脑上的 `127.0.0.1`。
