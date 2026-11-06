# Codex / WorkBuddy 接入

本目录保存外部 Agent Skills 和 WorkBuddy Connector 元信息。CLI 与 MCP 服务由项目 Node 运行时直接启动，不需要额外 npm MCP 依赖。

Codex 和 WorkBuddy 的完整安装与使用流程见[Agent 使用指南](../docs/agent-usage-guide.md)。

## 首次使用

Codex 可以先安装仓库外的引导插件，再从任意工作目录初始化项目：

```powershell
codex plugin marketplace add shiker1996/wechat-editroom --ref master --sparse .agents/plugins --sparse agent-integrations/codex-marketplace/plugin
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

MCP 同时提供内部模型任务和外部 Agent 结果提交两条路径。默认 Skills 使用外部 Agent 当前会话完成打标、事件卡/研判、编辑决策、文章、排版、封面和图文生成，再通过受限 MCP 工具提交。文章文档接口负责保存；可选的本地文章审计只给出确定性提醒，不代替事实核验或审稿。排版、封面和图文提交执行各自的确定性校验，图文支持浏览器审计、截图与归档。不要求配置见字内部模型。`*_generate`、`*_auto_research` 等内部任务工具仍保留，只有用户明确选择时才使用。外部 Agent 的模型会话和凭据不会传入工作台；采集器凭据按用户确认通过工作台配置 API 保存，并在返回值中遮蔽。

排版、封面和图文生成/提交成功后，MCP 与 CLI 结果会附带 `artifactEntries`，包含对应的工作台入口 URL（文章预览 `/#preview`、文章封面 `/#cover`、工具图文 `/#social-editor`、事件图文 `/#social-event`、自定义图文 `/#social-custom`）。完成任务后，Agent 应从工具结果中取出对应 URL 并在最终回复中作为可点击链接提供；异步任务的 `jianzi_job_get` / `jianzi_job_wait` 也会根据任务类型返回入口。入口用于在工作台查看、复制或下载产物，不代表已发布到公众号。

## MCP 工具

MCP 暴露 `jianzi_*` 具名工具，覆盖安装诊断、账号画像读写、采集器及采集源配置、批次/采集、热点标签、稳定事件、事件卡和研判报告提交、热点候选、自主写作和自定义图文项目创建、编辑决策、文章文档、文章配图规划/读取/生成/CDN 上传、排版/封面/图文产物提交和后台任务轮询。文章配图沿用工作台图片占位校验、格式与大小限制及资产登记；CDN 上传是外部写入，只在用户明确要求时调用。自主写作项目可由 MCP 创建而不启动见字内部模型；自定义图文项目创建时保存事实基座，后续由外部 Agent 生成故事板与视觉产物。图文 HTML 可在生成过程中调用浏览器审计工具反复检查；最终提交仍会复审、截图并归档。工具不提供任意 HTTP、数据库、shell、发布或删除能力。完整流程和具体工具顺序见 `skills/jianzi-topic-to-article`、`skills/jianzi-typeset-cover`、`skills/jianzi-social-cards`。

外部 Agent 可通过 `jianzi_integration_configuration_catalog/get/save/test` 配置采集器和又拍云图片 CDN。配置目录不包含模型、账号或任意插件配置；先读取 schema，取得用户明确提供的配置后再保存。秘密字段由工作台保存到隔离凭据存储，工具结果仅返回秘密字段是否已配置，不回显凭据。`test` 仅检查配置完整性，不验证第三方服务连通性。

本机工作台只接受 loopback 连接，MCP 子进程必须运行在同一台电脑。远程 WorkBuddy Agent 无法直接访问用户电脑上的 `127.0.0.1`。
