# 选题评分 v3（B 方案）技术设计

> 状态：**历史方案，已被 v4 正式评分取代**
> 本文仅保留为历史设计记录，不是当前实现或迁移依据；当前流程见 `docs/workflows/topic-scoring.md`。
> 范围：热点打标 → 事件聚类 → 预选 → 脑暴 → 卡片评分 → 候选池 → 榜单展示
> 影响：所有新批次的文章分（F）；图文 G_social 间接受影响
> 关联代码：`server/features/research/`、`server/platform/http/routes/`、`server/shared/domain/`、`skills/hotspot-tagging/`、`skills/hotspot-brainstorm/`
> 作者：见字工作台 Agent｜日期：2026-11-15

---

## 1. 背景

### 1.1 现象

连续两天，研判给出的核心候选与编辑实际选择不一致，编辑每次都手动把"国内大厂 / 吃瓜 / 程序员日常"类选题从榜单下部捞上来。

| 批次 | 研判排名靠前（F） | 编辑实际选择 |
|---|---|---|
| 2026-11-14 | Inkling 2 Small 70.2、Claude Managed Agents 64.9、马化腾组织变革 63.6 | DeepSeek 把 App 能力搬进 API（61.9，第 5） |
| 2026-11-15 | PyPI 安全标签 66.1、黄仁勋·中概 63.5、Cloudflare Kitesurf 63.2 | M365 全球中断（**未入池**，人工补选占位 60） |

2026-11-15 批次四个候选的实测分值：

| 候选 | H | B | P | T | J | C | F |
|---|---:|---:|---:|---:|---:|---:|---:|
| PyPI 安全标签 | 87 | 60 | 80 | 88.8 | 46.5 | 9 | 66.1 |
| 黄仁勋·中概跟跌 | 62 | 68 | 80 | 92.8 | 49.6 | 6 | 63.5 |
| Cloudflare Kitesurf | 56 | 64 | 80 | 88.6 | 50.7 | 3 | 63.2 |
| DeepSeek 额度管理 | 76 | 76 | 80 | 85.0 | 23.5 | 5 | 63.1 |

### 1.2 结论

这不只是“参数偏了一点”：v2 公式**没有显式的国内关联与共鸣变量**；当前账号配置下 P 的区分度有限（5 类为 80、政策类为 25），但不能说 P 被实现成恒定值。人工重排反映了当前排序与编辑选择之间的差异，具体成因仍需分阶段回放验证。

---

## 2. 现状机制（v2）

实现位置：server/features/research/application/research-pipeline.mjs、server/features/research/domain/event-heat-ranking.mjs

A = H×0.60 + B×0.25 + P×0.15
F = A×0.55 + T×0.25 + J×0.20 − C          # C = min(35, S+D)

- **H** = hBase[historicalType] + 五感×2 + 五问×5 + recommendationFit + emotionTheme + searchFriendly（上限 100）
- **B** =（angleUniqueness + emotionSpread + titleHook + audience + factSupport）×4；当前 audience 会受读者利益门禁封顶
- **P** = 账号分类契合分。resolveScoring() 已支持 scoring.accountFit 覆盖；当前账号上下文下，6 个分类里 5 个由支柱映射得到 80，政策与公共议题为 25。“P 全部恒为 80”不准确，但当前覆盖范围仍较窄。
- **T** = 事件价值（eventValue）。当前 T = 0.9 × base + platformImpact（最高 10 分）；base 中 audience 最多 40 分、impact 最多 25 分、informationGain 最多 20 分、sourceReliability 最多 10 分，新鲜度最多 3 分、扩散最多 2 分，并扣除历史衰减。github_project 另有 stars 相关变换。因此高 T 的主要来源是 audience/impact 打标与 github 项目的 stars 机制，不能简化为“英文源天然占优”。
- **J** = 研判增量，**C** = 同题饱和 + 重复。

### 2.1 缺陷清单

| # | 当前问题/假设 | 校正后的证据与边界 |
|---|---|---|
| D1 | P 区分度不足 | 当前确有 80 / 45 / 25 兜底档；账号支柱映射覆盖 5 类，政策类为 25。scoring.accountFit 覆盖逻辑已存在，只需进一步明确配置值。 |
| D2 | F 中无国内变量 | chinaRelevance 不参与当前 F；计划新增 DOM 属于评分方案变化。 |
| D3 | T 与 J 权重可能不符合编辑目标 | T 主要由 audience/impact 打标驱动，github_project 有 stars 变换。海外来源偏差应作为待检验假设，不写成已证实归因。 |
| D4 | B 子项缺少一致锚点 | 当前脑暴 Skill 定义五项，但无各项分档锚点；新增 relatability 后需同步生成与消费提示。 |
| D5 | audience 受具体读者利益门禁封顶 | scoreCards() 对结构化 readerStakeScore 在利益描述不具体时封顶 2。若 B 使用 raw 值，需与通知资格用的 capped 值分开。 |
| D6 | historicalType 误判可能影响 H | PyPI 样例的 worker_social 标注属于待查样例；调整 hBase 不能修正类型误判，不应声称已根治。 |
| D7 | chinaRelevance 缺少打标锚点 | 当前 Skill 只规定 0–12 数值。事件热榜 chinaRelevanceScore 另有 0–10 clamp，仅供返回/审计，不参与 T；修正该审计字段量程不等于改变 T。 |

#### M365 未入池的阶段边界

文章候选在 F 计算前已经过事件热榜、文章池选择、hasResearchBasis 与脑暴。selectArticlePool() 有核心名额、黑马/候补名额和开发者直接利益保护位；F 只对脑暴卡片计算。因此：

- F 回放只能评估已有卡片的分数与排序，不能让没有卡片的 M365 进入 F 榜。
- M365 是否进入文章候选池，应单独回放事件资格、文章池选择和研究依据门禁。
- 历史事件缺打标、热榜或研究依据输入时，回放只能指出卡点，不能证明新 F 公式能解决。

## 3. 目标与非目标

**目标**

1. F 中显式包含"国内关联"与"读者共鸣"两个变量，且权重可配置、可关闭。
2. 账号契合从常数变成真实分级。
3. 吃瓜/故障/职场类选题不再被结构性扣分。
4. 全部改动可回放、可对比、可回滚。

**非目标**

- 不重算历史批次的 `f_score`。
- 不改突发专题路径（`breaking-analysis-pipeline.mjs`）。
- 不改图文 G_social 的权重（仅共享 chinaRelevance 口径修正）。
- 不做 UI 大改（F 构成列可选）。

---

## 4. 方案总览

```
A   = H×0.50 + B×0.30 + P×0.20
B   = mean(bScores 各项) × 20                        # 各项 0–5，可用项均值
F   = A×0.55 + T×0.25 + J×0.10 + DOM×0.10 − C
DOM = chinaRelevance(0–12) / 12 × 100
```

### 4.1 与 v2 的差异

| 项 | v2 | v3 | 意图与依据 |
|---|---|---|---|
| H : B : P | 0.60 / 0.25 / 0.15 | 0.50 / 0.30 / 0.20 | B 承接读者侧信号；P 变成真实分级后才配得上 0.20 |
| B 构成 | 5 项 ×4 | 6 项均值 ×20 | 新增 `relatability`；量纲仍 0–100 |
| audience 取值 | 封顶后 | 封顶**仅用于通知池门禁**；B 用未封顶值 | 吃瓜类不再被结构性扣分 |
| F 构成 | A/T/J | A/T/J/**DOM** | 国内关联 10% |
| J 权重 | 0.20 | 0.10 | 降低"必须能深研"的门槛 |
| P 取值 | 80 / 45 / 25 | 分级表（见 5.3） | 恢复区分度 |

---

## 5. 详细设计

### 5.1 H：结构不变，只调 `hBase`

H 的组成公式保持不变（五感/五问/荐配/情绪母题/搜索友好都是内容属性，与本次问题无关）。只调账号侧的 `hBase`（`account-context.json` 已覆盖默认值，注意 `DEFAULT_SCORING.H_BASE` 与账号配置并不相同，改默认值不等于生效）。

| historicalType | v2 | v3 | 理由 |
|---|---:|---:|---|
| `worker_social` | 55 | 58 | 职场/社会类是本账号高潜 |
| `career_anxiety` | 45 | 50 | 更贴"打工人切身" |
| `bigtech` | 33 | 42 | 国内大厂事件要能与海外工具抗衡 |
| `key_person_move` | 25 | 32 | 人物变动常伴吃瓜属性 |
| `owned_experience` | 40 | 36 | 自写心得不应压过热点 |
| `ai_tool_test` | 20 | 14 | 见 5.6 的口径原因，仍需保留低位但不再作为主要入口 |
| `github_tool` | 15 | 10 | 同上 |
| `financing` | 5 | 3 | 融资类对读者价值最弱 |
| `controversial_return` | 35 | 35 | 不变 |
| `contrarian_bigtech` | 35 | 35 | 不变 |

> D6 的根治不属于本次范围（属于脑暴锚点问题），列为 §12 的后续项。

### 5.2 B：六项 + 量纲归一

B = mean(可用子项) × 20；子项为 angleUniqueness、emotionSpread、titleHook、audience、factSupport、relatability，各 0–5。

- 用均值而非求和；缺失项按其余项均值插补。
- 拆分 audienceRaw 与 audienceCapped：B 使用 raw，通知/分发资格继续使用 capped。不得让一个 readerStakeScore 同时表示两种语义。
- readerStakeScore 在 bScores、packaging 和 synthesis correction 中同名；需统一三路优先级和语义。当前 correction 优先于 packaging，合成模型也会收到完整 bScores。
- relatability 缺失（历史卡片）时按可用项均值插补。

**子项锚点**（写入 skills/hotspot-brainstorm/SKILL.md）：

| 子项 | 定义 | 5 分 | 1 分 |
|---|---|---|---|
| angleUniqueness | 角度是否与同题常见报道不同 | 与主流报道明显相反或更深一层 | 复述新闻 |
| emotionSpread | 社会面情绪扩散：会不会被转发吐槽 | 大厂故障、裁员、翻车、涨价、公共事件 | 版本号更新、文档修订 |
| titleHook | 标题张力 | 具体冲突 + 数字/反差 | 抽象概括 |
| audience | 结构化读者利益（有具体动作与后果） | 明确决策 + 明确后果 | 泛化“值得关注” |
| factSupport | 事实支撑 | 多源 + 官方 | 单源转述 |
| relatability | 共鸣度：不写这段代码的人会不会也想点 | 故障复盘、大厂内斗、职场价格、翻车 | 纯 SDK / 库更新 |

emotionSpread 是传播情绪，relatability 是更广泛的读者共鸣。当前没有 bScores 专用 schema 校验，但需同步脑暴 Skill、综合选题路由硬编码 JSON 模板、合成 Skill 说明和 scoreCards() 消费端。

### 5.3 P：分级表

resolveScoring() 已读取 scoring.accountFit 并合并到 accountFitByCategory。本方案不新增评分配置管道；在现有账号配置中更新 v3 权重、分类值和 hBase。旧账号配置会覆盖代码默认值，因此提供显式迁移脚本并在未迁移时输出提示。

| 分类 | v3 候选值 |
|---|---:|
| 大厂与商业战略 | 85 |
| 职场与组织变化 | 85 |
| 开源项目与开发者生态 | 75 |
| 产品与技术动态 | 65 |
| 行业趋势与市场变化 | 55 |
| 政策与公共议题 | 20 |
| 未配置标准分类 | 本表建议值；账号画像中的自定义分类按 accountFit 配置或 `accountFitForCategory()` 回退；不在画像分类表中的事件分类 P=25 并记录 warning |

这些值是待回放校准的初始配置，不是两批样本证明的最优参数。文章池选择阶段的 accountFit 只用于同分优先级和审计，不叠加到事件分，不能靠改 P 救回未入池事件。

### 5.4 F：四项 + DOM

F = A×wA + T×wT + J×wJ + DOM×wD − C
wA=0.55  wT=0.25  wJ=0.10  wD=0.10

- DOM = clamp(chinaRelevance, 0, 12) / 12 × 100。
- chinaRelevance 与 T 使用的 audience/impact 打标可能相关，不能先验视为正交。先计算同批相关性和排名变化；再比较绝对分、相对中心化分或阈值加分，不预设 0.10 已合理。
- event-heat-ranking.mjs 当前的 chinaRelevanceScore 0–10 只用于返回/审计，不进入 T。改为 0–12 是审计口径调整，应与改打标输入、新增 DOM 分开验证。
- formulaVersion 只写批次产物元数据：external-research-report.json 顶层和 Markdown 报告头；候选表不加列、不做数据库迁移。未来若需候选级版本筛选，再单独设计迁移。
- 公式权重是方案假设，需以后续独立批次验证；不以指定样本名次调参。

### 5.5 缺失值与回退矩阵

| 缺失字段 | 处理 | 理由 |
|---|---|---|
| `eventValue` / T | `F = null`，`scoreStatus = needs_source_data` | 沿用 v2：无热度不产出最终分 |
| `chinaRelevance` | **剔除 DOM 项**，其余三项按 0.90 重新归一化 | 缺数据不能当 0 分打压；`candidate-routes` 的综合选题走此分支 |
| `relatability` | 走 B 的可用项均值 | 历史卡片兼容 |
| `readerStakeScore` | `audience = 0` | 沿用 v2 |
| 账号配置缺少标准分类 `accountFit` | 应用本方案建议值并记录配置未迁移提示；账号画像中的自定义分类按账号画像回退；不在画像分类表中的事件分类 P = 25 并记录 warning | 避免标准类目沿用旧统一值，也不白送未知类目 80 分 |

### 5.6 打标口径（DOM 的输入质量）

skills/hotspot-tagging/SKILL.md 需补 chinaRelevance 锚点，将“全球基础设施、中国开发者也在用”排除在高分之外：

| 分档 | 判定 | 例 |
|---|---|---|
| 10–12 | 国内主体 + 直接影响国内开发者/市场/监管 | 国内大厂发布、工信部政策、国内平台改规则 |
| 7–9 | 国内主体但影响间接，或海外事件有明确国内传导 | 海外厂商在华业务调整 |
| 4–6 | 全球事件，国内读者可用但无本地落点 | 全球云故障、海外开源项目 |
| 0–3 | 纯海外、与国内开发者无动作关系 | 美国本地政务、海外消费电子 |

新增枚举 domesticSubject：国内厂商 | 国内监管 | 国内市场 | 无。本方案决定先只作打标判定依据，不直接进评分，也不要求从事件层传到候选层。updateTags() 将 tags 写入热点 raw_json.aiTags；若要持久化该字段，需在 repository 白名单和打标路由校验中接受它。将来若该字段参与评分或展示，再另行增加事件/候选数据流及数据库迁移评估。

chinaRelevanceScore 当前 0–10 字段只是返回/审计值，不参与 T；与本节的 0–12 打标口径分开处理。

### 5.7 配置项

```json
"scoring": {
  "weights": { "h": 0.50, "b": 0.30, "p": 0.20 },
  "eventValueWeight": 0.25,
  "researchValueWeight": 0.10,
  "domesticWeight": 0.10,
  "formulaVersion": "v3",
  "accountFit": {
    "大厂与商业战略": 85, "职场与组织变化": 85,
    "开源项目与开发者生态": 75, "产品与技术动态": 65,
    "行业趋势与市场变化": 55, "政策与公共议题": 20
  },
  "hBase": { "worker_social": 58, "career_anxiety": 50, "bigtech": 42, "key_person_move": 32,
             "owned_experience": 36, "ai_tool_test": 14, "github_tool": 10, "financing": 3,
             "controversial_return": 35, "contrarian_bigtech": 35 },
  "categoryPreference": { "大厂与商业战略": 6, "职场与组织变化": 6, "开源项目与开发者生态": 3,
                          "产品与技术动态": 2, "行业趋势与市场变化": 1, "政策与公共议题": 0 },
  "marketScopeCategoryPreference": {
    "国内": { "大厂与商业战略": 8, "职场与组织变化": 6, "产品与技术动态": 6 }
  }
}
```

约束（`resolveScoring()`）：

- `domesticWeight` 夹取 `[0, 0.25]`，默认 `0.10`。
- `eventValueWeight ∈ [0.25, 0.40]`、`researchValueWeight ∈ [0.10, 0.30]`（沿用）。
- 强制 `eventValueWeight + researchValueWeight + domesticWeight ≤ 0.85`，剩余归 A；越界时按比例缩放并记 warning。
- `weights.h + weights.b + weights.p` 归一化到 1；非 1 时写入可见 warning。

---

## 6. 文件级改动清单

### 6.1 评分核心

| 文件 | 位置 | 改动 |
|---|---|---|
| `server/features/research/application/research-pipeline.mjs` | `resolveScoring()`、`scoreCards()`、报告与回放产物 | v3 权重与迁移提示；B 六项均值、raw/capped 拆分、DOM、F 计算与精确 v2 分量快照 |
| `server/shared/domain/topic-scoring.mjs` | `computeFinalScore()` | 内部流水线、综合选题和直接外部研判共用公式与缺失值回退 |
| `server/platform/http/routes/task-routes.mjs` | 外部研判提交与打标校验 | 直接外部研判复用共享评分；国内关联取稳定事件分数 |
| `server/platform/http/routes/candidate-routes.mjs` | 综合选题输入 | bScores prompt 补 `relatability`；缺少 T 时不生成 F，缺 DOM 时归一化 |

### 6.2 打标与校验

| 文件 | 改动 |
|---|---|
| `skills/hotspot-tagging/SKILL.md` | 补 `chinaRelevance` 分档锚点；新增 `domesticSubject` 枚举 |
| `server/platform/http/routes/task-routes.mjs:73` | 打标入参校验接受 `domesticSubject`（否则 422） |
| `server/platform/persistence/repositories/hotspot-repository.mjs` | `updateTags` 持久化可选 `domesticSubject`；未提供时留空，与显式“无”区分 |
| `API.md:618` | 接口文档同步 |

### 6.3 数据流一致性

| 文件 | 位置 | 改动 |
|---|---|---|
| hotspot-clustering.mjs | 事件映射 | 保持 chinaRelevance 到事件级 china_relevance_score 的映射，作为 DOM 唯一输入 |
| event-heat-ranking.mjs | chinaRelevanceScore | 若统一 0–12，仅改返回/审计字段与对应测试；明确不进入 T 公式 |
| topic-candidate-generation.mjs | 候选生成 | 多事件候选取 lead 事件的 chinaRelevance，不用成员最大值抬高 DOM |
| social-scoring.mjs | 图文榜 | 只有打标口径变化时才回归分布；本轮不改变图文榜权重 |

### 6.4 脑暴产出端

| 文件 | 改动 |
|---|---|
| `skills/hotspot-brainstorm/SKILL.md` | ①bScores 五项写锚点 ②新增 `relatability` ③`emotionSpread` 与 `relatability` 分工写清 |

> 代码内 `BRAINSTORM_SYSTEM` fallback 已删除（`test/selection-prompts.test.mjs:23` 断言其不存在），skill 是唯一来源，无需同步第二份。

### 6.5 配置与展示

| 文件 | 改动 |
|---|---|
| `account-context.json` | 按 5.7 更新 `scoring` |
| `account-context.example.json` | 同步示例 |
| `scripts/migrate-topic-scoring-v3.mjs` | 预览或备份后迁移被忽略的本地 account-context.json；更新标准分类的评分与预选偏好、保留自定义分类和 legacyV2 回放快照 |
| `public/src/core/account-context.js` | 配置编辑提示含 v3 权重和迁移命令 |
| `server/features/research/application/research-pipeline.mjs` | `topics-ranked.md` 展示 DOM 列、公式版本和账号配置告警；不改候选表 UI |

### 6.6 不改动清单

| 对象 | 为什么不动 |
|---|---|
| `breaking-analysis-pipeline.mjs` | 突发专题的 f 来自模型 `finalScore`，另一套口径；与本方案混改会无法归因 |
| 历史 `f_score` | 不回算，避免新旧分数混表；新批次生效 |
| `scoreCards` 的 C（竞争扣分） | 本次无证据表明其有问题 |
| `preselection()` 的 `finalPreScore` | 仅影响入池排序，F 修正后其作用被稀释；下一轮再评估 |

---

## 7. 兼容性

1. **历史批次**：`f_score` 不变；批次报告产物 JSON 顶层和 Markdown 报告头写 `formulaVersion`。本方案不增加候选行版本字段；产物中心预览的 `topics-ranked.md` 会展示报告头的批次级版本。
2. **外部 Agent 契约**：`jianzi_batch_research_submit` 的 `scoreInputs` 保持 H/B/J/饱和/重复五字段必填；DOM **可选**，缺失走 5.5 回退。若强制必填，现有调用方会全部 422。
3. **图文榜**：`G_social` 权重不变，但 `chinaRelevance` 口径收紧会使其数值整体下移，需单独回归（不视为失败）。
4. **分数整体漂移**：v3 下所有候选 F 会移动约 ±3–8 分，属于预期；不使用硬阈值（现有代码已无 `f_score < 55` 拦截）。

---

## 8. 测试计划

### 8.1 预计必须更新的用例

| 文件:行 | 原断言 | 处理 |
|---|---|---|
| test/research-pipeline.test.mjs:625 | weights.h === 0.6 | 按最终 v3 配置更新 |
| 同上 611–620 | 自定义权重回测期望 | 重算 |
| 同上 167、177 | eventValue 高者排前 | 按拆分后的最终公式重写期望 |
| 同上 214–239 | reader-stake 门禁用例 | 区分 raw 分参与 B、capped 分参与门禁 |
| 同上 637 | 六项 bScores 场景 | 补 relatability |
| test/breaking-analysis.test.mjs:59 | f_score === 82 | 确认走突发路径则不变 |

### 8.2 新增用例

| 用例 | 断言 |
|---|---|
| DOM 缺失回退 | F 按 0.90 归一化，不因缺字段掉到 0 |
| DOM 翻转排序 | 仅 DOM 差异即可改变排名 |
| chinaRelevance 边界 | DOM 公式 0 / 12 / 超出范围 |
| relatability 缺失 | B 按可用项均值，等于按均值插补 |
| 权重归一化 | 三项之和 > 1 时缩放并 warning |
| 通知池门禁不受影响 | capped 规则仍生效 |
| formulaVersion 写入 | 批次产物 JSON 顶层和 Markdown 报告头带版本；不要求候选行带版本 |

## 9. 回放与验收

### 9.1 回放范围

- **F 回放**：仅能对已进入脑暴且已归档 bScores / hProfile 的候选计算新旧分。两批约 20 条、日期相邻且来源与事件可能重叠；只作功能回归和错误检查，不作为参数有效性的统计证据。
- **预选/入池回放**：单独读取同一时点的全量热点、事件打标、热榜及门禁输入，复现事件热榜、文章池选择、研究依据门禁。没有这些输入的未入池事件不能用 F 回放替代。
- **前瞻观察**：参数冻结后收集后续独立日期批次。按批次/日期等依赖组划分，避免相邻或重复事件跨入调参与验证两侧。只有两批数据时，不宣称完成留出验证。
- 输出候选覆盖数、未入池原因、v2/v3 分数与排名、DOM/T 相关性、方向性变化及人工编辑选择，并列出反例。Kendall τ、top-3 命中只作描述性指标，注明样本量，不作显著性结论。

### 9.2 验收标准

1. **阶段边界正确**：M365 等未入池事件只在预选/池选择回放中评估，不列为 F 必须“进前三”的条件。
2. **实现不回归**：v2 与抽取后的 v2 计算结果逐条相等；无 T 候选仍不产出正式 F；通知池硬门禁保持原行为。
3. **指标如实报告**：对当前约 20 条卡片报告排名变化、DOM/T 相关性及方向性分组结果，不按指定候选名次调权，也不据此声称泛化有效。
4. **前瞻标准**：参数冻结后新增多个独立批次，检查目标分组平均排名变化、编辑选择覆盖和反例变化；评估窗口与方向性阈值须在查看验证结果前登记。
5. **反例检查**：至少覆盖纯海外工具/消费电子、政策类、融资类候选，观察是否无差别整体抬分。
6. 全部既有测试通过（除 8.1 明确更新的用例）。

### 9.3 回放脚本

新增 scripts/quality/backtest-topic-scoring.mjs：读取 sources/preselection-ranking.json 与已归档候选卡，用 v2/v3 两套常量分别计算，输出排名、F、A/T/J/DOM 构成。脚本区分事件入池回放与卡片 F 回放；门禁输入不可重建时标注“无法回放”，不补造数据。

### 9.4 小样本验证约束

当前两批样本相邻且可能共享事件/采集源，不能视作独立验证集。验证数据应按批次、事件或时间组整体留出，避免依赖样本同时出现在调参与验证集合；小样本结果仅供回归和方向性观察。分组验证原则可参考 [scikit-learn 对依赖分组数据的交叉验证说明](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data)。

## 10. 发布顺序与回滚

每步单独改动并记录回放结果；下列数值是候选方案，不代表现有样本已验证。

| 步 | 内容 | 可验证信号 | 回滚方式 |
|---|---|---|---|
| **S0 基线** | 保存当前输入、v2 F 输出和各阶段淘汰原因；补回放脚本骨架及报告产物 formulaVersion 约定，不改评分行为 | 原输入可重现候选和分数；产物有版本 | 移除新增脚本/元数据 |
| **S1 消除公式重复** | 将主路径与外部 Agent 提交路径抽为共享函数；保持 v2 公式、缺失值与 rounding 等价；同步报告公式文字 | 两条路径相同输入输出一致且逐项等于基线 | 恢复原实现 |
| **S2 配置 P** | 使用现有 scoring.accountFit 填分类值，不新增配置管道；观察 P 与同分排序影响 | 配置生效；预选资格和 T 排序不变 | 删除覆盖配置 |
| **S3 调整 H 配置** | 单独调整 hBase；历史类型误判单独记录，不以权重变化冒充分类修复 | 只观察已入池卡片 H/F 变化 | 恢复旧 hBase |
| **S4a audience 语义拆分** | raw 分用于 B，capped 分用于通知/分发门禁；统一 bScores、packaging、synthesis correction 语义 | B 读 raw，门禁读 capped，旧卡兼容明确 | 恢复旧封顶逻辑 |
| **S4b relatability** | 单独增加字段、锚点和所有生成/消费提示 | 历史缺字段兼容，prompt 与评分读取一致 | 移除字段并恢复原均值 |
| **S5 DOM** | 在现有打标口径下新增 DOM；先看相关性和排名变化，再决定权重；不同时改锚点 | 开关差异可解释，缺失回退正确 | domesticWeight=0 并恢复旧 F |
| **S6 打标口径与 subject 持久化** | 单独更新锚点；domesticSubject 若仅作依据，只补输入校验与热点 tags 写入，不扩展评分数据流 | 记录标签分布及对 T/DOM 的影响 | 回退 Skill/校验口径 |
| **S7 文档收口** | 更新测试、API、配置示例、工作流契约和 changelog；仅在跨层实现落地后更新当前态 workflow contract | 文档与实现路径一致 | 随对应实现提交回滚 |

**回滚**：DOM 权重置 0 可关闭新增项；P、H 配置可恢复旧值；B 语义变更分别回退。产物保留 formulaVersion 区分批次，不覆盖历史分数。

## 11. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| DOM 与 T 打标信号相关 | 国内关联可能被 audience/impact 双重计分 | 先测相关性和排名影响；比较绝对分、相对中心化或阈值加分，不预设 0.10 已合理 |
| 分数整体漂移 | 历史可比性断裂 | 批次产物与报告头记录 formulaVersion；不回算，不增加候选数据库列 |
| B 六项让模型打分更分散 | 方差变大，历史同名字段语义冲突 | 区分 raw/capped reader stake；同步脑暴、综合选题 prompt、synthesis 和消费者 |
| 外部 Agent 契约变化 | 调用方校验失败或字段缺失 | DOM 保持可选；核对路由校验、API 文档和 MCP schema 实际调用路径 |
| 公式路径重复 | 内部与外部结果漂移 | 先锁定 v2 基线；共享函数后验证同输入等价 |
| 样本过少且批次相关 | 具体名次阈值容易过拟合 | 当前回放只作回归/探索；冻结参数后收集独立批次 |
| 未入池问题被误归到 F | 评分改动无法影响前置入池与研究依据门禁 | 分阶段记录事件热榜、文章池、hasResearchBasis、脑暴和 F |
| domesticSubject 被误当作完整下游字段 | 热点 tag 不会自动进入事件/候选 | 本轮只作打标依据；若进公式，补映射与迁移设计 |
| 开发者直接利益保护位未评估 | 可能重复增加 DOM 权重来解决入池覆盖 | 先评估 selectArticlePool() 现有保护位，再决定是否调整 |

## 12. 未决事项（需编辑确认）

| # | 问题 | 当前建议/边界 |
|---|---|---|
| 1 | DOM 只由 chinaRelevance 构成，还是纳入 domesticSubject | 先仅用 chinaRelevance；subject 只作打标依据，不扩展事件/候选 schema |
| 2 | DOM 形式与权重 | 可配置实验项；先测与 T 的相关性，再比较绝对分、相对分或阈值加分；0.10 未校准 |
| 3 | 外部 Agent scoreInputs 是否强制 DOM | 保持可选；缺失按回退矩阵处理，确认实际验证器和接口文档 |
| 4 | 历史批次是否回算 | 不回算；回放产物与新批次分别标记公式版本 |
| 5 | relatability 是新增项还是并入 emotionSpread | 建议新增，以区分传播情绪与共鸣；同步所有生成/消费提示 |
| 6 | 是否抽取共享 computeFinalScore() | 建议公式调整前抽取并证明 v2 等价；核对主路径和外部提交路径的输入、门禁、输出 |
| 7 | historicalType 误判是否本轮处理 | 先记录误判样本，不以 hBase 对冲后宣称修复 |
| 8 | 现有两批样本如何验收 | 只作回归/探索，不用指定前三名或事后阈值调参；冻结参数后追加独立批次 |
| 9 | formulaVersion 写在哪里 | 批次报告产物 JSON 顶层和 Markdown 报告头；不增候选表列 |
| 10 | domesticSubject 若以后进评分如何扩展 | 增加事件/候选映射与持久化/迁移评估；当前不进入公式 |
| 11 | 是否利用开发者直接利益保护位 | 已有热榜前 5 保护位；先测覆盖率，再与 DOM 比较 |

## 附录 A：术语

| 术语 | 含义 |
|---|---|
| H | 内容侧潜力分（类型基分 + 五感/五问/荐配/情绪母题/搜索友好） |
| B | 读者侧张力分（角度/情绪/标题/受众利益/事实支撑/共鸣） |
| P | 账号分类契合分 |
| A | 文章化质量分 = H/B/P 加权 |
| T | 事件热度分（`eventValue`） |
| J | 研判增量分 |
| DOM | 国内关联分 |
| C | 竞争扣分 = 同题饱和 S + 重复 D |

## 附录 B：v2 → v3 公式对照

> v3 数值是待回放/前瞻验证的候选配置，不代表两批小样本已证明效果；实施前先记录 v2 基线，参数冻结后用独立后续批次评估。

```
v2:  A = H×0.60 + B×0.25 + P×0.15
     F = A×0.55 + T×0.25 + J×0.20 − C

v3:  A = H×0.50 + B×0.30 + P×0.20
     B = mean(6 项可用子项) × 20
     F = A×0.55 + T×0.25 + J×0.10 + DOM×0.10 − C
```
