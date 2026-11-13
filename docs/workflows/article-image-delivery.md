# 文章配图交付当前流程契约

## 用户目标与范围

- 工作台 UI 与外部 Agent 均可读取文章配图占位、按需规划或创建（自动匹配选题采集来源并截图、时间轴、数据卡、ECharts）本地图片，并在用户明确要求时上传到已配置 CDN。
- 本流程覆盖普通文章候选配图；批次早报配图仍只通过工作台 API/UI 操作。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 工作台 UI | `public/index.html`、`public/src/views/preview.js`、`public/src/views/batch-drawer.js` | 主按钮提交候选级配图流水线任务并显示任务进度；已有图片可在卡片上单独重做 |
| 工作台 HTTP / Job | `server/platform/http/routes/media-routes.mjs`、`server/features/batches/application/ai-job-handlers.mjs` | 候选配图流水线入口、异步任务调度及已有工作区/单项接口 |
| MCP 工具 | `scripts/agent-integration/tools.mjs`、`agent-integrations/dsh-workbench/shared/tools.mjs` | 两份 `jianzi_article_images_run` 工具映射到同一候选配图流水线 API |
| 配图业务逻辑 | `server/features/articles/application/article-image-pipeline.mjs`、`article-image-agent` Skill、`image-workflow.mjs` | 占位规划、来源 ID 匹配、逐项生成与检查点恢复 |
| 外部 Agent 指引 | `agent-integrations/skills/jianzi-typeset-cover/SKILL.md` | 指导规划、生成及需要明确要求的 CDN 上传 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 查看 | `candidateId` | 返回配图占位、本地/CDN 状态和 CDN 是否已配置 | `GET /api/candidates/:id/images` |
| 启动 | `candidateId`、可选 provider | 要求已有 `09-FINAL.md`；创建候选级异步任务 | `POST /api/candidates/:id/images/run` |
| 规划（按需/重规划） | 终稿 Markdown、`replan` | 默认重规划；没有已完成图片时先清除旧占位再规划，有已完成图片时保留现有占位以免图片与新占位错配 | `article-image-pipeline.mjs`、`image-workflow.mjs` |
| 来源匹配（按需） | 待配图占位、候选关联已采集来源摘要 | Agent 只返回输入中的来源 ID；无直接相关来源时标记待人工确认，不接收 Agent 自造 URL | `article-image-agent/SKILL.md`、`article-image-pipeline.mjs` |
| 逐项生成 | 占位及匹配结果 | 先处理可匹配来源的截图和结构化生成图片，再记录待人工确认项；单项失败不阻塞其他图片；逐项更新资产清单和流水线检查点 | `article-image-pipeline.mjs`、`article-image-create.mjs` |
| 等待与恢复 | Job ID、工作区检查点 | 同一流水线再次运行会跳过已有本地/CDN 图片，只重试仍缺失的项；完成后由 UI 刷新配图工作区 | `ai-job-manager.mjs`、`batch-drawer.js`、`article-image-pipeline.json` |
| 生成（可选） | `candidateId`、工作区返回的 `imageId` | 仅对标记为可生成的占位生成图片并登记清单 | `POST /api/candidates/:id/images/:imageId/generate` |
| 单项重做（可选） | `candidateId`、`imageId` | 直接创建单张来源配图时按候选采集来源的确定性相关度排序并截图；流水线批量配图使用来源规划 Agent | `POST /api/candidates/:id/images/:imageId/create`，`mode: auto` |
| 其他创建（可选） | `candidateId`、`imageId`、显式来源 URL 或结构化图表规格 | 使用隔离浏览器或受控图表渲染生成 PNG 并登记到现有占位；识别到人工验证时尝试配图专用可见 Chrome | 同上 |
| 上传（用户明确要求时） | `candidateId`、`imageId` | 上传已保存的本地图片至配置的 CDN，更新公开 URL 和资产清单 | `POST /api/candidates/:id/images/:imageId/cdn` |

HTTP 层验证候选、终稿和可生成占位；底层保存流程限制 PNG/JPEG/GIF/WebP 且单张不超过 8MB。MCP 不提供任意文件路径或任意 HTTP 调用。

## 入口间差异

- MCP 与工作台候选图片接口共用同一业务逻辑和上传门控。早报图片没有暴露为 MCP 工具。
- 两份外部 Agent 工具注册表都把自动配图入口映射到同一流水线 API，单项重做仍映射到配图创建接口；流水线将 Agent 选择的采集来源 ID 交给图片服务，截图使用独立 `article-image-capture` Profile，不复用 Reddit Profile。
- 工作台按钮和外部 Agent 均调用同一候选级流水线，默认重规划未完成占位、优先生成可处理图片、记录检查点并重试缺失项。外部 Agent 调用 `jianzi_article_images_run` 后通过 `jianzi_job_wait` 等待；逐占位生成/创建接口保留为人工单项重做入口。
- 手动调用单项 `create` 的 `mode:auto` 仍使用确定性相关度排序；流水线 Agent 批量规划时只提交受校验的采集来源 ID。
- CDN 上传会产生外部写入；MCP 描述和 Skill 要求只有用户明确要求时才调用。

## 产物与验证

- 图片与清单位于候选工作目录；清单为 `image-assets.json`，恢复检查点为 `article-image-pipeline.json`。CDN 上传成功后工具返回图片条目和公开地址。
- 工具定义/映射：`scripts/agent-integration/tools.mjs`、`agent-integrations/dsh-workbench/shared/tools.mjs`；HTTP 实现：`server/platform/http/routes/media-routes.mjs`。

## 变更触点

- MCP 工具和 dispatcher：`scripts/agent-integration/tools.mjs`、`agent-integrations/dsh-workbench/shared/tools.mjs`。
- HTTP 路由、任务处理和图片业务：`server/platform/http/routes/media-routes.mjs`、`server/features/batches/application/ai-job-handlers.mjs`、`server/features/articles/application/article-image-pipeline.mjs`、`server/features/articles/application/image-workflow.mjs`。
- 外部 Agent 文档副本：`agent-integrations/README.md`、`agent-integrations/skills/jianzi-typeset-cover/SKILL.md`、`agent-integrations/workbuddy/skills/jianzi-typeset-cover/SKILL.md`。
