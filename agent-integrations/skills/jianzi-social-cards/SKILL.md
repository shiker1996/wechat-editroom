---
name: jianzi-social-cards
description: 在见字工作台中研判图文选题、制定故事板、生成 AI 视觉图文并检查任务产物。适用于公众号图文卡片、小红书卡片等分页内容。
---

# 图文故事板与 AI 视觉生成

1. 图文候选应位于 `social_cards` 轨道。使用 `jianzi_batch_candidates` 查询；缺少候选时用批次热点排名和 `jianzi_candidate_add` 加入图文池，并将事件资讯显式设为 `socialMaterialType: "event"`（默认也是事件型）；软件项目介绍设为 `repository`，其他自定义内容设为 `custom`。
2. 调用 `jianzi_candidate_source_fetch` 抓取并保存候选原文，再根据抓取结果核对事实。
3. 调用 `jianzi_card_editorial_get` 查看故事板、事实基座和门禁状态。事件型图文缺少事件事实卡时，先完成工作台研判或事件卡要求。
4. 可由 Agent 基于完整来源与事实计划故事板，再调用 `jianzi_card_editorial_update` 保存；或在用户选择见字内部 AI 时调用 `jianzi_card_storyboard_generate`。
5. 检查页数、每页目标、证据对应关系、事实覆盖、开头和结尾。故事板方案需用户认可后调用 `jianzi_card_lock`。
6. 调用 `jianzi_card_generate` 生成 AI 视觉 HTML/PNG，随后用 `jianzi_job_wait` 等待浏览器布局审计和截图完成。审计失败时读取任务错误，修复后重新生成。
7. 图文故事板和视觉生成使用当前默认 Agent Runtime；未启用外部 Runtime 时才使用见字工作台模型。不要将“任务已启动”描述为“PNG 已交付”，也不要把 AI HTML 当成已经通过视觉审计。
