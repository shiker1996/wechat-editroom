---
name: jianzi-topic-to-article
description: 使用见字工作台完成热点采集、选题研判、文章简报和成稿。适用于用户要求找热点、筛选选题、写公众号文章或从采集到成稿完整处理。
---

# 采集、研判与文章成稿

## 工作流

1. 调用 `jianzi_batches_list` 复用用户指定的批次；没有合适批次时先创建 `jianzi_batch_create`。
2. 调用 `jianzi_batch_collect` 启动采集，再用 `jianzi_job_wait` 等待完成。报告失败来源，不要把部分成功说成完整采集。
3. 外部 Agent 路径：先调用 `jianzi_account_profile` 获取真实账号画像，再调用 `jianzi_batch_hotspots` 读取原始热点与项目发现元数据，按项目 `hotspot-tagging` Skill 执行打标；分批调用 `jianzi_batch_tags_submit` 保存标签。然后调用 `jianzi_batch_events` 获取稳定事件组，逐事件综合原文形成事件事实卡，每次最多 200 张调用 `jianzi_batch_event_cards_submit`；根据返回的 `completed`、`total`、`remaining` 继续提交，直到 `remaining` 为 0，再读取 `jianzi_batch_ranking`，结合事件卡和账号画像完成研判，用 `jianzi_batch_research_submit` 提交命题、切入角度、读者利益、风险理由及 `scoreInputs`（H/B/J、竞争饱和扣分、重复扣分）。最终分由工作台按 T/J/A/C/F 公式计算；检查返回榜单和分项后，再由用户选择是否调用 `jianzi_candidate_add` 入池。只有用户选中的热点才通过 `jianzi_candidate_add` 加入候选。
   - 打标必须遵循 `hotspot-tagging` Skill，只处理 `researchEligible: true` 的热点：分类使用账号配置，事件要素写入 `eventParts.who/what`（系统据此生成 `eventKey`）；分数上限 conflict/audience=20、informationGain/emotion=15、timeliness/impact/sourceReliability=10。风险只标记不擅自删除热点。
   - 文章与图文分别选题：文章按研判返回的 T/J/A/C/F 榜单供用户选择；图文另调用 `jianzi_batch_social_ranking` 查看项目内置的 G_social、`selected`、`candidateEligible`、`materialType` 和理由。用户确认后分别调用 `jianzi_candidate_add`：文章用 `tracks:["article"]`；工具/项目图文用 `tracks:["social_cards"],socialMaterialType:"repository"`，事件图文用 `socialMaterialType:"event"`。不要用文章 F 分替代图文 G_social。
   - 若用户明确选择见字内部 AI 自动研判，才调用 `jianzi_batch_auto_research`。
4. 读取 `jianzi_candidate_get` 获取来源、事实和现有编辑决策；读取 `jianzi_account_profile` 了解受众与账号定位。
5. 先输出选题理由、事实与未知项、切入角度和风险。保存编辑决策时调用 `jianzi_candidate_editorial_update`。锁题 `jianzi_candidate_lock` 会触发门禁；若未就绪，按错误补齐事实或研判，不绕过门禁。
6. 锁题通过后，由外部 Agent 按事实基座、简报和文章 Skill 完成写作与自审；调用 `jianzi_article_document_save` 保存为 `draft`。用户确认终稿后，再以 `final` 保存。用 `jianzi_article_documents` 回读确认已落库。只有用户明确要求见字内部 AI 成稿时，才调用 `jianzi_article_generate`。

## 工具和模型边界

- Agent 可以自行做选题比较与编辑判断，不需要把 Codex/WorkBuddy 模型凭据写入见字。
- `jianzi_batch_auto_research`、`jianzi_article_generate` 会调用工作台已配置的模型；外部 Agent 写作后通过 `jianzi_article_document_save` 保存，不需要见字内部模型。
- 不虚构来源、事实或作者经历；无法核验的内容应保留为待核实问题。
- 不自动发布到公众号。最终选择和发布由用户完成。
