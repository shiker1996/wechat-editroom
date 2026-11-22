# 自定义资源/教程图文策划当前流程契约

## 用户目标与范围

- 作者把资源包、操作教程、清单或观点整理为公众号/小红书分页图文；流程先确认内容是否适合卡片，再补齐事实、来源、可用结果和边界。
- 本流程负责自定义内容的策划、事实基座和故事板就绪门禁。自动热点/仓库图文继续使用 G_social 与现有类型路由；视觉生成和交付见[图文视觉生成契约](social-card-ai-visual-generation.md)。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 内部策划对话 | `server/platform/http/routes/candidate-routes.mjs`、`server/features/social-cards/application/agent/custom-social-adapter.mjs`、`skills/custom-social-chat/SKILL.md` | 对话维护表单草稿；未就绪时返回具体缺项，作者补充后继续 |
| 自定义图文创建 | `server/platform/http/routes/candidate-routes.mjs`、`server/features/social-cards/application/custom-fact-service.mjs` | 构建事实基座并创建 `social_cards` 候选 |
| 外部 Agent | `scripts/agent-integration/tools.mjs`、`agent-integrations/skills/jianzi-social-cards/SKILL.md` | `jianzi_custom_social_create` 使用同一创建入口；随后读取门禁和编辑结果 |
| DSH 工作台入口提示 | `agent-integrations/dsh-workbench/lib/client.js` | 启动提示要求先看 G_social 与 cardFit、优先合格资源/教程素材；不覆盖分数 |
| 内容/类型门禁 | `server/features/social-cards/domain/social-card-gate.mjs`、`server/features/social-cards/application/social-card-pipeline.mjs` | `evaluateCustomCardGate` 在故事板生成前执行 |
| 故事板 | `skills/custom-card-storyboard/SKILL.md`、`skills/custom-card-storyboard/references/storyboard.md` | 将事实基座整理为教程、清单或观点分页，并保留来源等级与边界 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 图文适配研判 | 作者主题/热点素材、读者任务、可用资料 | 说明 `cardFit` 强/有条件/弱及依据；资源可保存、教程可复现并能核对结果、结构对比能被图示解释时优先考虑图文。弱适配建议走文章或不制作图文 | `custom-social-chat` Skill、`jianzi-social-cards` Skill |
| 策划补料 | 内容类型、读者、要点、来源、步骤、边界 | 内部对话逐项补齐表单；教程需要至少 2 步、可核对结果（`thesis`）和适用边界（`limitations`）。资源清单逐项写名称、用途和真实入口 | `custom-social-adapter.mjs`、`custom-social-chat/SKILL.md` |
| 事实基座创建 | 已就绪表单、用户素材和链接 | 抓取可访问链接，记录来源等级、步骤、结果和限制；链接抓取失败会保留为失败状态供门禁阻断；资料不足不生成使用承诺 | `custom-fact-service.mjs`、`candidate-routes.mjs` |
| 故事板前门禁 | 自定义事实基座、编辑决策 | 检查内容类型、要点来源、至少一条非模型素材、链接抓取、披露、禁止表达、目标读者、页数；教程另检查步骤、预期结果和适用边界 | `social-card-gate.mjs`、`social-card-pipeline.mjs` |
| 故事板与后续视觉 | 通过门禁的事实基座、作者认可的页面方案 | 生成并锁定故事板，再进入既有视觉方案、HTML 审计与截图交付链；不改变视觉审计契约 | `custom-card-storyboard` Skill、`social-card-pipeline.mjs`、`social-card-ai-visual-pipeline.mjs` |

缺少资源入口、步骤依据、结果或适用边界时，Agent 应明确标出缺口并暂停或补问；不能补造链接、安装命令、实测效果或发布承诺。作者明确确认“无额外限制”可作为边界说明，不能由模型默认填写。

## 入口间差异

- 内部入口先通过表单对话补素材，使用 `evaluateCustomSocialReadiness` 阻止未就绪表单提交；创建后进入同一事实基座和故事板门禁。
- 外部 Agent 使用 MCP 工具提交完整表单，不运行内部策划对话；创建后调用同一工作台门禁并按返回的 issues 补齐。Skill 负责 cardFit 和缺项追问，MCP 本地门禁不推断资源是否值得保存。
- 自动热点/仓库图文使用 G_social 与候选池配额；`cardFit` 只是内容形式判断，不替代分数、资格线和配额，不对资源/教程额外加分。

## 产物与验证

- 自定义事实数据保存在既有 `repository_fact_sheets` JSON 结构中，`kind: custom`；无数据库迁移。
- 相关既有验证：`test/custom-social-chat.test.mjs`、`test/custom-social-card.test.mjs`、`test/conversation-agent-custom-social.test.mjs`。本阶段未运行测试。

## 变更触点

- 内部策划/事实基座/门禁：`skills/custom-social-chat/SKILL.md`、`server/features/social-cards/application/agent/custom-social-adapter.mjs`、`server/features/social-cards/application/custom-fact-service.mjs`、`server/features/social-cards/domain/social-card-gate.mjs`。
- 故事板与外部 Agent：`skills/custom-card-storyboard/`、`agent-integrations/skills/jianzi-social-cards/SKILL.md`、`agent-integrations/workbuddy/skills/jianzi-social-cards/SKILL.md`。
- 视觉链保持原契约：`docs/workflows/social-card-ai-visual-generation.md`。
