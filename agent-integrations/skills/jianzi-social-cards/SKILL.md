---
name: jianzi-social-cards
description: 在见字工作台中研判图文选题、制定故事板、生成 AI 视觉图文并检查任务产物。适用于公众号图文卡片、小红书卡片等分页内容。
---

# 图文故事板与 AI 视觉生成

1. 图文候选应位于 `social_cards` 轨道。使用 `jianzi_batch_candidates` 查询；缺少候选时调用 `jianzi_batch_social_ranking`，依据 G_social、入池资格、素材类型及理由向用户推荐，确认后用 `jianzi_candidate_add` 加入图文池。事件资讯显式设为 `socialMaterialType: "event"`；软件项目介绍设为 `repository`，其他自定义内容设为 `custom`。
2. 调用 `jianzi_candidate_source_fetch` 抓取并保存候选关联原文，再根据抓取结果核对事实。
3. 调用 `jianzi_card_editorial_get` 查看故事板、事实基座和门禁状态。事件型图文缺少事件事实卡时，先完成批次外部研判：热点打标后调用 `jianzi_batch_events`，根据事件与原文生成事件事实卡，再调用 `jianzi_batch_event_cards_submit` 保存。
4. 默认由外部 Agent 基于完整来源与事实计划故事板，再调用 `jianzi_card_editorial_update` 保存；同时提交 `targetReader`、`painPoint`、`mustDisclose`、`forbiddenClaims`，让工作台执行读者、来源披露和禁止表达门禁。仓库或工具图文还应填写 `toolPositioning`、`mustHighlight`，按需填写 `gettingStarted`。根据 `jianzi_card_editorial_get` 返回的 `gate.issues` 补齐未通过项；只有用户明确要求工作台内部 AI 时才调用 `jianzi_card_storyboard_generate`。
5. 检查页数、每页目标、证据对应关系、事实覆盖、开头和结尾。故事板方案需用户认可后调用 `jianzi_card_lock`。
6. 默认由外部 Agent 按故事板与事实基座，为本次生成新的视觉方案，再生成分页 HTML 与配套文案。生成过程中调用 `jianzi_card_visual_audit` 审计整组或逐页 HTML；按报告修复溢出后重新审计。最终通过 `jianzi_card_visual_submit` 一并提交方案和产物，工作台会再次执行页数与文案门禁、浏览器审计、PNG 截图和归档。
7. `jianzi_card_storyboard_generate` 和 `jianzi_card_generate` 是见字内部模型路径；只有用户明确要求时使用。提交工具成功返回后，才能说明 HTML/PNG 已通过工作台门禁。
8. 图文提交或生成成功后，从工具结果的 `artifactEntries` 取出事件图文入口 URL，并在最终回复中提供可点击链接；异步任务在 `jianzi_job_wait` 的最终结果中也会返回入口。不能只说“已生成”而遗漏 HTML/PNG 的查看和下载入口。
