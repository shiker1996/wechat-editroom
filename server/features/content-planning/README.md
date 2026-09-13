# 内容规划模块

本目录承载主动写作素材箱和内容规划能力。公众号导入、内容表现反馈、项目发现反馈等能力归属 `server/features/content-feedback`，本目录不再提供反馈实现或旧路径转发。

- `content-planning-recommendations.mjs` 将反馈快照和素材评估合成为可解释的软推荐，支持复盘优先排序、目标选择、标题结构提示和下一篇验证预告；不替代热点评分，也不自动修改账号长期策略。
- 持久化由 `server/platform/persistence/repositories/content-planning-repository.mjs` 负责。
- HTTP 入口位于 `server/platform/http/routes/content-routes.mjs`；素材评估只把历史表现作为软性推荐，不改变现有热点选题评分链。
- 栏目是独立实体，不把栏目字段写入 `account-context.json`。
