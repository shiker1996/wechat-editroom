---
name: jianzi-topic-to-article
description: 使用见字工作台完成热点采集、选题研判、文章简报和成稿。适用于用户要求找热点、筛选选题、写公众号文章或从采集到成稿完整处理。
---

# 采集、研判与文章成稿

## 工作流

1. 调用 `jianzi_batches_list` 复用用户指定的批次；没有合适批次时先创建 `jianzi_batch_create`。
2. 调用 `jianzi_batch_collect` 启动采集，再用 `jianzi_job_wait` 等待完成。报告失败来源，不要把部分成功说成完整采集。
3. 研判有两种路径：
   - 外部 Agent 路径：读取 `jianzi_batch_ranking` 和候选来源，结合账号画像独立研判；只把用户选中的热点通过 `jianzi_candidate_add` 加入候选。
   - 工作台 AI 路径：用户选择内部 AI 自动研判时调用 `jianzi_batch_auto_research`，等待任务完成，并读取排名与候选。
4. 对已加入候选池的选题，先调用 `jianzi_candidate_source_fetch` 抓取并保存关联原文，再读取 `jianzi_candidate_get` 获取来源、事实和现有编辑决策；读取 `jianzi_account_profile` 了解受众与账号定位。原文抓取失败时先报告原因，不要直接进入成稿。
5. 先输出选题理由、事实与未知项、切入角度和风险。保存编辑决策时调用 `jianzi_candidate_editorial_update`。锁题 `jianzi_candidate_lock` 会触发门禁；若未就绪，按错误补齐事实或研判，不绕过门禁。
6. 用户要求工作台内部 AI 成稿时调用 `jianzi_article_generate` 并等待任务。生成完成后用 `jianzi_article_documents` 查验产物；再按请求调用排版和封面流程。

## 工具和模型边界

- Agent 可以自行做选题比较与编辑判断，不需要把 Codex/WorkBuddy 模型凭据写入见字。
- `jianzi_batch_auto_research`、`jianzi_article_generate` 按当前默认 Agent Runtime 执行；未接入外部 Runtime 时使用工作台已配置的模型。
- 不虚构来源、事实或作者经历；无法核验的内容应保留为待核实问题。
- 不自动发布到公众号。最终选择和发布由用户完成。
