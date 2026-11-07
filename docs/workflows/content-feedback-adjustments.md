# 内容反哺调整草案当前流程契约

## 用户目标与范围

- 用户查看文章或图文/项目反馈，并生成可审阅、可修改、确认后才写入的调整草案。
- 文章正文的规则目标是实际使用的简化 Prompt；文章标题仍可调整标题技能。图文反馈仍按实际执行记录调整故事板/文案技能。项目发现反馈使用独立的人工确认流程。
- 本能力通过本地工作台 UI、HTTP API 和本机 MCP 提供；MCP 可读取反馈/策略、生成和列出草案、拒绝草案，确认写入仍须用户明确要求。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 工作台 UI | `public/index.html`、`public/src/views/content-feedback.js` | 查看反馈、生成和确认草案 |
| DSH 首页 | `agent-integrations/dsh-workbench/lib/client.js` | 「06 / 复盘」卡片准备原生会话草稿，由 DSH Agent 通过内容反哺 MCP 生成待确认草案 |
| HTTP 路由 | `server/platform/http/routes/content-feedback-routes.mjs` | 读取、生成、编辑、确认、拒绝草案 |
| MCP | `scripts/agent-integration/tools.mjs`、`scripts/agent-integration/client.mjs` | 导入公众号表格并刷新反馈、读取反馈/策略、生成/列出草案、按用户确认写入或拒绝；DSH 包通过 `agent-integrations/dsh-workbench/build.mjs` 同步共享实现 |
| 文章反馈领域 | `server/features/content-feedback/domain/wechat-content-feedback.mjs` | 从关联文章和完成稿提取结构信号、文章类型映射和表现数据 |
| 草案服务 | `server/features/content-feedback/application/feedback-adjustment-service.mjs` | 两阶段目标判断、文件 diff、安全校验和确认写入 |
| 提案提示词 | `prompts/feedback/article-planning.md`、`prompts/feedback/article-patching.md` | 规定文章 Prompt 目标与精确编辑约束 |
| 正文 Prompt 源 | `prompts/articles/draft.md`、`prompts/articles/type-*.md` | 文章生产实际加载的通用 Prompt 和类型组件 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 快照 | 已确认指标、已关联正文、文章产物 | 持久化反馈快照和正文/文章类型信号 | `POST /api/wechat/feedback/rebuild`、`wechat-content-feedback.mjs` |
| 外部 Agent 导入 | 用户上传文件经 Agent 传为 Base64，或从附件准确提取的 CSV/TSV 文本；明确 `importType` | 导入并合并历史数据；自动索引本地文章、执行指标匹配；随后重建内容反馈快照并返回策略建议 | MCP `jianzi_content_feedback_import` → `POST /api/wechat/import` → `POST /api/wechat/feedback/rebuild` → `GET /api/wechat/strategy` |
| AI 草案 | 刷新后的本地反馈快照、账号上下文、文章/图文规则源文件 | 生成待确认的 Prompt/技能/账号配置 diff；不自动应用 | MCP `jianzi_content_feedback_adjustment_generate` → `/api/wechat/feedback/adjustments/generate` |
| 目标判断 | 快照、服务端生成的 `strategy`、本地 `account_context`、标题技能和正文 Prompt 候选 | 选择账号/标题/正文 Prompt 调整意图；文章类型映射仅传递 ID、样本数和置信度。跨周期题材信号映射到现有内容支柱和配比字段；未分类题材跳过，读者画像/简介/关注承诺不由阅读相关性推断 | `article-planning.md`、`buildFeedbackAdjustmentPlanningMessages`、`wechat-strategy-recommendations.mjs` |
| 精确编辑 | 目标意图、标题技能全文、选中正文 Prompt 全文、账号字段映射候选 | 只将已选正文 Prompt 原文交给第二阶段；账号内容支柱只能重排现有条目，内容配比只能采用服务端映射候选；若第二阶段没有可应用的正文编辑且映射证据达到样本门槛，服务端生成一条可审阅的最小正文候选 | `article-patching.md`、`buildFeedbackAdjustmentPatchMessages`、`buildFallbackArticlePromptEdit`、`sanitizeAccountPatch` |
| 校验与保存 | 模型 edits、当前源文件及 Prompt manifest | 保存待确认草案；唯一原文匹配、现有字段白名单、正文 Prompt ID/path 白名单 | `buildAdjustmentDraft`、`applySkillEdits` |
| 确认 | 待确认草案、源文件哈希与 Prompt 版本 | 原子写账号配置/标题技能覆盖/正文 Prompt；正文 Prompt manifest 版本递增 | `confirmAdjustmentDraft` |

账号配置只在系统策略至少两个有效周期且每周期关联至少 3 篇正文时允许生成 patch。运行时 `strategy` 与 `account_context` 由服务端计算/读取，不要求人工导入。渠道缺少阅读后关注只限制渠道涨粉判断。旧版本草案失效；哈希或 Prompt manifest 版本冲突时拒绝写入。

## 入口间差异

- 文章、图文和项目发现共用工作台的反馈区，但使用不同目标和业务实现。图文仍调整已执行的故事板和文案技能；文章正文调整简化 Prompt；项目反馈只影响下一批排序。
- MCP 与 UI 共用同一 HTTP 业务路径和服务端校验；外部 Agent 导入依次调用既有导入、匹配、快照刷新和策略读取接口，不直接改模型规则。生成接口通过 `Accept` 协商，网页使用 NDJSON 进度流，MCP 使用 JSON 最终结果。MCP 确认工具会写本地文件，只能在用户明确要求应用草案后调用。
- 导入支持 CSV/TSV、旧版 BIFF XLS、HTML 表格伪 XLS；DSH MCP 另接受附件的完整 CSV/TSV 文本，便于 Agent 可读附件时转交。XLSX 二进制当前不支持，必须先准确转换为 CSV/TSV。表头必须符合所选公众号导出类型；工具不让模型汇总或改写行数据。

## 产物与验证

- 待确认草案持久化在内容反馈调整记录中，UI 展示文件 diff；确认后变更对应源文件。
- HTTP 路由：`server/platform/http/routes/content-feedback-routes.mjs`；服务端校验：`server/features/content-feedback/application/feedback-adjustment-service.mjs`。

## 变更触点

- 提案提示词与正文 Prompt 注册：`prompts/feedback/`、`prompts/articles/`、`prompts/manifest.json`。
- 文章流水线 Prompt 装配：`server/features/articles/application/article-prompts.mjs`。
- API 文档：`API.md`。
- MCP 工具定义与执行：`scripts/agent-integration/tools.mjs`、`scripts/agent-integration/client.mjs`；DSH 包副本由 `agent-integrations/dsh-workbench/build.mjs` 生成。
