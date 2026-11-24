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
| 最终评分 | H/B/P/T/J/S/D、chinaRelevance、materialStrategy、materialFit 与账号公式配置 | resolveScoring 解析和校验 `scoring.formula`；computeFinalScore 对所有候选统一计算 A、DOM、M、C、F 并排序。未分类或缺少 M 时 M 取中性 50；T 缺失时 F 为 null；DOM 缺失时对其余有效分项归一化 | server/shared/domain/topic-scoring.mjs；server/features/research/application/research-pipeline.mjs |
| 候选筛选和产物 | 评分卡、文章资格字段 | 通过文章资格门禁的候选排序；写入 topics-ranked.md 和 topic-scoring-candidates.json，记录公式版本 | server/features/research/application/research-pipeline.mjs |

## 文章与图文赛道及阶段轨迹

- 文章和图文候选按各自赛道判断入池；`GET /api/batches/:id/ranking` 的 `inPool` / `eliminationReason` 只表示文章赛道，`GET /api/batches/:id/social-ranking` 的 `inPool` 只表示图文赛道。两个列表均附 `inPoolByTrack` 和 `selection` 状态摘要。
- 纯 GitHub 项目默认保留在图文赛道。只有采集/项目元数据明确标记 `materialStrategy=direct_practical` 的项目，才可在图文池之外最多 3 个进入讨论深研范围与文章候选预选；进入候选不代表自动入文章池，仍执行新近触发事实、可回答性、研判依据、文章资格和最终选池门禁。其他项目不改变原分流。
- `GET /api/batches/:id/selection-trace?track=all|article|social_cards&hotspotId=<id>` 将热点与事件、预选、深研覆盖、评分榜单和持久化候选产物关联，返回每个阶段的状态与原因。`not_reached` 表示前置条件未满足或阶段未运行，`not_selected` 表示执行过筛选但未入选；最终接口显示赛道自己的入池状态与最后可归因原因。
  - 组合候选的持久化成员热点会逐一关联到候选，因此成员热点的轨迹会显示已入池。若评分产物声明入选、却未匹配到持久化候选，最终阶段标记为 `unreported`（界面显示“待核对”），避免把评分记录误报为实际入池。
- 当前轨迹从批次已持久化产物重建，不新增数据库列或迁移。产物缺失时会明确显示未运行/未记录，不能据此推断为已筛选淘汰。
- 内部与外部 Agent 分阶段路径共用讨论深研与评分 pipeline，因此适用同一分流与轨迹；外部 Agent 直接提交评分不运行这套阶段 pipeline，其最终候选状态可显示，但没有发生的上游阶段会标记为未执行。

实现入口：`server/features/research/application/batch-selection-trace.mjs`、`server/features/research/domain/discussion-research.mjs`、`server/features/research/application/research-pipeline.mjs`、`server/platform/http/routes/batch-routes.mjs`、`scripts/agent-integration/tools.mjs`。

## 入口间差异

- 工作台 pipeline 与外部 Agent 分阶段入口共用完整的研究依据、脑暴、综合及评分门禁。
- 外部 Agent 直接提交入口不运行脑暴，也不从原始 bScores 重算 H/B/J；它信任提交的 H/B/J 和 S/D，在服务端读取事件 T、P、chinaRelevance，可选接收素材策略/M。未提供 M 时使用中性 50。它与内部流程共用 v4 computeFinalScore，但上游输入与门禁不同。
- 外部 Agent 分阶段入口复用脑暴产物，按相同 v4 公式评分。
- 综合选题路由只对单个综合候选调用 scoreCards，可能没有 T 或国内关联；没有 T 时不产出 F，没有 DOM 时按余下权重归一化。

## 产物与验证

- 批次产物：sources/external-research-report.json、sources/topic-scoring-candidates.json、sources/preselection-ranking.json、topics-ranked.md。
- 公式算法版本仍为 v4；账号可以在 `scoring.formula` 配置 A 内 H/B/P 权重、F 的 A/T/J/DOM/M 权重，以及 S/D 扣分系数和上限。权重输入范围为 0–1 并自动归一化；非法值回退默认值并在评分报告中提示。
- 缺失值规则保持当前行为：T 缺失不产出 F，DOM 缺失时其余分项重新归一化，素材策略未分类或 M 缺失时取中性 50。分数封顶为 0–100。公式不接受任意表达式。
- `topic-scoring-candidates.json` 和外部 Agent 报告记录本批次生效的完整归一化公式配置；回放工具优先使用该快照，因此后续调整默认值不会改变可复现的历史评分输入。
- `topics-ranked.md` 在产物中心预览时显示本批次实际公式、M 分项和配置提示；旧账号配置仍可运行 `npm run migrate:topic-scoring-v4` 预览，确认后运行 `npm run migrate:topic-scoring-v4 -- --write` 迁移并自动备份。
- `account-context.json` 中的 `scoring.formulaVersion: "v4"` 是本地配置迁移标记；`resolveScoring()` 用它判断是否提示旧配置迁移。历史批次仍保留生成时的分数与公式版本，不重算。
- 评分回放输入保存 raw B 子项、hProfile、旧公式输入快照及公式参数；回放比较分数，不重跑候选池门禁或模型决策。
- 回放工具按 v4 重算新排名；旧回放没有素材策略/M 时以 `unclassified` 和中性 M=50 重算对照，不修改归档批次，也不推断编辑采纳结果。
- 相关测试：test/topic-scoring.test.mjs、test/research-pipeline.test.mjs、test/external-event-card-batching.test.mjs、test/topic-candidate-generation-domestic.test.mjs。
- 回放：node scripts/quality/backtest-topic-scoring.mjs <batch-workdir>。

## 变更触点

- 公式与配置：server/shared/domain/topic-scoring.mjs、server/features/research/application/research-pipeline.mjs、account-context.example.json、public/src/core/account-context.js。
- Agent 评分字段：skills/hotspot-brainstorm/SKILL.md、skills/hotspot-synthesis/SKILL.md、skills/hotspot-tagging/SKILL.md、server/platform/http/routes/candidate-routes.mjs。
- 外部契约：server/platform/http/routes/task-routes.mjs、scripts/agent-integration/tools.mjs、API.md。
- 标签持久化：server/platform/persistence/repositories/hotspot-repository.mjs。
