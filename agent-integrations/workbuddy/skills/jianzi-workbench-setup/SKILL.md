---
name: jianzi-workbench-setup
description: 安装、诊断和配置见字工作台与 Codex/WorkBuddy 集成时使用。适用于初始化项目、连接本机 MCP、检查账号画像和工作台配置。
---

# 见字工作台安装与配置

见字工作台是运行在本机的内容生产系统。先确认用户正在项目目录中，并让 MCP 工具 `jianzi_doctor` 检查 `http://127.0.0.1:4317`。

## 配置步骤

1. 如工作台尚未安装依赖或缺少运行配置，说明将运行项目自带安装引导：Windows 执行 `setup-workbench.cmd`，macOS/Linux 执行 `./setup-workbench.sh`。这两个入口会先按项目现有规则选择或引导安装 Node，再启动 setup。首次运行时让用户决定是否安装 RSSHub；不要传 `--yes`，以便在用户选择 RSSHub 时先跳过通用安装，再按下一步固定版本。
2. 对全新克隆且用户选择安装 RSSHub 的项目，先让通用向导跳过 RSSHub；从 `server/platform/integrations/rsshub-installer.mjs` 读取 `RSSHUB_INSTALL_MANIFEST.revision`，在 `config.local.json` 指定的 RSSHub 目录执行 `git init`、`git remote add origin https://github.com/DIYgod/RSSHub.git`、`git fetch --depth 1 origin <revision>`、`git checkout --detach FETCH_HEAD`，再运行上述向导安装依赖。不要为了这一步改动通用 setup，也不要替已有项目切换 RSSHub 版本。
3. 配置当前 Agent：执行 `node scripts/agent-integration/cli.mjs install --agent codex`、`--agent workbuddy` 或 `--agent both`。
4. Codex 使用项目级 `.codex/config.toml` 和 `.agents/skills/`；首次使用时需要信任该项目并重启/刷新 MCP。
5. WorkBuddy 使用项目级 `.mcp.json` 与 `.codebuddy/skills/`。若该 WorkBuddy 客户端不加载项目配置，引导用户在连接器设置中导入 `agent-integrations/workbuddy` 并检查本机 MCP 进程权限。
6. 再次调用 `jianzi_doctor`。若连接失败，确认工作台正在运行、端口配置一致，然后重启 MCP 连接。

## 模型配置

读取 `jianzi_settings_summary` 并只说明哪些模型/服务商已配置，不输出密钥。采集后可由 Agent 自行看热点和作编辑判断；调用文章成稿、AI 排版、封面或图文生成工具时，实际生成由见字 ModelGateway 执行，若无内部模型配置应清楚告知用户。

不要编辑或输出 `.env`、`config.local.json` 中的密钥字段。不要通过批次删除、外部发布或修改第三方账号设置来完成初始化。
