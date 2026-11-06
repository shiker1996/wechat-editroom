# 社交卡 AI 视觉生成当前流程契约

## 用户目标与范围

- 输入已冻结的图文事实、故事板和视觉方案，生成可截图的多页 HTML，再由编排层截图并交付。
- 本流程负责 AI 视觉 HTML 生成、程序布局审计和失败页局部修复；文章封面生成使用共享写入插件，但不暴露 `replace-page`。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 社交卡图文编排 | `server/features/social-cards/application/social-card-beautify.mjs` | 准备输入、写入与审计工具、运行生成 Agent、记录阶段并启动交付 |
| 外部 Agent MCP | `scripts/agent-integration/tools.mjs`、`server/platform/http/routes/media-routes.mjs` | 外部 Agent 提交整份 HTML 做浏览器审计；Agent 在自己的草稿中返修，再重审并提交 |
| 单 Agent 文档协议 | `server/platform/agent/ai-visual-document-agent.mjs` | 读取资料、管理写入/审计时序及 finish 条件；社交卡和文章封面共用 Agent 编排 |
| 社交卡写入能力 | `plugins/ai-visual-document-writer/adapter.mjs`、`plugins/ai-visual-document-writer/manifest.json` | 在活动会话内追加文档，或按锚点精确替换单页 |
| 程序布局审计 | `server/features/social-cards/application/social-card-visual-audit.mjs`、`server/platform/browser/html-layout-probe.mjs` | Chromium 按 DOM 中 `.page` 顺序编号，检查 375×667 页面与正文容器溢出 |
| Agent 行为规范 | `skills/social-card-ai-visual-generator/SKILL.md` | 要求页码锚点、单页修复和事实/视觉边界 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 生成 | 冻结输入、故事板、视觉方案 | 单 Agent 通过 `begin`、多个 `append` 写入完整 HTML；finish 前插件强制核对每页 `CARD-PAGE:N:START/END` 注释，且 `.page[data-page="N"]` 与 DOM 顺序一致 | `social-card-beautify.mjs`、`ai-visual-document-agent.mjs`、`ai-visual-document-writer/adapter.mjs` |
| 首次审计 | 当前完整 HTML | 程序返回每页尺寸、正文容器测量和带页码的问题；2px 内为可接受误差 | `social-card-visual-audit.mjs`、`html-layout-probe.mjs` |
| 页级修复 | 审计只返回带页码的 `CONTENT_OVERFLOW` 问题 | Agent 一次用 `replace-page(page, content)` 替换一个完整 `.page` 根元素；插件验证目标页锚点、DOM 页码、唯一根元素、会话版本与请求幂等键。全局样式/结构错误和其他页原样保留，无法安全定位时走全量重建 | `social-card-beautify.mjs`、`ai-visual-document-writer/adapter.mjs` |
| 复审与结束 | 被修改后的完整 HTML | 内容摘要变化会使旧审计失效；Agent 必须重新审计整份 HTML。所有问题消除且页数匹配后才能 `finish`；无可定位页码的文档级问题，或写入器明确拒绝锚点/页面根结构时，允许 abort 并全量重建 | `social-card-beautify.mjs`、`ai-visual-document-agent.mjs` |
| 截图与交付 | 已 finish 且审计通过的 HTML | 编排器逐页截图、运行交付门禁并登记产物；阶段记录保留 `pageRepairAttempts` | `social-card-beautify.mjs`、`social-card-ai-visual-pipeline.mjs` |

## 入口间差异

- 社交卡使用程序视觉审计，并通过工具 schema 暴露 `replace-page`；服务端参数解析器与写入插件共同限制只修当前审计失败的页。
- MCP 外部 Agent 路径通过 `jianzi_card_visual_audit` 接收诊断结果并自行修改 HTML，再调用 `jianzi_card_visual_submit`；它不共享内部 Agent 写入会话，因此不调用 `replace-page`。Skill 要求只修改报错页并重新审计整组 HTML。
- 文章封面复用共享 Agent 和写入插件，但其工具 schema 不暴露页级操作，也不使用本契约中的社交卡审计门禁。
- Agent 的原生 function tool 和 JSON ToolRequest 两条调用路径共用社交卡参数解析器和同一个写入插件；非原生路径另有 Agent 层早期恢复校验。

## 产物与验证

- HTML：候选工作目录中的 `ai-beautified.html`；阶段记录：`social-card-ai-visual-stage-executions.json`。
- 相关既有验证：`test/ai-visual-document-writer-plugin.test.mjs`、`test/social-card-ai-visual-baseline.test.mjs`。本次未运行测试。

## 变更触点

- 写入协议：`plugins/ai-visual-document-writer/adapter.mjs`、`plugins/ai-visual-document-writer/manifest.json`。
- 社交卡调用门禁与记录：`server/features/social-cards/application/social-card-beautify.mjs`。
- Agent 指令：`server/platform/agent/ai-visual-document-agent.mjs`。
- 技能与当前流程：`skills/social-card-ai-visual-generator/SKILL.md`、`docs/workflows/social-card-ai-visual-generation.md`。
