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
2. 默认由当前外部 Agent 根据终稿与 `wechat-article-typeset` / `magazine-design-advisor` 技能，为本篇生成设计方案和完整 HTML，再将两者传给 `jianzi_article_typeset_submit`。工作台会校验结构保真、运行公众号 HTML 规范化和确定性门禁，再归档 HTML 与设计方案。校验失败时按返回的门禁问题修复 HTML 后重提。
3. 用户需要封面时，根据文章终稿为本篇制定封面设计方案并生成单页 900×383 HTML，标题必须完整可见；将设计方案和 HTML 一起传给 `jianzi_cover_submit`。工作台校验封面约束、浏览器截图并归档设计方案/HTML/PNG。
4. 用户需要文章配图时，先调用 `jianzi_article_images` 查看占位；需要规划时调用 `jianzi_article_images_plan`（会更新终稿），需要生成可生成的本地图片时逐项调用 `jianzi_article_image_generate`。只有用户明确要求上传到 CDN 时，才对已有本地图片调用 `jianzi_article_image_upload`。若 CDN 未配置，可读取 `jianzi_integration_configuration_catalog` 中 `upyun-image-upload` 的 schema，向用户收集配置值并在用户确认后通过 `jianzi_integration_configuration_save` 保存，再调用 `jianzi_integration_configuration_test` 检查完整性。
5. `jianzi_article_typeset` 和 `jianzi_cover_generate` 是见字内部模型路径；只有用户明确要求改用工作台内部 AI 时才调用，并等待任务完成。
6. 不执行公众号发布或覆盖远端资源，除非用户明确要求且项目提供了对应受控操作。
7. 排版或封面提交/生成成功后，从工具结果的 `artifactEntries` 中取出对应入口 URL，并在最终回复中提供可点击链接；异步任务在 `jianzi_job_wait` 的最终结果中也会返回入口。不能只说“已生成”而遗漏用户查看、复制或下载产物的入口。

外部 Agent 使用自己的模型完成生成；工作台负责输入约束、规范化、确定性校验、浏览器渲染和产物归档，不需要为此配置见字内部模型。
