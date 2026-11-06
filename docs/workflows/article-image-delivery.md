# 文章配图交付当前流程契约

## 用户目标与范围

- 外部 Agent 可读取文章配图占位、按需规划或生成本地图片，并在用户明确要求时上传到已配置 CDN。
- 本流程覆盖普通文章候选配图；批次早报配图仍只通过工作台 API/UI 操作。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 工作台 HTTP | `server/platform/http/routes/media-routes.mjs` | 候选配图工作区、规划、保存、生成和 CDN 上传 |
| MCP 工具 | `scripts/agent-integration/tools.mjs` | 受限 `jianzi_article_images*` 工具映射到候选配图 API |
| 配图业务逻辑 | `server/features/articles/application/image-workflow.mjs`、`article-image-generator.mjs` | 占位/资产管理、图片生成与受控 CDN 上传 |
| 外部 Agent 指引 | `agent-integrations/skills/jianzi-typeset-cover/SKILL.md` | 指导规划、生成及需要明确要求的 CDN 上传 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 查看 | `candidateId` | 返回配图占位、本地/CDN 状态和 CDN 是否已配置 | `GET /api/candidates/:id/images` |
| 规划（可选） | `candidateId`、可选 provider | 需要已有 `09-FINAL.md`；规划后更新终稿及资产清单 | `POST /api/candidates/:id/images/plan` |
| 生成（可选） | `candidateId`、工作区返回的 `imageId` | 仅对标记为可生成的占位生成图片并登记清单 | `POST /api/candidates/:id/images/:imageId/generate` |
| 上传（用户明确要求时） | `candidateId`、`imageId` | 上传已保存的本地图片至配置的 CDN，更新公开 URL 和资产清单 | `POST /api/candidates/:id/images/:imageId/cdn` |

HTTP 层验证候选、终稿和可生成占位；底层保存流程限制 PNG/JPEG/GIF/WebP 且单张不超过 8MB。MCP 不提供任意文件路径或任意 HTTP 调用。

## 入口间差异

- MCP 与工作台候选图片接口共用同一业务逻辑和上传门控。早报图片没有暴露为 MCP 工具。
- CDN 上传会产生外部写入；MCP 描述和 Skill 要求只有用户明确要求时才调用。

## 产物与验证

- 图片与清单位于候选工作目录；清单为 `image-assets.json`。CDN 上传成功后工具返回图片条目和公开地址。
- 工具定义/映射：`scripts/agent-integration/tools.mjs`；HTTP 实现：`server/platform/http/routes/media-routes.mjs`。

## 变更触点

- MCP 工具和 dispatcher：`scripts/agent-integration/tools.mjs`。
- HTTP 路由和图片业务：`server/platform/http/routes/media-routes.mjs`、`server/features/articles/application/image-workflow.mjs`。
- 外部 Agent 文档副本：`agent-integrations/README.md`、`agent-integrations/skills/jianzi-typeset-cover/SKILL.md`、`agent-integrations/workbuddy/skills/jianzi-typeset-cover/SKILL.md`。
