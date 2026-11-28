# 社交卡 AI 视觉生成当前流程契约

## 用户目标与范围

- 输入已冻结的图文事实、故事板和视觉方案，生成可截图的多页 HTML，再由编排层截图并交付。
- 自定义图文的方向研判、素材补齐和故事板就绪门禁见[自定义图文策划流程契约](custom-social-card-planning.md)；本契约中的视觉生成、审计和交付实现保持原样。
- 本流程负责 AI 视觉 HTML 生成、程序布局审计和失败页局部修复；文章封面生成使用共享写入插件，但不暴露 `replace-page`。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 标题与配文生成 | `server/features/social-cards/application/social-card-copy.mjs`、`prompts/social-cards/copy.md` | 内部生成和 AI 美化共用同一调用；标题主旨透明、含 1–2 个搜索词、最多 20 字且无标题党词，程序校验长度 |
| 社交卡图文编排 | `server/features/social-cards/application/social-card-beautify.mjs` | 准备输入、写入与审计工具、运行生成 Agent、记录阶段并启动交付 |
| 外部 Agent MCP | `scripts/agent-integration/tools.mjs`、`server/platform/http/routes/social-card-routes.mjs` | 外部 Agent 必须把结构化视觉方案和整份 HTML 一起审计；可选发布标题须不超过 20 字；审计报告复用装饰空间几何诊断，Agent 在自己的草稿中按实测区域重排内容，再重审并提交 |
| 单 Agent 文档协议 | `server/platform/agent/ai-visual-document-agent.mjs` | 读取资料、管理写入/审计时序及 finish 条件；社交卡和文章封面共用 Agent 编排 |
| 社交卡写入能力 | `plugins/ai-visual-document-writer/adapter.mjs`、`plugins/ai-visual-document-writer/manifest.json` | 在活动会话内追加文档，或按锚点精确替换单页 |
| 程序布局与方案兑现审计 | `server/features/social-cards/application/social-card-visual-audit.mjs`、`server/features/social-cards/application/social-card-design-scheme-contract.mjs`、`server/features/social-cards/application/social-card-design-conformance.mjs`、`server/platform/browser/html-layout-probe.mjs` | Chromium 检查 375×667 画布、正文溢出、内容文字范围相对正文可用区的垂直居中偏差（18px 以内）、内容页占用率、列表条目，以及统一方案与每页 DOM 标记、共用锚点和渲染背景差异。测量正文主体/内容栈矩形、文字边界和装饰矩形；装饰与内容相交时，审计结果附带相交框及左右/上下可用版心建议，供 Agent 重排正文；这组几何数据用于诊断和修复，不新增独立准入门槛 |
| Agent 行为规范 | `skills/social-card-ai-visual-generator/SKILL.md` | 要求页码锚点、单页修复和事实/视觉边界 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 视觉范式选择 | 已通过门禁的故事板 | 按当前故事板推荐 3 个页面结构范式和自由结构；用户选择后将范式 ID 与故事板 SHA-256 指纹写入 `card_editorial_sessions.visual_paradigm_json`。故事板变更会使选择过期；范式只约束页面组织和允许版式，不定义视觉审美 | `social-card-routes.mjs`、`social-card-visual-paradigms.mjs`、`social-editor.js` |
| 视觉方案 | 标题、渠道、内容类型、故事板页职责/标题/导语/布局意图、已选范式 | 先比较 2–3 个基于本篇对象、读者痛点、叙事和证据的视觉概念，再选定具体 art direction；生成并校验统一 schema v5。范式约束版式；方案推导视觉方向、调色板、字阶、构图、视觉语言、系列锚点和逐页设计。整组页序每页最多一个稳定显示位置；重复页序作为 warning 回送 Agent 自动修正一次，未修正时不阻断方案生成。其他装饰意图可选；构图/背景多样性作为设计建议，不因数量不足阻断方案生成。schema 校验失败时，将 issues 和允许字段回送 Agent，最多自动修复 3 轮；若仅重复输出冗余的页级 `title`，清除该非契约字段后复核，再保存方案产物。输出 `social-design-scheme.json/.md` | `social-card-design-scheme.mjs`、`social-card-design-scheme-contract.mjs`、`visual-direction-catalog.mjs` |
| 生成 | 冻结输入、故事板、已选范式、schema v5 视觉方案 | 内部 Agent 与外部 Agent 均按同一方案写入完整 HTML；服务端校验范式选择仍匹配当前故事板，且页数、顺序、职责、允许版式、每页 DOM 标记、系列锚点和逐项可见装饰通过校验。内部社交卡生成不设 Agent 级步骤、调用、总时长、工具结果或历史字符预算；仍遵循单个工具声明的超时、模型上下文和单次输出限制。其他 Agent 预算不变 | `social-card-beautify.mjs`、`social-card-design-scheme.mjs`、`ai-visual-document-agent.mjs`、`conversation-agent.mjs`、`ai-visual-document-writer/adapter.mjs` |
| 整组结构审计 | 已完成的当前 HTML | 先省略 `page`，只检查整份文档的页数、DOM 页序、`data-page` 和页面起止锚点；不运行浏览器布局测量或逐页方案兑现检查。结构问题属于整份文档问题，不产生可供 `replace-page` 使用的失败页码；需修正或重建文档后重审。整组通过后不再允许 append | `social-card-beautify.mjs`、`ai-visual-document-agent.mjs`、`social-card-visual-audit.mjs` |
| 逐页测量与方案兑现 | 整组结构审计通过的当前 HTML | 从第 1 页按 DOM 顺序传 `page`，逐页检查溢出、居中、密度、列表、装饰空间和方案标记。只有此阶段返回的当前页失败可触发 `replace-page`；每页最多 3 次成功修复，每次后复审同一页。第 3 次修复后仍失败则保存完整审计报告并封存该页，继续下一页；封存页不能再次修复或导致整份文档重建。全部页面通过或封存后允许 `finish`，不再重复整组审计。原生文档工具调用由 Agent 服务端固定 `resourceId`、输出路径、会话 ID 和写入请求 ID | `social-card-beautify.mjs`、`ai-visual-document-agent.mjs`、`social-card-visual-audit.mjs`、`html-layout-probe.mjs`、`social-card-design-conformance.mjs`、`ai-visual-document-writer/adapter.mjs` |
| 截图与交付 | 已 finish 且所有页已通过或封存审计结果的 HTML | 编排器逐页生成 PNG 并检查图片数量；不在截图后重复运行布局审计。交付门禁检查 HTML 页数、配套文案、PNG 完整性和逐页审计是否均已完成；封存失败页作为审计警告保留，不阻断流程。`ai-visual-page-audit-results.json` 持久化每次页审计、修复次数和耗尽状态，并登记为运行产物 | `social-card-beautify.mjs`、`social-card-ai-visual-pipeline.mjs` |

## 入口间差异

- 社交卡内部 Agent 与 MCP 外部 Agent 共用视觉范式目录、按故事板推荐的选项、持久化选择与 SHA-256 指纹校验，以及版本化 designScheme v5、字段/版式校验、故事板页数/归一职责校验、逐页 DOM 标记与系列锚点兑现校验、逐页装饰清单与真实可见装饰兑现校验、色彩/字号和视觉多样性规则。结构 schema 位于 `server/shared/domain/schemas/social-card-design-scheme.mjs`，业务校验位于 `social-card-design-scheme-contract.mjs`，MCP 工具 schema 从同一结构 schema 导出。
- 页面数量与锁定故事板严格一致；需要拆分或合并时先回到故事板阶段。内外部 Agent 共用垂直居中测量与 18px 页级门禁；`CONTENT_NOT_CENTERED` 可与 `CONTENT_OVERFLOW` 一样通过单页替换修复。内部恢复遇到旧版本方案或范式 ID 不匹配会重新生成 v5；历史产物不迁移。外部 Agent 提交使用 v5 MCP schema，并且必须匹配服务端保存的当前范式选择。
- MCP 外部路径的 `jianzi_card_visual_audit` 和 `jianzi_card_visual_submit` 均要求携带同一份方案；外部 Agent 在自己的草稿中返修并重审，提交时服务端重新执行完整门禁。整组审计返回联系表供外部 Agent 视觉复核，标记不能替代对真实视觉效果的确认。
- 内部 Agent 的整组结构审计使用 `auditSocialCardHtmlGroup`；逐页阶段才调用 `auditSocialCardHtmlFit` 和视觉方案兑现检查，并通过工具 schema 暴露 `replace-page`。服务端参数解析器要求最近一次审计带有 `page` 且明确指出该页失败；每页修复成功次数封顶 3 次，仍失败时保留逐次报告并跳过该页。外部路径仍调用 `auditSocialCardHtmlFit` 对整份自有草稿做完整布局与方案审计、获得相同装饰空间几何诊断；外部 Agent 在自有草稿中返修，不共享内部 Agent 写入会话，也不调用 `replace-page`。因此目前内外部 Agent 的审计粒度和修复预算仍有意不同。
- 内部与外部的修复/交付入口仍不同：内部 Agent 使用文档写入会话和页级修复；外部 Agent 在自有草稿里改 HTML。画布和截图交付仍为 375×667。
- 文章封面复用共享 Agent 和写入插件，但其工具 schema 不暴露页级操作，也不使用本契约中的社交卡审计门禁。
- Agent 的原生 function tool 和 JSON ToolRequest 两条调用路径共用社交卡参数解析器和同一个写入插件；页修复内容被拒绝重复后，两条路径都暂时切换为 JSON ToolRequest 做一次恢复；恢复仍重复时停止该 Agent 运行。

## 产物与验证

- HTML：候选工作目录中的 `ai-beautified.html`；阶段记录：`social-card-ai-visual-stage-executions.json`。
- 逐页审计：`ai-visual-page-audit-results.json` 记录每次页审计报告、每页修复次数和封存页；交付报告为 `ai-beautify-report.json`，交付门禁为 `ai-beautified-delivery-gate.json`。
- 外部 MCP 提交会同步归档 `publish-title.txt`、`copy.txt`、设计方案 JSON、逐页 PNG 和交付报告；标题文件与候选预览接口读取的标题保持一致。
- 相关既有验证：`test/ai-visual-document-writer-plugin.test.mjs`、`test/social-card-ai-visual-baseline.test.mjs`、`test/social-card-html-group-audit.test.mjs`、`test/social-card-design-scheme-repair.test.mjs`、图文生成与页面数门禁测试。

## 变更触点

- 视觉方案：`server/shared/domain/schemas/social-card-design-scheme.mjs`、`server/features/social-cards/application/social-card-design-scheme.mjs`、`server/features/social-cards/application/social-card-design-scheme-contract.mjs`、`server/shared/themes/visual-direction-catalog.mjs`。
- 写入协议：`plugins/ai-visual-document-writer/adapter.mjs`、`plugins/ai-visual-document-writer/manifest.json`。
- 社交卡调用门禁与记录：`server/features/social-cards/application/social-card-beautify.mjs`。
- 程序审计：`server/features/social-cards/application/social-card-visual-audit.mjs`、`server/features/social-cards/application/social-card-design-conformance.mjs`、`server/platform/browser/html-layout-probe.mjs`。
- Agent 指令：`server/platform/agent/ai-visual-document-agent.mjs`、`agent-integrations/dsh-workbench/lib/client.js`。
- 技能与当前流程：`skills/social-card-ai-visual-generator/SKILL.md`、`agent-integrations/skills/jianzi-social-cards/SKILL.md`、`agent-integrations/workbuddy/skills/jianzi-social-cards/SKILL.md`、`docs/workflows/social-card-ai-visual-generation.md`。
