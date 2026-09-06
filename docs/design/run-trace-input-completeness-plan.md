# Run Trace 输入完整性演进方案

> 状态：P0、P1、P2 已实施  
> 范围：Run Trace、Workflow 阶段输入、模型调用审计和研判流程  
> 目标：解决 Run Trace 目前“能看到阶段和模型输出，但无法确认模型实际使用了什么输入”的日志完整性问题。

## 1. 背景

当前 Run Trace 已经能够串联 Workflow、Stage、Model Call、Tool Call、Checkpoint 和 Artifact，但输入信息仍然分散在不同位置：

- 任务日志通常只有任务名称、批次和结果摘要；
- `generation snapshot` 主要冻结 Skill、模型、工具和配置，不等同于本次运行的业务输入；
- `model_calls` 保存模型、token、耗时和输出审计，但不统一保存实际输入消息；
- 研判流程已经在 `discussion-research-input.json` 中按 `phase + attempt` 保存输入和 messages，但尚未统一挂到 Run Trace；
- 因此页面可以回答“模型返回了什么”，却不能稳定回答“模型依据什么返回”。

这会导致三类问题：

1. 无法判断输入缺失发生在业务入口、阶段组装还是模型 Gateway；
2. 无法解释假设、验证和选题生成之间的上下文传递；
3. 失败重试或恢复后，无法确认新运行继承了哪些输入。

## 2. 设计目标

### 2.1 必须满足

1. 主要生产入口的 Root Run 都能查询到已落盘的 Run 级业务输入；
2. Run Trace 能从 Root Run 下钻到每个 Workflow Stage 的输入；
3. 每次模型调用都能反查其业务输入来源和阶段上下文；
4. 重试、恢复和子 Run 保留输入来源关系，不依赖页面临时状态；
5. 保持现有 `/api/logs` 平铺接口和任务日志页面兼容。

### 2.2 暂不追求

- 不要求普通任务列表直接展示完整 Prompt；
- 不把所有 Prompt、原始文件和 reasoning 默认复制到数据库；
- 不保存流式 token 的每个增量；
- 不在本方案中实现离线 Replay；
- 不改变业务流程的阶段顺序和模型选择逻辑。

## 3. 核心方案

采用“一个 Run 级业务输入 + 阶段输入 + 可选 Prompt 详情”的三级结构。P0 沿用各业务入口已经写入任务目录的输入文件，由 Trace 查询层提供统一预览和下载视图：

```text
Root Run：本次业务任务的完整输入
  └─ Workflow Stage：该阶段实际消费的输入和前序结果
      └─ Model Call：本次调用的输出和阶段关联
```

### 3.1 Run 级业务输入

Run 级输入是本次任务的业务事实来源，作为 Run Trace 的默认输入视图。第一版不复制输入到数据库，而是从可识别的现有任务文件读取并统一展示：

```json
{
  "schema_version": 1,
  "run_id": "job:…",
  "root_run_id": "job:…",
  "workflow_run_id": "job:…",
  "entry_point": "discussion-research",
  "batch_id": "…",
  "request_type": "topic-research",
  "input": {
    "events": ["event-1", "event-2"],
    "candidates": ["candidate-1"],
    "policy": { "research_mode": "full" }
  },
  "created_at": "…"
}
```

完整输入继续写入现有任务目录中的输入文件，Run Trace 只读取并展示受控预览。第一版不新增输入摘要、来源引用或通用输入快照表；历史或缺少对应文件的 Run 明确显示未记录输入。

### 3.2 Stage 输入

Stage 输入描述某个阶段从 Run 输入中选取了什么，以及加入了哪些前序结果：

```json
{
  "root_run_id": "job:…",
  "workflow_run_id": "job:…",
  "stage_id": "discussion-research.internal",
  "attempt": 1,
  "input_preview": "…",
  "input_length": 18240,
  "created_at": "…"
}
```

Stage 记录回答“这个阶段拿了什么”。完整内容沿用现有阶段输入文件，由后端根据 `root_run_id + stage_id + attempt` 定位；页面不展示文件路径或抽象来源引用。

### 3.3 Model Prompt 详情

模型调用继续保留现有输出、token、耗时和错误审计。P0 只补齐 `root_run_id`、`stage_id` 和 `attempt`，让调用能够定位到对应阶段；完整 Prompt 输入暂不作为模型日志的必填字段：

```json
{
  "model_call_id": "mc-…",
  "root_run_id": "job:…",
  "stage_id": "discussion-research.internal",
  "attempt": 1,
  "input_chars": 18240,
  "estimated_input_tokens": 4560
}
```

完整输入只作为 Run / Stage 审计留存，不在 Run Trace 页面无限展开。所有输入统一使用按类型配置的可见范围策略：

- 短输入：在页面直接显示完整内容；
- 长文本：显示头尾片段和总字符数，并提供“下载完整输入”；
- 结构化输入：显示序列化后的受控片段，完整 JSON 通过下载获取；
- 预览上限由统一配置控制，按输入类型设置合理范围，不把某个固定字符数写入业务契约；
- 下载内容直接读取现有任务目录中的脱敏输入文件，并沿用现有留存策略；
- 输入文件缺失时，明确显示“输入未记录”或“输入已清理”，不用输出内容冒充输入。

## 4. 研判流程的阶段映射

研判不应只显示一个“研判”节点，应按当前实际执行阶段记录：

| 业务含义 | `stage_id` 建议 | 输入内容 |
|---|---|---|
| 事件内假设 | `discussion-research.internal` | 单事件事实、异常点、利益冲突和待验证方向 |
| 跨事件假设 | `discussion-research.inter_event` | 事件集合、候选关系和外部锚点 |
| 事件内验证 | `discussion-research.internal_verify` | 事件内假设、搜索结果和证据摘要 |
| 跨事件验证 | `discussion-research.inter_event_verify` | 跨事件假设、关系证据和冲突信息 |
| 选题生成 / 脑暴 | `discussion-research.topic_generation` | 研判摘要、已验证材料和选题约束 |
| 单事件兼容模式 | `discussion-research.single_event` | 单次组合输入及该次交互的完整上下文 |

当前 `discussion-research-input.json` 已经保存了 `phase`、`attempt`、`input`、`messages`、输入字符数和估算 token。实施时优先在现有文件记录上补齐 `root_run_id / workflow_run_id / stage_id`，避免重新发起模型调用或重复生成业务文件。

如果某条路径确实采用 `single_event` 一次完成多个动作，则保留一个组合阶段，不能在日志中虚构不存在的独立调用；只有实际拆分执行后，才记录为多个阶段。

## 5. 数据与关联字段

### 5.1 输入记录

第一版不新增通用 `run_input_snapshots` 表，也不引入输入摘要、来源引用或路径字段。继续使用现有任务目录和阶段输入文件，补充最小关联元数据：

```text
root_run_id
workflow_run_id
stage_id
attempt
input_length
created_at
```

页面预览由后端读取现有输入文件后按类型截断生成；完整输入下载也由后端根据 Run、Stage 和 Attempt 定位文件，文件路径不返回给前端。

### 5.2 现有对象的扩展

| 对象 | 增加或补齐 |
|---|---|
| `ai_runs` / Root Run | Run 级输入记录状态 |
| Stage 事件或阶段记录 | `stage_id`、`attempt`、输入记录状态 |
| `model_calls` | `root_run_id`、`stage_id`、`attempt`、现有输入统计 |
| `run_events` | `stage_id`、`sequence` |
| `discussion-research-input.json` | `root_run_id`、`workflow_run_id`、`stage_id` |

恢复运行保留原始 `root_run_id`，并为新 attempt 记录新的阶段输入；重试可以复用原始 Run 输入，同时记录新的阶段 Attempt。

## 6. API 与页面

### 6.1 查询接口

在现有 Trace 查询基础上增加：

```text
GET /api/runs/:rootRunId/input
GET /api/runs/:rootRunId/stages/:stageId/input
GET /api/runs/:rootRunId/input/download?stageId=…&attempt=…
```

接口返回预览、长度、阶段和 Attempt。默认响应只带按类型截断后的预览；超过可见范围时不返回完整正文，下载接口再读取脱敏后的现有输入文件。权限和留存规则沿用现有日志治理，不把文件路径返回到任务列表。

### 6.2 Run Trace 页面

默认布局：

```text
Run Trace
  ├─ Run 输入（默认展开预览）
  ├─ Workflow / Stage
  │   └─ 阶段输入（事件、产物、工具结果）
  └─ Model Call
      └─ Prompt 输入（按可见范围预览，超长输入下载）
```

阶段节点点击后应保留父节点和同级节点，只筛选当前节点及其子节点的详情日志；输入视图与现有轨迹筛选共用 `stage_id` 和 `attempt`。

## 7. 实施顺序

### P0：Run 级输入闭环

- 定义输入记录格式、预览上限和脱敏规则；
- 将所有主要业务入口已经落盘的输入文件纳入 Run 级查询视图；
- 将 Run 级输入状态挂到 Root Run 和 Run Trace 查询；
- 页面在对应运行、阶段和模型事件详情中展示“运行输入”预览；
- 兼容没有输入记录的历史 Run，显示“该运行未记录输入”。

### P0：研判阶段接入

- 将 `discussion-research-input.json` 的既有 phase 记录按 Root Run 纳入 Trace；
- 补齐 `internal`、`inter_event`、`internal_verify`、`inter_event_verify`、`topic_generation` 和 `single_event` 的 Stage 输入；
- 保留 `attempt`、输入统计、模型调用 ID 和现有文件审计；
- Run Trace 按阶段展示输入预览和对应 Attempt。

### P1：模型调用输入排查

- 读取研判输入文件中已有的 `response.call_id`，与 Trace 的 `model_calls.id` 对齐；
- 在阶段输入预览中展示模型、状态、Token 和调用编号，并支持跳转模型调用详情；
- 保持完整 Prompt 不复制进数据库，继续从阶段输入文件按权限预览或下载；
- 找不到对应审计行时保留阶段输入，但明确显示未关联模型调用。

### P1：重试与恢复一致性

- 重试复用同一 Run 业务输入，生成新的阶段 Attempt；
- 恢复从 checkpoint 指定阶段读取现有输入文件和前序产物；
- Trace 显示原始 Run、目标 Run、恢复点和输入继承关系。

### P2：历史数据补链

- 对已有 `discussion-research-input.json` 和可识别的阶段文件建立不暴露路径的只读索引；
- 能识别的历史记录按 Run、Stage、Attempt 和 `call_id` 关联到当前 Trace；
- 无法确定输入的记录保持“未记录”，不伪造模型输入，也不回写历史业务数据。

## 8. 验收标准

1. 新建主要业务 Run 且入口已有输入文件时，Run Trace 能看到 Run 级输入预览；
2. 研判任务能分别查看假设、验证和选题生成阶段的输入；
3. 任意模型调用都能反查所属 Run、Stage、Attempt 和对应输入记录；
4. 页面能区分“未记录输入”“输入已脱敏”和“输入已清理”；
5. 重试和恢复不会丢失原始业务输入来源；
6. 现有任务日志、模型输出、工具日志和 Artifact 关联不受影响；
7. 对同一 Run，输入记录、模型调用和阶段事件可以按 Run、Stage、Attempt 相互定位；
8. 页面不会默认加载超过可见范围的完整输入，超长输入可以下载脱敏后的完整输入文件；
9. 历史记录不因无法补齐输入而被错误标记为完整。

## 9. 关键取舍

本方案把 **Run 级业务输入** 定为主入口，阶段输入作为下钻层。这样能解决当前日志完整性缺失，又不会让普通任务页面承载大量模型内部文本。

如果后续只做 Run 级输入而不保留阶段记录，页面可以知道“任务输入是什么”，但仍无法准确解释研判中“假设、验证、脑暴分别使用了什么”。因此阶段记录是最小的必要补充；完整 Prompt 下载属于后续按需增强。
