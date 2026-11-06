# 外部 Agent 文章成稿当前流程契约

## 用户目标与范围

- 外部 Agent 根据锁定简报与事实材料生成文章草稿，完成核验、审稿和字数检查后交用户确认。
- 外部路径复用工作台的候选、来源、事实基座、字数配置读取和确定性本地审计；不启动内部文章成稿模型链。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| MCP 工作流指引 | `agent-integrations/skills/jianzi-topic-to-article/SKILL.md` | 写作、事实核验、自审、返修和用户确认要求 |
| MCP 工具 | `scripts/agent-integration/tools.mjs` | 读取设置、读取候选/文档、确定性审计和保存草稿/终稿 |
| 本地审计 | `server/features/articles/application/external-article-local-audit.mjs` | 结构、字数、标题风险和内部流程措辞检查；不做事实审稿 |
| 字数口径 | `server/features/articles/application/article-pipeline-contract.mjs`、`server/platform/integrations/runtime-settings.mjs` | Markdown 可见字符算法及全局可见字数配置 |
| 内部模型流程参考 | `server/features/articles/application/article-pipeline.mjs` | 事实门禁、结构化审稿、最多两轮返修及字数调整/调整后复核 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 准备 | 候选、锁定简报、事实材料 | 外部 Agent 读取设置中的 `articleLength` 和已抓取来源 | `jianzi_settings_summary`、`jianzi_candidate_get` |
| 写作与事实核验 | 项目基础写作提示、简报、事实材料 | 生成完整 Markdown，并联网核验影响标题、核心结论和读者行动的关键事实 | 外部 Agent Skill |
| 审稿与定点返修 | 草稿、实际查阅的来源 | 按文章审阅标准检查简报兑现、事实、归因、论证、标题与风险；最多两轮实质问题修订/复审 | 外部 Agent Skill（外部模型自执行） |
| 字数调整 | 已审稿文章、设置范围或用户指定范围 | 超范围时最多两轮扩缩；调整后复核受影响句段；本地审计可传 `articleLength:{min,max}` | `jianzi_article_local_audit`、`auditExternalArticleLocally` |
| 保存与确认 | 审稿和长度检查完成的文章 | 先保存 draft 并回读；用户确认具体文章后才保存 final | `jianzi_article_document_save`、`jianzi_article_documents` |

`jianzi_article_local_audit` 是确定性提醒，不是模型审稿或事实核验门禁。MCP 外部路径的审稿由外部 Agent 执行，不能声称工作台已自动审稿通过；超限且两轮后仍不符合时应报告实际字数及目标范围。

## 入口间差异

- 基础成稿提示句与 `prompts/articles/draft.md` 一致，但内部模型链按文章类型注入提示组件；外部 Agent 根据 Skill 和简报执行相应表达。
- 内部链自动生成事实基座、调用联网事实与证据审稿门禁、记录审稿历史、按配置返修最多两轮，再按配置字数调整最多两轮并复核改动。
- 外部链使用 MCP 已保存的事实/来源材料，外部 Agent 自行联网核验和审稿；MCP 本地审计只做确定性检查。两条路径的门禁自动化和审计产物不同。

## 产物与验证

- 草稿/终稿存为候选文档；本地审计结果由 MCP 工具直接返回。
- 字数审计调用：`jianzi_article_local_audit(articleLength:{min,max})`。

## 变更触点

- 外部 Agent 行为与复制副本：`agent-integrations/skills/jianzi-topic-to-article/SKILL.md`、`agent-integrations/workbuddy/skills/jianzi-topic-to-article/SKILL.md`。
- MCP schema/路由：`scripts/agent-integration/tools.mjs`、`server/platform/http/routes/media-routes.mjs`。
- 本地审计与口径：`server/features/articles/application/external-article-local-audit.mjs`、`server/features/articles/application/article-pipeline-contract.mjs`。
