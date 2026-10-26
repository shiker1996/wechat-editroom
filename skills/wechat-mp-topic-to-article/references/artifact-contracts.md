# 产物契约

所有 Markdown 文件使用 UTF-8。每个阶段只读取已声明的上游产物，不依赖隐含聊天记忆。

## 目录

```text
articles/<topic-slug>/
  00-skill-manifest.json
  00-stage-executions.json
  00-article-brief.md
  01-personal-materials.md
  02-fact-base.json
  03-titles.md
  04-draft.md
  04-quality-gate.json
  05-humanized.md
  06-reviewed.md
  07-seo-keywords.md       # SEO 未启用时保存跳过说明，便于审计
  08-seo-optimized.md      # SEO 未启用时为 06-reviewed.md 的安全透传稿
  08-quality-gate.json
  research-coverage-review.json
  09-FINAL.md
```

## 最低字段

### 00-skill-manifest.json / 00-stage-executions.json

技能清单记录总技能、写作子技能和阶段子技能的项目内文件、内容哈希与 fallback 状态。阶段执行清单严格使用 `runtime-stage-contracts.md` 声明的阶段顺序，记录输入、输出、执行技能和门禁结果。

### 00-article-brief.md

来自选题编排链时复制或引用其 `article-brief.md`；直接成稿时在本目录建立。至少包含：

- `brief_status: LOCKED`
- `candidate_id`（直接调用可省略）
- `experience_required: true|false`
- `decision_source: explicit-user|public-analysis`
- `final_readiness: WRITE_NOW`
- `topic`
- `locked_thesis`
- `target_reader`
- `reader_job`
- `distribution_lane: 推荐池|通知池|实验池`
- `reader_stake`
- `freshness_basis`：近期触发事件/变化、发生或更新时间、对应来源，以及它此刻影响目标读者的原因
- `confirmed_public_facts`
- `confirmed_author_opinions`
- `confirmed_experiences`
- `counterevidence_and_limits`
- `final_package`
- `forbidden_claims`
- `remaining_gaps`

`experience_required: true` 时 `confirmed_experiences` 不得为空，并须记录材料或证据来源。`remaining_gaps` 中只要仍有会影响核心命题成立的项目，就不得标为 `LOCKED`。

`freshness_basis` 应说明近期触发事件/变化、时间和来源，以及它此刻影响目标读者的原因。用户明确要求写常青解释稿时，可将其标为常青稿并说明原因。

### `editorial-research-selection.json`

记录作者在编辑室明确采用的研判点与明确舍弃的方向。`selected` 保存自然语言研判点及可选回溯引用，`rejected` 保存方向和原因；内部 ID 只用于追溯，不要求正文出现，也不作为文章事实或成稿门禁的字符串匹配条件。

### 01-personal-materials.md

- `topic`
- `angle`
- `article_brief_path`
- `brief_status: LOCKED`
- `experience_required: true|false`
- `audience`
- `distribution_lane: 推荐池|通知池|实验池`
- `reader_stake`
- `content_role: 拉新|沉淀|搜索`
- `expected_action`（1-2 个：评论、分享、收藏、关注或搜索）
- `practical_increment`
- `conversion_bridge`
- `follow_reason`
- `growth_fields_inferred: true|false`
- `inferred: true|false`
- `experience`
- `emotional_quote`
- `insider_context`
- `avoid`

保留用户原话时使用引用块；推断内容不得放进引用块。

成稿流程不创建 `02-outline.md`。锁定简报负责提供核心问题、角度、读者任务和边界；写作阶段根据这些要素与事实基座自行组织结构，不需要额外的大纲产物。用户主动提供的大纲可作为额外上下文，但不是成稿前置条件。

### 02-fact-base.json

保存根据锁定事实、作者观点和来源正文建立的结构化事实基座。每条 claim 包含 `claim`、`status`、`evidence`、`sourceUrl` 和 `boundary`；高影响主张还应记录来源类型、来源日期和归因对象；`status` 只能是 `verified`、`disputed`、`unverified` 或 `opinion`。

### 02-publication-claim-register.json

保存供写作、标题、SEO 和发布合规门禁共同使用的主张登记。每条记录包含 `id`、`claim`、`status`、`evidence`、`sourceUrl`、`sourceTitle`、`sourceType`、`publishedAt`、`boundary` 和 `publicationRule`。`verified` 只表示来源直接支持主张；`disputed`、`unverified` 和没有直接来源的主张不得作为确定性高影响事实进入标题。

### 03-titles.md

- `core_keywords`
- `distribution_lane: 推荐池|通知池|实验池`
- `reader_stake`
- 候选标题及评分理由
- 唯一一行 `SELECTED_TITLE: ...`
- `writer_skill: ...`

### 04-draft.md / 05-humanized.md

第一行是唯一 H1 标题。读者应能从正文链接、自然归因、脚注或文末来源说明追溯关键事实，按文章选择一种清楚、轻量的方式。相同来源支撑的连续事实只在事实簇首次出现时归因；不得机械添加“来源：”或“来源：同上”，也不得逐句重复来源标签。

`04-quality-gate.json` 保存初稿语义门禁结果，不进入正文。

`05-voice-quality-gate.json` 保存自然化后的独立风格门禁结果、问题引文和返修轮数。门禁只记录具体、可定位且有实质影响的问题；最多自动返修一次。仍不通过时继续完成后续审稿、SEO 和终稿，最终文稿标记为待人工复核；问题在编辑室展示，人工确认前不得作为已通过稿发布。门禁问题引文统一保存为 `evidence`，兼容旧结果中的 `quote` 字段。

### 06-reviewed.md

先写可发布修订稿。机器审稿结论不写入 `06-reviewed.md` 正文，而由编排器单独调用 `decision.article_review_gate` 返回；`06-review-gate.md` 只保存模型原始 Markdown 响应，便于审计和重试。

`conversion_bridge_status: verified` 只用于已提供真实标题或链接的具体推荐；只有后续内容类型、没有具体历史内容时使用 `type-only`。转化字段任一为 `needs-revision` 时，不得进入 SEO 或终稿阶段。上述审稿摘要字段由决策工具返回并写入门禁 JSON，不再要求模型把它们嵌入 Markdown。

### 07-seo-keywords.md

记录核心词、评分、相关词、采用与弃用理由。该文件是报告，不进入终稿。

### 08-seo-optimized.md

只包含优化后的文章和可移除的 HTML 元数据注释，不添加 SEO 报告头。

`08-quality-gate.json` 保存终稿语义门禁结果，不进入最终正文。

### 10-publication-compliance.json

保存 SEO、图表和配图占位完成后的最终发布合规门禁。包括程序风险扫描、模型门禁结果、风险类别、阻断主张和修订建议。该门禁未通过时不得进入排版或发布。

### 09-FINAL.md

只包含读者可见的标题、正文、确有必要的来源说明和手动配图占位符。不得包含工作流状态、评分、审稿意见或 SEO 分析。来源说明服务于追溯，不要求单设“来源”标签或来源清单；正文已用可点击链接清楚归因时，不重复添加说明。
