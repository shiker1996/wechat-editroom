# 文章事实基座与写作立场组合设计

> 状态：Phase 0–3 已实施，保留 S001 真实批次回归  
> 日期：2026-09-15  
> 适用范围：热点文章成稿链，从事实基座到初稿、审稿、SEO、视觉规划和发布门禁  
> 关联设计：[内容类型、来源证据与文章/图文分流改造方案](./content-routing-and-source-evidence-design.md)、[公众号热点成稿编排器](../../skills/wechat-mp-topic-to-article/SKILL.md)

## 1. 背景

当前文章流水线已经具备事实基座、发布主张登记、写作技能、审稿门禁和视觉规划，但“文章写什么”和“作者如何说”仍然部分混在同一层里。

当前主要有三类表现：

1. `article_type` 既承担内容路由，又间接承担文章结构和语气。运行时通过 `selectWriterSkill()` 选择 `wechat-mp-tech-deep`、`wechat-mp-tech-hotspot`、`wechat-mp-deep-dive` 等写作技能。
2. 单一来源被事实基座拆成多条主张后，写作和审稿阶段倾向于逐条重复“据该来源”，可审计性直接泄漏到正文。
3. 观点型文章为了区分事实与判断，反复出现“这是观点”“不是行业统计”“不能当作事实”等元话语，导致论证不连贯。

本方案不通过复制技能解决问题，也不把每种“内容类型 × 表达方式”做成独立技能，而是把内容路由、写作立场、证据审计和视觉策略拆开组合。

## 2. 目标与非目标

### 2.1 目标

- 保留现有 `article_type → writer skill` 路由，不破坏已有技能注册和工作区自定义技能。
- 在锁定简报中保存一个稳定的 `writing_stance`，并让它贯穿初稿、自然化、审稿、SEO 和视觉规划。
- 让事实可追溯性继续由事实基座和发布主张登记保证，而不是依靠正文重复来源词保证。
- 让观点型文章通过事实—机制—判断自然推进，不强制逐段插入合规标签。
- 让视觉策略由内容类型和写作立场推导，默认不为观点文强行生成 Mermaid。
- 保持旧文章可读取、可复审、可继续排版；缺少新字段时采用兼容默认值。

### 2.2 非目标

- 不重写事实采集、事件归并和研究拓展链。
- 不改变 `verified`、`disputed`、`unverified`、`opinion` 四类事实状态的基本含义。
- 不允许 `writing_stance` 放宽事实门禁、生成新来源或覆盖 `forbidden_claims`。
- 不为 `deep_dive + opinion`、`deep_dive + analysis` 等组合复制新的写作技能。
- 不在第一阶段把所有视觉策略做成用户可编辑的复杂配置面板。

## 3. 核心概念

### 3.1 内容类型：文章讲什么

`article_type` 是内容路由字段，负责选择写作技能和基础结构。热点文章当前支持：

| `article_type` | 写作技能 | 主要任务 |
|---|---|---|
| `wechat-mp-tech-deep` | `wechat-mp-tech-deep` | 原理、架构、性能、成本和可复算指标 |
| `wechat-mp-tech-hotspot` | `wechat-mp-tech-hotspot` | 技术产品、公司动态及其影响 |
| `wechat-mp-deep-dive` | `wechat-mp-deep-dive` | 行业、职场、社会事件、利益关系和因果链 |
| `wechat-mp-gossip-chill` | `wechat-mp-gossip-chill` | 轻量趣闻、职场反差和低风险吐槽 |
| `wechat-mp-composite` | `wechat-mp-composite` | 多热点的共同机制、趋势或差异 |

自主写作和批次早报仍使用独立路线：

- `wechat-mp-personal-writing`：心得经验；
- `wechat-mp-tutorial`：技术教程；
- `wechat-mp-daily`：批次早报。

`article_type` 不负责决定引用密度或作者是否显式表达个人判断。

### 3.2 写作立场：作者如何说

第一阶段只引入三个值：

| `writing_stance` | 含义 | 可见来源策略 | 典型文章 |
|---|---|---|---|
| `report` | 事实报道 | 来源归因密集，事实先于判断 | 产品发布、公司动态、早报 |
| `analysis` | 机制分析 | 按事实簇归因，事实—机制—影响—边界 | 行业、职场、技术影响 |
| `opinion` | 作者判断 | 开头集中交代来源，正文以推理承接观点 | 个人观点、热点评论 |

后续如有明确需求，再增加 `comparison`、`explainer` 等立场；第一阶段不提前扩展枚举。

`writing_stance` 不是“事实强度”开关。无论取值是什么，事实状态、来源边界和禁止扩写规则都不变。

### 3.3 生产角色和分发池不是写作立场

以下字段继续保持独立：

- `content_role`：`拉新`、`沉淀`、`搜索`；
- `distribution_lane`：`推荐池`、`通知池`、`实验池`；
- `packaging_mode`：`搜索型`、`分享型`、`双栖型`。

它们影响标题、读者利益、转化承接和分发包装，不直接改变事实归因和论证方式。

## 4. 目标数据结构

### 4.1 锁定简报

在编辑底稿的 `material_brief` 和成稿运行时的 `brief` 中增加 `writing_stance`：

```json
{
  "article_type": "wechat-mp-deep-dive",
  "writing_stance": "opinion",
  "distribution_lane": "实验池",
  "content_role": "拉新",
  "experience_required": false
}
```

字段规则：

- 只接受 `report`、`analysis`、`opinion`；
- 编辑会锁定后不可由下游模型静默覆盖；
- 用户显式选择优先于自动推断；
- 缺失时由 `article_type` 推导兼容默认值；
- 推导结果必须写入 `00-article-brief.md` 和 `00-skill-manifest.json`，保证运行可复核。

### 4.2 默认推导

默认推导仅用于兼容历史候选，不能覆盖用户已经锁定的值：

```text
wechat-mp-tech-deep     → analysis
wechat-mp-tech-hotspot  → report
wechat-mp-deep-dive     → analysis
wechat-mp-gossip-chill  → opinion
wechat-mp-composite     → report
wechat-mp-personal-writing → opinion
wechat-mp-tutorial      → report
wechat-mp-daily         → report
```

若编辑底稿包含明确的 `author_opinions`、`thesis` 和观点型包装，但没有第一人称实践，允许编辑会将 `writing_stance` 从默认值改为 `opinion`。有亲身实践时仍由 `experience_required` 和自主写作路线控制，不把 `opinion` 当作亲身经历的替代品。

### 4.3 事实基座补充证据层级

现有 `status` 继续表达主张状态，但需要增加来源归因元数据，避免把“来源直接支持”误读为“公共事实已被多方确认”。每条 claim 建议补充：

```json
{
  "id": "claim-2",
  "claim": "Agent 主推理模型更容易确定",
  "status": "verified",
  "source_group_id": "source-group-1",
  "source_level": "personal_social",
  "evidence_kind": "source_observation",
  "attribution_required": true,
  "visible_citation": "cluster",
  "sourceUrl": "https://x.com/...",
  "boundary": "只能作为来源个人观察呈现，不得扩写为行业统计"
}
```

字段含义：

- `source_group_id`：同一来源或同一证据簇的稳定分组；
- `source_level`：`official`、`reliable_media`、`technical_primary`、`personal_social`、`community` 等；
- `evidence_kind`：`public_fact`、`source_observation`、`source_quote`、`author_material`、`model_inference`；
- `attribution_required`：是否必须保留来源归因；高影响或单方来源通常为 `true`；
- `visible_citation`：正文展示策略，第一阶段支持 `each_claim`、`cluster`、`endnote_only`。

对于个人社交媒体来源，推荐：

```text
status: verified
source_level: personal_social
evidence_kind: source_observation
visible_citation: cluster
```

这里的 `verified` 表示“来源正文确实支持这条来源陈述”，不表示“该陈述已经被公司或多方独立证实”。

## 5. 事实基座到写作立场的运行链路

目标链路：

```text
热点来源
  ↓
事实抽取与来源分组
  ↓
事实基座 + 发布主张登记
  ↓
编辑会锁定 article_type / writing_stance / evidence_boundary
  ↓
选择 writer skill
  ↓
组合 writer skill + writing stance overlay
  ↓
初稿
  ↓
自然化（保持立场策略）
  ↓
审稿与事实门禁（按立场检查可见归因密度）
  ↓
SEO（不得改变立场和来源策略）
  ↓
视觉策略推导
  ↓
发布合规门禁
```

### 5.1 事实基座阶段

事实基座阶段负责：

1. 抽取主张并标注 `status`；
2. 将同一来源的主张归入 `source_group_id`；
3. 记录来源级别和证据种类；
4. 生成 `publication_claim_register`；
5. 为每条主张计算正文允许的可见归因策略。

事实基座不负责决定文章采用 `report`、`analysis` 还是 `opinion`。立场来自编辑会或兼容默认值。

### 5.2 编辑会阶段

编辑会新增或展示三个互相独立的决策：

- 内容类型：文章走哪条 writer skill；
- 写作立场：事实报道、机制分析或作者判断；
- 证据边界：哪些事实可以确定表达，哪些只能归因或删除。

编辑会界面第一阶段可以只增加一个选择控件 `writing_stance`，默认展示系统推导值；用户修改后写回锁定简报。

### 5.3 写作阶段

写作系统消息由三部分组成：

```text
总编排契约
---
writer skill prompt
---
writing stance overlay
---
当前阶段契约
```

立场 overlay 只修改表达方式，不修改事实权限。

#### `report` overlay

- 先交代发生了什么，再交代影响；
- 关键事实就近保留具体来源；
- 不把来源观点改写成作者确定判断；
- 不用长篇机制推演替代事实缺口；
- 允许较高的来源可见密度。

#### `analysis` overlay

- 按“事实 → 机制 → 影响 → 边界”推进；
- 同一 `source_group_id` 在一个论证段落中集中归因；
- 观点必须有事实和推理支撑；
- 反事实、因果和动机必须降低语气；
- 不要求每个句子重复来源。

#### `opinion` overlay

- 开头一次性交代事实来源和文章观察角度；
- 后文优先使用自然连接和作者推理，不重复“据该来源”；
- 观点通过论证呈现，不强制使用“作者判断”“本文认为”等标签；
- 对未核实、高影响或单方主张保留必要的自然限定；
- 结尾回到作者判断和适用边界，不增加模板化免责声明。

## 6. 事实归因策略

### 6.1 正文可见归因和机器可追溯分离

事实可追溯性由以下机器产物保证：

- `02-fact-base.json`：主张、状态、证据和来源；
- `02-publication-claim-register.json`：发布允许方式和禁止方式；
- `00-stage-executions.json`：使用的技能和运行快照；
- 模型调用和门禁记录：输入事实基座与输出结果。

正文不再承担“每条主张重复展示来源”的审计职责。

### 6.2 三种可见策略

#### `each_claim`

每条主张都保留来源，适合：

- 早报；
- 财经、事故、法律和公司负面等高风险内容；
- 多来源并列且容易混淆的事实。

#### `cluster`

一个事实簇首次出现时完整归因，后续句子共享该归因，适合：

- 单一来源的热点分析；
- `analysis` 和 `opinion` 文章；
- 同一帖子拆出的多个连续观察。

#### `endnote_only`

正文只保留极少来源提示，文末或编辑元数据保留完整来源，适合低风险的知识解释或作者已有充分背景的文章。高影响主张不得只使用该策略。

### 6.3 门禁规则

门禁检查的是：

```text
每个关键 claim 是否能映射到事实基座中的来源和允许写法
```

不再把以下指标当成唯一质量标准：

```text
正文中出现了多少次“据来源”
正文中是否每段都有 URL
```

`citationCoverage` 改为基于 claim 映射计算：

```text
已被正文正确表达且可追溯的关键 claim 数
÷
正文实际使用的关键 claim 总数
```

同一 `source_group_id` 的连续主张不因共享一次归因而被重复扣分。

## 7. 写作技能调整

### 7.1 不新增组合技能

不新增以下技能：

```text
wechat-mp-deep-dive-opinion
wechat-mp-deep-dive-analysis
wechat-mp-tech-hotspot-opinion
```

这些组合由同一个 writer skill 和不同 overlay 运行。

### 7.2 现有技能的职责调整

现有技能保留领域结构，但增加统一说明：

> 表达立场由运行时 `writing_stance` overlay 提供。技能负责内容结构、领域解释和读者任务；如果 overlay 与技能中的表达建议冲突，以事实安全规则为最高优先级、以锁定的 `writing_stance` 为表达优先级。

建议调整：

| 技能 | 保留 | 调整 |
|---|---|---|
| `wechat-mp-deep-dive` | 利益关系、因果链、反方边界 | 不把“自然表达观点”写死为固定句式 |
| `wechat-mp-tech-deep` | 原理、公式、性能和成本 | 明确技术深解默认 `analysis`，不强行要求每篇都个人判断 |
| `wechat-mp-tech-hotspot` | 事件、影响、受众和行动依据 | 允许 `report` / `analysis` / `opinion` overlay |
| `wechat-mp-gossip-chill` | 轻松语气和趣闻结构 | 继续服从事实归因和高风险降级规则 |
| `wechat-mp-composite` | 多热点共同机制或趋势 | 允许按素材选择 `report` 或 `analysis` |
| `article-reviewer` | 事实、风险、标题和发布合规 | 改为按 stance 检查可见归因密度，禁止强制元话语 |
| `seo-content-optimizer` | 搜索意图和关键词自然布局 | 不得为了关键词新增事实、来源或改变作者立场 |

工作区自定义技能仍可作为 writer skill 使用，但必须声明自己接受 `writing_stance` overlay；未声明时按旧行为运行，并在技能清单中记录 `stanceOverlay: unsupported`。

## 8. 视觉策略

视觉策略第一阶段不增加新的用户字段，而是由 `article_type + writing_stance + factBase` 推导：

| 组合 | 默认视觉策略 |
|---|---|
| `report` + 单一来源 | `off` |
| `opinion` | `off` |
| `analysis` + 复杂流程/多主体关系 | `auto` |
| `tech_deep` + 架构或数据关系 | `auto` |
| `comparison`（后续） | `data_or_table` |
| 用户明确要求配图 | `manual_override` |

推导结果传入 `illustrateArticle()` 和 `planArticleVisuals()`：

```js
{
  visualPolicy: 'off',
  reason: 'opinion stance defaults to prose-first'
}
```

当策略为 `off` 时，直接跳过 Mermaid/ECharts 规划和插入；仍可保留用户手动提供的图片占位。自动图表不得因为“有三个事实点”就生成，必须证明图表带来的理解增量超过正文解释。

## 9. 代码改动清单

### 9.1 数据和领域层

| 文件 | 改动 |
|---|---|
| `server/shared/domain/material-brief.mjs` | 增加 `writing_stance` 的读取、规范化和兼容默认值 |
| `server/features/articles/domain/editorial-readiness.mjs` | 编辑会锁定时校验 `writing_stance` 枚举 |
| `server/features/articles/domain/article-fact-eligibility.mjs` | 保持事实资格判断不受 stance 放宽 |
| `server/features/articles/domain/publication-compliance.mjs` | 将高风险主张的可见归因要求与普通 claim 分开 |

### 9.2 成稿流水线

| 文件 | 改动 |
|---|---|
| `server/features/articles/application/article-pipeline-contract.mjs` | 增加 stance 默认推导、overlay 构造和 citation policy 计算 |
| `server/features/articles/application/article-pipeline.mjs` | 将 `writing_stance`、overlay 和 citation policy 注入 drafting、humanize、review、SEO、visual stages |
| `server/shared/domain/writing-stance.mjs` | 新增立场枚举、默认映射、提示 overlay 和视觉策略推导 |
| `server/features/articles/llm/editorial-room.mjs` | 编辑会上下文中展示并写入锁定的 stance |
| `server/features/articles/application/article-illustration.mjs` | 接收 visual policy，策略为 `off` 时跳过自动视觉规划 |
| `server/features/articles/llm/visual-planner.mjs` | 接收 policy，拒绝与当前 stance 不匹配的视觉建议 |
| `server/features/articles/application/image-workflow.mjs` | 保持手动图片规划，不让 image stage 改写正文 |

### 9.3 技能和配置

| 文件 | 改动 |
|---|---|
| `skills/wechat-mp-topic-to-article/SKILL.md` | 增加 stance 契约、归因策略和阶段传递规则 |
| `skills/wechat-mp-deep-dive/SKILL.md` | 声明支持 `report`、`analysis`、`opinion`，移除固定元话语要求 |
| `skills/wechat-mp-tech-deep/SKILL.md` | 默认 `analysis`，允许 stance 覆盖表达，不覆盖事实规则 |
| `skills/wechat-mp-tech-hotspot/SKILL.md` | 声明支持三种 stance |
| `skills/article-reviewer/SKILL.md` | 改为 semantic boundary check，不以重复来源词作为质量标准 |
| `skills/article-visual-planner/SKILL.md` | 增加 visual policy 输入和“没有理解增量时返回空数组”规则 |
| `config/capability-consumers.json` 或对应编辑会配置 | 如需持久化，增加 stance 字段白名单和编辑会写入权限 |

## 10. S001 运行示例

S001 目标配置：

```json
{
  "article_type": "wechat-mp-deep-dive",
  "writing_stance": "opinion",
  "source_groups": [
    {
      "id": "source-group-1",
      "source_level": "personal_social",
      "claim_ids": ["claim-1", "claim-2", "claim-3", "claim-4", "claim-5", "claim-6", "claim-7", "claim-8", "claim-9", "claim-10", "claim-11"]
    }
  ],
  "visual_policy": "off"
}
```

正文预期：

1. 开头一次说明 X 帖作者和来源性质；
2. 模型、垂类模型和跨团队摩擦用连续论证展开；
3. “权力在上、风险在下”作为作者判断自然推出；
4. 飞书/豆包案例保留一次明确的“该来源如此叙述”边界；
5. 不在每个段落重复来源声明；
6. 不插入没有额外理解价值的 Mermaid。

## 11. 兼容与迁移

### 11.1 历史文章

历史产物缺少 `writing_stance` 时：

- 从 `00-article-brief.md`、`00-skill-manifest.json` 和 writer skill 推导；
- 推导结果只用于复审和后续运行，不回写旧终稿；
- 旧终稿保留原有可见归因和正文，不自动重写。

### 11.2 自定义技能

自定义 writer skill 未声明 stance 能力时，兼容策略为：

- 允许选择；
- 使用统一事实基座和门禁；
- 不强行注入可能与自定义技能冲突的表达 overlay；
- 在运行清单记录 `stanceOverlay: unsupported`；
- 用户明确选择 `opinion` 时，若技能不支持则提示需要人工复核，而不是静默降级。

### 11.3 快照和可复现

`00-skill-manifest.json` 需要记录：

```json
{
  "writerSkill": "wechat-mp-deep-dive",
  "writingStance": "opinion",
  "stanceOverlayVersion": "1",
  "citationPolicy": "cluster",
  "visualPolicy": "off"
}
```

写作立场、overlay 版本和策略必须纳入 generation snapshot，否则同一篇文章重跑时可能因为工作区默认技能或策略变更而产生不可解释差异。

## 12. 门禁与测试

### 12.1 单元测试

- `writing_stance` 缺失时正确推导默认值；
- 非法 stance 被拒绝；
- 用户锁定 stance 后，候选字段和模型输出不能覆盖；
- 同一 `source_group_id` 的多条 claim 计算为一次事实簇归因；
- `opinion` overlay 不改变事实状态和禁止主张；
- `visualPolicy: off` 时不调用视觉规划模型；
- `report` / `analysis` / `opinion` 生成的 overlay 内容稳定。

### 12.2 流水线测试

至少增加以下回归样例：

1. S001 单一个人社交媒体来源的观点文：正文来源归因不重复，未核实案例仍有自然边界；
2. 多来源公司动态报道：关键事实逐条可追溯；
3. 技术机制拆解：公式、数字、性能和成本约束不被 `opinion` overlay 放宽；
4. 多热点综合：不同来源不会因为 `cluster` 策略被错误合并；
5. 观点文视觉关闭：`09-visual-plan.json` 为空或明确记录 skipped。

### 12.3 质量指标

不以“据来源”出现次数作为质量指标，改用：

- 关键主张可追溯率；
- 来源簇归因准确率；
- 观点/事实语义混淆率；
- 观点文重复免责声明率；
- 不必要视觉插入率；
- 不同 stance 下事实保真率。

## 13. 分阶段实施计划

### Phase 0：契约和数据模型（已实施）

- 增加 `writing_stance` 枚举和默认推导；
- 增加 `source_group_id`、`source_level`、`evidence_kind`、`visible_citation`；
- 写入运行快照和技能清单；
- 不改变正文生成策略。

### Phase 1：提示组合和审稿策略（已实施）

- 新增 `writing-stance.mjs`；
- 把 overlay 接入 drafting、humanize、review、SEO；
- 将 citation coverage 改为 claim 映射；
- S001 用 `deep_dive + opinion` 做离线回归。

### Phase 2：视觉策略（已实施）

- 根据 stance 推导 `visualPolicy`；
- 观点文默认跳过自动 Mermaid/ECharts；
- 保留手动图片占位；
- 增加 visual planner skipped 记录。

### Phase 3：编辑会和技能 UI（已实施）

- 在锁定简报区域展示写作立场；
- 允许用户在成稿前修改并锁定；
- 编辑室表单只在作者明确指定时写入，缺失时按 `article_type` 推导；
- 运行清单记录文章类型、写作立场、来源策略和视觉策略。

当前已覆盖的实现路径：

- `server/shared/domain/writing-stance.mjs`：枚举、默认推导、overlay、引用和视觉策略；
- `server/features/articles/application/article-pipeline.mjs`：成稿、审稿、SEO、视觉与发布门禁的立场贯穿；
- `server/features/articles/domain/publication-compliance.mjs`：来源簇、来源级别和可见归因元数据；
- `server/features/articles/application/agent/editorial-adapter.mjs` 与 `public/index.html`：编辑室立场字段；
- `server/features/articles/llm/visual-planner.mjs`：`visualPolicy=off` 的确定性跳过；
- `test/writing-stance.test.mjs` 与 `test/visual-planner.test.mjs`：核心行为回归。

## 14. 验收标准

方案实施后，S001 或等价回归样例应满足：

- writer skill 与 `article_type` 一致；
- `writing_stance=opinion` 在快照中可见且不可被下游覆盖；
- 同一来源簇不重复堆叠“据该来源”；
- 个人观点通过事实和机制展开，不依赖密集元话语；
- 未核实案例保留自然且明确的来源边界；
- 观点文默认不自动生成无必要 Mermaid；
- 事实基座、发布主张登记和门禁仍能追溯全部关键主张；
- 旧文章和自定义技能仍可读取、复审和排版。
