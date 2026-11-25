---
name: jianzi-typeset-cover
description: 对见字工作台中的文章执行公众号 AI 排版和 AI 视觉封面生成。适用于排版 HTML、更新排版产物或制作文章封面。
---

# 文章排版与封面

开始业务流程前先调用 `jianzi_doctor`。若返回 `WORKBENCH_VERSION_MISMATCH`，停止业务工具调用，在目标项目根目录执行 `git pull`，按升级说明更新依赖并重新构建，重启工作台和 MCP 连接后再调用 doctor。若工作台未连接，调用 `jianzi_workbench_start`，等待其返回 ready 且项目指纹匹配后再继续；DSH/npm 包需传本机项目绝对路径 `projectRoot` 或配置 `JIANZI_PROJECT_ROOT`。启动失败、指纹不匹配或超时后停止业务操作并报告诊断，不要重复启动。

## 流程续接与下一步提示

- 先按用户要求识别完整目标，不要把中间工具调用结果当作最终完成。工具返回 `next_action`、`next_step`、`pending`、`jobId` 或明确后续工具时，若该后续属于用户要求的范围且不越过确认门禁，就在同一轮继续执行。
- 需要用户审阅终稿、确认设计或补充输入时，停在对应门禁，明确列出待确认对象/ID 和用户接下来要做什么；不要泛泛地询问“还需要什么”。
- 回复结束时给出一个与当前状态匹配的具体下一步。交付产物时提供预览入口并说明如何查看；未完成当前流程时说明下一阶段；不得自动越过用户确认、覆盖或发布门禁。

1. 确认文章候选 ID、批次 ID 和终稿。通过 `jianzi_article_documents` 读取 `final`；没有终稿时先提示回到成稿流程。
2. 默认由当前外部 Agent 根据终稿与 `wechat-article-typeset` / `magazine-design-advisor` 技能，为本篇生成设计方案和完整 HTML。外部 `designScheme` 就是 `magazine-design-advisor` 的 `tokens` JSON，结构为 `schema_version: 1`、`colors`、`typography`、`spacing`、`image`。这也是内部排版设计阶段的原始输出格式；两条路径共用 `validateTypesetDesignScheme` 字段和范围校验。内部通过后再规范化为渲染用 tokens；外部提交会规范化公众号 HTML，并在产物上通过浏览器核对真实计算样式：背景/正文/强调/弱化色、正文字号与行高、章节字号与间距、段落间距；存在图片和图注时也核对圆角与字号。样式未实际使用 tokens 或门禁失败时，按 issue 修正后重提。通过后归档 HTML、方案与视觉审计记录。
3. 用户需要封面时，根据文章终稿为本篇制定结构化设计方案并生成单页 900×383 HTML，标题必须完整可见；`jianzi_cover_generate` 内部方案和外部 `jianzi_cover_submit` 共用同一方案核心结构：顶层 `schemaVersion: 1`、`semantic`、`designScheme.visualDirection`、`designScheme.tokens` 与 `designScheme.spec.layout/components`。内部归档可附带文章元信息、审计和 Markdown；外部提交传核心字段即可。两条路径共用主题 token、对比度、组件、布局骨架与标题保真校验。HTML 的 `.page` 根元素标记 `data-cover-layout`；每个方案组件在真实可见的 HTML 元素上标记 `data-cover-component`，有颜色角色的组件再标记 `data-cover-color-role`；标题组件文字必须是完整文章标题。外部提交还会在 Chromium 中核对实际可见组件、构图位置、标题字号和颜色，再截图归档设计方案/HTML/PNG。门禁问题需先修正 HTML 或方案再提交，不能用标记替代实际样式兑现。
4. 用户要求自动配图时，调用一次 `jianzi_article_images_run`，随后用 `jianzi_job_wait` 等待流水线完成。默认续跑缺失项；若用户明确要求从终稿占位重新测试/规划，则设置 `restartFromStart=true`，旧图片、资产清单和检查点会归档，再从占位开始。流水线会组合选题已采集来源和已启用的网络搜索槽位，优先查找官方页面；可读性不足的页面可改做数据卡，机制/关系图可依据一手原文绘成带来源的示意图。数据卡数字须同时出现在文章终稿和重新抓取的来源正文；示意图的原文摘录须在已抓取正文中逐字找到。来源 URL 与核验日期会随资产记录。搜索/抓取不可用或证据不充分时，该图标为待人工确认，不阻塞其他配图。完成后调用 `jianzi_article_images` 检查图片、策略和来源元数据。结果有失败或待人工确认项时，可再次运行以重试缺失项。需要单独重做一张时再调用 `jianzi_article_image_generate` 或 `jianzi_article_image_create`。只有用户明确要求上传 CDN 时，才调用 `jianzi_article_image_upload`。若 CDN 未配置，可读取 `jianzi_integration_configuration_catalog` 中 `upyun-image-upload` 的 schema，向用户收集配置值并在用户确认后通过 `jianzi_integration_configuration_save` 保存，再调用 `jianzi_integration_configuration_test` 检查完整性。
5. `jianzi_article_typeset` 和 `jianzi_cover_generate` 是见字内部模型路径；只有用户明确要求改用工作台内部 AI 时才调用，并等待任务完成。
6. 不执行公众号发布或覆盖远端资源，除非用户明确要求且项目提供了对应受控操作。
7. 排版或封面提交/生成成功后，从工具结果的 `artifactEntries` 中取出对应入口 URL，并在最终回复中提供可点击链接；异步任务在 `jianzi_job_wait` 的最终结果中也会返回入口。不能只说“已生成”而遗漏用户查看、复制或下载产物的入口。

外部 Agent 使用自己的模型完成生成；工作台负责输入约束、规范化、确定性校验、浏览器渲染和产物归档，不需要为此配置见字内部模型。
