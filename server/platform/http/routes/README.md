# routes

## 职责

HTTP 路由处理器和参数映射。素材查询、写入与评估由 `material-routes.mjs` 负责；内容反馈由 `content-feedback-routes.mjs` 负责；内容规划和交付路由按迁移阶段继续拆分。

## 依赖边界

保持薄层，禁止在路由内实现领域规则或直接拼装底层存储细节。
