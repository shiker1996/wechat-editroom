# Codex / WorkBuddy 接入

本目录保存外部 Agent Skills 和 WorkBuddy Connector 元信息。CLI 与 MCP 服务由项目 Node 运行时直接启动，不需要额外 npm MCP 依赖。

## 首次使用

1. 在见字项目根目录执行 `npm run setup`，完成工作台依赖和基础配置；可选来源按提示决定是否安装。
2. 启动工作台：`npm start`。
3. 安装当前 Agent 配置：

   ```powershell
   npm run jianzi -- install --agent codex
   # 或
   npm run jianzi -- install --agent workbuddy
   # 或同时写入两种客户端配置
   npm run jianzi -- install --agent both
   ```

4. 运行 `npm run jianzi -- doctor --json` 检查连接。
5. 重启 Agent 的 MCP 连接。Codex 项目级 MCP 仅在用户信任当前项目后加载。

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
```

文章生成、排版、封面和图文视觉工具会调用见字工作台已配置的内部模型。外部 Agent 的模型会话和 API 凭据不会传入工作台；外部 Agent 结果导入能力列为后续工作。

## MCP 工具

MCP 暴露 `jianzi_*` 具名工具，覆盖安装诊断、账号画像、批次/采集/研判、候选/编辑决策、文章/排版/封面、图文故事板/生成和后台任务轮询。所有动作通过 loopback HTTP API 执行，服务端继续负责状态与业务门禁；不提供任意 HTTP、数据库、shell、发布或删除工具。

本机工作台只接受 loopback 连接，MCP 子进程必须运行在同一台电脑。远程 WorkBuddy Agent 无法直接访问用户电脑上的 `127.0.0.1`。
