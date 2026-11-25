# 社交卡 AI 视觉生成当前流程契约

## 用户目标与范围

- 输入已冻结的图文事实、故事板和视觉方案，生成可截图的多页 HTML，再由编排层截图并交付。
- 自定义图文的方向研判、素材补齐和故事板就绪门禁见[自定义图文策划流程契约](custom-social-card-planning.md)；本契约中的视觉生成、审计和交付实现保持原样。
- 本流程负责 AI 视觉 HTML 生成、程序布局审计和失败页局部修复；文章封面生成使用共享写入插件，但不暴露 `replace-page`。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 社交卡图文编排 | `server/features/social-cards/application/social-card-beautify.mjs` | 准备输入、写入与审计工具、运行生成 Agent、记录阶段并启动交付 |
| 外部 Agent MCP | `scripts/agent-integration/tools.mjs`、`server/platform/http/routes/social-card-routes.mjs` | 外部 Agent 必须把结构化视觉方案和整份 HTML 一起审计；Agent 在自己的草稿中返修，再重审并提交 |
| 单 Agent 文档协议 | `server/platform/agent/ai-visual-document-agent.mjs` | 读取资料、管理写入/审计时序及 finish 条件；社交卡和文章封面共用 Agent 编排 |
| 社交卡写入能力 | `plugins/ai-visual-document-writer/adapter.mjs`、`plugins/ai-visual-document-writer/manifest.json` | 在活动会话内追加文档，或按锚点精确替换单页 |
| 程序布局与方案兑现审计 | `server/features/social-cards/application/social-card-visual-audit.mjs`、`server/features/social-cards/application/social-card-design-scheme-contract.mjs`、`server/features/social-cards/application/social-card-design-conformance.mjs`、`server/platform/browser/html-layout-probe.mjs` | Chromium 检查 375×667 画布、正文溢出、内容页占用率、列表条目，以及统一方案与每页 DOM 标记、共用锚点和渲染背景差异 |
| Agent 行为规范 | `skills/social-card-ai-visual-generator/SKILL.md` | 要求页码锚点、单页修复和事实/视觉边界 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 视觉范式选择 | 已通过门禁的故事板 | 按当前故事板推荐 3 个范式和自由设计；用户选择后将范式 ID 与故事板 SHA-256 指纹写入 `card_editorial_sessions.visual_paradigm_json`。故事板变更会使选择过期；范式只约束页面结构和允许版式，不定义颜色/字体主题 | `social-card-routes.mjs`、`social-card-visual-paradigms.mjs`、`social-editor.js` |
| 视觉方案 | 标题、渠道、内容类型、故事板页职责/标题/导语/布局意图、已选范式 | 生成并校验统一 schema v4：必填 `paradigmId`，约束版式属于所选范式；视觉方向、调色板、结构化字阶、组级构图系统、视觉语言、系列锚点和逐页设计独立制定。输出 `social-design-scheme.json/.md` | `social-card-design-scheme.mjs`、`social-card-design-scheme-contract.mjs`、`visual-direction-catalog.mjs` |
| 生成 | 冻结输入、故事板、已选范式、schema v4 视觉方案 | 内部 Agent 与外部 Agent 均按同一方案写入完整 HTML；服务端校验范式选择仍匹配当前故事板，且页数、顺序、职责、允许版式、每页 DOM 标记与系列锚点通过校验 | `social-card-beautify.mjs`、`social-card-design-scheme.mjs`、`ai-visual-document-agent.mjs`、`ai-visual-document-writer/adapter.mjs` |
| 首次审计 | 当前完整 HTML | 程序返回每页尺寸、正文容器测量和带页码的问题；2px 内为可接受误差 | `social-card-visual-audit.mjs`、`html-layout-probe.mjs` |
| 页级修复 | 审计只返回带页码的 `CONTENT_OVERFLOW` 问题 | Agent 一次用 `replace-page(page, content)` 替换一个完整 `.page` 根元素；插件验证目标页锚点、DOM 页码、唯一根元素、会话版本与请求幂等键。全局样式/结构错误和其他页原样保留，无法安全定位时走全量重建 | `social-card-beautify.mjs`、`ai-visual-document-writer/adapter.mjs` |
| 复审与结束 | 被修改后的完整 HTML | 内容摘要变化会使旧审计失效；Agent 必须重新审计整份 HTML。所有问题消除且页数匹配后才能 `finish`；无可定位页码的文档级问题，或写入器明确拒绝锚点/页面根结构时，允许 abort 并全量重建 | `social-card-beautify.mjs`、`ai-visual-document-agent.mjs` |
| 截图与交付 | 已 finish 且审计通过的 HTML | 编排器逐页截图、运行交付门禁并登记产物；阶段记录保留 `pageRepairAttempts` | `social-card-beautify.mjs`、`social-card-ai-visual-pipeline.mjs` |

## 入口间差异

- 社交卡内部 Agent 与 MCP 外部 Agent 共用视觉范式目录、按故事板推荐的选项、持久化选择与 SHA-256 指纹校验，以及版本化 designScheme v4、字段/版式校验、故事板页数/归一职责校验、逐页 DOM 标记与系列锚点兑现校验、色彩/字号和视觉多样性规则。结构 schema 位于 `server/shared/domain/schemas/social-card-design-scheme.mjs`，业务校验位于 `social-card-design-scheme-contract.mjs`，MCP 工具 schema 从同一结构 schema 导出。
- 页面数量与锁定故事板严格一致；需要拆分或合并时先回到故事板阶段。内部恢复遇到旧版本方案或范式 ID 不匹配会重新生成 v4；历史产物不迁移。外部 Agent 提交使用 v4 MCP schema，并且必须匹配服务端保存的当前范式选择。
- MCP 外部路径的 `jianzi_card_visual_audit` 和 `jianzi_card_visual_submit` 均要求携带同一份方案；外部 Agent 在自己的草稿中返修并重审，提交时服务端重新执行完整门禁。整组审计返回联系表供外部 Agent 视觉复核，标记不能替代对真实视觉效果的确认。
- 内部 Agent 使用同一 `auditSocialCardHtmlFit` 和视觉方案兑现检查，并通过工具 schema 暴露 `replace-page`；服务端参数解析器与写入插件共同限制只修当前审计失败的页。外部路径不共享内部 Agent 写入会话，因此不调用 `replace-page`。
- 内部与外部的修复/交付入口仍不同：内部 Agent 使用文档写入会话和页级修复；外部 Agent 在自有草稿里改 HTML。画布和截图交付仍为 375×667。
- 文章封面复用共享 Agent 和写入插件，但其工具 schema 不暴露页级操作，也不使用本契约中的社交卡审计门禁。
- Agent 的原生 function tool 和 JSON ToolRequest 两条调用路径共用社交卡参数解析器和同一个写入插件；非原生路径另有 Agent 层早期恢复校验。

## 产物与验证

- HTML：候选工作目录中的 `ai-beautified.html`；阶段记录：`social-card-ai-visual-stage-executions.json`。
- 外部 MCP 提交会同步归档 `publish-title.txt`、`copy.txt`、设计方案 JSON、逐页 PNG 和交付报告；标题文件与候选预览接口读取的标题保持一致。
- 相关既有验证：`test/ai-visual-document-writer-plugin.test.mjs`、`test/social-card-ai-visual-baseline.test.mjs`、图文生成与页面数门禁测试。

## 变更触点

- 视觉方案：`server/shared/domain/schemas/social-card-design-scheme.mjs`、`server/features/social-cards/application/social-card-design-scheme.mjs`、`server/features/social-cards/application/social-card-design-scheme-contract.mjs`、`server/shared/themes/visual-direction-catalog.mjs`。
- 写入协议：`plugins/ai-visual-document-writer/adapter.mjs`、`plugins/ai-visual-document-writer/manifest.json`。
- 社交卡调用门禁与记录：`server/features/social-cards/application/social-card-beautify.mjs`。
- Agent 指令：`server/platform/agent/ai-visual-document-agent.mjs`、`agent-integrations/dsh-workbench/lib/client.js`。
- 技能与当前流程：`skills/social-card-ai-visual-generator/SKILL.md`、`agent-integrations/skills/jianzi-social-cards/SKILL.md`、`agent-integrations/workbuddy/skills/jianzi-social-cards/SKILL.md`、`docs/workflows/social-card-ai-visual-generation.md`。
