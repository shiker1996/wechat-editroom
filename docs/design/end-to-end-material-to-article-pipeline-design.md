# 从素材采集到公众号成稿的端到端改造设计

> 状态：待评审，尚未实施
>
> 日期：2026-09-07
>
> 目标：把“明确动作—具体影响—现实后果—利益冲突”从素材采集阶段一路传递到文章成稿和发布后复盘，用最小改动提高爆款素材的发现率、选题命中率和成稿兑现度。

相关设计：

- [从讨论研判到高讨论文章的选题链改造方案](./discussion-oriented-topic-research-adjustment-plan.md)
- [事件归并与事件热榜设计](./event-resolution-and-hotlist-design.md)
- [内容类型、来源证据与文章/图文分流改造方案](./content-routing-and-source-evidence-design.md)
- [决策底稿研判采用与文章贴合度改造方案](./editorial-decision-draft-research-coverage-adjustment-plan.md)

## 1. 核心结论

本方案不新增一套独立的“爆款评分系统”，也不要求安装外部写作技能。改造重点是增加一份贯穿各阶段的文章素材简报，并让现有事件卡、研判素材、编辑会和文章链消费同一组字段。

目标链路：

```text
采集来源
  ↓
热点打标与事件归并
  ↓
事件事实卡：确认发生了什么
  ↓
讨论研判：发现落差、冲突、影响和证据
  ↓
研判素材：形成可验证的论证单元
  ↓
候选选题与编辑会：锁定一个命题
  ↓
文章素材简报：锁定读者、角度、证据和标题承诺
  ↓
事实基座 → 大纲 → 类型化初稿 → 标题 → 审稿 → SEO → 终稿
  ↓
发布数据回流：更新素材模式和搜索模板
```

关键判断：

> 事件卡回答“发生了什么”；研判素材回答“这件事形成了什么可验证的矛盾或影响”；文章素材简报回答“这次具体要写什么，以及文章必须兑现什么”。

## 2. 对象边界

当前项目中的“素材”有不同语义，不能合并成一个对象。

| 对象 | 当前对应物 | 粒度 | 核心问题 | 主要消费者 |
|---|---|---|---|---|
| 原始热点 | `hotspots` | 一条报道/来源 | 哪条来源说了什么 | 打标、归并 |
| 事件事实卡 | `event-cards.json` / `event-card-generator` | 一个稳定事件 | 事实是什么，来源之间有何增量或分歧 | 热榜、研判、事件图文 |
| 研判素材 | `verified_research_materials` | 一个反常、冲突、关系或影响 | 哪个事实可以支撑一个讨论方向 | 候选生成、脑暴、编辑会 |
| 文章素材简报 | 锁题后的 `article-brief.md`，新增结构化段落 | 一个文章命题 | 这次从什么角度写，读者获得什么判断 | 事实基座、写作、标题、审稿 |
| 作者素材卡 | `writing_materials` | 一条个人经历、项目记录或外部资料 | 作者实际记录或确认了什么 | 主动写作、素材池 |

### 2.1 事件卡不是文章角度

事件卡是事实层对象，以事件为中心，可以挂多条报道和来源。它可以说明某公司宣布调整组织结构、官方如何表述、媒体补充了什么，以及来源之间有什么分歧，但不应该直接决定：

- 文章从谁的成本切入；
- 读者应该改变什么判断；
- 哪个冲突是文章主线；
- 标题应该承诺什么。

### 2.2 一张事件卡可以产生多条研判素材

研判素材必须在事件卡完成、讨论研判完成之后，由已搜索和整理过的证据提炼出来。一张事件卡可以生成多条研判素材，一条研判素材也可以关联多个事件：

```text
事件事实卡 E1
  ├─ M1：承诺与结果的落差
  ├─ M2：公司与员工的成本冲突
  └─ M3：用户迁移的后续影响

事件事实卡 E2 + E3
  └─ M4：两个事件的策略反差
```

研判素材类型包括：

- `internal_anomaly`：预期、承诺、基线与结果的落差；
- `internal_interest_conflict`：收益、成本、责任或解释权分配不对称；
- `internal_divergence`：同一事件存在相反解释或结果分化；
- `inter_event_sequence` / `response` / `comparison` / `trend` / `counterexample`：事件间关系。

研判素材必须回指 `event_id`、`material_id` 和证据来源，不能把事件卡中的 `angles`、`consequence_signals` 或模型推测直接升级为已验证素材。

### 2.3 文章素材简报是写作契约

文章素材简报不是新的事实来源，也不是新的历史数据表，而是编辑会从研判素材中选定命题后生成的写作契约。它要回答：

```text
这篇文章要解释什么？
谁应该关心？
核心冲突是什么？
证据能支持到什么程度？
标题承诺什么？
正文必须如何兑现？
```

第一阶段不新增独立的 `material_cards` 表。热点研判复用现有 `verified_research_materials`；文章素材简报优先写入现有 `article-brief.md` 和结构化索引。

### 2.4 作者素材卡保持独立

`writing_materials` 面向作者经历、项目复盘、阅读资料和证据资产，与热点研判素材不合并。两者可以在文章简报中同时引用，但必须标注来源类型和事实边界。

## 3. 跨阶段传递契约

不新增独立的爆款评分实体，而是规定现有对象之间必须传递的最小字段。字段在不同阶段逐步补齐，前一阶段没有证据时，后一阶段不得自行补写成事实。

| 字段 | 首次产生阶段 | 进入候选前 | 锁题后 | 成稿消费方 |
|---|---|---:|---:|---|
| `action` | 事件事实卡 | 必填，需标注事实状态 | 必填 | 开头、标题 |
| `affected_group` | 采集/研判 | 必须有来源或明确待核 | 必填 | 开头、读者意义 |
| `baseline_change` | 讨论研判 | 候选优先；缺失则降为观察 | 必填或写明未知 | 机制解释 |
| `reader_consequence` | 讨论研判 | 高优先级候选必填 | 必填 | 正文和结尾 |
| `conflict` | 讨论研判 | 高冲突低证据进入实验池 | 必填或明确无冲突 | 正文主线 |
| `impact_evidence` | 讨论研判 | 至少一条可回溯证据 | 必填 | 事实基座、审稿 |
| `alternative_explanations` | 验证层 | 高风险表达必填 | 必填或明确无 | 审稿、限定表达 |
| `thesis` | 编辑会 | 不在候选阶段强行生成 | 必填 | 大纲、初稿 |
| `title_promise` | 标题生成阶段 | 不参与事件热榜 | 成稿前生成 | 标题、标题兑现审稿 |

三条不变量：

1. `event-card` 只能提供事实和证据边界，不能直接提供文章角度；
2. `verified_research_materials` 只能在有来源回指时升级为候选研判素材；
3. `material_brief` 是写作契约，不是新的事实来源，写作、标题和审稿只能消费它及其回指证据。

旧事件、旧候选和旧文章简报缺少这些字段时允许读取，但不能因此自动获得高确定性推荐；重跑或编辑锁题时补齐字段。

## 4. 端到端目标流程

### 阶段 0：历史素材模式校准

使用已导入的历史文章表现数据，包含目前被标记为 `manual_skip` 的高表现文章，提取少量可解释的模式，不建立复杂预测模型。

第一版只归纳：

- 主体动作：裁员、重组、涨价、处罚、关闭、迁移、开放、跨界等；
- 影响对象：员工、程序员、开发者、创作者、用户、商家等；
- 现实后果：岗位、收入、成本、权限、效率、选择等；
- 冲突类型：收益与成本、承诺与结果、平台与用户、公司与员工等；
- 证据形态：比例、金额、人数、时间变化、回应、迁移或替代行为。

这些模式只用于生成搜索扩展和研判提示，不直接把某类标题判为爆款。

### 阶段 1：采集与热点打标

保留现有采集器、热榜和来源健康机制。在热点进入事件归并前增加轻量的“后果发现提示”：

```text
主体动作 + 影响对象
主体动作 + 成本/岗位/权限/效率/选择
主体动作 + 回应/反弹/迁移/替代
主体动作 + 数字/比例/金额/前后变化
```

采集阶段只记录候选信号，不把搜索摘要直接当成事实。来源状态和证据等级继续沿用现有规则。

### 阶段 2：事件归并与事件事实卡

事件归并继续负责回答“是不是同一件事”。事件卡继续负责：

- 事件结论和背景；
- 已确认事实；
- 来源增量；
- 来源分歧；
- 时间线；
- 待核内容；
- 内容类型和文章/图文资格。

本阶段不生成文章角度，不计算读者利益，不把事件卡摘要直接包装成标题。

事件卡可以增加以下事实发现字段，但必须标记状态：

```json
{
  "action_summary": "主体做了什么",
  "affected_groups": ["可能受影响的群体"],
  "consequence_signals": ["来源中已经出现的后果线索"]
}
```

状态只能是 `confirmed`、`reported` 或 `unverified`，不能把模型推断伪装成已确认事实。

### 阶段 3：讨论研判

沿用当前“Top-K 事件一次模型联网研判、程序整理报告和素材”的总体设计，但把搜索和输出明确分成发现层、验证层。

#### 3.1 发现层

围绕事件卡生成以下研究问题：

- 主体做了什么具体动作；
- 哪个群体受到直接影响；
- 和过去、承诺或行业基线相比改变了什么；
- 谁获益，谁承担成本；
- 有没有真实回应、迁移、抵制、替代或后续结果。

#### 3.2 验证层

对可能进入候选的方向补齐，并在文章简报中统一映射命名：

- `baseline`：原来的状态或参照系；
- `observed_change`：现在发生的变化；
- `affected_group`：具体受影响群体；
- `reader_consequence`：对工作、收入、成本、效率或选择的影响；
- `conflict`：收益、成本、责任或解释权的冲突；
- `impact_evidence`：支撑后果的来源、数字或回应；
- `alternative_explanations`：反方解释或限制条件。

第一版不改造 `verified_research_materials` 的既有字段契约：`reader_impact` 映射为文章层的 `reader_consequence`，`difference_or_conflict` 与 `parties` 映射为文章层的 `conflict`。只有现有素材确实缺失时，才在研判提示中补问，不新增同义字段。

没有后果证据的素材可以保留为观察线索，但不得直接进入高确定性爆款候选。

### 阶段 4：候选选题与编辑会

候选仍由 `hotspot-brainstorm` 和 `hotspot-synthesis` 生成，但新增以下要求：

- 候选标题不能只是事件卡标题的改写；
- `angle` 必须说明解释对象和切入角度；
- `thesis` 必须是可被证据支持或反驳的判断；
- `reader_consequence` 必须具体到工作、收入、成本、效率或选择；
- 候选必须回填至少一个研判素材和一个证据边界；
- 高冲突但证据不足的题进入实验池，不伪装成稳定推荐题。

编辑会最终只锁定一个文章命题，不再只锁定一个事件：

```text
事件：某公司调整组织结构
命题：这不是一次普通裁员，而是成本压力开始传导到哪些技术岗位的问题
读者任务：判断自己的岗位风险和技能迁移方向
证据边界：目前只能确认岗位数量和官方解释，影响范围仍需限定
```

预选阶段不新增独立数值分，改为根据以下字段生成 `material_readiness` 状态：

- 动作具体性；
- 影响对象明确度；
- 现实后果证据；
- 冲突清晰度；
- 量化或反应证据；
- 来源完整度。

状态只有三档：

| 状态 | 含义 | 选题去向 |
|---|---|---|
| `insufficient` | 只有事件事实，尚缺少具体后果或证据 | 保留观察，不进入重点文章候选 |
| `promising` | 已看到影响或冲突，但仍需要验证 | 进入爆发型/实验型候选 |
| `verified` | 动作、影响、后果和证据基本完整 | 可以进入稳定推荐候选 |

`material_readiness` 只负责素材成熟度和候选路由，不预测阅读量，也不改变现有 H/B/P/S/D/F 评分。

### 阶段 5：文章素材简报

在现有 `article-brief.md` 中增加统一的 `material_brief` 段落：

```json
{
  "material_brief": {
    "event_ids": ["E1"],
    "research_material_ids": ["RM-1", "RM-2"],
    "action": "主体具体做了什么",
    "affected_group": "具体影响谁",
    "reader_consequence": "读者的工作、收入、成本、效率或选择发生什么变化",
    "conflict": "谁获益、谁承担成本或责任",
    "baseline_change": "与过去、承诺或行业基线相比的变化",
    "thesis": "本文要解释或判断的核心命题",
    "counter_evidence": ["反方解释或限制"],
    "evidence_boundary": "可确定表达、需限定表达和禁止表达",
    "title_promise": "标题向读者承诺解决什么问题",
    "reader_action": "读者读完后应该获得什么判断或行动依据",
    "article_type": "wechat-mp-tech-hotspot|wechat-mp-deep-dive|wechat-mp-tech-deep|wechat-mp-gossip-chill",
    "material_readiness": "verified"
  }
}
```

编辑室不展示或要求填写这段 JSON。页面只增加“文章素材承接”区域，系统根据研判结果预填，编辑确认关键判断。

| 页面字段 | 对应字段 | 交互方式 |
|---|---|---|
| 具体影响谁 | `affected_group` | 系统预填，编辑确认或修正 |
| 读者会受到什么影响 | `reader_consequence` | 系统预填，编辑确认或修正，必填 |
| 核心利益冲突 | `conflict` | 系统预填，编辑确认或修正，必填或明确“无” |
| 本文要证明什么 | `thesis` | 复用现有字段，必填 |
| 文章切入角度 | `angle` | 复用现有字段，必填 |
| 证据边界 | `evidence_boundary` | 由已确认事实、来源分歧和禁止表达汇总，编辑确认 |
| 读者最终获得什么 | `reader_action` | 系统建议，编辑确认或修改 |

以下字段只读或自动生成，不要求编辑填写：`event_ids`、`research_material_ids`、`action`、`baseline_change`、`counter_evidence`、`impact_evidence`、`article_type`、`material_readiness` 和 `title_promise`。内部 ID 不直接暴露给编辑。

### 阶段 6：事实基座、大纲和类型化初稿

成稿链继续使用现有 `wechat-mp-topic-to-article`，但所有写作技能都从 `material_brief` 读取主线。

#### 6.1 统一写作技能契约

`material_brief` 是写作技能的上游约束，不是供模型自由参考的背景资料。`wechat-mp-topic-to-article` 负责将它传入事实基座、规划、初稿和后续门禁；类型化写作技能负责把它兑现为文章结构。

所有文章类型共同遵守：

```text
material_brief
  → 开头：主体动作 + 影响对象 + 现实后果
  → 正文：事实 + 机制 + 利益/成本冲突 + 反方或边界
  → 结尾：读者应该获得的判断或行动依据
```

写作技能不得：

- 把 `promising` 或 `needs_review` 素材写成无条件确定事实；
- 把事件卡摘要直接扩写成文章命题；
- 为增强冲突自行补造数字、人物、后果或作者经历；
- 绕过 `evidence_boundary` 和 `forbidden_claims`；
- 为了套用“爆款结构”牺牲事实、限定语和作者立场边界。

#### 6.2 最小技能调整范围

| 技能 | 是否必须调整 | 最小调整 |
|---|---:|---|
| `wechat-mp-topic-to-article` | 是 | 将 `material_brief` 作为事实基座、规划、写作和审稿的共同输入；禁止下游阶段丢弃字段 |
| `wechat-mp-tech-hotspot` | 是 | 开头直接交代动作、影响对象和后果；正文按事实 → 解释 → 读者影响推进 |
| `wechat-mp-deep-dive` | 是 | 明确参与方、利益机制、成本/责任分配、反方解释和成立条件 |
| `title-generator` | 是 | 读取动作、影响对象、后果、冲突和命题；标题必须有可兑现的具体承诺 |
| `article-reviewer` | 是 | 检查标题兑现、后果证据、冲突展开和读者意义，发现缺失时返工 |
| `wechat-mp-tech-deep` | 轻量调整 | 将技术动作连接到成本、性能、工程边界和决策影响 |
| `wechat-mp-gossip-chill` | 轻量调整 | 将具体职场场景连接到反差、现实后果和克制解释 |
| `wechat-mp-tutorial` | 暂不调整 | 只有内容路由为工具教程时，再消费工具步骤、收益和限制字段 |
| `humanizer-zh`、SEO、排版、配图 | 不调整 | 继续消费通过前置门禁的正文 |

第一版只修改技能的输入契约、结构要求和门禁规则，不新增“爆款写法”技能，也不要求所有文章强行加入利益冲突；没有冲突时必须明确写成“无冲突”或改用其他可验证的文章主线。

共同写作规则：

1. 开头优先交代动作、影响对象和现实后果；
2. 正文按“事实 → 机制 → 后果 → 冲突/反例”推进；
3. 事实、解释和作者判断分开；
4. 不把 `needs_review` 或 `summary_only` 素材写成确定事实；
5. 结尾回答读者应该如何理解、判断或行动。

类型路由保持现有技能：

| 内容类型 | 重点承接 |
|---|---|
| `wechat-mp-tech-hotspot` | 发布/动作 → 开发者或从业者影响 → 判断 |
| `wechat-mp-deep-dive` | 参与方 → 利益机制 → 成本分配 → 反例 |
| `wechat-mp-tech-deep` | 技术动作 → 原理/成本/性能 → 决策影响 |
| `wechat-mp-gossip-chill` | 具体职场场景 → 离谱或反差 → 克制解释 |

不为每种文章另造一套“爆款写法”，只要求它们兑现同一份文章素材简报。

### 阶段 7：标题、审稿和终稿门禁

标题生成读取 `action`、`affected_group`、`reader_consequence`、`conflict` 和 `thesis`，优先生成：

- 主体动作 + 现实后果；
- 冲突双方 + 具体变化；
- 事件变化 + 读者意义；
- 数字/比例 + 影响对象。

标题确定后，再将最终标题及其兑现对象整理为 `title_promise`，供审稿门禁检查，不把它作为标题生成的前置输入。

审稿新增四项检查：

- 标题承诺的冲突是否在正文兑现；
- 现实后果是否有对应证据；
- 读者影响是否具体而非泛泛而谈；
- 文章是否只是复述新闻，没有解释为什么重要。

SEO、配图、排版和发布安全门禁不改变，只消费通过审稿的正文。

### 阶段 8：发布数据回流

历史数据和新发布数据分成两类用途：

- 头部表现：发现可能的爆发型素材模式；
- 中位表现和重复样本：判断模式是否稳定可复用。

每轮只校准三类可解释产物：

- `discovery_patterns`：哪些主体动作和影响对象组合值得继续搜索；
- `verification_questions`：哪些后果、冲突或反应最需要补证；
- `title_promises`：哪些读者意义适合继续测试。

反馈回流到采集搜索扩展、研判验证问题、选题素材标签和标题承诺，不直接改写作者技能。

第一版不把单篇高阅读文章、标题形式、栏目或通知状态直接解释为爆款因果。

## 5. 最小实施范围

### 5.1 必做改动

| 位置 | 最小改动 |
|---|---|
| `discussion-research-stage.mjs` | 增加动作、影响对象、后果、冲突和验证问题；输出继续回填现有研判素材 |
| `research-search.mjs` | 为事件生成“动作—影响对象—后果—反应”搜索扩展 |
| `research-pipeline.mjs` | 在预选阶段生成 `material_readiness`，用于候选路由，不新增独立数值分 |
| `topic-candidate-generation.mjs` | 候选绑定研判素材、读者后果和证据边界，禁止只由事件摘要生成标题 |
| `hotspot-brainstorm/SKILL.md` | 增加 `affectedGroup`、`readerConsequence`、`impactEvidence` 等输出要求 |
| `hotspot-synthesis/SKILL.md` | 区分爆发型和稳定型候选，不让高冲突低证据题直接晋级 |
| `editorial-room` / `article-brief` | 将锁定命题和 `material_brief` 写入现有文章简报 |
| `wechat-mp-topic-to-article` | 将 `material_brief` 作为写作、标题和审稿的共同输入 |
| `wechat-mp-topic-to-article`、写作技能、`title-generator`、`article-reviewer` | 按 6.1–6.2 增加素材契约、类型化结构和兑现检查，不重做技能体系 |

### 5.2 暂不改动

- 不新增外部插件或外置技能；
- 不重做热榜采集器和事件归并算法；
- 不新增独立 `material_cards` 数据表；
- 不重写 H/B/P/S/D/F 总评分；
- 不把栏目优先级建议重新加回内容反馈；
- 不改动 SEO、排版、封面和发布流程；
- 不把历史高阅读标题直接当作写作模板。

## 6. 实施顺序

### Phase 1：契约先行

确定 `research_material` 和 `material_brief` 字段，确保研判结果能无损传给候选、编辑会和文章链。旧候选缺少新字段时允许兼容读取。

### Phase 2：采集、研判与候选

增加后果导向的搜索扩展、研究问题、素材字段和小幅预选信号，观察候选池是否出现更多“动作—后果—冲突”结构，而不是先看文章阅读量。

### Phase 3：文章承接

把素材简报接入事实基座、大纲、写作、标题和审稿，重点检查文章是否兑现锁定命题。

### Phase 4：反馈校准

使用完整历史数据和新数据复盘素材模式，调整搜索模板和研判提示，不直接修改评分权重。

## 7. 验收标准

一次完整流程至少应能回溯：

```text
文章标题
  → title_promise
  → material_brief
  → locked thesis
  → research_material_ids
  → event_ids
  → event-card confirmed facts / sources
```

并满足：

1. 候选不是事件卡标题的同义改写；
2. 候选能指出具体影响对象和现实后果；
3. 文章事实基座能找到支撑命题的来源；
4. 初稿开头和正文至少一次明确兑现动作与后果；
5. 标题审稿能判断标题承诺是否兑现；
6. `needs_review`、`summary_only` 和作者个人素材不会被混写成同一种事实；
7. 写作技能实际收到 `material_brief`，且类型化结构与 `article_type` 匹配；
8. `promising` / `needs_review` 内容在成稿中保留限定语或待核边界；
9. 发布后数据可以回溯到素材模式，但不会被误读成标题因果证明。

## 8. 可实施性审查与最小落地裁定

### 8.1 审查结论

方案目标已经闭环，但原设计还遗漏了四个实现层契约：

1. `material_brief` 的持久化位置没有明确；
2. 编辑室新增字段没有同步到服务端门禁、Agent 表单工具和前端读写；
3. 锁定简报生成后，文章流水线如何真正消费这些字段没有明确到代码入口；
4. `title_promise`、`article_type` 和 `material_readiness` 的生成时机容易被误解为编辑室手填字段。

本次裁定如下：

- 不新增 `material_cards` 表；
- 在现有 `editorial_sessions` 增加一个 `material_brief_json` 字段，默认 `{}`，保存编辑室承接区草稿；候选锁定后将其视为不可变快照，并通过现有迁移机制兼容旧数据库；
- `material_readiness` 在研判/候选阶段由现有研究结果推导，候选表第一版不新增列；编辑室只读展示，锁题时快照进 `material_brief_json`；
- `reader_consequence` 和 `conflict` 加入现有编辑室门禁，`reader_action` 不阻塞成稿；
- `title_promise` 在标题生成阶段产生，不作为编辑室锁题前的必填项；
- `article_type` 继续由内容路线和主写技能推导，不新增人工选择字段。

### 8.2 最小实现映射

| 层 | 现有入口 | 最小改动 |
|---|---|---|
| 研判/候选 | `discussion-research-stage.mjs`、`research-pipeline.mjs` | 复用既有 `reader_impact` / `difference_or_conflict`，推导并路由 `material_readiness`，不新增同义字段或独立分数 |
| 表单权威 | `editorial-readiness.mjs` | 将 `reader_consequence`、`conflict` 纳入字段清单和必填门禁；服务端仍是唯一门禁来源 |
| Agent 更新 | `editorial-adapter.mjs` | 允许编辑室 Agent 增量更新两个新字段 |
| 持久化 | `editorial-repository.mjs`、`workbench-schema.mjs`、`migrations.mjs` | 增加 `material_brief_json`；仓库层将 JSON 字段展平给表单和门禁，旧记录默认 `{}` |
| 编辑室页面 | `public/index.html`、`public/src/views/editorial.js` | 增加两个可编辑文本框和一个只读成熟度提示；同步加载、保存和门禁展示 |
| 锁定简报 | `server.mjs` 的 `lockedBrief()` | 从现有候选、编辑底稿和研判上下文组装并渲染 `material_brief` |
| 成稿流水线 | `article-routes.mjs`、`article-pipeline.mjs`、`article-pipeline-contract.mjs` | 将同一份结构化简报传给事实基座、规划、写作、标题和审稿阶段 |
| 写作技能 | `skills/wechat-mp-topic-to-article/`、`skills/wechat-mp-tech-hotspot/`、`skills/wechat-mp-deep-dive/`、`skills/title-generator/`、`skills/article-reviewer/` | 按 6.1–6.2 更新输入契约、文章结构和兑现门禁；不新增外部技能 |

### 8.3 字段来源与去重规则

为避免同一事实在多个地方产生漂移，采用以下来源规则：

| `material_brief` 字段 | 来源 |
|---|---|
| `event_ids`、`research_material_ids` | 候选和采用研判点，只读回溯 |
| `action`、`affected_group`、`baseline_change` | 事件卡和已验证研判素材，系统预填 |
| `reader_consequence`、`conflict`、`thesis` | 分别由既有 `reader_impact`、`difference_or_conflict` + `parties`、候选命题预填，编辑室确认后作为锁定值 |
| `impact_evidence` | 采用研判点、已确认事实和来源边界汇总，不新增手填证据库 |
| `counter_evidence`、`evidence_boundary` | 研判反方解释、`rejected_angles` 和 `forbidden_claims` 汇总 |
| `reader_action` | 系统建议，编辑可改，不阻塞成稿 |
| `title_promise` | 标题阶段根据锁定命题、读者后果和最终标题生成 |
| `article_type` | 内容路线/主写技能推导 |
| `material_readiness` | 研判成熟度推导，锁题时快照 |

`material_brief_json` 在锁题前是编辑室承接区的可编辑草稿，锁题后成为结构化快照；`article-brief.md` 只负责可读呈现，不能反向覆盖数据库中的编辑决策。前端就绪提示可以复用现有逻辑，但最终能否锁题必须由服务端 `evaluateEditorialReadiness` 判定。

### 8.4 兼容与失败规则

- 旧候选可以正常打开和查看；缺少新字段时显示“待确认”，不自动补写；
- 旧候选在锁题前必须补齐 `reader_consequence`、`conflict` 和现有必填项；
- `insufficient` 不进入稳定推荐，但可以由作者明确确认后进入实验型文章；
- `promising` 允许进入实验型文章，不得在分发说明中伪装成稳定推荐；
- `verified` 才可以自动进入稳定推荐候选；
- 研判字段缺失时不让写作模型自行推断为事实，而是写入待核边界或阻止锁题。

### 8.5 最小验收测试

至少补以下确定性测试，不需要先做端到端联网测试：

1. 旧 `editorial_sessions` 自动迁移并能读取 `material_brief_json` 默认值；
2. 编辑室新增字段可以 GET → 修改 → PUT 往返保存；
3. 缺少 `reader_consequence` 或 `conflict` 时锁题门禁拒绝；
4. 锁题后 `material_brief_json`、`article-brief.md` 和成稿流水线输入内容一致；
5. `material_readiness` 三种状态路由符合设计，且不会改变 H/B/P/S/D/F；
6. 旧候选可查看但不会被自动补写新事实；
7. `title_promise` 只在标题阶段生成，编辑室不因缺少它而阻塞。

## 9. 最终裁定

本方案采用分层命名：

- 事件层：继续叫**事件事实卡**；
- 研判层：继续叫**研判素材**，不新增“素材卡”实体；
- 写作层：叫**文章素材简报**，作为现有 `article-brief.md` 的结构化部分；
- 主动写作层：保留**作者素材卡**，即现有 `writing_materials`。

这样既能承接“找爆款素材”的新要求，又不会把事件事实、研判判断、文章命题和作者经历混成一张卡。
