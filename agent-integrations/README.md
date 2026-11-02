# Codex / WorkBuddy 接入

本目录保存外部 Agent Skills 和 WorkBuddy Connector 元信息。CLI 与 MCP 服务由项目 Node 运行时直接启动，不需要额外 npm MCP 依赖。

Codex 和 WorkBuddy 的完整安装与使用流程见[Agent 使用指南](../docs/agent-usage-guide.md)。

## 首次使用

Codex 可以先安装仓库外的引导插件，再从任意工作目录初始化项目：

```powershell
codex plugin marketplace add shiker1996/wechat-editroom --ref codex/agent-mcp-integration --sparse agent-integrations/codex-marketplace
```

然后在 Codex 的 Plugins 目录中安装 `jianzi-workbench-setup`，并运行 `$jianzi-project-onboarding`。它会引导选择项目目录、克隆代码、运行项目 setup，并完成账号画像和采集源配置。Codex 插件由独立的 marketplace 包装，项目内的 CLI/MCP 仍由新项目提供。

如果项目已经克隆，则直接：

1. 在项目根目录执行平台初始化入口：Windows 用 `setup-workbench.cmd`，macOS/Linux 用 `./setup-workbench.sh`。它会按项目现有规则选择或引导安装 Node，并完成依赖和基础配置；RSSHub 等可选来源由用户决定是否安装。
2. 启动工作台：Windows 用 `start-workbench.cmd`，macOS/Linux 用 `./start-workbench.sh`。
3. 安装当前 Agent 配置：

   ```powershell
   npm run jianzi -- install --agent codex
   # 或
   npm run jianzi -- install --agent workbuddy
   # 或同时写入两种客户端配置
   npm run jianzi -- install --agent both
   ```

4. 运行 `npm run jianzi -- doctor --json` 检查连接。
5. Codex 信任新项目并重载 MCP；之后可用 `jianzi-project-onboarding` Skill 完成账号和采集源配置。

WorkBuddy 安装会生成项目级 `.mcp.json` 并复制 Skills 到 `.codebuddy/skills/`。不支持项目级配置的客户端，需要在其 MCP 设置中添加 `node <项目路径>/scripts/agent-integration/mcp-server.mjs`；WorkBuddy 开放平台发行包见 `workbuddy/`。

## 常用 CLI

```powershell
npm run jianzi -- batch list --json
npm run jianzi -- batch create --title "科技热点"
npm run jianzi -- batch collect --batch <批次ID>
npm run jianzi -- batch ranking --batch <批次ID>
npm run jianzi -- candidate get --candidate <候选ID>
npm run jianzi -- article documents --batch <批次ID> --candidate <候选ID> --kind final
npm run jianzi -- job wait --job <任务ID> --timeout 240
npm run jianzi -- account profile
npm run jianzi -- account update --file account-context.json
npm run jianzi -- collectors list
npm run jianzi -- sources list
npm run jianzi -- sources add --plugin feed-collector --file source.json
npm run jianzi -- sources test --id <采集源ID>
```

文章成稿、审稿、排版、封面和图文视觉等已接入的任务使用当前默认 Agent Runtime；未接入外部 Runtime 的任务仍使用见字工作台模型。外部 Agent 的模型会话和模型凭据不会传入工作台；采集器凭据按用户确认通过工作台配置 API 保存，并在返回值中遮蔽。

## MCP 工具

MCP 暴露 `jianzi_*` 具名工具，覆盖安装诊断、账号画像读写、采集器及采集源配置、批次/采集/研判、候选/编辑决策、文章/排版/封面、图文故事板/生成和后台任务轮询。所有动作通过 loopback HTTP API 执行，服务端继续负责状态与业务门禁；不提供任意 HTTP、数据库、shell、发布或删除工具。

本机工作台只接受 loopback 连接，MCP 子进程必须运行在同一台电脑。远程 WorkBuddy Agent 无法直接访问用户电脑上的 `127.0.0.1`。
