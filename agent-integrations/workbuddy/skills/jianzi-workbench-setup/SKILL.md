---
name: jianzi-workbench-setup
description: 安装、诊断和配置见字工作台与 Codex/WorkBuddy 集成时使用。适用于初始化项目、连接本机 MCP、检查账号画像和工作台配置。
---

# 见字工作台安装与配置

见字工作台是运行在本机的内容生产系统。先确认用户正在项目目录中，并让 MCP 工具 `jianzi_doctor` 检查 `http://127.0.0.1:4317`。若服务未运行，调用 `jianzi_workbench_start`；它会运行项目官方启动脚本、不打开浏览器并等待 ready，然后再次验证健康状态。

如果当前目录不是见字项目（缺少 `server.mjs` 或 `scripts/runtime/start-workbench.ps1` / `.sh`），启动工具不能安装或克隆项目。先说明本机缺少项目 checkout，并询问用户是否将 `https://github.com/shiker1996/wechat-editroom.git` 克隆到一个空目录；只有用户确认后才克隆，绝不覆盖非空目录。克隆后再运行项目安装向导。若当前 Agent 没有终端或工作区文件权限，停止并给出手动步骤。

## 配置步骤

1. 如工作台尚未安装依赖或缺少运行配置，说明将运行项目自带安装引导：Windows 执行 `setup-workbench.cmd`，macOS/Linux 执行 `./setup-workbench.sh`。这两个入口会先按项目现有规则选择或引导安装 Node，再启动 setup。首次运行时让用户决定是否安装 RSSHub；不要传 `--yes`，以便在用户选择 RSSHub 时先跳过通用安装，再按下一步固定版本。
2. 对全新克隆且用户选择安装 RSSHub 的项目，先让通用向导跳过 RSSHub；从 `server/platform/integrations/rsshub-installer.mjs` 读取 `RSSHUB_INSTALL_MANIFEST.revision`，在 `config.local.json` 指定的 RSSHub 目录执行 `git init`、`git remote add origin https://github.com/DIYgod/RSSHub.git`、`git fetch --depth 1 origin <revision>`、`git checkout --detach FETCH_HEAD`，再运行上述向导安装依赖。不要为了这一步改动通用 setup，也不要替已有项目切换 RSSHub 版本。
3. 配置当前 Agent：执行 `node scripts/agent-integration/cli.mjs install --agent codex`、`--agent workbuddy` 或 `--agent both`。
4. Codex 使用项目级 `.codex/config.toml` 和 `.agents/skills/`；首次使用时需要信任该项目并重启/刷新 MCP。
5. WorkBuddy 使用项目级 `.mcp.json` 与 `.codebuddy/skills/`。若该 WorkBuddy 客户端不加载项目配置，引导用户在连接器设置中导入 `agent-integrations/workbuddy` 并检查本机 MCP 进程权限。
6. 再次调用 `jianzi_doctor`。若服务未运行，调用 `jianzi_workbench_start` 自动拉起并等待 ready；工具会核对 `workspaceId`，避免连到另一项目。若启动工具报端口占用、环境检查失败、项目指纹不匹配或超时，按返回信息排障，不要盲目重复启动。服务 ready 但 MCP 仍连不上时，再重启 MCP 连接。DSH/npm 包没有源码项目上下文，需给启动工具传本机绝对路径 `projectRoot`，或给 MCP 进程配置 `JIANZI_PROJECT_ROOT`。

新项目或隔离测试项目必须使用自己的 `config.local.json`、数据库、数据目录和可选 RSSHub checkout。不要把配置中的 RSSHub 地址改为另一个项目正在运行的服务，也不要复用其他项目的数据，除非用户明确要求迁移或共享。

## 模型配置

默认外部 Agent 工作流由当前 Agent 会话完成热点研判、文章写作、排版、封面和图文生成，再通过 MCP 提交给工作台校验、渲染和归档，不要求配置见字内部模型。只有用户明确选择 `jianzi_*_generate` 或 `jianzi_batch_auto_research` 等内部 AI 路径时，才读取 `jianzi_settings_summary` 检查模型配置；不得把缺少内部模型误报为外部 Agent 流程无法使用。

不要编辑或输出 `.env`、`config.local.json` 中的密钥字段。不要通过批次删除、外部发布或修改第三方账号设置来完成初始化。
