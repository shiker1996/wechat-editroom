# 选题评分当前流程契约

## 用户目标与范围

- 将已打标热点转换为文章候选，依据读者利益、账号契合、事件价值、研判增量、国内关联与竞争扣分进行排序。
- 本流程包含热点标签和事件分数如何到达候选评分。成稿、编辑会最终决策、突发专题独立评分不在范围内。

## 入口与实现

| 入口 | 实现位置 | 说明 |
| --- | --- | --- |
| 工作台研究流程 | server/features/research/application/research-pipeline.mjs | 生成事件热榜、文章池、脑暴卡、综合修正、F 分与 topics-ranked.md |
| 外部 Agent 分阶段研判 | server/platform/http/routes/task-routes.mjs；scripts/agent-integration/tools.mjs | prepare/submit 继续运行内部 pipeline，复用同一 scoreCards 与最终评分函数 |
| 外部 Agent 直接提交评分 | POST /api/batches/:id/external/research；server/platform/http/routes/task-routes.mjs | Agent 提交 H/B/J 与竞争扣分，工作台读取事件 T、P、国内关联并计算报告分数 |
| 综合选题评分 | server/platform/http/routes/candidate-routes.mjs | 复用 scoreCards；缺少国内关联值时由共享评分函数归一化其余权重 |

## 阶段与数据流

| 阶段 | 输入 | 输出/状态变化 | 实现位置 |
| --- | --- | --- | --- |
| 热点打标 | 热点标题、摘要、来源与账号上下文 | 分类、chinaRelevance、可选 domesticSubject、preScores 写入热点 raw_json.aiTags | skills/hotspot-tagging/SKILL.md；server/platform/http/routes/task-routes.mjs；server/platform/persistence/repositories/hotspot-repository.mjs |
| 事件热榜 | 已打标热点与事件历史 | T/eventValue、chinaRelevanceScore（审计字段）和排序；chinaRelevanceScore 不参与 T | server/features/research/domain/event-heat-ranking.mjs |
| 事件候选池 | 稳定事件、事件热榜 | 按 T 选核心/黑马/候补；P 只影响同分优先级；含 developerImpact 保护位 | server/features/research/application/research-pipeline.mjs |
| 研判依据门禁 | 入池事件、事件事实卡、研判素材与信号 | 无有效依据的候选不进入脑暴 | server/features/research/application/research-pipeline.mjs |
| 脑暴与综合 | 研判依据、候选卡 | 生成 H/B 原始子项；综合阶段可校正 raw readerStakeScore 和饱和扣分 | skills/hotspot-brainstorm/SKILL.md；skills/hotspot-synthesis/SKILL.md；server/features/research/application/research/editorial-exploration.mjs |
| 最终评分 | H/B/P/T/J/S/D 与 chinaRelevance | scoreCards 计算 capped 受众门禁分与 raw B 分；computeFinalScore 统一计算 A、DOM、C、F。T 缺失时 F 为 null；DOM 缺失时 A/T/J 权重按剩余占比归一化 | server/shared/domain/topic-scoring.mjs；server/features/research/application/research-pipeline.mjs |
| 候选筛选和产物 | 评分卡、文章资格字段 | 通过文章资格门禁的候选排序；写入 topics-ranked.md 和 topic-scoring-candidates.json，记录公式版本 | server/features/research/application/research-pipeline.mjs |

## 入口间差异

- 工作台 pipeline 与外部 Agent 分阶段入口共用完整的研究依据、脑暴、综合及评分门禁。
- 外部 Agent 直接提交入口不运行脑暴，也不从原始 bScores 重算 H/B/J；它信任提交的 H/B/J 和 S/D，在服务端读取事件 T、P、chinaRelevance。它与内部流程共用 computeFinalScore，但上游输入与门禁不同。
- 综合选题路由只对单个综合候选调用 scoreCards，可能没有 T 或国内关联；没有 T 时不产出 F，没有 DOM 时按余下权重归一化。

## 产物与验证

- 批次产物：sources/external-research-report.json、sources/topic-scoring-candidates.json、sources/preselection-ranking.json、topics-ranked.md。
- 公式版本为 v3，写入批次评分产物 JSON 与评分报告头；不在候选数据库增加版本列。
- `topics-ranked.md` 在产物中心预览时显示批次公式版本与账号配置提示；迁移前的账号配置会保留旧权重/H 基线覆盖，运行 `npm run migrate:topic-scoring-v3` 先预览，确认后运行 `npm run migrate:topic-scoring-v3 -- --write` 迁移并自动备份。
- `account-context.json` 中的 `scoring.formulaVersion: "v3"` 是本地配置迁移标记；`resolveScoring()` 用它判断是否提示旧配置迁移。它与批次产物中的公式版本各自独立。迁移会更新标准分类的 accountFit、categoryPreference 和国内 marketScope 偏好，同时保留自定义分类和旧配置快照。
- 评分回放输入保存 raw B 子项、hProfile、旧公式输入快照及公式参数；回放比较分数，不重跑候选池门禁或模型决策。
- 相关测试：test/topic-scoring.test.mjs、test/research-pipeline.test.mjs、test/external-event-card-batching.test.mjs、test/topic-candidate-generation-domestic.test.mjs。
- 回放：node scripts/quality/backtest-topic-scoring.mjs <batch-workdir>。

## 变更触点

- 公式与配置：server/shared/domain/topic-scoring.mjs、server/features/research/application/research-pipeline.mjs、account-context.example.json。
- Agent 评分字段：skills/hotspot-brainstorm/SKILL.md、skills/hotspot-synthesis/SKILL.md、skills/hotspot-tagging/SKILL.md、server/platform/http/routes/candidate-routes.mjs。
- 外部契约：server/platform/http/routes/task-routes.mjs、scripts/agent-integration/tools.mjs、API.md。
- 标签持久化：server/platform/persistence/repositories/hotspot-repository.mjs。
