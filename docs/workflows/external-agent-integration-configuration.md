# 外部 Agent 集成配置当前流程契约

## 用户目标与范围

- 外部 Agent 可在本机工作台为外部流程必需的采集器和图片 CDN 配置缺失项。
- MCP 配置面仅包含采集器和 `upyun-image-upload`；模型、账号、通用系统设置及任意扩展不在范围内。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| MCP 工具 | `scripts/agent-integration/tools.mjs` | 目录、读取、保存和完整性检查，并限制资源白名单 |
| 统一配置 HTTP API | `server/platform/http/routes/system-routes.mjs` | schema 校验、保存配置、返回配置状态 |
| 凭据隔离 | `server/platform/extensions/configuration-service.mjs`、`server/platform/tools/remote-credentials.mjs` | 普通字段进扩展配置仓库，秘密字段进凭据 Profile；查询以 `__configured__` 表示已配置 |
| CDN 插件 | `plugins/upyun-image-upload/manifest.json` | 定义 Bucket、操作员、密码、访问域名和目录前缀字段 |
| 外部 Agent 指引 | `agent-integrations/README.md`、`agent-integrations/skills/jianzi-typeset-cover/SKILL.md` | 约束先读 schema、用户明确提供后再保存 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 列目录 | 无 | 仅返回采集器和又拍云上传插件的 schema 与配置状态 | `GET /api/system/configuration/catalog`，MCP 过滤 |
| 读取 | 类型和资源 ID | 返回 schema、非秘密字段和秘密字段状态；不返回秘密值 | `GET /api/system/configuration/:type/:id` |
| 保存 | 用户明确提供的 schema 字段 | 服务端校验并分离存储普通字段与秘密字段；响应不含秘密值 | `PUT /api/system/configuration/:type/:id` |
| 检查 | 类型和资源 ID | 检查当前配置是否满足 schema；不测试外部连接 | `POST /api/system/configuration/:type/:id/test` |

MCP dispatcher 仅允许 `collector` 与 `tool` 类型；工具插件 ID 限定为 `upyun-image-upload`，采集器 ID 必须存在于统一配置目录。配置保存前由 Agent 取得用户提供并确认的字段。

## 入口间差异

- 工作台可配置全部统一配置资源；MCP 只暴露外部 Agent 配置采集和图片 CDN 所需的子集。
- 旧采集器专用 MCP 工具仍可用；新增统一工具使用统一配置路由，覆盖 CDN 插件和跨版本配置 schema。
- 完整性检查只是通用 schema 检查，不做第三方 API 连通性验证。

## 产物与验证

- 配置状态保存在 `extension_settings`；秘密字段使用隔离凭据 Profile。
- MCP 映射：`scripts/agent-integration/tools.mjs`；统一配置实现：`server/platform/extensions/configuration-service.mjs`。

## 变更触点

- MCP 工具：`scripts/agent-integration/tools.mjs`。
- 系统配置路由与服务：`server/platform/http/routes/system-routes.mjs`、`server/platform/extensions/configuration-service.mjs`。
- 外部 Agent 指引：`agent-integrations/README.md`、`agent-integrations/skills/jianzi-typeset-cover/SKILL.md`、`agent-integrations/workbuddy/skills/jianzi-typeset-cover/SKILL.md`。
