# 提示词资产管理方案

> 本文中的版本号和阶段描述是历史盘点；当前文章提示词版本与执行阶段分别以 `server/features/articles/application/article-prompts.mjs` 和 `skills/wechat-mp-topic-to-article/references/runtime-stage-contracts.md` 为准。

日期：2026-10-22  
状态：方案已开始实施；文章主链和其他模块分批迁移中

## 当前迁移进度

- 已完成：统一 manifest/loader、热点文章成稿主链；采集字段识别/候选排序/GitHub 仓库发现；早报与教程的标题/审稿追加指令；突发分析、配图规划与移动端返工；图文封面标题拆行、布局修复与浏览器审计后调整；排版 design/draft 阶段契约；主题路由、主题生成、Social 模板提案及 JSON 修复；文章与图文复盘调整两阶段提示词。
- 进行中：早报/教程剩余阶段附加指令、研究研判、编辑室、图文其他生成阶段、主题与模板主生成提示词、平台级上下文与模型探针中的其余代码提示词。
- 迁移原则：沿用现有技能加载、动态上下文、JSON 契约、模型参数和调用顺序；只迁固定指令文本，不在同一批次里重写提示词语义。
- 完成条件：业务源码中没有未登记的模型指令字符串；确需留在代码里的机器协议说明都列入例外清单；manifest 中每个资产均可解析且版本可追踪。

## 1. 目标

把当前散落在业务代码中的模型指令变成可单独审阅、修改、追踪和回滚的项目资产，同时保留现有代码对流程顺序、数据准备、工具调用、重试和门禁的控制。

本方案希望解决：

- 提示词正文散在不同 feature、route 和 pipeline 文件里，难以完整盘点。
- 同一模型任务的正文、阶段补充规则、技能文本和数据上下文可能在多处拼接，难看出模型实际收到什么。
- 改代码字符串容易不小心改变转义、换行或插值边界。
- 运行后较难把某个输出准确对应到提示词版本。

## 2. 现状

- 热点文章主链提示词集中在 `server/features/articles/application/article-prompts.mjs`，有 `direct-brief-v3` 版本、哈希清单和阶段产物记录。
- 部分运行已有 generation snapshot，可保存模型实际消息及技能快照。
- 早报、教程、研判、图文、主题生成、采集、复盘等模块仍在各自源码中保留 system prompt 或附加指令。
- 一些 system prompt 由技能正文、代码内短规则、动态数据共同组成；只看一个常量文件并不能还原实际请求。
- `docs/hardcoded-prompt-inventory.md` 是盘点索引，不应被运行时读取为提示词。

## 3. 管理粒度

### 推荐：一个模型任务或可复用提示词片段一个文件

按业务类别分目录，每个文件只承载一个职责清楚的任务提示词，或一个会被显式复用的提示词片段：

```text
prompts/
  manifest.json
  articles/
    facts.md
    draft.md
    review.md
    repair.md
    length-adjust.md
    humanize.md
    title.md
    writer-tech-deep.md
    writer-deep-dive.md
  daily/
    review-addendum.md
  research/
    breaking-analysis.md
    event-analysis-fallback.md
  social-cards/
    cover-title-wrap.md
    layout-repair.md
  shared/
    untrusted-data.md
```

Markdown 文件由程序作为 UTF-8 原始文本读取，不解析标题、列表或代码围栏，也不把整个类别文件交给模型。一个文件的内容就是一个可寻址的 prompt asset，因此不需要在文件内另造特殊分隔符。

### 运行时组合

有些请求确实需要组合正文与补充规则。由 manifest 显式指定组件顺序，例如：

```json
{
  "id": "articles.draft",
  "version": 1,
  "file": "articles/draft.md",
  "components": ["articles.writer-tech-deep"],
  "variables": ["brief", "facts", "length_range"],
  "output": { "format": "markdown" }
}
```

`components` 中的每个 ID 必须唯一且已登记。组合次序固定，禁止业务代码在加载后随意追加未登记的提示词。短且只服务于一个任务的规则直接放该任务文件；确实跨任务复用的规则才拆成 shared component，避免为一句话过度拆文件。

## 4. 元数据和占位变量

提示词正文用明确占位符，例如：

```text
根据已确认简报和事实材料，写出完整文章。

【简报】
{{brief}}
```

元数据放 `manifest.json`，而不是靠 Markdown 标题或 front matter 推断：

- `id`：稳定、唯一的提示词 ID。
- `version`：整数版本；改变提示词语义或契约时递增。
- `file`：相对 `prompts/` 的文件路径。
- `components`：可选的、显式排序的提示词片段 ID。
- `variables`：本任务允许注入的变量名。
- `output`：文本、严格 JSON、HTML 或原生工具等输出约定。
- `owner` / `purpose`：维护模块与用途说明。

变量替换采用单一 loader：只替换已登记变量；变量缺失、未知变量或替换后残留 `{{...}}` 时直接失败，不静默留给模型猜测。动态业务数据应作为 user message 或明确变量提供，不混进 manifest。

## 5. 运行时边界

- **提示词资产**：说明模型当前要做的单一工作，以及必要的事实/表达约束。
- **业务编排代码**：决定执行阶段、准备上下文、调用工具、重试、保存产物和执行确定性门禁。
- **技能**：保留可被用户选择/配置的领域流程和创作方法；由具体任务声明是否加载，禁止无条件把整套技能正文再叠加到所有阶段。
- **Schema/校验器**：机器可验证的输出结构优先由 JSON Schema 或代码校验；提示词描述输出意图，不作为唯一门禁。
- **动态材料**：简报、事实、评论、来源、用户回答、模板能力等都作为数据传递，并使用现有的不可信输入边界保护，不被当作指令。

每次请求通过统一 API 解析，例如 `resolvePrompt('articles.review', { brief, facts, article })`，返回：

```js
{
  id: 'articles.review',
  version: 1,
  componentIds: ['articles.review'],
  sourceHashes: { 'articles.review': 'sha256:...' },
  system: '展开后的 system prompt',
  user: '本次 user 内容'
}
```

实际结构可按 Gateway 接口调整，但调用方不应自行拼 prompt 字符串。

## 6. 版本追踪与复现

每次模型调用至少记录：

- 主 prompt ID 和版本。
- 参与组合的 component ID、版本及哈希。
- 最终展开后的 system/user 消息快照，或现有 generation snapshot 引用。
- 模型、purpose、调用时间及输出契约版本。

仅记录版本号不足以复现；必须保留快照或可校验的原始内容。提示词正文进入 Git 后天然支持 diff 与回滚；版本字段用于运行记录和兼容判断，不替代 Git 历史。

## 7. 方案比较

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| 继续使用源码常量 | 当前改动小、类型检查方便 | 提示词和逻辑耦合，跨模块仍分散 | 不作为目标方案 |
| 一个类别一个 Markdown，再用标题/分隔符切分 | 文件少 | 要维护解析格式，边界和选择逻辑易漂移；误把整文件传给模型会泄漏其他任务指令 | 不推荐 |
| **一个任务/复用片段一个 Markdown + JSON manifest** | 边界由文件保证；正文易读；组合/变量显式；Git 可审阅回滚 | 要建设 loader、manifest 校验和迁移 | **推荐** |
| 外部提示词管理服务 | 可做在线版本、审批和实验 | 引入外部依赖、服务配置和运行差异；当前并非必要 | 暂不采用 |

## 8. 分阶段实施步骤

### 阶段 A：建立目录与解析器

1. 创建 `prompts/` 和 `manifest.json` schema。
2. 实现只读 loader：加载 UTF-8 文件、校验唯一 ID/路径/变量/组件引用、展开变量、计算 SHA-256。
3. 为错误场景增加自动化用例：缺文件、重复 ID、缺少变量、未知变量、循环组件和残留占位符。
4. 不迁移业务调用，不改变现有运行行为。

### 阶段 B：迁移文章成稿主链

1. 将 `ARTICLE_PROMPTS` 七阶段原文逐条迁入 `prompts/articles/*.md`。
2. 迁 writer route 短提示为显式 component。
3. 保留当前 prompt 文本、模型参数、消息角色和变量内容，先做等价迁移。
4. 让 `article-pipeline.mjs` 通过 loader 获取提示词；保留 `00-prompt-manifest.json`，升级为记录 asset ID、版本、component hashes 和实际快照。
5. 对同一输入比较迁移前后的展开后消息字节内容，确保迁移本身不改变提示词。

### 阶段 C：迁移其他模型调用

按风险和调用量分批迁移：早报/教程 → 研判与素材整理 → 图文 → 主题/模板 → 内容复盘和低频工具任务。每批只迁移一个模块，保持输出和调用参数不变。

### 阶段 D：清理与收口

1. 搜索源码中遗留的硬编码 system prompt 和 prompt suffix。
2. 对仍留在代码里的字符串逐个登记例外原因，例如短探针、确定性格式提示或不适合由编辑维护的协议约束。
3. CI 校验所有已迁移任务都能解析、变量闭合、组件存在；禁止新增长篇 prompt 字符串而没有登记。
4. 观察一次真实成稿链 trace，确认快照中的最终消息与资产文件一致。

## 9. 回滚与未完成事项

- 每阶段迁移均保持旧提示词常量可在单独提交中恢复；迁移阶段不同时改写提示词语义。
- 若展开后快照不一致，回滚该模块调用适配，不回滚其他模块。
- 本方案尚未决定 manifest 是否要记录模型路由默认值；建议模型路由仍由现有技能/配置系统控制，避免重复形成第二套配置。
- 本方案也未定义运行时网页编辑器。第一阶段继续通过 Git 修改提示词，先验证文件式管理能否解决审阅和追踪问题。

## 10. 参考

- [项目内硬编码提示词盘点](../hardcoded-prompt-inventory.md)
- [现有文章提示词清单](../article-pipeline-prompt-inventory.md)
- [文章优化提示词设计](article-pipeline-optimized-prompts.md)
- OpenAI 官方关于提示词版本化/快照及应用编排分离的说明：[Assistants migration guide](https://platform.openai.com/docs/assistants/migration)。本方案只参考版本管理原则，不依赖 OpenAI 托管提示词。
- OpenAI 官方建议针对模型版本变化实施 eval：[API Reference introduction](https://platform.openai.com/docs/api-reference/introduction?lang=node.js)。
