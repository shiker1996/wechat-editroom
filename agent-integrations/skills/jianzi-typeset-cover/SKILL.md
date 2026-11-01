---
name: jianzi-typeset-cover
description: 对见字工作台中的文章执行公众号 AI 排版和 AI 视觉封面生成。适用于排版 HTML、更新排版产物或制作文章封面。
---

# 文章排版与封面

1. 确认文章候选 ID、批次 ID 和终稿。通过 `jianzi_article_documents` 读取 `final`；没有终稿时先提示回到成稿流程。
2. 调用 `jianzi_article_typeset`，默认 `imageDeliveryMode=auto`。用 `jianzi_job_wait` 等待完成。
3. 排版失败时，返回任务错误和对应文档链接；不要把任务已启动当作生成成功。完成后检查任务产物清单和工作台文章文件。
4. 用户需要封面时调用 `jianzi_cover_generate` 并等待完成。封面走 AI 视觉生成；不再选择标准封面主题。
5. 排版与封面生成由见字 ModelGateway 执行，需要工作台配置可用模型。外部 Agent 的模型配置不会自动传给见字。
6. 不执行公众号发布、CDN 上传或覆盖远端资源，除非用户明确要求且项目提供了对应受控操作。
