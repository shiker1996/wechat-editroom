# 外部 Agent 执行见字生成流程设计

> 状态：MCP 外部执行路径已接入首轮实现；本文记录当前契约与后续边界。

## 目标

由 Codex、WorkBuddy、DSH 等外部 Agent 执行需要模型判断和创作的步骤；见字通过 MCP 提供业务上下文与结果提交入口，继续承担数据持久化、事实/结构门禁、浏览器审计、产物归档和任务追踪。现有内置模型入口暂时保留，作为可选执行路径。

MCP 工具只公开业务操作，不映射每个内部 Agent、插件或数据库操作。Agent Skill 说明流程、输入依据、产物格式和用户确认点；MCP 工具提供受 schema 约束的上下文读取和结果提交。

## 每阶段的 MCP 契约

每个外部执行阶段采用相同生命周期：`prepare` 读取项目上下文、阶段约束和产物 schema；外部 Agent 根据项目 Skills 生成结果；`submit` 提交结果；见字调用现有校验和保存逻辑，返回 gate、artifact 和 job 状态。大型渲染、截图等工作返回现有 job ID，Agent 通过 `jianzi_job_wait` 查询。

| 内置工作 | 外部 Agent 取得的上下文 | 外部提交 | 见字仍执行 |
|---|---|---|---|
| 批次打标、事件聚类与研判 | `jianzi_batch_hotspots`、账号画像、稳定事件分组和事件卡 | `jianzi_batch_tags_submit`、`jianzi_batch_event_cards_submit`、`jianzi_batch_research_submit` | 校验批次/事件/热点归属，写回标签、事件卡和研判报告；排名继续采用现有确定性评分 |
| 编辑室 | 候选事实、来源抓取、历史编辑决策、文章简报契约 | `jianzi_candidate_editorial_update`、`jianzi_candidate_lock` | 编辑室门禁、锁题状态和简报产物写回 |
| 文章成稿与审稿 | 锁定简报、事实包、作者资产、目标写作 Skill 和长度/风险契约 | Markdown 草稿或终稿，通过 `jianzi_article_document_save` 回写 | 文档与 Artifact 归档；终稿由调用 Agent 负责自审，既有内部生成门禁只在内部路径运行 |
| 公众号排版 | 终稿和外部 Agent 生成的 HTML | `jianzi_article_typeset_submit` | 结构保真校验、公众号规范化、确定性 HTML 门禁和 Artifact 归档 |
| 封面 | 标题、摘要和 900×383 画布约束 | `jianzi_cover_submit` 提交 HTML/CSS | 封面安全/标题/画布门禁、浏览器截图和 PNG/HTML 归档 |
| 图文故事板与视觉生成 | 事实基座、候选原文、已锁定故事板与分页契约 | `jianzi_card_editorial_update`、`jianzi_card_lock`、生成中反复调用 `jianzi_card_visual_audit`、最终调用 `jianzi_card_visual_submit` | CARD GATE、页数/文案校验、浏览器逐页溢出审计、截图和 PNG/HTML 归档 |

## 运行时行为

- 外部结果写入都通过明确命名的 MCP 工具，不允许任意文件路径写入或任意 HTTP 转发。
- 每次提交绑定 batch/candidate、阶段、输入快照摘要和外部运行来源；保存前重新读取当前状态，拒绝过期简报、未锁定候选或不匹配的事实引用。
- `prepare` 返回阶段特定的精简上下文，不返回 provider 密钥、内部日志或无关全量数据库内容。
- `submit` 使用现有领域服务和门禁。校验失败返回结构化问题列表及可修复字段，不把无效产物标记为完成。
- 需要外部上传的 HTML/资源以内容字段或受控资源包提交；路径限制在服务端生成的候选工作目录中，拒绝路径穿越、脚本和不允许的外链资源。
- 高影响动作仍由用户确认；MCP Skill 不代替授权，也不自动发布公众号。

## 实施顺序

1. **文章外部生成**：MCP 保存草稿/终稿，提供回读；外部 Agent 根据锁定简报写作。
2. **批次和编辑判断**：接入打标、稳定事件分组、事件卡和研判报告的结构化提交；复用热点/排名/候选 API。
3. **排版与封面导入**：接入外部 HTML，执行既有规范化、门禁、截图和归档。
4. **图文视觉导入**：沿用故事板更新/锁定，接入外部 HTML/文案、浏览器溢出审计、截图和归档。
5. **编辑室对话**：使用候选上下文读取和结构化决策保存；外部 Agent 维护对话上下文，工作台负责锁题门禁和简报写回。
6. **端到端验证**：需在配置好的测试副本中通过 MCP/Skills 实际跑批次和创作流程；本次只完成代码实现与静态审阅，未运行测试或外部流程。

## 当前实现边界

现有 `jianzi_batch_auto_research`、`jianzi_article_generate`、`jianzi_article_typeset`、`jianzi_cover_generate`、`jianzi_card_storyboard_generate` 和 `jianzi_card_generate` 仍保留为显式内部模型路径；Skills 默认指导外部 Agent 生成并提交。外部排版与视觉提交通道目前同步运行浏览器门禁，可能需要较长 MCP 调用时间；不支持通过 HTML 接口直接上传任意本地图片文件，只接受 HTML 内可访问的资源。端到端真实生成与截图尚待在测试副本验证。
