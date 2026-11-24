# 市场范围与国内关联标注流程

## 用户目标与范围

- 为热点标记事件主要市场范围，并独立评估其对国内读者的影响及可核验传导路径。
- 本流程定义标签、接口校验、事件归并和展示行为；不重写已完成批次的持久化标签或既有评分。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 内部打标 | `server/features/research/llm/tasks.mjs`、`skills/hotspot-tagging/SKILL.md` | Prompt 从技能文件装载，按事件范围和国内传导分别打标。 |
| 外部 Agent | `server/platform/http/routes/task-routes.mjs`、`scripts/agent-integration/tools.mjs`、`agent-integrations/dsh-workbench/shared/tools.mjs` | 提交时仅接受“国内”或“国外”。 |
| 热点图谱 | `server/features/research/domain/hotspot-clustering.mjs`、`server/features/research/domain/event-resolution-shadow.mjs`、`server/features/research/domain/event-heat-ranking.mjs`、`server/features/research/rendering/hotspot-atlas.mjs`、`public/index.html`、`public/src/views/atlas.js` | 事件解析、评分输入、统计和筛选处规范化历史别名，只显示两类。 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 范围判定 | 事件影响地及主体/市场 | 中国境内主要影响标“国内”；境外事件及全球/跨境事件标“国外”；媒体所在地不作为依据。 | `skills/hotspot-tagging/SKILL.md` |
| 国内关联判定 | 事件事实与可见来源 | `chinaRelevance` 和 `relevanceReason` 记录影响程度与明确传导路径；海外产品先核对官方可用地区和用户资格。明确不支持中国大陆时，国内直接使用路径关闭；产品使用型选题未证实国内可用时最高 3 分，间接影响单独举证。 | `skills/hotspot-tagging/SKILL.md` |
| 写入与归并 | 内部模型结果或外部提交 | 内部模型和 API 只接受二元范围；读取既有“全球/全球性”时映射为“国外”，不回写历史行。 | `server/features/research/llm/tasks.mjs`、`server/platform/http/routes/task-routes.mjs`、`server/features/research/domain/hotspot-clustering.mjs` |
| 评分与展示 | 规范化事件和账号范围偏好 | 国内影响分独立参与账号适配；图谱只提供国内/国外筛选和计数。旧配置的全球范围加分兼容归到国外。 | `server/features/research/application/research-pipeline.mjs`、`server/features/research/rendering/hotspot-atlas.mjs` |

## 入口间差异

内部 Agent 通过技能 Prompt 生成标签；外部 Agent 通过 HTTP/MCP schema 提交并由同一任务接口校验。历史记录保留原始值，图谱聚类和展示层做兼容映射。

## 产物与验证

- 产物和用户可访问入口：批次热点图谱的“国内/国外”筛选与分布。
- 相关测试/校验：`test/hotspot-atlas.test.mjs`、`test/research-pipeline.test.mjs`、`test/tagging-retry.test.mjs`；本次只更新相关 fixture 与断言，未执行测试。

## 变更触点

- Prompt/规则：`skills/hotspot-tagging/SKILL.md`、`skills/account-context-assistant/SKILL.md`。
- API 与 MCP：`server/platform/http/routes/task-routes.mjs`、`scripts/agent-integration/tools.mjs`、`agent-integrations/dsh-workbench/shared/tools.mjs`、`API.md`。
- 聚类、评分及展示：`server/features/research/domain/hotspot-clustering.mjs`、`server/features/research/application/research-pipeline.mjs`、`server/features/research/rendering/hotspot-atlas.mjs`、`public/index.html`、`public/src/views/atlas.js`、`public/styles/production.css`、`public/assets/styles/common.css`。
- 历史数据库值不迁移；新演示数据使用二元枚举。
